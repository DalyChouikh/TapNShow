import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  type ReleasedConnection,
  releasedSchema,
} from "@/server/google/release";
import type { SheetSourceRow } from "@/lib/sheets/types";
import {
  type SheetPauseReason,
  type SheetStatus,
  sheetPauseReasonSchema,
  sheetStatusSchema,
} from "@/shared/api/sheets";
import { dbDetailRowSchema, toDetailRow } from "./results";
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
    // Missing before the #413 migration reaches a database (a deploy or preview can go first).
    sharing: z
      .object({
        team: z
          .object({
            team_count: z.number(),
            total: z.number(),
            can_view: z.number(),
            cant_open: z.number(),
            in_progress: z.number(),
          })
          .nullable(),
        mine: z.string().nullable(),
        my_email: z.string().nullable(),
      })
      .nullish(),
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
      sharing: db.sharing
        ? {
            team: db.sharing.team && {
              teamCount: db.sharing.team.team_count,
              total: db.sharing.team.total,
              canView: db.sharing.team.can_view,
              cantOpen: db.sharing.team.cant_open,
              inProgress: db.sharing.team.in_progress,
            },
            mine: db.sharing.mine,
            myEmail: db.sharing.my_email,
          }
        : null,
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

/** A TapNShow tab as `sheet_tabs` stores it (what the next redraw compares against). */
export type StoredTab = {
  tabKey: string;
  year: number;
  googleSheetId: number;
  title: string;
  contentHash: string;
  rowCount: number;
  formatVersion: number;
  startsFrom?: string | null;
  startsTo?: string | null;
};

/** One leased sheet, as `sheet_claim` returns it. */
export type SheetClaim = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  timezone: string;
  locale: string;
  spreadsheetId: string | null;
  createKey: string;
  connection: {
    id: string;
    userId: string;
    googleSub: string;
    tokenEncrypted: string;
    scopes: string[];
  } | null;
  /** Changed years, newest first, with the version the claim read. */
  years: { year: number; version: number }[];
  tabs: StoredTab[];
};

/** Who to tell that a sheet paused (`sheet_pause`; null when already told today). */
export type SheetPausedAlert = {
  email: string;
  workspaceName: string;
  workspaceSlug: string;
  reason: SheetPauseReason;
};

