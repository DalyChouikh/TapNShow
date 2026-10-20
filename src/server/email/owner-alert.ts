import "server-only";
import { renderOwnerAlertEmail } from "@/emails/owner-alert-email";
import { sheetUrl } from "@/lib/sheets/url";
import { settingsPath, workspaceHomePath } from "@/lib/with-query";
import type { SheetPauseReason } from "@/shared/api/sheets";
import type { SystemEmail } from "./system-mailer";

/** An alert to a workspace Owner, before its Settings link is known. */
export type OwnerAlertInput =
  | {
      kind: "senderBroken" | "senderRemoved" | "senderAndSheetRemoved";
      workspaceName: string;
      workspaceSlug: string;
    }
  | {
      kind: "sheetPaused";
      reason: SheetPauseReason;
      workspaceName: string;
      workspaceSlug: string;
    }
  | {
      kind: "sendingSuspended" | "sendingResumed";
      workspaceName: string;
      workspaceSlug: string;
    }
  | {
      kind: "sheetAccessLeft";
      left: number;
      workspaceName: string | null;
      accountEmail: string;
      spreadsheetId: string;
    };

/**
 * Renders and sends one Owner alert (spec §8) with the link that helps: the Settings section that
 * fixes it (Sending for Gmail problems, and when both stopped Gmail comes first; Sheets for a
 * paused sheet), the workspace's Home when its sending was paused or resumes, or the Google Sheet
 * itself when people may still have access to it. The one place these links are built.
 */
export async function sendOwnerAlert(
  mailer: { send: (email: SystemEmail) => Promise<void> },
  appUrl: string,
  to: string,
  alert: OwnerAlertInput,
): Promise<void> {
  const link = (path: string) => `${appUrl}${path}`;
  const content =
    alert.kind === "sheetAccessLeft"
      ? await renderOwnerAlertEmail({
          kind: alert.kind,
          left: alert.left,
          workspaceName: alert.workspaceName,
          accountEmail: alert.accountEmail,
          linkUrl: sheetUrl(alert.spreadsheetId),
        })
      : alert.kind === "sheetPaused"
        ? await renderOwnerAlertEmail({
            kind: alert.kind,
            reason: alert.reason,
            workspaceName: alert.workspaceName,
            linkUrl: link(settingsPath(alert.workspaceSlug, "sheets")),
          })
        : alert.kind === "sendingSuspended" || alert.kind === "sendingResumed"
          ? await renderOwnerAlertEmail({
              kind: alert.kind,
              workspaceName: alert.workspaceName,
              linkUrl: link(workspaceHomePath(alert.workspaceSlug)),
            })
          : await renderOwnerAlertEmail({
              kind: alert.kind,
              workspaceName: alert.workspaceName,
              linkUrl: link(settingsPath(alert.workspaceSlug, "sending")),
            });
  await mailer.send({ to, ...content });
}
