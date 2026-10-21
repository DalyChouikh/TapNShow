import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { serviceRpc } from "@/test/db/outbox";
import { seedConnection } from "@/test/db/sender";
import {
  cleanupsOf,
  makeCleanupsDue,
  makeSharesDue,
  seedShare,
  seedSharedSheet as seedTeamSheet,
  setSheetTeamSharing,
  shareTargetsOf,
  sharesDueOf,
  sharesOf,
} from "@/test/db/sheet-shares";
import { seedSheet } from "@/test/db/sheets";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import { parkAllWork } from "@/test/db/workers";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { SHEET_SHARE_REASONS, SHEET_SHARE_STATES } from "@/shared/api/sheets";
import { createShareStore } from "./sheet-shares";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

/** Seeds an active sheet with a file, held by `holder`'s Google account (the Owner's by default). */
const seedSharedSheet = (
  googleEmail = "club@example.test",
  holder: TestUser = owner,
) => seedTeamSheet(workspace.id, holder.id, googleEmail);

/** The Owner turns the sheet off; the test stops at once if the database refused. */
async function turnOff() {
  const { data, error } = await owner.client.rpc("turn_off_sheet", {
    p_workspace: workspace.id,
  });
  if (error) {
    throw error;
  }
  return data;
}

const sharesDueNow = (workspaceId: string) =>
  queryLocalSql(
    `select private.sheet_shares_due(s) as due from public.sheet_syncs s where s.workspace_id = '${workspaceId}'`,
    z.array(z.object({ due: z.boolean() })).length(1),
  )[0].due;

const workersDue = () =>
  queryLocalSql(
    "select private.workers_due() as due",
    z.array(z.object({ due: z.boolean() })).length(1),
  )[0].due;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Sheet Owner" });
  admin = await createTestUser({ fullName: "Sara Admin" });
  viewer = await createTestUser({ fullName: "Ali Viewer" });
  workspace = await createWorkspaceAs(owner, "Robotics Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("who the Google Sheet is shared with", () => {
  it("wants every team member except the sheet's own Google account", async () => {
    await seedSharedSheet(owner.email.toUpperCase());
    expect(shareTargetsOf(workspace.id)).toEqual([
      { email: admin.email, position: 1 },
      { email: viewer.email, position: 2 },
    ]);
  });

  it("wants the Owner too when the sheet is in another Google account", async () => {
    await seedSharedSheet("club@example.test");
    expect(shareTargetsOf(workspace.id).map((t) => t.email)).toEqual([
      owner.email,
      admin.email,
      viewer.email,
    ]);
  });
});

