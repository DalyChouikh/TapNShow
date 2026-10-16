import { render } from "react-email";
import { APP_NAME } from "@/config/app";
import { ActionEmail } from "./action-email";
import { getEmailTranslator } from "./translator";

/** What the platform admin invite email needs. */
export type AdminInviteEmailProps = {
  inviterName: string;
  link: string;
  expiresInDays: number;
};

/**
 * Subject + HTML + plain text of an invite to help run TapNShow (spec §7.19), sent by the platform
 * sender. Its own words: a workspace invite names a workspace and a role, which this one hasn't.
 */
export async function renderAdminInviteEmail(
  props: AdminInviteEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const values = {
    inviter: props.inviterName,
    appName: APP_NAME,
    days: props.expiresInDays,
  };
  const element = (
    <ActionEmail
      preview={tr("adminInvite.preview", values)}
      heading={tr("adminInvite.heading", values)}
      body={tr("adminInvite.body", values)}
      button={tr("adminInvite.button")}
      link={props.link}
      fallback={tr("adminInvite.fallback")}
    />
  );
  return {
    subject: tr("adminInvite.subject", values),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
