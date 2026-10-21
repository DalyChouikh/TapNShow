import "server-only";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import {
  DRIVE_PERMISSIONS_PAGE_SIZE,
  SHEET_REQUEST_TIMEOUT_MS,
} from "@/config/sheets";
import { sendOwnerAlert } from "@/server/email/owner-alert";
import { createSystemMailer } from "@/server/email/system-mailer";
import { createDrivePermissionsClient } from "@/server/google/drive-permissions";
import { revokeReleased } from "@/server/google/release";
import { googleTokenDeps } from "@/server/google/token-deps";
import { createShareStore } from "@/server/queries/sheet-shares";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { SheetSharesDeps } from "./run-sheet-shares";

/**
 * Real dependencies for `runSheetShares` and `runShareCleanups` (#413).
 * @throws Error naming the first missing secret
 */
export function createSheetSharesDeps(): SheetSharesDeps {
  const env = getServerEnv();
  const mailer = createSystemMailer();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  return {
    store: createShareStore(createSupabaseAdminClient()),
    drive: createDrivePermissionsClient({
      driveBaseUrl: env.GOOGLE_DRIVE_API_BASE_URL,
      timeoutMs: SHEET_REQUEST_TIMEOUT_MS,
      pageSize: DRIVE_PERMISSIONS_PAGE_SIZE,
    }),
    ...googleTokenDeps(),
    revoke: revokeReleased,
    alertPaused: (alert) =>
      sendOwnerAlert(mailer, appUrl, alert.email, {
        kind: "sheetPaused",
        reason: alert.reason,
        workspaceName: alert.workspaceName,
        workspaceSlug: alert.workspaceSlug,
      }),
    alertAccessLeft: (alert) =>
      sendOwnerAlert(mailer, appUrl, alert.email, {
        kind: "sheetAccessLeft",
        left: alert.left,
        workspaceName: alert.workspaceName,
        accountEmail: alert.accountEmail,
        spreadsheetId: alert.spreadsheetId,
      }),
    reportBug: (context) =>
      Sentry.captureMessage(
        `Google Drive sharing ${context.where} ${context.status} ${context.reason}`,
        "error",
      ),
    now: () => Date.now(),
    newRunId: () => randomUUID(),
  };
}
