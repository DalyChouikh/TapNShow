import { Button, Section } from "react-email";
import { RESPONSE_CHOICES, type ResponseChoice } from "@/config/meetings";
import type { ResponseMode } from "@/shared/api/meeting-settings";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

const CHOICE_FILL: Record<ResponseChoice, string> = {
  attending: t.success,
  going: t.success,
  late: t.warning,
  absent: t.danger,
  not_going: t.danger,
};

const buttonStyle = (fill: string) => ({
  ...brutalBox(fill, t.radiusControl),
  color: t.ink,
  display: "inline-block",
  fontFamily: t.fontDisplay,
  fontSize: "15px",
  padding: "12px 18px",
  textDecoration: "none",
});

/** The answer buttons of a mode; each only pre-selects its choice on `/r/[token]` (spec §4). */
export function AnswerButtons({
  responseMode,
  respondUrl,
}: {
  responseMode: Exclude<ResponseMode, "announcement">;
  respondUrl: string;
}) {
  const tr = getEmailTranslator();
  return (
    <Section style={{ margin: "20px 0 8px" }}>
      {RESPONSE_CHOICES[responseMode].map((choice) => (
        <Button
          key={choice}
          href={`${respondUrl}?choice=${choice}`}
          style={{ ...buttonStyle(CHOICE_FILL[choice]), margin: "0 8px 8px 0" }}
        >
          {tr(`meetingInvite.choice.${choice}`)}
        </Button>
      ))}
    </Section>
  );
}

/** One primary-filled link button ("Change my answer", "Add to my calendar"). */
export function PrimaryLinkButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Section style={{ margin: "20px 0 8px" }}>
      <Button href={href} style={buttonStyle(t.primary)}>
        {label}
      </Button>
    </Section>
  );
}
