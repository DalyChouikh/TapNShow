import { z } from "zod";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import { adminClient } from "./clients";
import { seedConnection } from "./sender";
import { seedSheet } from "./sheets";
import { queryLocalSql, runLocalScript, runLocalSql } from "./sql";

/**
 * Seeds a workspace's active Google Sheet with a file, held by `holderId`'s Google account whose
 * address is `googleEmail` (a team member with that address owns the file and isn't shared with).
 * Returns the connection.
 */
export async function seedSharedSheet(
  workspaceId: string,
  holderId: string,
  googleEmail = "club@example.test",
): Promise<{ id: string; sub: string }> {
  const connection = await seedConnection(holderId, {
    scopes: [DRIVE_FILE_SCOPE],
  });
  await seedSheet(workspaceId, connection.id, {
    googleSub: connection.sub,
    googleEmail,
    spreadsheetId: `file-${crypto.randomUUID().slice(0, 12)}`,
  });
  return connection;
}

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
  runLocalScript(PARK_ALL_SHARES_SQL);
}

/** `parkAllShares` as SQL, for `parkAllWork` and `makeSharesDue`. */
export const PARK_ALL_SHARES_SQL =
  "update public.sheet_syncs set shares_due_at = null, shares_run_id = null, shares_locked_until = null;";

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

/** Inserts one share row (service role), as a share run would have left it. */
export async function seedShare(
  workspaceId: string,
  row: {
    userId?: string | null;
    email: string;
    state: "pending" | "sharing" | "shared" | "external" | "refused";
    permissionId?: string | null;
    reason?: "refused" | "too_many" | "removed_in_drive" | null;
  },
): Promise<void> {
  const { error } = await adminClient()
    .from("sheet_shares")
    .insert({
      workspace_id: workspaceId,
      user_id: row.userId ?? null,
      email: row.email,
      state: row.state,
      permission_id: row.permissionId ?? null,
      reason: row.reason ?? null,
    });
  if (error) {
    throw error;
  }
}

/** The cleanups left for a workspace's files (service role), oldest first. */
export async function cleanupsOf(workspaceId: string): Promise<
  Array<{
    permissionIds: string[];
    emails: string[];
    releaseAfter: boolean;
    connectionId: string | null;
    tokenUserId: string;
    hasToken: boolean;
  }>
> {
  const { data, error } = await adminClient()
    .from("sheet_share_cleanups")
    .select(
      "permission_ids, emails, release_after, connection_id, token_user_id, refresh_token_encrypted",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (error) {
    throw error;
  }
  return data.map((row) => ({
    permissionIds: [...row.permission_ids].sort(),
    emails: [...row.emails].sort(),
    releaseAfter: row.release_after,
    connectionId: row.connection_id,
    tokenUserId: row.token_user_id,
    hasToken: row.refresh_token_encrypted.length > 0,
  }));
}

/** Parks every cleanup and frees its lease (the cleanup claim is global). */
export function parkAllCleanups(): void {
  runLocalScript(PARK_ALL_CLEANUPS_SQL);
}

/** `parkAllCleanups` as SQL, for `parkAllWork` and `makeCleanupsDue`. */
export const PARK_ALL_CLEANUPS_SQL =
  "update public.sheet_share_cleanups set retry_at = now() + interval '1 day', run_id = null, locked_until = null;";

/**
 * Parks every sheet's shares, then marks this workspace's due as `private.sheet_shares_mark` does,
 * a minute back: the local clock can step back (WSL2 time sync), and a mark at `now()` would then
 * not be due yet for a claim made right after. Like `makeDue` for the redraw.
 */
export function makeSharesDue(workspaceId: string): void {
  runLocalScript(`${PARK_ALL_SHARES_SQL}
    select private.sheet_shares_mark(array['${workspaceId}'::uuid]);
    update public.sheet_syncs set shares_due_at = now() - interval '1 minute' where workspace_id = '${workspaceId}';`);
}

/** Parks every cleanup, then makes this workspace's due a minute back (see `makeSharesDue`). */
export function makeCleanupsDue(workspaceId: string): void {
  runLocalScript(`${PARK_ALL_CLEANUPS_SQL}
    update public.sheet_share_cleanups set retry_at = now() - interval '1 minute' where workspace_id = '${workspaceId}';`);
}