describe("when a sheet's shares are due", () => {
  it("marks a sheet's shares due when someone joins, changes role or leaves", async () => {
    await seedSharedSheet();
    const start = await sharesDueOf(workspace.id);
    const newcomer = await createTestUser();
    await addMember(workspace.id, newcomer.id, "viewer");
    expect((await sharesDueOf(workspace.id)).version).toBe(start.version + 1);
    const changed = await owner.client.rpc("change_role", {
      p_workspace: workspace.id,
      p_user: newcomer.id,
      p_role: "admin",
      p_can_check_in: false,
    });
    expect(changed.error).toBeNull();
    expect((await sharesDueOf(workspace.id)).version).toBe(start.version + 2);
    const removed = await owner.client.rpc("remove_member", {
      p_workspace: workspace.id,
      p_user: newcomer.id,
    });
    expect(removed.error).toBeNull();
    const after = await sharesDueOf(workspace.id);
    expect(after.version).toBe(start.version + 3);
    expect(after.dueAt).not.toBeNull();
  });

  it("leaves a workspace without a sheet alone", async () => {
    const other = await createWorkspaceAs(owner, "No Sheet Club");
    await addMember(other.id, admin.id, "viewer");
    const rows = queryLocalSql(
      `select count(*)::int as n from public.sheet_syncs where workspace_id = '${other.id}'`,
      z.array(z.object({ n: z.number().int() })).length(1),
    );
    expect(rows[0].n).toBe(0);
  });

  it("marks shares due when the sheet gets its file or resumes", async () => {
    const connection = await seedConnection(owner.id, {
      scopes: [DRIVE_FILE_SCOPE],
    });
    await seedSheet(workspace.id, connection.id, { googleSub: connection.sub });
    const start = await sharesDueOf(workspace.id);
    const filed = await adminClient()
      .from("sheet_syncs")
      .update({ spreadsheet_id: "file-abcdefghijkl" })
      .eq("workspace_id", workspace.id);
    expect(filed.error).toBeNull();
    expect((await sharesDueOf(workspace.id)).version).toBe(start.version + 1);
    runLocalSql(
      `update public.sheet_syncs set status = 'paused', paused_reason = 'trashed' where workspace_id = '${workspace.id}'`,
    );
    runLocalSql(
      `update public.sheet_syncs set status = 'active', paused_reason = null where workspace_id = '${workspace.id}'`,
    );
    expect((await sharesDueOf(workspace.id)).version).toBe(start.version + 3);
  });

  it("marks every given sheet due (the migration marks every existing sheet)", async () => {
    await seedSharedSheet();
    runLocalSql(
      `update public.sheet_syncs set shares_due_at = null where workspace_id = '${workspace.id}'`,
    );
    runLocalSql(
      `select private.sheet_shares_mark(array['${workspace.id}'::uuid])`,
    );
    expect((await sharesDueOf(workspace.id)).dueAt).not.toBeNull();
  });
});

describe("the switch", () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it("is due only while the switch is on", async () => {
    await seedSharedSheet();
    parkAllWork();
    makeSharesDue(workspace.id);
    restore = setSheetTeamSharing(false);
    expect(sharesDueNow(workspace.id)).toBe(false);
    expect(workersDue()).toBe(false);
    setSheetTeamSharing(true);
    expect(sharesDueNow(workspace.id)).toBe(true);
    expect(workersDue()).toBe(true);
  });

  it("stays due while paused only with its file still in reach", async () => {
    await seedSharedSheet();
    makeSharesDue(workspace.id);
    restore = setSheetTeamSharing(true);
    // Owner, 2026-10-21: people who leave are still removed (the worker adds nobody until it
    // resumes). One query: the same predicate on the sheet's row paused for each reason.
    expect(
      queryLocalSql(
        `select r.reason, private.sheet_shares_due(pg_catalog.jsonb_populate_record(s,
           pg_catalog.jsonb_build_object('status', 'paused', 'paused_reason', r.reason))) as due
         from public.sheet_syncs s,
           unnest(array['trashed', 'full', 'drive_full', 'deleted', 'access_lost']) as r(reason)
         where s.workspace_id = '${workspace.id}' order by r.reason`,
        z.array(z.object({ reason: z.string(), due: z.boolean() })),
      ),
    ).toEqual([
      { reason: "access_lost", due: false },
      { reason: "deleted", due: false },
      { reason: "drive_full", due: true },
      { reason: "full", due: true },
      { reason: "trashed", due: true },
    ]);
  });
});

