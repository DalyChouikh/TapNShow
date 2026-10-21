import { render } from "react-email";
import { APP_NAME } from "@/config/app";
import type { SheetPauseReason } from "@/shared/api/sheets";
import { ActionEmail } from "./action-email";
import { getEmailTranslator } from "./translator";

/** What an alert to a workspace Owner needs (sent by the platform sender, spec §8). */
export type OwnerAlertEmailProps =
  | {
      kind: "senderBroken" | "senderRemoved" | "senderAndSheetRemoved";
      workspaceName: string;
      linkUrl: string;
    }
  | {
      kind: "sheetPaused";
      reason: SheetPauseReason;
      workspaceName: string;
      linkUrl: string;
    }
  | {
      kind: "sendingSuspended" | "sendingResumed";
      workspaceName: string;
      linkUrl: string;
    }
  | {
      kind: "sheetAccessLeft";
      left: number;
      /** Null when the workspace no longer exists. */
      workspaceName: string | null;
      accountEmail: string;
      linkUrl: string;
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
  const values: Record<string, string | number> =
    props.kind === "sheetAccessLeft"
      ? {
          workspace: props.workspaceName ?? "",
          known: props.workspaceName === null ? "no" : "yes",
          account: props.accountEmail,
          left: props.left,
          appName: APP_NAME,
        }
      : { workspace: props.workspaceName, appName: APP_NAME };
  const { kind } = props;
  return {
    subject: tr(`${kind}.subject`, values),
    preview: tr(`${kind}.preview`, values),
    heading: tr(`${kind}.heading`, values),
    body:
      props.kind === "sheetPaused"
        ? tr(`sheetPaused.body.${props.reason}`, values)
        : tr(`${props.kind}.body`, values),
    button: tr(`${kind}.button`, values),
    fallback: tr(`${kind}.fallback`, values),
  };
}

/**
 * Tells an Owner that something of their workspace needs them (spec §8): its Gmail needs
 * reconnecting, its sending (and maybe its Google Sheet) stopped because the account was removed,
 * its Google Sheet stopped updating, its meeting emails are paused for review or can go out again
 * (spec §7.12), or people may still have access to a Google Sheet TapNShow let go of (#413). Sent
 * by the platform sender.
 */
export function OwnerAlertEmail({
  copy,
  linkUrl,
}: {
  copy: AlertCopy;
  linkUrl: string;
}) {
  return (
    <ActionEmail
      preview={copy.preview}
      heading={copy.heading}
      body={copy.body}
      button={copy.button}
      link={linkUrl}
      fallback={copy.fallback}
    />
  );
}

/** Subject + HTML + plain text for one Owner alert. */
export async function renderOwnerAlertEmail(
  props: OwnerAlertEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const copy = alertCopy(props);
  const element = <OwnerAlertEmail copy={copy} linkUrl={props.linkUrl} />;
  return {
    subject: copy.subject,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
