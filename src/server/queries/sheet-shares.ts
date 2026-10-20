import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import {
  type ReleasedConnection,
  releasedSchema,
} from "@/server/google/release";
import type { ShareRow, ShareTarget } from "@/lib/sheets/share-plan";
import {
  SHEET_SHARE_REASONS,
  SHEET_SHARE_STATES,
  type SheetPauseReason,
  type SheetShareReason,
  type SheetShareState,
} from "@/shared/api/sheets";
import type { DbError } from "./roster";
import { type SheetPausedAlert, sheetPausedAlertSchema } from "./sheets";

type Client = SupabaseClient<Database>;

/** One leased sheet, as `sheet_share_claim` returns it (#413). */
export type ShareClaim = {
  workspaceId: string;
  spreadsheetId: string;
  /** The mark's version at claim time (`sheet_share_release` compares it). */
  version: number;
  cap: number;
  connection: {
    id: string;
    userId: string;
    googleSub: string;
    tokenEncrypted: string;
    scopes: string[];
  } | null;
  targets: ShareTarget[];
  shares: ShareRow[];
};

/** One leased cleanup, as `sheet_share_cleanup_claim` returns it. */
export type CleanupClaim = {
  id: string;
  spreadsheetId: string;
  googleSub: string;
  tokenUserId: string;
  tokenEncrypted: string;
  permissionIds: string[];
  emails: string[];
  giveUpAt: string;
};

/** Who to tell that people may still have access to a sheet TapNShow let go of. */
export type ShareAccessAlert = {
  email: string;
  workspaceName: string | null;
  spreadsheetId: string;
  accountEmail: string;
  left: number;
};

/** One person's outcome, as `sheet_share_save` records it. */
export type ShareOutcome = {
  email: string;
  userId: string | null;
  state: SheetShareState;
  permissionId: string | null;
  reason: SheetShareReason | null;
  nextTryAt: string | null;
};

