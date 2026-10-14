import "server-only";
import { renderOwnerAlertEmail } from "@/emails/owner-alert-email";
import { settingsPath } from "@/lib/with-query";
import type { SheetPauseReason } from "@/shared/api/sheets";
import type { SystemEmail } from "./system-mailer";

/** An alert to a workspace Owner, before its Settings link is known. */
export type OwnerAlertInput =
  | {
      kind: "senderBroken" | "senderRemoved";
      workspaceName: string;
      workspaceSlug: string;
    }
  | {
      kind: "sheetPaused";
      reason: SheetPauseReason;
      workspaceName: string;
      workspaceSlug: string;
    };

/**
 * Renders and sends one Owner alert (spec §8) with the link to the Settings section that fixes it:
 * Sending for Gmail problems, Sheets for a paused sheet. The one place these links are built.
 */
export async function sendOwnerAlert(
  mailer: { send: (email: SystemEmail) => Promise<void> },
  appUrl: string,
  to: string,
  alert: OwnerAlertInput,
): Promise<void> {
  const section = alert.kind === "sheetPaused" ? "sheets" : "sending";
  const settingsUrl = `${appUrl}${settingsPath(alert.workspaceSlug, section)}`;
  const content =
    alert.kind === "sheetPaused"
      ? await renderOwnerAlertEmail({
          kind: alert.kind,
          reason: alert.reason,
          workspaceName: alert.workspaceName,
          settingsUrl,
        })
      : await renderOwnerAlertEmail({
          kind: alert.kind,
          workspaceName: alert.workspaceName,
          settingsUrl,
        });
  await mailer.send({ to, ...content });
}
