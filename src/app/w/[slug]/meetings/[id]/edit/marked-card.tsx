"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import type { CardSection } from "@/lib/meetings/changes";

/**
 * The meeting card with what changed marked (owner's mockup, 2026-10-09): an old value struck
 * through above the new one, highlighted; long text only says "Updated". The update email renders
 * the same `markedCard()` sections (`src/emails/marked-meeting-card.tsx`), so the organizer sees
 * what members get. Hidden "Before:/Now:" labels keep the meaning for screen readers.
 */
export function MarkedCard({ sections }: { sections: CardSection[] }) {
  const t = useTranslations("Email.changes");
  return (
    <Card className="flex flex-col gap-3">
      {sections.map((section) => {
        if (section.key === "title") {
          return (
            <div key={section.key} className="flex flex-col">
              {section.before !== null ? (
                <del className="text-sm text-muted-ink">
                  <span className="sr-only">{t("before")} </span>
                  {section.before}
                </del>
              ) : null}
              <p className="font-display text-xl break-words">
                {section.before !== null ? (
                  <ins className="rounded-sm bg-fill-warning/25 px-1 text-ink no-underline">
                    <span className="sr-only">{t("now")} </span>
                    {section.now}
                  </ins>
                ) : (
                  section.now
                )}
              </p>
            </div>
          );
        }
        return (
          <div key={section.key} className="flex flex-col gap-0.5">
            <p className="text-xs font-bold tracking-wide uppercase">
              {t(`sections.${section.key}`)}
            </p>
            {section.updated ? (
              <p>
                <span className="rounded-sm bg-fill-warning/25 px-1 font-bold">
                  {t("updated")}
                </span>
              </p>
            ) : section.before === null ? (
              <p className="break-words">{section.now}</p>
            ) : (
              <>
                <del className="break-words text-muted-ink">
                  <span className="sr-only">{t("before")} </span>
                  {section.before}
                </del>
                <ins className="self-start rounded-sm bg-fill-warning/25 px-1 font-bold break-words text-ink no-underline">
                  <span className="sr-only">{t("now")} </span>
                  {section.now}
                </ins>
              </>
            )}
          </div>
        );
      })}
    </Card>
  );
}
