import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { APP_NAME } from "@/config/app";
import { DEFAULT_LOCALE } from "@/config/i18n";
import { PRIVACY_POLICY_URL } from "@/config/legal";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/**
 * Shared email frame: brand sticker, outlined card with hard shadow, footer. Every footer ends with
 * the privacy policy's link (spec §7.18), after the caller's own footer when there is one.
 */
export function EmailLayout({
  preview,
  heading,
  children,
  sticker,
  footer,
}: {
  preview: string;
  heading: string;
  children: ReactNode;
  /** Text in the top sticker (meeting invites show the workspace name). */
  sticker?: string;
  /** Footer content (meeting emails carry their opt-out links); the privacy link follows it. */
  footer?: ReactNode;
}) {
  const tr = getEmailTranslator();
  return (
    <Html lang={DEFAULT_LOCALE}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: t.background,
          color: t.ink,
          fontFamily: t.fontBody,
          margin: 0,
          padding: "24px 12px",
        }}
      >
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Text
            style={{
              ...brutalBox(t.primary, t.radiusSticker),
              display: "inline-block",
              fontFamily: t.fontDisplay,
              fontSize: "16px",
              margin: "0 0 16px",
              padding: "6px 12px",
            }}
          >
            {sticker ?? APP_NAME}
          </Text>
          <Section
            style={{ ...brutalBox(t.surface, t.radiusCard), padding: "24px" }}
          >
            <Heading
              as="h1"
              style={{
                fontFamily: t.fontDisplay,
                fontSize: "24px",
                lineHeight: "30px",
                margin: "0 0 12px",
              }}
            >
              {heading}
            </Heading>
            {children}
          </Section>
          <Text
            style={{
              color: t.muted,
              fontSize: "13px",
              lineHeight: "18px",
              marginTop: "20px",
            }}
          >
            {footer ?? tr("footer", { appName: APP_NAME })}
            {footer ? " · " : " "}
            <Link
              href={PRIVACY_POLICY_URL}
              style={{ color: t.muted, textDecoration: "underline" }}
            >
              {tr("privacy")}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
