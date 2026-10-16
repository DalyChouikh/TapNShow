import { Button, Text } from "react-email";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";

/**
 * One email that asks for one action (spec §7.13, §8): a paragraph, the primary button, an
 * optional note (an expiry), and the link written out for clients that block buttons. Workspace
 * and admin invites and the Owner alerts share it.
 */
export function ActionEmail({
  preview,
  heading,
  body,
  button,
  link,
  note,
  fallback,
}: {
  preview: string;
  heading: string;
  body: string;
  button: string;
  link: string;
  note?: string;
  fallback: string;
}) {
  return (
    <EmailLayout preview={preview} heading={heading}>
      <Text
        style={{ fontSize: "16px", lineHeight: "24px", margin: "0 0 20px" }}
      >
        {body}
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
        {button}
      </Button>
      {note ? (
        <Text
          style={{ fontSize: "15px", lineHeight: "22px", margin: "20px 0 8px" }}
        >
          {note}
        </Text>
      ) : null}
      <Text
        style={{
          color: t.muted,
          fontSize: "13px",
          lineHeight: "18px",
          margin: note ? 0 : "20px 0 0",
          wordBreak: "break-all",
        }}
      >
        {fallback} {link}
      </Text>
    </EmailLayout>
  );
}
