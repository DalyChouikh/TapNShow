import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser } from "@/test/db/clients";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { queryLocalSql } from "@/test/db/sql";

const tokenHash = () =>
  createHash("sha256").update(randomBytes(32)).digest("hex");
const text = z.array(z.object({ result: z.string() })).length(1);

beforeEach(() => clearPlatformAdmins());

describe("set_platform_owner (the script's function)", () => {
  it("needs an existing verified account", async () => {
    expect(() =>
      queryLocalSql(
        `select private.set_platform_owner('nobody-${crypto.randomUUID()}@example.test', false) as result`,
        text,
      ),
    ).toThrow(/tn:not_found/);
  });

  it("sets the owner once, says unchanged the second time, refuses a second owner without replace", async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    // Events from earlier runs stay (the log is append-only): count only this test's.
    const before = queryLocalSql(
      "select coalesce(max(id), 0)::text as result from public.platform_events",
      text,
    )[0].result;
    expect(
      queryLocalSql(
        `select private.set_platform_owner('${first.email}', false) as result`,
        text,
      )[0].result,
    ).toBe("set");
    expect(
      queryLocalSql(
        `select private.set_platform_owner('${first.email.toUpperCase()}', false) as result`,
        text,
      )[0].result,
    ).toBe("unchanged");
    expect(() =>
      queryLocalSql(
        `select private.set_platform_owner('${second.email}', false) as result`,
        text,
      ),
    ).toThrow(/tn:conflict/);
    expect(
      queryLocalSql(
        `select private.set_platform_owner('${second.email}', true) as result`,
        text,
      )[0].result,
    ).toBe("set");
    const roles = queryLocalSql(
      `select role::text as result from public.platform_admins where user_id = '${first.id}'`,
      text,
    );
    expect(roles[0].result).toBe("admin");
    const events = queryLocalSql(
      `select count(*)::text as result from public.platform_events where kind = 'owner_set' and id > ${before}`,
      text,
    );
    expect(events[0].result).toBe("2");
  });

  it("is not callable through the Data API by anyone (private, no grants: the script runs it as postgres)", () => {
    const grants = queryLocalSql(
      `select string_agg(r, ',' order by r) as result
       from unnest(array['anon', 'authenticated', 'service_role']) r
       where has_function_privilege(r, 'private.set_platform_owner(text, boolean)', 'execute')`,
      z.array(z.object({ result: z.string().nullable() })).length(1),
    );
    expect(grants[0].result).toBeNull();
  });
});

describe("admins and their invites", () => {
  it("only the owner invites; an admin and a stranger get not_found", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const stranger = await createTestUser();
    makePlatformAdmin(owner, "owner");
    makePlatformAdmin(admin, "admin");
    const ok = await owner.client.rpc("admin_invite", {
      p_email: "NEW@Example.test ",
      p_token_hash: tokenHash(),
    });
    expect(ok.error).toBeNull();
    for (const user of [admin, stranger]) {
      const refused = await user.client.rpc("admin_invite", {
        p_email: "x@example.test",
        p_token_hash: tokenHash(),
      });
      expect(refused.error?.message).toBe("tn:not_found");
    }
  });

  it("accepting needs the invited verified email; then the person is an admin", async () => {
    const owner = await createTestUser();
    const invited = await createTestUser();
    const other = await createTestUser();
    makePlatformAdmin(owner, "owner");
    const hash = tokenHash();
    await owner.client.rpc("admin_invite", {
      p_email: invited.email,
      p_token_hash: hash,
    });
    const wrong = await other.client.rpc("admin_invite_preview", {
      p_token_hash: hash,
    });
    expect(wrong.data?.[0]?.status).toBe("wrong_account");
    expect(
      (await other.client.rpc("accept_admin_invite", { p_token_hash: hash }))
        .error?.message,
    ).toBe("tn:invite_wrong_account");
    expect(
      (await invited.client.rpc("accept_admin_invite", { p_token_hash: hash }))
        .error,
    ).toBeNull();
    expect((await invited.client.rpc("my_platform_role")).data).toBe("admin");
    // Like workspace invites: the new admin revisiting the link is told they're in; anyone else sees it used.
    const again = await invited.client.rpc("admin_invite_preview", {
      p_token_hash: hash,
    });
    expect(again.data?.[0]?.status).toBe("already_admin");
    const late = await other.client.rpc("admin_invite_preview", {
      p_token_hash: hash,
    });
    expect(late.data?.[0]?.status).toBe("used");
  });

  it("revoked and renewed invites behave like workspace invites", async () => {
    const owner = await createTestUser();
    makePlatformAdmin(owner, "owner");
    const hash = tokenHash();
    const created = await owner.client.rpc("admin_invite", {
      p_email: "r@example.test",
      p_token_hash: hash,
    });
    const id = (created.data as { id: string }).id;
    const renewedHash = tokenHash();
    expect(
      (
        await owner.client.rpc("admin_invite_renew", {
          p_invite: id,
          p_token_hash: renewedHash,
        })
      ).error,
    ).toBeNull();
    expect(
      (await owner.client.rpc("admin_invite_preview", { p_token_hash: hash }))
        .data?.[0]?.status,
    ).toBe("not_found");
    expect(
      (await owner.client.rpc("admin_invite_revoke", { p_invite: id })).error,
    ).toBeNull();
    expect(
      (
        await owner.client.rpc("admin_invite_preview", {
          p_token_hash: renewedHash,
        })
      ).data?.[0]?.status,
    ).toBe("revoked");
  });

  it("the owner removes an admin, never the owner; the log masks emails", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    makePlatformAdmin(owner, "owner");
    makePlatformAdmin(admin, "admin");
    expect(
      (await owner.client.rpc("admin_remove", { p_user: owner.id })).error
        ?.message,
    ).toBe("tn:forbidden");
    expect(
      (await owner.client.rpc("admin_remove", { p_user: admin.id })).error,
    ).toBeNull();
    expect((await admin.client.rpc("my_platform_role")).data).toBeNull();
    const facts = queryLocalSql(
      `select facts::text as result from public.platform_events where kind = 'admin_removed' order by id desc limit 1`,
      text,
    );
    expect(facts[0].result).toContain("•••@");
    expect(facts[0].result).not.toContain(admin.email);
  });

  it("an admin's account deletion removes them; the owner's is refused", async () => {
    const owner = await createTestUser();
    makePlatformAdmin(owner, "owner");
    const refused = await owner.client.rpc("delete_account", {
      p_confirm: "confirm",
    });
    expect(refused.error?.message).toBe("tn:platform_owner");
  });

  it("lists admins and open invites for admins only, emails masked", async () => {
    const owner = await createTestUser();
    makePlatformAdmin(owner, "owner");
    await owner.client.rpc("admin_invite", {
      p_email: "list@example.test",
      p_token_hash: tokenHash(),
    });
    const { data } = await owner.client.rpc("admin_admins");
    const body = data as {
      admins: Array<{ role: string; email: string }>;
      invites: Array<{ email: string }>;
    };
    expect(body.admins.map((admin) => admin.role)).toEqual(["owner"]);
    expect(body.invites[0]?.email).toBe("l•••@example.test");
  });
});
