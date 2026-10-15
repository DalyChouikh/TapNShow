import { Button, render, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import type { SheetPauseReason } from "@/shared/api/sheets";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** What an alert to a workspace Owner needs (sent by the platform sender, spec §8). */
export type OwnerAlertEmailProps =
  | {
      kind: "senderBroken" | "senderRemoved" | "senderAndSheetRemoved";
      workspaceName: string;
      settingsUrl: string;
    }
  | {
      kind: "sheetPaused";
      reason: SheetPauseReason;
      workspaceName: string;
      settingsUrl: string;
    };

type AlertCopy = {
  subject: string;
  preview: string;
  heading: string;
  body: string;
  button: string;
  fallback: string;
};

/** The words of one alert, from `Email.<kind>` (a paused sheet's body depends on the reason). */
function alertCopy(props: OwnerAlertEmailProps): AlertCopy {
  const tr = getEmailTranslator();
  const values = { workspace: props.workspaceName, appName: APP_NAME };
  const { kind } = props;
  return {
    subject: tr(`${kind}.subject`, values),
    preview: tr(`${kind}.preview`, values),
    heading: tr(`${kind}.heading`, values),
    body:
      props.kind === "sheetPaused"
        ? tr(`sheetPaused.body.${props.reason}`, values)
        : tr(`${props.kind}.body`, values),
    button: tr(`${kind}.button`),
    fallback: tr(`${kind}.fallback`),
  };
}

/**
 * Tells an Owner that something of their workspace needs them (spec §8): its Gmail needs
 * reconnecting, its sending (and maybe its Google Sheet) stopped because the account was removed,
 * or its Google Sheet stopped updating. Sent by the platform sender.
 */
export function OwnerAlertEmail({
  copy,
  settingsUrl,
}: {
  copy: AlertCopy;
  settingsUrl: string;
}) {
  return (
    <EmailLayout preview={copy.preview} heading={copy.heading}>
      <Text
        style={{ fontSize: "16px", lineHeight: "24px", margin: "0 0 20px" }}
      >
        {copy.body}
      </Text>
      <Button
        href={settingsUrl}
        style={{
          ...brutalBox(t.primary, t.radiusControl),
          color: t.ink,
          display: "inline-block",
          fontFamily: t.fontDisplay,
          fontSize: "16px",
          padding: "14px 22px",
          textDecoration: "none",
        }}
      >
        {copy.button}
      </Button>
      <Text
        style={{
          color: t.muted,
          fontSize: "13px",
          lineHeight: "18px",
          margin: "20px 0 0",
          wordBreak: "break-all",
        }}
      >
        {copy.fallback} {settingsUrl}
      </Text>
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one Owner alert. */
export async function renderOwnerAlertEmail(
  props: OwnerAlertEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const copy = alertCopy(props);
  const element = (
    <OwnerAlertEmail copy={copy} settingsUrl={props.settingsUrl} />
  );
  return {
    subject: copy.subject,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
