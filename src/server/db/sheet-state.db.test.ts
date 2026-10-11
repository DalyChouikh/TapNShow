import { TZDate } from "@date-fns/tz";
import { beforeEach, describe, expect, it } from "vitest";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { seedConnection, setSender } from "@/test/db/sender";
import { dirtyYears, seedSheet } from "@/test/db/sheets";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
/** The workspace's current year (createWorkspaceAs uses Africa/Tunis), like private.sheet_year. */
const thisYear = () => new TZDate(Date.now(), "Africa/Tunis").getFullYear();
let owner: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Sheet Club");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("save_google_connection", () => {
  it("accepts a Sheets-only grant as well as a Gmail one, and nothing else", async () => {
    const save = (scopes: string[]) =>
      adminClient().rpc("save_google_connection", {
        p_user: owner.id,
        p_google_sub: `sub-${crypto.randomUUID()}`,
        p_google_email: "a@example.test",
        p_scopes: scopes,
        p_token_encrypted: "v1.a.b.c",
      });
    expect((await save(["openid", DRIVE_FILE])).error).toBeNull();
    expect((await save(["openid", GMAIL_SEND])).error).toBeNull();
    expect((await save(["openid", "email"])).error?.message).toBe(
      "tn:invalid_input",
    );
  });
});

describe("start_sheet", () => {
  it("creates the sheet row and marks every year with a meeting that asks for answers, plus this year", async () => {
    const { id: connection } = await seedConnection(owner.id, {
      scopes: [DRIVE_FILE],
    });
    await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: "2024-03-01T17:00:00Z",
    });
    await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: "2023-03-01T17:00:00Z",
      response_mode: "announcement",
    });
    await seedMeeting(workspace.id, {
      status: "draft",
      starts_at: "2022-03-01T17:00:00Z",
    });
    const { data, error } = await adminClient().rpc("start_sheet", {
      p_user: owner.id,
      p_workspace: workspace.id,
      p_connection: connection,
      p_replace: false,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ started: true, released: null });
    const years = (await dirtyYears(workspace.id)).map((row) => row.year);
    expect(years).toContain(2024);
    expect(years).toContain(thisYear());
    expect(years).not.toContain(2023);
    expect(years).not.toContain(2022);
  });

  it("refuses a different Google account for an existing sheet, and reattaches the same one", async () => {
    const first = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, first.id, {
      googleSub: first.sub,
      spreadsheetId: "file-abcdefghij",
      status: "paused",
      pausedReason: "access_lost",
    });
    const other = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    const wrong = await adminClient().rpc("start_sheet", {
      p_user: owner.id,
      p_workspace: workspace.id,
      p_connection: other.id,
      p_replace: false,
    });
    expect(wrong.error?.message).toBe("tn:sheet_wrong_account");
    const same = await adminClient().rpc("start_sheet", {
      p_user: owner.id,
      p_workspace: workspace.id,
      p_connection: first.id,
      p_replace: false,
    });
    expect(same.data).toEqual({ started: false, released: null });
    const { data } = await adminClient()
      .from("sheet_syncs")
      .select("status, paused_reason")
      .eq("workspace_id", workspace.id)
      .single();
    expect(data).toEqual({ status: "active", paused_reason: null });
  });

  it("replaces a sheet on request and releases the old account when nothing else uses it", async () => {
    const old = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, old.id, {
      googleSub: old.sub,
      spreadsheetId: "file-abcdefghij",
    });
    const fresh = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    const { data } = await adminClient().rpc("start_sheet", {
      p_user: owner.id,
      p_workspace: workspace.id,
      p_connection: fresh.id,
      p_replace: true,
    });
    expect(data).toMatchObject({
      started: true,
      released: { google_sub: old.sub, user_id: owner.id },
    });
    const gone = await adminClient()
      .from("google_connections")
      .select("id")
      .eq("id", old.id);
    expect(gone.data).toEqual([]);
  });

  it("is for the workspace's Owner only", async () => {
    const { id } = await seedConnection(viewer.id, { scopes: [DRIVE_FILE] });
    const { error } = await adminClient().rpc("start_sheet", {
      p_user: viewer.id,
      p_workspace: workspace.id,
      p_connection: id,
      p_replace: false,
    });
    expect(error?.message).toBe("tn:owner_only");
  });
});

describe("the release rule", () => {
  it("Disconnect stops sending everywhere but keeps an account a sheet lives in", async () => {
    const shared = await seedConnection(owner.id, {
      scopes: [GMAIL_SEND, DRIVE_FILE],
    });
    await setSender(workspace.id, shared.id);
    await seedSheet(workspace.id, shared.id, { googleSub: shared.sub });
    const { data, error } = await owner.client.rpc(
      "disconnect_google_connection",
      { p_connection: shared.id },
    );
    expect(error).toBeNull();
    expect(data).toEqual({ released: null, sheets_kept: ["Sheet Club"] });
    const ws = await adminClient()
      .from("workspaces")
      .select("sender_connection_id")
      .eq("id", workspace.id)
      .single();
    expect(ws.data?.sender_connection_id).toBeNull();
  });

  it("Turn off releases an account nothing else uses (owner only)", async () => {
    const solo = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, solo.id, { googleSub: solo.sub });
    await expectAppError(
      viewer.client.rpc("turn_off_sheet", { p_workspace: workspace.id }),
      "owner_only",
    );
    const { data } = await owner.client.rpc("turn_off_sheet", {
      p_workspace: workspace.id,
    });
    expect(data).toMatchObject({ released: { google_sub: solo.sub } });
    expect(await dirtyYears(workspace.id)).toEqual([]);
  });

  it("deleting a workspace releases its sender and its sheet's account when unused", async () => {
    const sender = await seedConnection(owner.id);
    await setSender(workspace.id, sender.id);
    const { data } = await owner.client.rpc("delete_workspace", {
      p_workspace: workspace.id,
      p_confirm_name: "Sheet Club",
    });
    expect(data).toMatchObject({ released: [{ google_sub: sender.sub }] });
  });
});

