import { Button, render, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** What the invite email needs. */
export type InviteEmailProps = {
  workspaceName: string;
  inviterName: string;
  role: "admin" | "viewer";
  link: string;
  expiresInDays: number;
};

/** Viewer/Admin invitation (spec §7.13), sent by the platform sender. */
export function InviteEmail({
  workspaceName,
  inviterName,
  role,
  link,
  expiresInDays,
}: InviteEmailProps) {
  const tr = getEmailTranslator();
  const roleText = tr(
    role === "admin" ? "invite.roleAdmin" : "invite.roleViewer",
  );
  return (
    <EmailLayout
      preview={tr("invite.preview", {
        workspace: workspaceName,
        role: roleText,
        days: expiresInDays,
      })}
      heading={tr("invite.heading", { workspace: workspaceName })}
    >
      <Text
        style={{ fontSize: "16px", lineHeight: "24px", margin: "0 0 20px" }}
      >
        {tr("invite.body", {
          inviter: inviterName,
          workspace: workspaceName,
          appName: APP_NAME,
          role: roleText,
        })}
      </Text>
      <Button
        href={link}
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
        {tr("invite.button")}
      </Button>
      <Text
        style={{ fontSize: "15px", lineHeight: "22px", margin: "20px 0 8px" }}
      >
        {tr("invite.expiry", { days: expiresInDays })}
      </Text>
      <Text
        style={{
          color: t.muted,
          fontSize: "13px",
          lineHeight: "18px",
          margin: 0,
          wordBreak: "break-all",
        }}
      >
        {tr("invite.fallback")} {link}
      </Text>
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one invite. */
export async function renderInviteEmail(
  props: InviteEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const element = <InviteEmail {...props} />;
  return {
    subject: tr("invite.subject", {
      inviter: props.inviterName,
      workspace: props.workspaceName,
      appName: APP_NAME,
    }),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
