import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { parkAllJobs } from "@/test/db/outbox";
import { parkAllPlatformEvents } from "@/test/db/platform";
import { seedConnection } from "@/test/db/sender";
import {
  parkAllShares,
  setSheetTeamSharing,
  shareTargetsOf,
  sharesDueOf,
  sharesOf,
} from "@/test/db/sheet-shares";
import { seedSheet } from "@/test/db/sheets";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

/** Seeds an active sheet with a file, held by `holder`'s Google account (the Owner's by default). */
async function seedSharedSheet(
  googleEmail = "club@example.test",
  holder: TestUser = owner,
) {
  const connection = await seedConnection(holder.id, { scopes: [DRIVE_FILE] });
  await seedSheet(workspace.id, connection.id, {
    googleSub: connection.sub,
    spreadsheetId: `file-${crypto.randomUUID().slice(0, 12)}`,
  });
  const { error } = await adminClient()
    .from("sheet_syncs")
    .update({ google_email: googleEmail })
    .eq("workspace_id", workspace.id);
  if (error) {
    throw error;
  }
  return connection;
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
      scopes: [DRIVE_FILE],
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

  it("is due only while the switch is on, the sheet is active and has a file", async () => {
    await seedSharedSheet();
    parkAllJobs();
    parkAllPlatformEvents();
    runLocalSql(
      "update public.sheet_syncs set retry_at = now() + interval '1 day'",
    );
    runLocalSql("delete from public.push_deliveries");
    parkAllShares();
    runLocalSql(
      `select private.sheet_shares_mark(array['${workspace.id}'::uuid])`,
    );
    restore = setSheetTeamSharing(false);
    expect(sharesDueNow(workspace.id)).toBe(false);
    expect(workersDue()).toBe(false);
    setSheetTeamSharing(true);
    expect(sharesDueNow(workspace.id)).toBe(true);
    expect(workersDue()).toBe(true);
    runLocalSql(
      `update public.sheet_syncs set status = 'paused', paused_reason = 'trashed' where workspace_id = '${workspace.id}'`,
    );
    expect(sharesDueNow(workspace.id)).toBe(false);
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