describe("share rows", () => {
  beforeEach(async () => {
    await seedSharedSheet();
    const { error } = await adminClient()
      .from("sheet_shares")
      .insert([
        {
          workspace_id: workspace.id,
          user_id: admin.id,
          email: admin.email,
          state: "shared",
          permission_id: "perm1",
        },
        {
          workspace_id: workspace.id,
          user_id: viewer.id,
          email: viewer.email,
          state: "refused",
          reason: "refused",
        },
      ]);
    if (error) {
      throw error;
    }
  });

  it("lets the Owner read every share row and a member only their own", async () => {
    const asOwner = await owner.client
      .from("sheet_shares")
      .select("email")
      .eq("workspace_id", workspace.id);
    expect(asOwner.data?.map((row) => row.email).sort()).toEqual(
      [admin.email, viewer.email].sort(),
    );
    const asViewer = await viewer.client
      .from("sheet_shares")
      .select("email")
      .eq("workspace_id", workspace.id);
    expect(asViewer.data?.map((row) => row.email)).toEqual([viewer.email]);
  });

  it("lets nobody write share rows", async () => {
    const inserted = await owner.client.from("sheet_shares").insert({
      workspace_id: workspace.id,
      email: "someone@example.test",
    });
    expect(inserted.error).not.toBeNull();
    await owner.client
      .from("sheet_shares")
      .update({ state: "shared" })
      .eq("workspace_id", workspace.id);
    await owner.client
      .from("sheet_shares")
      .delete()
      .eq("workspace_id", workspace.id);
    const expected = [
      {
        email: admin.email,
        state: "shared",
        permissionId: "perm1",
        reason: null,
      },
      {
        email: viewer.email,
        state: "refused",
        permissionId: null,
        reason: "refused",
      },
    ].sort((a, b) => a.email.localeCompare(b.email));
    expect(await sharesOf(workspace.id)).toEqual(expected);
  });

  it("keeps addresses lower-case", async () => {
    const { error } = await adminClient().from("sheet_shares").insert({
      workspace_id: workspace.id,
      email: "Mixed@Example.test",
    });
    expect(error).not.toBeNull();
  });
});

const connectionExists = async (id: string) => {
  const { data, error } = await adminClient()
    .from("google_connections")
    .select("id")
    .eq("id", id);
  if (error) {
    throw error;
  }
  return data.length === 1;
};

describe("removing the team's access before letting go", () => {
  it("keeps the team's shares to remove when the sheet is turned off, and holds the Google account until they are", async () => {
    const connection = await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "shared",
      permissionId: "perm2",
    });
    const off = await owner.client.rpc("turn_off_sheet", {
      p_workspace: workspace.id,
    });
    expect(off.error).toBeNull();
    expect(off.data).toEqual({ released: null });
    expect(await cleanupsOf(workspace.id)).toEqual([
      {
        permissionIds: ["perm1", "perm2"],
        emails: [],
        releaseAfter: true,
        connectionId: connection.id,
        tokenUserId: owner.id,
        hasToken: true,
      },
    ]);
    expect(await connectionExists(connection.id)).toBe(true);
  });

  it("looks up a share Google may have made when the run never recorded it", async () => {
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "sharing",
    });
    await turnOff();
    expect((await cleanupsOf(workspace.id))[0]).toMatchObject({
      permissionIds: [],
      emails: [admin.email],
    });
  });

  it("looks up an address Google refused, whose share may still have gone through", async () => {
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "refused",
      reason: "refused",
    });
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "refused",
      reason: "too_many",
    });
    await turnOff();
    expect((await cleanupsOf(workspace.id))[0]).toMatchObject({
      permissionIds: [],
      emails: [admin.email],
    });
  });

  it("leaves nothing to clean up when TapNShow shared nothing", async () => {
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "external",
    });
    const off = await owner.client.rpc("turn_off_sheet", {
      p_workspace: workspace.id,
    });
    expect(off.data).not.toEqual({ released: null });
    expect(await cleanupsOf(workspace.id)).toEqual([]);
  });

  it("keeps the old file's shares to remove when the Owner creates a new sheet", async () => {
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    const next = await seedConnection(owner.id, { scopes: [DRIVE_FILE_SCOPE] });
    const started = await adminClient().rpc("start_sheet", {
      p_user: owner.id,
      p_workspace: workspace.id,
      p_connection: next.id,
      p_replace: true,
    });
    expect(started.error).toBeNull();
    expect(await cleanupsOf(workspace.id)).toHaveLength(1);
    expect(await sharesOf(workspace.id)).toEqual([]);
    expect((await sharesDueOf(workspace.id)).dueAt).not.toBeNull();
  });

  it("keeps the shares to remove when the workspace is deleted", async () => {
    const connection = await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    const deleted = await owner.client.rpc("delete_workspace", {
      p_workspace: workspace.id,
      p_confirm_name: workspace.name,
    });
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual({ released: [] });
    expect(await cleanupsOf(workspace.id)).toHaveLength(1);
    expect(await connectionExists(connection.id)).toBe(true);
  });

  it("keeps the shares to remove when the person whose Google account holds the sheet deletes their account", async () => {
    const connection = await seedSharedSheet("admin-drive@example.test", admin);
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "shared",
      permissionId: "perm1",
    });
    const gone = await admin.client.rpc("delete_account", {
      p_confirm: "confirm",
    });
    expect(gone.error).toBeNull();
    expect(gone.data).toMatchObject({ released: [] });
    expect(await sharesOf(workspace.id)).toEqual([
      {
        email: viewer.email,
        state: "pending",
        permissionId: null,
        reason: null,
      },
    ]);
    const removed = await adminClient().auth.admin.deleteUser(admin.id);
    expect(removed.error).toBeNull();
    expect(await connectionExists(connection.id)).toBe(false);
    expect(await cleanupsOf(workspace.id)).toEqual([
      {
        permissionIds: ["perm1"],
        emails: [],
        releaseAfter: true,
        connectionId: null,
        tokenUserId: admin.id,
        hasToken: true,
      },
    ]);
  });
});

