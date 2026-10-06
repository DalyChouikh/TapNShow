import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";
import { APP_NAME } from "@/config/app";
import { DEFAULT_LOCALE } from "@/config/i18n";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** Shared email frame: brand sticker, outlined card with hard shadow, footer. */
export function EmailLayout({
  preview,
  heading,
  children,
}: {
  preview: string;
  heading: string;
  children: ReactNode;
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
            {APP_NAME}
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
            {tr("footer", { appName: APP_NAME })}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
