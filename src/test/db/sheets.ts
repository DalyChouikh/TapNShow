import { adminClient } from "./clients";

/** A sheet row as the callback would create it (service role); returns nothing. */
export async function seedSheet(
  workspaceId: string,
  connectionId: string,
  options: {
    googleSub: string;
    spreadsheetId?: string | null;
    status?: "active" | "paused";
    pausedReason?: "trashed" | "deleted" | "access_lost" | "full" | null;
  } = { googleSub: "" },
): Promise<void> {
  const { error } = await adminClient()
    .from("sheet_syncs")
    .insert({
      workspace_id: workspaceId,
      connection_id: connectionId,
      google_sub: options.googleSub,
      google_email: "sheets@example.test",
      spreadsheet_id: options.spreadsheetId ?? null,
      status: options.status ?? "active",
      paused_reason: options.pausedReason ?? null,
    });
  if (error) {
    throw error;
  }
}

/** Dirty years of a workspace, newest first (service role). */
export async function dirtyYears(
  workspaceId: string,
): Promise<{ year: number; version: number }[]> {
  const { data, error } = await adminClient()
    .from("sheet_dirty_years")
    .select("year, version")
    .eq("workspace_id", workspaceId)
    .order("year", { ascending: false });
  if (error) {
    throw error;
  }
  return data;
}