describe("finishing a cleanup", () => {
  const run = () => crypto.randomUUID();
  const finishedSchema = z.object({
    released: z
      .object({
        google_sub: z.string(),
        user_id: z.uuid(),
        refresh_token_encrypted: z.string(),
      })
      .nullable(),
    alert: z
      .object({
        email: z.string(),
        workspace_name: z.string().nullable(),
        account_email: z.string(),
        left: z.number(),
      })
      .loose()
      .nullable(),
  });

  /** Makes the workspace's one cleanup due and claims it for a new run. */
  async function claimCleanup() {
    makeCleanupsDue(workspace.id);
    const runId = run();
    const [claimed] = z
      .array(
        z.object({ id: z.uuid(), refresh_token_encrypted: z.string() }).loose(),
      )
      .length(1)
      .parse(
        await serviceRpc("sheet_share_cleanup_claim", {
          p_run: runId,
          p_limit: 5,
          p_lease_seconds: 60,
        }),
      );
    return { id: claimed.id, token: claimed.refresh_token_encrypted, runId };
  }

  /** Claims the workspace's one cleanup and finishes it with `left` people left. */
  async function finishCleanup(left: number) {
    const claimed = await claimCleanup();
    return finishedSchema.parse(
      await serviceRpc("sheet_share_cleanup_finish", {
        p_id: claimed.id,
        p_run: claimed.runId,
        p_left: left,
      }),
    );
  }

  const NEW_TOKEN = "v1.new.new.new";
  /** The person connects the same Google account again: Google gives TapNShow a new token. */
  const connectAgain = (user: TestUser, sub: string) =>
    serviceRpc("save_google_connection", {
      p_user: user.id,
      p_google_sub: sub,
      p_google_email: "again@example.test",
      p_scopes: [DRIVE_FILE_SCOPE],
      p_token_encrypted: NEW_TOKEN,
    });

  it("keeps a Google account its person connected again while the cleanup ran", async () => {
    const connection = await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    await connectAgain(owner, connection.sub);
    const finished = await finishCleanup(0);
    expect(finished.released).toBeNull();
    expect(await connectionExists(connection.id)).toBe(true);
  });

  it("removes the shares with the account's newest token while it is connected", async () => {
    const connection = await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    await connectAgain(owner, connection.sub);
    expect((await claimCleanup()).token).toBe(NEW_TOKEN);
  });

  it("revokes the newest token when its person connected again, then deleted their account", async () => {
    const connection = await seedSharedSheet("admin-drive@example.test", admin);
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    await connectAgain(admin, connection.sub);
    expect(
      (await admin.client.rpc("delete_account", { p_confirm: "confirm" }))
        .error,
    ).toBeNull();
    expect(
      (await adminClient().auth.admin.deleteUser(admin.id)).error,
    ).toBeNull();
    const finished = await finishCleanup(0);
    expect(finished.released?.refresh_token_encrypted).toBe(NEW_TOKEN);
  });

  it("never releases the Google account of someone other than the person who turned the sheet off", async () => {
    // The sheet stayed on the previous Owner's (now an Admin's) Google account.
    const connection = await seedSharedSheet("admin-drive@example.test", admin);
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    expect((await cleanupsOf(workspace.id))[0].releaseAfter).toBe(false);
    const finished = await finishCleanup(0);
    expect(finished.released).toBeNull();
    expect(await connectionExists(connection.id)).toBe(true);
  });

  it("revokes the token when its person deletes their account while the cleanup still runs", async () => {
    const connection = await seedSharedSheet("admin-drive@example.test", admin);
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    const gone = await admin.client.rpc("delete_account", {
      p_confirm: "confirm",
    });
    expect(gone.error).toBeNull();
    expect(
      (await adminClient().auth.admin.deleteUser(admin.id)).error,
    ).toBeNull();
    const finished = await finishCleanup(0);
    expect(finished.released).toMatchObject({
      google_sub: connection.sub,
      user_id: admin.id,
    });
  });

  it("forgets the token, releases the Google account and returns what to revoke", async () => {
    const connection = await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    const finished = await finishCleanup(0);
    expect(finished.released?.google_sub).toBe(connection.sub);
    expect(finished.alert).toBeNull();
    expect(await cleanupsOf(workspace.id)).toEqual([]);
    expect(await connectionExists(connection.id)).toBe(false);
  });

  it("returns the alert when people may still have access", async () => {
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    const finished = await finishCleanup(2);
    expect(finished.alert).toMatchObject({
      email: owner.email,
      workspace_name: workspace.name,
      account_email: "club@example.test",
      left: 2,
    });
  });

  it("backs a cleanup off after a Google error, and not when only the run's time ran out", async () => {
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    const state = () =>
      queryLocalSql(
        `select attempts, retry_at <= now() as due, run_id is null as free from public.sheet_share_cleanups where workspace_id = '${workspace.id}'`,
        z
          .array(
            z.object({
              attempts: z.number(),
              due: z.boolean(),
              free: z.boolean(),
            }),
          )
          .length(1),
      )[0];
    for (const [backoff, expected] of [
      [false, { attempts: 0, due: true, free: true }],
      [true, { attempts: 1, due: false, free: true }],
    ] as const) {
      const { id, runId } = await claimCleanup();
      await serviceRpc("sheet_share_cleanup_retry", {
        p_id: id,
        p_run: runId,
        p_backoff: backoff,
      });
      expect(state()).toEqual(expected);
    }
  });

  it("lets only the run holding a cleanup finish or retry it", async () => {
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await turnOff();
    makeCleanupsDue(workspace.id);
    const [claimed] = z.array(z.object({ id: z.uuid() }).loose()).parse(
      await serviceRpc("sheet_share_cleanup_claim", {
        p_run: run(),
        p_limit: 5,
        p_lease_seconds: 60,
      }),
    );
    expect(
      await serviceRpc("sheet_share_cleanup_finish", {
        p_id: claimed.id,
        p_run: run(),
        p_left: 0,
      }),
    ).toBeNull();
    expect(await cleanupsOf(workspace.id)).toHaveLength(1);
  });
});

