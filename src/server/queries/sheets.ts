import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  type ReleasedConnection,
  releasedSchema,
} from "@/server/google/release";
import {
  type SheetStatus,
  sheetPauseReasonSchema,
  sheetStatusSchema,
} from "@/shared/api/sheets";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

/** `workspace_sheet()`'s jsonb, read into `SheetStatus`. */
const dbSheetSchema = z
  .object({
    state: z.enum(["off", "creating", "on", "paused"]),
    spreadsheet_id: z.string().nullable(),
    paused_reason: sheetPauseReasonSchema.nullable(),
    synced_at: z.string().nullable(),
    behind: z.boolean(),
    created_at: z.string().nullable(),
    turned_on_by: z.string(),
    account_email: z.string().nullable(),
    owner_name: z.string(),
    tabs: z.array(
      z.object({
        year: z.number().int(),
        google_sheet_id: z.number().int(),
        starts_from: z.string().nullable(),
        starts_to: z.string().nullable(),
      }),
    ),
  })
  .transform((db): SheetStatus =>
    sheetStatusSchema.parse({
      state: db.state,
      spreadsheetId: db.spreadsheet_id,
      pausedReason: db.paused_reason,
      syncedAt: db.synced_at,
      behind: db.behind,
      createdAt: db.created_at,
      turnedOnBy: db.turned_on_by,
      accountEmail: db.account_email,
      ownerName: db.owner_name,
      tabs: db.tabs.map((tab) => ({
        year: tab.year,
        googleSheetId: tab.google_sheet_id,
        startsFrom: tab.starts_from,
        startsTo: tab.starts_to,
      })),
    }),
  );

/** `workspace_sheet()` (any member; the account email for the Owner only). */
export async function getWorkspaceSheet(
  client: Client,
  workspaceId: string,
): Promise<{ data: SheetStatus | null; error: DbError | null }> {
  const { data, error } = await client.rpc("workspace_sheet", {
    p_workspace: workspaceId,
  });
  return error
    ? { data: null, error }
    : { data: dbSheetSchema.parse(data), error: null };
}

const releasedResultSchema = z.object({ released: releasedSchema });

/** `turn_off_sheet()` (Owner): returns the connection to revoke, if it was released. */
export async function turnOffSheet(
  client: Client,
  workspaceId: string,
): Promise<{ data: ReleasedConnection | null; error: DbError | null }> {
  const { data, error } = await client.rpc("turn_off_sheet", {
    p_workspace: workspaceId,
  });
  return error
    ? { data: null, error }
    : { data: releasedResultSchema.parse(data).released, error: null };
}

/** `retry_sheet()` (Owner, rate limited): Try again. */
export async function retrySheet(
  client: Client,
  workspaceId: string,
): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("retry_sheet", {
    p_workspace: workspaceId,
  });
  return { error };
}

const startedSchema = z.object({
  started: z.boolean(),
  released: releasedSchema,
});

/**
 * `start_sheet()`: turns the sheet on, reattaches it to the same Google account, or replaces it.
 * `admin` must be the service-role client (the connect callback names the verified user).
 */
export async function startSheet(
  admin: Client,
  input: {
    userId: string;
    workspaceId: string;
    connectionId: string;
    replace: boolean;
  },
): Promise<{
  data: { started: boolean; released: ReleasedConnection | null } | null;
  error: DbError | null;
}> {
  const { data, error } = await admin.rpc("start_sheet", {
    p_user: input.userId,
    p_workspace: input.workspaceId,
    p_connection: input.connectionId,
    p_replace: input.replace,
  });
  return error
    ? { data: null, error }
    : { data: startedSchema.parse(data), error: null };
}

/**
 * `google_connection_saved()` (service role): after any Google callback, resumes or pauses the
 * sheets on that Google account (spec §8 Resume).
 */
export async function googleConnectionSaved(
  admin: Client,
  input: { userId: string; connectionId: string },
): Promise<{ error: DbError | null }> {
  const { error } = await admin.rpc("google_connection_saved", {
    p_user: input.userId,
    p_connection: input.connectionId,
  });
  return { error };
}

/** `hit_google_connect_limit()`: true while the signed-in person may start another connect. */
export async function hitGoogleConnectLimit(
  client: Client,
): Promise<{ data: boolean; error: DbError | null }> {
  const { data, error } = await client.rpc("hit_google_connect_limit");
  return { data: data ?? false, error };
}
