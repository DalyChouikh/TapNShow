import { Text } from "react-email";
import type { CardSection } from "@/lib/meetings/changes";
import { bodyStyle as body, labelStyle as label } from "./meeting-blocks";
import { emailTheme as t, hiddenStyle } from "./theme";
import { getEmailTranslator } from "./translator";

const highlight = {
  backgroundColor: t.warning,
  borderRadius: "4px",
  padding: "1px 4px",
};

// Explicit, since some clients drop the default style of <s>.
const struck = { textDecoration: "line-through" };

/** A changed value: the old one struck through (muted), then the new one highlighted. */
function Changed({ before, now }: { before: string; now: string }) {
  const tr = getEmailTranslator();
  return (
    <>
      <Text style={{ ...body, color: t.muted }}>
        <span style={hiddenStyle}>{`${tr("changes.before")} `}</span>
        <s style={struck}>{before}</s>
      </Text>
      <Text style={{ ...body, fontWeight: 700 }}>
        <span style={hiddenStyle}>{`${tr("changes.now")} `}</span>
        <span style={highlight}>{now}</span>
      </Text>
    </>
  );
}

/**
 * The meeting card with what changed marked (owner's mockup A, 2026-10-09; the Review changes
 * step shows the same `markedCard` sections). The layout heading already shows the title, so the
 * title part appears only when it changed, as the old title struck through.
 */
export function MarkedMeetingCard({ sections }: { sections: CardSection[] }) {
  const tr = getEmailTranslator();
  return (
    <>
      {sections.map((section) => {
        if (section.key === "title") {
          return section.before === null ? null : (
            <Text key={section.key} style={{ ...body, color: t.muted }}>
              <span style={hiddenStyle}>{`${tr("changes.before")} `}</span>
              <s style={struck}>{section.before}</s>
            </Text>
          );
        }
        return (
          <div key={section.key}>
            <Text style={label}>{tr(`changes.sections.${section.key}`)}</Text>
            {section.updated ? (
              <Text style={body}>
                <span style={{ ...highlight, fontWeight: 700 }}>
                  {tr("changes.updated")}
                </span>
              </Text>
            ) : section.before === null ? (
              <Text style={body}>{section.now}</Text>
            ) : (
              <Changed before={section.before} now={section.now} />
            )}
          </div>
        );
      })}
    </>
  );
}