/** The sheet worker's database calls (service role; `createSheetStore`). */
export type SheetStore = {
  claim(
    run: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<SheetClaim[]>;
  rows(workspaceId: string, year: number): Promise<SheetSourceRow[]>;
  saveFile(
    workspaceId: string,
    run: string,
    spreadsheetId: string,
  ): Promise<boolean>;
  saveTab(workspaceId: string, run: string, tab: StoredTab): Promise<boolean>;
  dropTabs(workspaceId: string, run: string, keys: string[]): Promise<void>;
  finishYear(
    workspaceId: string,
    run: string,
    year: number,
    version: number,
  ): Promise<boolean>;
  release(workspaceId: string, run: string, synced: boolean): Promise<void>;
  retry(workspaceId: string, run: string, error: string): Promise<void>;
  pause(
    workspaceId: string,
    run: string,
    reason: SheetPauseReason,
  ): Promise<SheetPausedAlert | null>;
};

const claimsSchema = z.array(
  z
    .object({
      workspace_id: z.uuid(),
      workspace_name: z.string(),
      workspace_slug: z.string(),
      timezone: z.string(),
      locale: z.string(),
      spreadsheet_id: z.string().nullable(),
      create_key: z.uuid(),
      connection: z
        .object({
          id: z.uuid(),
          user_id: z.uuid(),
          google_sub: z.string(),
          refresh_token_encrypted: z.string(),
          granted_scopes: z.array(z.string()),
        })
        .nullable(),
      years: z.array(
        z.object({ year: z.number().int(), version: z.number().int() }),
      ),
      tabs: z.array(
        z.object({
          tab_key: z.string(),
          year: z.number().int(),
          google_sheet_id: z.number().int(),
          title: z.string(),
          content_hash: z.string(),
          row_count: z.number().int(),
          format_version: z.number().int(),
        }),
      ),
    })
    .transform((db): SheetClaim => ({
      workspaceId: db.workspace_id,
      workspaceName: db.workspace_name,
      workspaceSlug: db.workspace_slug,
      timezone: db.timezone,
      locale: db.locale,
      spreadsheetId: db.spreadsheet_id,
      createKey: db.create_key,
      connection: db.connection && {
        id: db.connection.id,
        userId: db.connection.user_id,
        googleSub: db.connection.google_sub,
        tokenEncrypted: db.connection.refresh_token_encrypted,
        scopes: db.connection.granted_scopes,
      },
      years: db.years,
      tabs: db.tabs.map((tab) => ({
        tabKey: tab.tab_key,
        year: tab.year,
        googleSheetId: tab.google_sheet_id,
        title: tab.title,
        contentHash: tab.content_hash,
        rowCount: tab.row_count,
        formatVersion: tab.format_version,
      })),
    })),
);

/** `sheet_rows`: the Attendance Details shape plus the meeting's status and the person's lists. */
const sheetRowsSchema = z.array(
  dbDetailRowSchema
    .extend({
      meeting_status: z.enum(["scheduled", "cancelled"]),
      lists: z.array(z.string()),
    })
    .transform((db): SheetSourceRow => ({
      ...toDetailRow(db),
      meetingStatus: db.meeting_status,
      lists: db.lists,
    })),
);

/** `sheet_pause`'s answer: who to tell, or null when already told today (shared with the share step). */
export const sheetPausedAlertSchema = z
  .object({
    email: z.string(),
    workspace_name: z.string(),
    workspace_slug: z.string(),
    reason: sheetPauseReasonSchema,
  })
  .nullable()
  .transform(
    (db): SheetPausedAlert | null =>
      db && {
        email: db.email,
        workspaceName: db.workspace_name,
        workspaceSlug: db.workspace_slug,
        reason: db.reason,
      },
  );

/**
 * The sheet worker's store over the service-role client (Task 7 RPCs). Throws on a database error,
 * naming only the call and the error code (messages can hold data); the run logs it.
 */
export function createSheetStore(admin: Client): SheetStore {
  const check = <T>(
    name: string,
    result: { data: T; error: DbError | null },
  ): T => {
    if (result.error) {
      throw new Error(`${name} failed: ${result.error.code ?? ""}`);
    }
    return result.data;
  };
  return {
    claim: async (run, limit, leaseSeconds) =>
      claimsSchema.parse(
        check(
          "sheet_claim",
          await admin.rpc("sheet_claim", {
            p_run: run,
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          }),
        ),
      ),
    rows: async (workspaceId, year) =>
      sheetRowsSchema.parse(
        check(
          "sheet_rows",
          await admin.rpc("sheet_rows", {
            p_workspace: workspaceId,
            p_year: year,
          }),
        ),
      ),
    saveFile: async (workspaceId, run, spreadsheetId) =>
      check(
        "sheet_save_file",
        await admin.rpc("sheet_save_file", {
          p_workspace: workspaceId,
          p_run: run,
          p_spreadsheet_id: spreadsheetId,
        }),
      ) === true,
    saveTab: async (workspaceId, run, tab) =>
      check(
        "sheet_save_tab",
        await admin.rpc("sheet_save_tab", {
          p_workspace: workspaceId,
          p_run: run,
          p_tab: {
            tab_key: tab.tabKey,
            year: tab.year,
            google_sheet_id: tab.googleSheetId,
            title: tab.title,
            starts_from: tab.startsFrom ?? null,
            starts_to: tab.startsTo ?? null,
            content_hash: tab.contentHash,
            row_count: tab.rowCount,
            format_version: tab.formatVersion,
          },
        }),
      ) === true,
    dropTabs: async (workspaceId, run, keys) => {
      check(
        "sheet_drop_tabs",
        await admin.rpc("sheet_drop_tabs", {
          p_workspace: workspaceId,
          p_run: run,
          p_keys: keys,
        }),
      );
    },
    finishYear: async (workspaceId, run, year, version) =>
      check(
        "sheet_finish_year",
        await admin.rpc("sheet_finish_year", {
          p_workspace: workspaceId,
          p_run: run,
          p_year: year,
          p_version: version,
        }),
      ) === true,
    release: async (workspaceId, run, synced) => {
      check(
        "sheet_release",
        await admin.rpc("sheet_release", {
          p_workspace: workspaceId,
          p_run: run,
          p_synced: synced,
        }),
      );
    },
    retry: async (workspaceId, run, error) => {
      check(
        "sheet_retry",
        await admin.rpc("sheet_retry", {
          p_workspace: workspaceId,
          p_run: run,
          p_error: error,
        }),
      );
    },
    pause: async (workspaceId, run, reason) =>
      sheetPausedAlertSchema.parse(
        check(
          "sheet_pause",
          await admin.rpc("sheet_pause", {
            p_workspace: workspaceId,
            p_run: run,
            p_reason: reason,
          }),
        ),
      ),
  };
}
