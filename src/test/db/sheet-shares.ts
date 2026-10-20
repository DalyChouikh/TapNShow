import { z } from "zod";
import { adminClient } from "./clients";
import { queryLocalSql, runLocalSql } from "./sql";

/**
 * Switches sharing the Google Sheet with the team on or off (`private.app_flags`) and returns the
 * restore, like `overrideLimit`. The flag is global: tests that need it on switch it in
 * `beforeEach` and restore it in `afterEach`.
 */
export function setSheetTeamSharing(enabled: boolean): () => void {
  const before = queryLocalSql(
    "select enabled from private.app_flags where name = 'sheet_team_sharing'",
    z.array(z.object({ enabled: z.boolean() })).length(1),
  )[0].enabled;
  runLocalSql(
    `update private.app_flags set enabled = ${enabled} where name = 'sheet_team_sharing'`,
  );
  return () =>
    runLocalSql(
      `update private.app_flags set enabled = ${before} where name = 'sheet_team_sharing'`,
    );
}

/**
 * Clears every sheet's share marks and leases. The share claim and `workers_due` are global, so a
 * test that claims or wakes must not see sheets other test files left due.
 */
export function parkAllShares(): void {
  runLocalSql(
    "update public.sheet_syncs set shares_due_at = null, shares_run_id = null, shares_locked_until = null",
  );
}

/** A workspace's share rows, by address (service role). */
export async function sharesOf(workspaceId: string): Promise<
  Array<{
    email: string;
    state: string;
    permissionId: string | null;
    reason: string | null;
  }>
> {
  const { data, error } = await adminClient()
    .from("sheet_shares")
    .select("email, state, permission_id, reason")
    .eq("workspace_id", workspaceId)
    .order("email");
  if (error) {
    throw error;
  }
  return data.map((row) => ({
    email: row.email,
    state: row.state,
    permissionId: row.permission_id,
    reason: row.reason,
  }));
}

/** When a sheet's shares are due and how many times they were marked (service role). */
export async function sharesDueOf(
  workspaceId: string,
): Promise<{ dueAt: string | null; version: number }> {
  const { data, error } = await adminClient()
    .from("sheet_syncs")
    .select("shares_due_at, shares_version")
    .eq("workspace_id", workspaceId)
    .single();
  if (error) {
    throw error;
  }
  return { dueAt: data.shares_due_at, version: data.shares_version };
}

/** The wanted team of a workspace's sheet, in order (`private.sheet_share_targets`). */
export function shareTargetsOf(
  workspaceId: string,
): Array<{ email: string; position: number }> {
  return queryLocalSql(
    `select email, position from private.sheet_share_targets('${workspaceId}') order by position`,
    z.array(z.object({ email: z.string(), position: z.number().int() })),
  );
}
