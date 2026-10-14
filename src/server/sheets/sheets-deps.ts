import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { SHEET_REQUEST_TIMEOUT_MS } from "@/config/sheets";
import { createSystemMailer } from "@/server/email/system-mailer";
import { googleTokenDeps } from "@/server/google/token-deps";
import { createGoogleSheetsClient } from "@/server/google/sheets-client";
import { createSheetStore } from "@/server/queries/sheets";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { SheetsDeps } from "./run-sheets";
import { sendOwnerAlert } from "@/server/email/owner-alert";

/**
 * Real dependencies for `runSheetSync`.
 * @throws Error naming the first missing secret
 */
export function createSheetsDeps(): SheetsDeps {
  const env = getServerEnv();
  const mailer = createSystemMailer();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  return {
    store: createSheetStore(createSupabaseAdminClient()),
    google: createGoogleSheetsClient({
      sheetsBaseUrl: env.GOOGLE_SHEETS_API_BASE_URL,
      driveBaseUrl: env.GOOGLE_DRIVE_API_BASE_URL,
      timeoutMs: SHEET_REQUEST_TIMEOUT_MS,
    }),
    ...googleTokenDeps(),
    alertPaused: (alert) =>
      sendOwnerAlert(mailer, appUrl, alert.email, {
        kind: "sheetPaused",
        reason: alert.reason,
        workspaceName: alert.workspaceName,
        workspaceSlug: alert.workspaceSlug,
      }),
    reportBug: (context) =>
      Sentry.captureMessage(
        `Google Sheets ${context.where} ${context.status} ${context.reason}`,
        "error",
      ),
    hash: (text) => createHash("sha256").update(text).digest("hex"),
    now: () => Date.now(),
    newRunId: () => randomUUID(),
    // Sheets tab ids are positive 31-bit integers; Google keeps 0 for the first tab.
    newObjectId: () => randomInt(1, 2 ** 31 - 1),
  };
}
