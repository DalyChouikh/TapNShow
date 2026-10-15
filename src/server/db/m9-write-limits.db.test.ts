import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ROUTES, type LimitRule } from "@/server/http/route-registry";
import { adminClient, createTestUser } from "@/test/db/clients";
import { withLimit } from "@/test/db/limits";
import { queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const flag = z.array(z.object({ ok: z.boolean() })).length(1);
const rules = Object.values(ROUTES).flatMap((methods) =>
  Object.values(methods).flatMap((entry) => entry?.limits ?? []),
);
const userRules = rules.filter(
  (rule): rule is Extract<LimitRule, { kind: "user" }> => rule.kind === "user",
);
const writeRules = rules.filter(
  (rule): rule is Extract<LimitRule, { kind: "write" }> =>
    rule.kind === "write",
);

describe("route registry against the database (spec §10)", () => {
  it.each(userRules.map((rule) => [rule.in, rule.action]))(
    "%s spends %s",
    (fn, action) => {
      const [schema, name] = fn.split(".");
      const [row] = queryLocalSql(
        `select bool_or(pg_get_functiondef(p.oid) like '%''${action}%') as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = '${schema}' and p.proname = '${name}'`,
        flag,
      );
      expect(row.ok).toBe(true);
    },
  );

  it.each(writeRules.map((rule) => [rule.table, rule.action]))(
    "%s has the write trigger for %s",
    (table, action) => {
      const [row] = queryLocalSql(
        `select exists (select 1 from pg_trigger t where t.tgrelid = '${table}'::regclass and not t.tgisinternal
           and t.tgfoid = 'private.limit_direct_writes'::regproc
           and encode(t.tgargs, 'escape') like '${action}%') as ok`,
        flag,
      );
      expect(row.ok).toBe(true);
    },
  );

  it("maps every user and write action to a limit that exists", () => {
    // workspace_create predates hit_user_rate_limit (its own key in create_workspace).
    const actions = [
      ...new Set([...userRules, ...writeRules].map((rule) => rule.action)),
    ].filter((action) => action !== "workspace_create");
    const [{ body }] = queryLocalSql(
      "select pg_get_functiondef('private.hit_user_rate_limit(text)'::regprocedure) as body",
      z.array(z.object({ body: z.string() })).length(1),
    );
    for (const action of actions) {
      expect(body, action).toContain(`when '${action}' then`);
    }
  });
});

describe("direct-write limits (M9)", () => {
  it("refuses the write past the limit, with tn:rate_limited", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Write Limits");
    await withLimit("list_writes_per_user_per_hour", 2, async () => {
      for (const name of ["A", "B"]) {
        const { error } = await owner.client
          .from("lists")
          .insert({ workspace_id: workspace.id, name });
        expect(error).toBeNull();
      }
      const { error } = await owner.client
        .from("lists")
        .insert({ workspace_id: workspace.id, name: "C" });
      expect(error?.message).toBe("tn:rate_limited");
    });
  });

  it("counts one invoker call once, however many tables it writes", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "One Call");
    const { data: list } = await owner.client
      .from("lists")
      .insert({ workspace_id: workspace.id, name: "Team" })
      .select("id")
      .single();
    const { data: contact } = await owner.client
      .from("contacts")
      .insert({
        workspace_id: workspace.id,
        email: "a@example.test",
        full_name: "A",
      })
      .select("id")
      .single();
    await withLimit("contact_writes_per_user_per_hour", 1, async () => {
      // update_contact updates the contact and replaces its lists: three statements, one unit.
      const first = await owner.client.rpc("update_contact", {
        p_workspace: workspace.id,
        p_contact: contact!.id,
        p_full_name: "A B",
        p_email: "a@example.test",
        p_list_ids: [list!.id],
      });
      expect(first.error).toBeNull();
      const second = await owner.client.rpc("update_contact", {
        p_workspace: workspace.id,
        p_contact: contact!.id,
        p_full_name: "A C",
        p_email: "a@example.test",
        p_list_ids: [],
      });
      expect(second.error?.message).toBe("tn:rate_limited");
    });
  });

  it("never counts SECURITY DEFINER writes (create_meeting inserts meetings)", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Definer");
    // Limits stay above 0 (the table's check): spend the one unit with a direct write first.
    await withLimit("meeting_writes_per_user_per_hour", 1, async () => {
      const first = await owner.client.rpc("create_meeting", {
        p_workspace: workspace.id,
      });
      expect(first.error).toBeNull();
      const direct = await owner.client
        .from("meetings")
        .update({ title: "Spent" })
        .eq("id", first.data!);
      expect(direct.error).toBeNull();
      const { error } = await owner.client.rpc("create_meeting", {
        p_workspace: workspace.id,
      });
      expect(error).toBeNull();
    });
  });

  it("never counts the service role", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Service");
    await withLimit("workspace_writes_per_user_per_hour", 1, async () => {
      const direct = await owner.client
        .from("workspaces")
        .update({ name: "Owner Renamed" })
        .eq("id", workspace.id);
      expect(direct.error).toBeNull();
      const { error } = await adminClient()
        .from("workspaces")
        .update({ name: "Service Renamed" })
        .eq("id", workspace.id);
      expect(error).toBeNull();
    });
  });
});

describe("shared Wi-Fi (Review Focus 1)", () => {
  it("lets 100 members behind one IP open and answer their own links", async () => {
    const admin = adminClient();
    for (let member = 0; member < 100; member += 1) {
      const tokenHash = `${member}`.padStart(64, "0");
      for (let request = 0; request < 3; request += 1) {
        const { data } = await admin.rpc("check_token_rate_limit", {
          p_ip: "203.0.113.50",
          p_token_hash: tokenHash,
        });
        expect(data, `member ${member} request ${request}`).toBe(true);
      }
    }
  });
});

describe("wrapper and IP limits (M9)", () => {
  it("refuses a wrapper call past its limit", async () => {
    const user = await createTestUser();
    await withLimit("invite_previews_per_user_per_hour", 1, async () => {
      const first = await user.client.rpc("invite_preview", {
        p_token_hash: "0".repeat(64),
      });
      expect(first.error).toBeNull();
      const second = await user.client.rpc("invite_preview", {
        p_token_hash: "0".repeat(64),
      });
      expect(second.error?.message).toBe("tn:rate_limited");
    });
  });

  it("limits Google sign-in starts per IP and rejects unknown actions", async () => {
    await withLimit("google_signin_per_ip_per_hour", 1, async () => {
      const admin = adminClient();
      const first = await admin.rpc("check_ip_rate_limit", {
        p_action: "google_signin",
        p_ip: "198.51.100.7",
      });
      expect(first.data).toBe(true);
      const second = await admin.rpc("check_ip_rate_limit", {
        p_action: "google_signin",
        p_ip: "198.51.100.7",
      });
      expect(second.data).toBe(false);
      const other = await admin.rpc("check_ip_rate_limit", {
        p_action: "google_signin",
        p_ip: "198.51.100.8",
      });
      expect(other.data).toBe(true);
      const unknown = await admin.rpc("check_ip_rate_limit", {
        p_action: "made_up",
        p_ip: "198.51.100.7",
      });
      expect(unknown.error?.message).toBe("tn:invalid_input");
    });
  });
});
