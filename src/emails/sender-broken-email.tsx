import { Button, render, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** What the sender-broken alert needs. */
export type SenderBrokenEmailProps = {
  workspaceName: string;
  settingsUrl: string;
};

/** Tells an Owner their workspace's Gmail needs reconnecting (spec §8), sent by the platform sender. */
export function SenderBrokenEmail({
  workspaceName,
  settingsUrl,
}: SenderBrokenEmailProps) {
  const tr = getEmailTranslator();
  return (
    <EmailLayout
      preview={tr("senderBroken.preview", { workspace: workspaceName })}
      heading={tr("senderBroken.heading", { workspace: workspaceName })}
    >
      <Text
        style={{ fontSize: "16px", lineHeight: "24px", margin: "0 0 20px" }}
      >
        {tr("senderBroken.body", {
          workspace: workspaceName,
          appName: APP_NAME,
        })}
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
        {tr("senderBroken.button")}
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
        {tr("senderBroken.fallback")} {settingsUrl}
      </Text>
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one sender-broken alert. */
export async function renderSenderBrokenEmail(
  props: SenderBrokenEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const element = <SenderBrokenEmail {...props} />;
  return {
    subject: tr("senderBroken.subject", { workspace: props.workspaceName }),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
