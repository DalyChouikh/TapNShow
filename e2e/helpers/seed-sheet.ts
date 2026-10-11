import { GMAIL_CONNECT_SCOPES } from "../../src/config/gmail";
import { DRIVE_FILE_SCOPE } from "../../src/config/sheets";
import { adminClient, ownerIdOf, workspaceIdOf } from "./admin";
import { seedGoogleConnection } from "./seed-sender";

/**
 * Turns on the Google Sheet of the workspace at `slug` the way the connect callback does
 * (`start_sheet`), on a fake Google account of its Owner that granted Gmail sending and Drive
 * files. Returns the workspace id and the Owner's email (where a pause alert goes).
 */
export async function seedSheet(
  slug: string,
): Promise<{ workspaceId: string; ownerEmail: string }> {
  const workspaceId = await workspaceIdOf(slug);
  const userId = await ownerIdOf(workspaceId);
  const connectionId = await seedGoogleConnection(
    userId,
    `e2e-sheets-${crypto.randomUUID().slice(0, 8)}@example.test`,
    [...GMAIL_CONNECT_SCOPES, DRIVE_FILE_SCOPE],
  );
  const client = adminClient();
  const started = await client.rpc("start_sheet", {
    p_user: userId,
    p_workspace: workspaceId,
    p_connection: connectionId,
    p_replace: false,
  });
  if (started.error) {
    throw started.error;
  }
  const owner = await client.auth.admin.getUserById(userId);
  const ownerEmail = owner.data.user?.email;
  if (owner.error || !ownerEmail) {
    throw owner.error ?? new Error("the Owner has no email");
  }
  return { workspaceId, ownerEmail };
}

/**
 * Makes a workspace's changed years due now, as if the 1-minute quiet time had passed. Twin:
 * `makeDue` in src/test/db/sheets.ts.
 */
export async function makeSheetDue(workspaceId: string): Promise<void> {
  const past = new Date(Date.now() - 120_000).toISOString();
  const { error } = await adminClient()
    .from("sheet_dirty_years")
    .update({ changed_at: past, first_changed_at: past })
    .eq("workspace_id", workspaceId);
  if (error) {
    throw error;
  }
}

/** The workspace's sheet status (`active` or `paused`), or null without a sheet. */
export async function sheetStatus(
  workspaceId: string,
): Promise<"active" | "paused" | null> {
  const { data, error } = await adminClient()
    .from("sheet_syncs")
    .select("status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data?.status ?? null;
}