/** The share worker's database calls (service role; `createShareStore`). */
export type ShareStore = {
  claim(
    run: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<ShareClaim[]>;
  intend(
    workspaceId: string,
    run: string,
    target: ShareTarget,
  ): Promise<boolean>;
  save(
    workspaceId: string,
    run: string,
    outcome: ShareOutcome,
  ): Promise<boolean>;
  forget(workspaceId: string, run: string, emails: string[]): Promise<boolean>;
  release(
    workspaceId: string,
    run: string,
    version: number,
    nextDue: string | null,
  ): Promise<void>;
  retry(workspaceId: string, run: string): Promise<void>;
  pause(
    workspaceId: string,
    run: string,
    reason: SheetPauseReason,
  ): Promise<SheetPausedAlert | null>;
  cleanupClaim(
    run: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<CleanupClaim[]>;
  cleanupRetry(id: string, run: string): Promise<void>;
  cleanupFinish(
    id: string,
    run: string,
    left: number,
  ): Promise<{
    released: ReleasedConnection | null;
    alert: ShareAccessAlert | null;
  } | null>;
};

const claimsSchema = z.array(
  z
    .object({
      workspace_id: z.uuid(),
      spreadsheet_id: z.string(),
      version: z.number().int(),
      cap: z.number().int().positive(),
      connection: z
        .object({
          id: z.uuid(),
          user_id: z.uuid(),
          google_sub: z.string(),
          refresh_token_encrypted: z.string(),
          granted_scopes: z.array(z.string()),
        })
        .nullable(),
      targets: z.array(
        z.object({
          user_id: z.uuid(),
          email: z.string(),
          position: z.number().int(),
        }),
      ),
      shares: z.array(
        z.object({
          email: z.string(),
          state: z.enum(SHEET_SHARE_STATES),
          permission_id: z.string().nullable(),
          reason: z.enum(SHEET_SHARE_REASONS).nullable(),
          next_try_at: z.string().nullable(),
        }),
      ),
    })
    .transform((db): ShareClaim => ({
      workspaceId: db.workspace_id,
      spreadsheetId: db.spreadsheet_id,
      version: db.version,
      cap: db.cap,
      connection: db.connection && {
        id: db.connection.id,
        userId: db.connection.user_id,
        googleSub: db.connection.google_sub,
        tokenEncrypted: db.connection.refresh_token_encrypted,
        scopes: db.connection.granted_scopes,
      },
      targets: db.targets.map((target) => ({
        userId: target.user_id,
        email: target.email,
        position: target.position,
      })),
      shares: db.shares.map((share) => ({
        email: share.email,
        state: share.state,
        permissionId: share.permission_id,
        reason: share.reason,
        nextTryAt: share.next_try_at,
      })),
    })),
);

const cleanupsSchema = z.array(
  z
    .object({
      id: z.uuid(),
      spreadsheet_id: z.string(),
      google_sub: z.string(),
      token_user_id: z.uuid(),
      refresh_token_encrypted: z.string(),
      permission_ids: z.array(z.string()),
      emails: z.array(z.string()),
      give_up_at: z.string(),
    })
    .transform((db): CleanupClaim => ({
      id: db.id,
      spreadsheetId: db.spreadsheet_id,
      googleSub: db.google_sub,
      tokenUserId: db.token_user_id,
      tokenEncrypted: db.refresh_token_encrypted,
      permissionIds: db.permission_ids,
      emails: db.emails,
      giveUpAt: db.give_up_at,
    })),
);

const finishedSchema = z
  .object({
    released: releasedSchema,
    alert: z
      .object({
        email: z.string(),
        workspace_name: z.string().nullable(),
        spreadsheet_id: z.string(),
        account_email: z.string(),
        left: z.number().int().positive(),
      })
      .nullable()
      .transform(
        (db): ShareAccessAlert | null =>
          db && {
            email: db.email,
            workspaceName: db.workspace_name,
            spreadsheetId: db.spreadsheet_id,
            accountEmail: db.account_email,
            left: db.left,
          },
      ),
  })
  .nullable();

/**
 * The share worker's store over the service-role client (#413 RPCs). Throws on a database error,
 * naming only the call and the error code (messages can hold data); the run logs it.
 */
export function createShareStore(admin: Client): ShareStore {
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
          "sheet_share_claim",
          await admin.rpc("sheet_share_claim", {
            p_run: run,
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          }),
        ),
      ),
    intend: async (workspaceId, run, target) =>
      check(
        "sheet_share_intend",
        await admin.rpc("sheet_share_intend", {
          p_workspace: workspaceId,
          p_run: run,
          p_email: target.email,
          p_user: target.userId,
        }),
      ) === true,
    save: async (workspaceId, run, outcome) =>
      check(
        "sheet_share_save",
        await admin.rpc("sheet_share_save", {
          p_workspace: workspaceId,
          p_run: run,
          p_email: outcome.email,
          p_user: sqlNullable(outcome.userId),
          p_state: outcome.state,
          p_permission_id: sqlNullable(outcome.permissionId),
          p_reason: sqlNullable(outcome.reason),
          p_next_try_at: sqlNullable(outcome.nextTryAt),
        }),
      ) === true,
    forget: async (workspaceId, run, emails) =>
      check(
        "sheet_share_forget",
        await admin.rpc("sheet_share_forget", {
          p_workspace: workspaceId,
          p_run: run,
          p_emails: emails,
        }),
      ) === true,
    release: async (workspaceId, run, version, nextDue) => {
      check(
        "sheet_share_release",
        await admin.rpc("sheet_share_release", {
          p_workspace: workspaceId,
          p_run: run,
          p_version: version,
          p_next_due: sqlNullable(nextDue),
        }),
      );
    },
    retry: async (workspaceId, run) => {
      check(
        "sheet_share_retry",
        await admin.rpc("sheet_share_retry", {
          p_workspace: workspaceId,
          p_run: run,
        }),
      );
    },
    pause: async (workspaceId, run, reason) =>
      sheetPausedAlertSchema.parse(
        check(
          "sheet_share_pause",
          await admin.rpc("sheet_share_pause", {
            p_workspace: workspaceId,
            p_run: run,
            p_reason: reason,
          }),
        ),
      ),
    cleanupClaim: async (run, limit, leaseSeconds) =>
      cleanupsSchema.parse(
        check(
          "sheet_share_cleanup_claim",
          await admin.rpc("sheet_share_cleanup_claim", {
            p_run: run,
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          }),
        ),
      ),
    cleanupRetry: async (id, run) => {
      check(
        "sheet_share_cleanup_retry",
        await admin.rpc("sheet_share_cleanup_retry", { p_id: id, p_run: run }),
      );
    },
    cleanupFinish: async (id, run, left) =>
      finishedSchema.parse(
        check(
          "sheet_share_cleanup_finish",
          await admin.rpc("sheet_share_cleanup_finish", {
            p_id: id,
            p_run: run,
            p_left: left,
          }),
        ),
      ),
  };
}
