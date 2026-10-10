"use client";

import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui/chip";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { declaredActual } from "@/lib/responses/check-in";
import { describeAnswer, lowerFirst } from "@/lib/responses/describe-answer";
import { ACTUAL_TONE } from "@/lib/responses/tones";
import { cn } from "@/lib/utils";
import type { Mark, PersonRow } from "@/shared/api/responses";
import { LateMinutes } from "./late-minutes";
import { PersonName } from "./person-row";

const ACTUALS: Mark["actual"][] = ["present", "late", "absent"];

/**
 * One person at the door (owner's mockup A): name, what they said, then Present / Late / Absent.
 * Before a mark, the chip their answer suggests has a dashed outline; tapping the pressed chip
 * clears the mark. The three choices sit in a fixed grid: at 320 px they fit side by side, and a
 * sideways-swiping row could hide Absent at the door. Late asks how late (#257), starting from the
 * minutes the person said.
 */
export function CheckInRow({
  slug,
  person,
  delayOptions,
  failed,
  onMark,
}: {
  slug: string;
  person: PersonRow;
  /** The meeting's delay choices, offered when marked Late. */
  delayOptions: number[];
  failed: boolean;
  onMark: (actual: Mark["actual"] | null, lateMinutes: number | null) => void;
}) {
  const t = useTranslations("MeetingPage.checkIn");
  const labels = useAnswerLabels();
  const said = person.answer ? describeAnswer(labels, person.answer) : null;
  const hint = person.mark
    ? null
    : declaredActual(person.answer?.status ?? null);
  const differs =
    person.mark !== null &&
    said !== null &&
    person.mark.actual !== declaredActual(person.answer?.status ?? null);
  return (
    <li className="flex flex-col gap-1 border-b border-dashed border-outline/30 py-2 [contain-intrinsic-size:auto_6rem] [content-visibility:auto] last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <PersonName slug={slug} person={person} />
        <span className="text-sm text-muted-ink">
          {differs && said
            ? t("said", { answer: lowerFirst(said) })
            : (said ?? t("noReply"))}
        </span>
      </div>
      <div
        role="group"
        aria-label={t("group", { name: person.fullName })}
        className="grid grid-cols-3 gap-2"
      >
        {ACTUALS.map((value) => {
          const pressed = person.mark?.actual === value;
          return (
            <Chip
              key={value}
              tone={ACTUAL_TONE[value]}
              pressed={pressed}
              className={cn(
                "w-full justify-center px-2",
                hint === value && "border-dashed",
              )}
              onPressedChange={() =>
                onMark(
                  pressed ? null : value,
                  !pressed && value === "late"
                    ? (person.answer?.delayMinutes ?? null)
                    : null,
                )
              }
            >
              {t(value)}
            </Chip>
          );
        })}
      </div>
      {person.mark?.actual === "late" ? (
        <LateMinutes
          inviteeId={person.inviteeId}
          name={person.fullName}
          options={delayOptions}
          value={person.mark.lateMinutes}
          onChange={(minutes) => onMark("late", minutes)}
        />
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm font-bold">
          {t("saveFailed")}
        </p>
      ) : null}
    </li>
  );
}