describe("the share run's calls", () => {
  let restore: () => void = () => undefined;
  beforeEach(async () => {
    restore = setSheetTeamSharing(true);
    await seedSharedSheet();
    makeSharesDue(workspace.id);
  });
  afterEach(() => restore());

  const claimSchema = z.array(
    z
      .object({
        workspace_id: z.uuid(),
        version: z.number().int(),
        cap: z.number().int(),
        targets: z.array(
          z.object({ email: z.string(), position: z.number().int() }).loose(),
        ),
        shares: z.array(z.object({ email: z.string() }).loose()),
      })
      .loose(),
  );
  const claim = async (runId: string) =>
    claimSchema.parse(
      await serviceRpc("sheet_share_claim", {
        p_run: runId,
        p_limit: 5,
        p_lease_seconds: 60,
      }),
    );

  it("says when the sheet it hands out is paused", async () => {
    runLocalSql(
      `update public.sheet_syncs set status = 'paused', paused_reason = 'drive_full' where workspace_id = '${workspace.id}'`,
    );
    const [paused] = await claim(crypto.randomUUID());
    expect(paused).toMatchObject({ workspace_id: workspace.id, paused: true });
  });

  it("gives a due sheet's team and records to one run at a time", async () => {
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    const first = await claim(crypto.randomUUID());
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      workspace_id: workspace.id,
      cap: 500,
      paused: false,
    });
    expect(first[0].targets.map((t) => t.email)).toEqual([
      owner.email,
      admin.email,
      viewer.email,
    ]);
    expect(first[0].shares.map((s) => s.email)).toEqual([admin.email]);
    expect(await claim(crypto.randomUUID())).toEqual([]);
  });

  it("claims nothing while the switch is off", async () => {
    setSheetTeamSharing(false);
    expect(await claim(crypto.randomUUID())).toEqual([]);
  });

  it("keeps a sheet due when the team changed during the run", async () => {
    const runId = crypto.randomUUID();
    const [claimed] = await claim(runId);
    const newcomer = await createTestUser();
    await addMember(workspace.id, newcomer.id, "viewer");
    await serviceRpc("sheet_share_release", {
      p_workspace: workspace.id,
      p_run: runId,
      p_version: claimed.version,
      p_next_due: null,
    });
    expect((await sharesDueOf(workspace.id)).dueAt).not.toBeNull();
  });

  it("clears the mark when nothing changed during the run", async () => {
    const runId = crypto.randomUUID();
    const [claimed] = await claim(runId);
    await serviceRpc("sheet_share_release", {
      p_workspace: workspace.id,
      p_run: runId,
      p_version: claimed.version,
      p_next_due: null,
    });
    expect((await sharesDueOf(workspace.id)).dueAt).toBeNull();
  });

  it("records an intent, an outcome and a forgotten person while holding the lease", async () => {
    const runId = crypto.randomUUID();
    await claim(runId);
    expect(
      await serviceRpc("sheet_share_intend", {
        p_workspace: workspace.id,
        p_run: runId,
        p_email: admin.email,
        p_user: admin.id,
      }),
    ).toBe(true);
    expect(await sharesOf(workspace.id)).toEqual([
      {
        email: admin.email,
        state: "sharing",
        permissionId: null,
        reason: null,
      },
    ]);
    expect(
      await serviceRpc("sheet_share_save", {
        p_workspace: workspace.id,
        p_run: runId,
        p_email: admin.email,
        p_user: admin.id,
        p_state: "shared",
        p_permission_id: "perm9",
        p_reason: null,
        p_next_try_at: null,
      }),
    ).toBe(true);
    expect(await sharesOf(workspace.id)).toEqual([
      {
        email: admin.email,
        state: "shared",
        permissionId: "perm9",
        reason: null,
      },
    ]);
    expect(
      await serviceRpc("sheet_share_forget", {
        p_workspace: workspace.id,
        p_run: runId,
        p_emails: [admin.email],
      }),
    ).toBe(true);
    expect(await sharesOf(workspace.id)).toEqual([]);
  });

  it("writes nothing without the lease", async () => {
    await claim(crypto.randomUUID());
    const other = crypto.randomUUID();
    expect(
      await serviceRpc("sheet_share_intend", {
        p_workspace: workspace.id,
        p_run: other,
        p_email: admin.email,
        p_user: admin.id,
      }),
    ).toBe(false);
    expect(
      await serviceRpc("sheet_share_forget", {
        p_workspace: workspace.id,
        p_run: other,
        p_emails: [admin.email],
      }),
    ).toBe(false);
    expect(await sharesOf(workspace.id)).toEqual([]);
  });

  it("backs off the sheet's shares after a Google error", async () => {
    const runId = crypto.randomUUID();
    await claim(runId);
    await serviceRpc("sheet_share_retry", {
      p_workspace: workspace.id,
      p_run: runId,
    });
    const due = await sharesDueOf(workspace.id);
    expect(Date.parse(due.dueAt ?? "")).toBeGreaterThan(Date.now());
    expect(await claim(crypto.randomUUID())).toEqual([]);
  });

  it("pauses the sheet when Google access is lost, telling the Owner", async () => {
    const runId = crypto.randomUUID();
    await claim(runId);
    const paused = z
      .object({ email: z.string(), reason: z.string() })
      .loose()
      .parse(
        await serviceRpc("sheet_share_pause", {
          p_workspace: workspace.id,
          p_run: runId,
          p_reason: "access_lost",
        }),
      );
    expect(paused).toMatchObject({ email: owner.email, reason: "access_lost" });
    const { data } = await adminClient()
      .from("sheet_syncs")
      .select("status")
      .eq("workspace_id", workspace.id)
      .single();
    expect(data?.status).toBe("paused");
  });
});

