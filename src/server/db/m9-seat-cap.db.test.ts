import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser, type TestUser } from "@/test/db/clients";
import { withLimit } from "@/test/db/limits";
import { holdLocalTransaction, queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";
import { createInviteAs } from "@/test/db/invites";

const flag = z.array(z.object({ ok: z.boolean() })).length(1);

describe("bounded reads return one result (spec §10)", () => {
  it.each([
    "roster",
    "attendance_summary",
    "meeting_audience",
    "meeting_results",
    "my_account",
  ])(
    "public.%s returns a single value, so max_rows can never cut it",
    (name) => {
      const [row] = queryLocalSql(
        `select bool_and(not p.proretset) as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = '${name}'`,
        flag,
      );
      expect(row.ok).toBe(true);
    },
  );

  it("caps seats below the Data API's max_rows (1,000), so /api/me lists them all", () => {
    const [row] = queryLocalSql(
      `select private.app_limit('workspace_seats_per_user_max') < 1000 as ok`,
      flag,
    );
    expect(row.ok).toBe(true);
  });
});

async function acceptInto(owner: TestUser, member: TestUser) {
  const workspace = await createWorkspaceAs(owner, "Seat Club");
  const tokenHash = await createInviteAs(
    owner,
    workspace.id,
    member.email,
    "viewer",
  );
  return member.client.rpc("accept_invite", { p_token_hash: tokenHash });
}

describe("workspace seats per person (M9)", () => {
  it("refuses an invite past the cap and a new workspace past it", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    await withLimit("workspace_seats_per_user_max", 2, async () => {
      await createWorkspaceAs(member, "Own One");
      expect((await acceptInto(owner, member)).error).toBeNull();
      expect((await acceptInto(owner, member)).error?.message).toBe(
        "tn:workspace_seats_limit_reached",
      );
      await expect(createWorkspaceAs(member, "Own Two")).rejects.toMatchObject({
        message: "tn:workspace_seats_limit_reached",
      });
    });
  });

  it("makes a second seat wait for the first and then refuses it (two at once)", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    // The owner's own two seats come first: the cap of 1 below is about the member.
    const workspaceA = await createWorkspaceAs(owner, "A");
    const workspaceB = await createWorkspaceAs(owner, "B");
    await withLimit("workspace_seats_per_user_max", 1, async () => {
      const hashB = await createInviteAs(
        owner,
        workspaceB.id,
        member.email,
        "viewer",
      );
      // A first seat is being added for the member and not committed yet...
      const held = await holdLocalTransaction(
        `insert into public.workspace_roles (workspace_id, user_id, role)
         values ('${workspaceA.id}', '${member.id}', 'viewer')`,
        2,
      );
      // ...when the member accepts another invite: it waits for that seat, then sees it.
      const accepted = await member.client.rpc("accept_invite", {
        p_token_hash: hashB,
      });
      await held.released;
      expect(accepted.error?.message).toBe("tn:workspace_seats_limit_reached");
    });
  });
});
