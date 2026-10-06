import { render, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { OTP_EXPIRY_SECONDS } from "@/config/auth";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** Supabase Auth replaces this with the real code when it sends the email. */
export const SUPABASE_TOKEN_PLACEHOLDER = "{{ .Token }}";

const minutes = OTP_EXPIRY_SECONDS / 60;

/** Sign-in code email: code only, no link (link scanners consume one-time links). */
export function SignInCodeEmail({ code }: { code: string }) {
  const tr = getEmailTranslator();
  return (
    <EmailLayout
      preview={tr("signIn.preview", { minutes })}
      heading={tr("signIn.heading")}
    >
      <Text
        style={{ fontSize: "16px", lineHeight: "24px", margin: "0 0 16px" }}
      >
        {tr("signIn.intro", { appName: APP_NAME })}
      </Text>
      <Text
        style={{
          ...brutalBox(t.warning, t.radiusControl),
          fontFamily: t.fontCode,
          fontSize: "32px",
          fontWeight: 700,
          letterSpacing: "6px",
          margin: "0 0 16px",
          padding: "14px 16px",
          textAlign: "center",
        }}
      >
        {code}
      </Text>
      <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 8px" }}>
        {tr("signIn.expiry", { minutes })}
      </Text>
      <Text
        style={{
          color: t.muted,
          fontSize: "14px",
          lineHeight: "20px",
          margin: 0,
        }}
      >
        {tr("signIn.ignore")}
      </Text>
    </EmailLayout>
  );
}

/** Subject + HTML for Supabase's "Magic Link" and "Confirm signup" templates. */
export async function renderSignInCodeTemplate(): Promise<{
  subject: string;
  html: string;
}> {
  const tr = getEmailTranslator();
  return {
    subject: tr("signIn.subject", { appName: APP_NAME }),
    html: await render(<SignInCodeEmail code={SUPABASE_TOKEN_PLACEHOLDER} />),
  };
}