describe("google_connection_saved (resume rule)", () => {
  it("moves an access-lost sheet on the same Google account to the new connection", async () => {
    const lost = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, lost.id, {
      googleSub: lost.sub,
      spreadsheetId: "file-abcdefghij",
      status: "paused",
      pausedReason: "access_lost",
    });
    await adminClient()
      .from("sheet_syncs")
      .update({ connection_id: null })
      .eq("workspace_id", workspace.id);
    const back = await adminClient().rpc("save_google_connection", {
      p_user: owner.id,
      p_google_sub: lost.sub,
      p_google_email: "back@example.test",
      p_scopes: [DRIVE_FILE],
      p_token_encrypted: "v1.x.y.z",
    });
    await adminClient().rpc("google_connection_saved", {
      p_user: owner.id,
      p_connection: back.data ?? "",
    });
    const { data } = await adminClient()
      .from("sheet_syncs")
      .select("status, connection_id")
      .eq("workspace_id", workspace.id)
      .single();
    expect(data).toEqual({ status: "active", connection_id: back.data });
  });

  it("pauses an active sheet when the account came back without the Sheets permission", async () => {
    const both = await seedConnection(owner.id, {
      scopes: [GMAIL_SEND, DRIVE_FILE],
    });
    await seedSheet(workspace.id, both.id, {
      googleSub: both.sub,
      spreadsheetId: "file-abcdefghij",
    });
    await adminClient()
      .from("google_connections")
      .update({ granted_scopes: [GMAIL_SEND] })
      .eq("id", both.id);
    await adminClient().rpc("google_connection_saved", {
      p_user: owner.id,
      p_connection: both.id,
    });
    const { data } = await adminClient()
      .from("sheet_syncs")
      .select("status, paused_reason")
      .eq("workspace_id", workspace.id)
      .single();
    expect(data).toEqual({ status: "paused", paused_reason: "access_lost" });
  });
});

describe("workspace_sheet and retry_sheet", () => {
  it("tells every member the state, and only the Owner which account holds it", async () => {
    const { id, sub } = await seedConnection(owner.id, {
      scopes: [DRIVE_FILE],
    });
    await seedSheet(workspace.id, id, {
      googleSub: sub,
      spreadsheetId: "file-abcdefghij",
    });
    const asOwner = await owner.client.rpc("workspace_sheet", {
      p_workspace: workspace.id,
    });
    const asViewer = await viewer.client.rpc("workspace_sheet", {
      p_workspace: workspace.id,
    });
    expect(asOwner.data).toMatchObject({
      state: "on",
      account_email: "sheets@example.test",
      spreadsheet_id: "file-abcdefghij",
    });
    expect(asViewer.data).toMatchObject({ state: "on", account_email: null });
  });

  it("says off without a sheet", async () => {
    const { data } = await viewer.client.rpc("workspace_sheet", {
      p_workspace: workspace.id,
    });
    expect(data).toMatchObject({ state: "off" });
  });

  it("Try again resumes a trashed sheet and marks this year, rate limited, Owner only", async () => {
    const { id, sub } = await seedConnection(owner.id, {
      scopes: [DRIVE_FILE],
    });
    await seedSheet(workspace.id, id, {
      googleSub: sub,
      spreadsheetId: "file-abcdefghij",
      status: "paused",
      pausedReason: "trashed",
    });
    await expectAppError(
      viewer.client.rpc("retry_sheet", { p_workspace: workspace.id }),
      "owner_only",
    );
    expect(
      (await owner.client.rpc("retry_sheet", { p_workspace: workspace.id }))
        .error,
    ).toBeNull();
    expect((await dirtyYears(workspace.id)).map((row) => row.year)).toEqual([
      thisYear(),
    ]);
  });

  it("never shows another workspace's sheet tables to a member", async () => {
    const { id, sub } = await seedConnection(owner.id, {
      scopes: [DRIVE_FILE],
    });
    await seedSheet(workspace.id, id, { googleSub: sub });
    const stranger = await createTestUser();
    const { data } = await stranger.client
      .from("sheet_syncs")
      .select("workspace_id");
    expect(data).toEqual([]);
    const dirty = await viewer.client.from("sheet_dirty_years").select("year");
    expect(dirty.error?.code).toBe("42501");
  });
});

describe("hit_google_connect_limit", () => {
  it("counts a signed-in person's Google connects", async () => {
    const { data, error } = await owner.client.rpc("hit_google_connect_limit");
    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});
