import type { SheetPauseReason } from "@/shared/api/sheets";
import { adminClient } from "./clients";
import { runLocalSql } from "./sql";

/** A sheet row as the callback would create it (service role); returns nothing. */
export async function seedSheet(
  workspaceId: string,
  connectionId: string,
  options: {
    googleSub: string;
    /** The address of the Google account holding the file. */
    googleEmail?: string;
    spreadsheetId?: string | null;
    status?: "active" | "paused";
    pausedReason?: SheetPauseReason | null;
  } = { googleSub: "" },
): Promise<void> {
  const { error } = await adminClient()
    .from("sheet_syncs")
    .insert({
      workspace_id: workspaceId,
      connection_id: connectionId,
      google_sub: options.googleSub,
      google_email: options.googleEmail ?? "sheets@example.test",
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

/** Makes a workspace's marked years due now (as if the 1-minute quiet time had passed). */
export function makeDue(workspaceId: string): void {
  runLocalSql(
    `update public.sheet_dirty_years set changed_at = now() - interval '2 minutes', first_changed_at = now() - interval '2 minutes' where workspace_id = '${workspaceId}'`,
  );
}

/**
 * Parks every sheet and frees every lease. `sheet_claim` is global (like `dispatch_claim`), so a
 * test that claims must not see sheets other test files left behind.
 */
export function parkAllSheets(): void {
  runLocalSql(
    "update public.sheet_syncs set retry_at = now() + interval '1 day', run_id = null, locked_until = null",
  );
}

/** Makes one workspace's sheet claimable again after `parkAllSheets` (retry time now). */
export function unparkSheet(workspaceId: string): void {
  runLocalSql(
    `update public.sheet_syncs set retry_at = now() where workspace_id = '${workspaceId}'`,
  );
}
