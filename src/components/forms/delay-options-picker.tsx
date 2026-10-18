"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DELAY_OPTIONS_MAX } from "@/config/meetings";
import {
  addDelayOption,
  delayChoices,
  lateMinutesMax,
  type AddDelayProblem,
} from "@/lib/meetings/late";
import { MinutesInput } from "./minutes-input";

/**
 * The delay choices of "I'll be late" (wizard Answers step, Settings > Meeting defaults): the chips
 * shorter than the meeting, any typed time already chosen, and Other to type one (#400). Up to
 * `DELAY_OPTIONS_MAX`; a seventh chip is ignored, a seventh typed time says so.
 */
export function DelayOptionsPicker({
  id,
  legend,
  durationMinutes,
  value,
  onChange,
  disabled = false,
  hint,
  error,
}: {
  id: string;
  legend: string;
  durationMinutes: number;
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
  /** Shown under the chips when there's no error. */
  hint?: string;
  /** The form's error for the choices (e.g. none picked); wins over the hint. */
  error?: string;
}) {
  const t = useTranslations("Wizard");
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<AddDelayProblem | null>(null);
  const chips = [...new Set([...delayChoices(durationMinutes), ...value])].sort(
    (a, b) => a - b,
  );
  const toggle = (minutes: number) => {
    if (value.includes(minutes)) {
      onChange(value.filter((chosen) => chosen !== minutes));
    } else if (value.length < DELAY_OPTIONS_MAX) {
      onChange([...value, minutes].sort((a, b) => a - b));
    }
  };
  const commit = () => {
    if (text === "") {
      return;
    }
    const added = addDelayOption(value, Number(text), durationMinutes);
    if ("problem" in added) {
      setProblem(added.problem);
      return;
    }
    onChange(added.options);
    setText("");
    setProblem(null);
    setTyping(false);
  };
  const problemText = {
    range: t("errors.delayRange", { max: lateMinutesMax(durationMinutes) }),
    taken: t("errors.delayTaken"),
    full: t("errors.delaysFull", { max: DELAY_OPTIONS_MAX }),
  };
  const hintId = `${id}-hint`;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={hintId}>
      <legend className="text-sm font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {chips.map((minutes) => (
          <Chip
            key={minutes}
            disabled={disabled}
            pressed={value.includes(minutes)}
            onPressedChange={() => toggle(minutes)}
          >
            {t("details.minutes", { count: minutes })}
          </Chip>
        ))}
        <Chip
          disabled={disabled}
          pressed={typing}
          onPressedChange={(pressed) => {
            setTyping(pressed);
            setProblem(null);
          }}
        >
          {t("responses.delayOther")}
        </Chip>
      </div>
      {typing ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <MinutesInput
              id={`${id}-custom`}
              label={t("responses.delayCustom")}
              value={text}
              error={problem ? problemText[problem] : undefined}
              onValueChange={(digits) => {
                setText(digits);
                setProblem(null);
              }}
              onCommit={commit}
            />
          </div>
          {/* A spacer as tall as the field's label keeps Add level with the field, also when an
              error shows under it. */}
          <div className="flex flex-col gap-1.5">
            <span aria-hidden className="invisible text-sm font-bold">
              {t("responses.delayAdd")}
            </span>
            <Button tone="primary" onClick={commit}>
              {t("responses.delayAdd")}
            </Button>
          </div>
        </div>
      ) : null}
      <p id={hintId} className="text-sm text-muted-ink">
        {error ? <strong className="text-ink">{error}</strong> : hint}
      </p>
    </fieldset>
  );
}
