import { render } from "react-email";
import { APP_NAME } from "@/config/app";
import { ActionEmail } from "./action-email";
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
    <ActionEmail
      preview={tr("invite.preview", {
        workspace: workspaceName,
        role: roleText,
        days: expiresInDays,
      })}
      heading={tr("invite.heading", { workspace: workspaceName })}
      body={tr("invite.body", {
        inviter: inviterName,
        workspace: workspaceName,
        appName: APP_NAME,
        role: roleText,
      })}
      button={tr("invite.button")}
      link={link}
      note={tr("invite.expiry", { days: expiresInDays })}
      fallback={tr("invite.fallback")}
    />
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