describe("performance", () => {
  it("finds due shares through their index, in the wake-up and in the claim", () => {
    for (const [call, role] of [
      ["private.workers_due()", "postgres"],
      [
        `public.sheet_share_claim('${crypto.randomUUID()}', 5, 120)`,
        "service_role",
      ],
    ] as const) {
      const plan = explainCall(call, owner.id, role, ["enable_seqscan = off"]);
      expect(planUsesIndex(plan, "sheet_syncs_shares_due_idx")).toBe(true);
    }
  });
});

describe("twins", () => {
  it("keeps SHEET_SHARE_STATES and SHEET_SHARE_REASONS equal to the database enums", () => {
    const values = (type: string) =>
      queryLocalSql(
        `select pg_catalog.unnest(pg_catalog.enum_range(null::public.${type}))::text as v`,
        z.array(z.object({ v: z.string() })),
      ).map((row) => row.v);
    expect(values("sheet_share_state")).toEqual([...SHEET_SHARE_STATES]);
    expect(values("sheet_share_reason")).toEqual([...SHEET_SHARE_REASONS]);
  });
});

describe("the share store (real database)", () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it("reads a share claim and a cleanup claim as the worker expects", async () => {
    restore = setSheetTeamSharing(true);
    await seedSharedSheet();
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "refused",
      reason: "refused",
    });
    makeSharesDue(workspace.id);
    const store = createShareStore(adminClient());
    const run = crypto.randomUUID();
    const [claim] = await store.claim(run, 5, 60);
    expect(claim).toMatchObject({ workspaceId: workspace.id, cap: 500 });
    expect(claim.connection?.scopes).toContain(DRIVE_FILE_SCOPE);
    expect(claim.shares).toEqual([
      {
        email: admin.email,
        state: "refused",
        permissionId: null,
        reason: "refused",
        nextTryAt: null,
      },
    ]);
    expect(
      await store.save(workspace.id, run, {
        email: admin.email,
        userId: admin.id,
        state: "shared",
        permissionId: "perm1",
        reason: null,
        nextTryAt: null,
      }),
    ).toBe(true);
    await store.release(workspace.id, run, claim.version, null);
    await turnOff();
    makeCleanupsDue(workspace.id);
    const cleanupRun = crypto.randomUUID();
    const [cleanup] = await store.cleanupClaim(cleanupRun, 5, 60);
    expect(cleanup).toMatchObject({
      permissionIds: ["perm1"],
      emails: [],
      tokenUserId: owner.id,
    });
    const finished = await store.cleanupFinish(cleanup.id, cleanupRun, 1);
    expect(finished?.alert).toMatchObject({
      email: owner.email,
      left: 1,
      accountEmail: "club@example.test",
    });
    expect(finished?.released?.userId).toBe(owner.id);
  });
});
