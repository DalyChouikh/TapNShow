"use client";

import { useTranslations } from "next-intl";
import { SwitchRow } from "@/components/forms/switch-row";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";

/**
 * A reminder setting (spec §7.6; owner's mockup B, 2026-10-09): a switch like the other switches
 * of the Answers step, then the hours before as one-choice chips while it is on. Switching on picks
 * `fallback` (callers pass `REMINDER_PENDING_DEFAULT` / `REMINDER_GOING_DEFAULT`); switching off
 * sends `null`. `note` says what the meeting's time changed (#403: a passed time replaced, too
 * close for any, already passed), shown on or off.
 */
export function ReminderChoice({
  id,
  label,
  hint,
  value,
  choices,
  fallback,
  onChange,
  disabled = false,
  note,
}: {
  id: string;
  label: string;
  hint: string;
  value: number | null;
  choices: readonly number[];
  fallback: number;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  note?: string;
}) {
  const t = useTranslations("Wizard.responses");
  return (
    <div className="flex flex-col gap-1">
      <SwitchRow
        id={id}
        label={label}
        checked={value !== null}
        disabled={disabled}
        onChange={(on) => onChange(on ? fallback : null)}
      />
      {value !== null ? (
        <>
          <div
            role="radiogroup"
            aria-labelledby={`${id}-label`}
            aria-describedby={note ? `${id}-hint ${id}-note` : `${id}-hint`}
            className={CHIP_ROW_CLASS}
          >
            {choices.map((hours) => (
              <Chip
                key={hours}
                role="radio"
                pressed={value === hours}
                disabled={disabled}
                onPressedChange={() => onChange(hours)}
              >
                {t("hoursBefore", { count: hours })}
              </Chip>
            ))}
          </div>
          <p id={`${id}-hint`} className="text-sm text-muted-ink">
            {hint}
          </p>
        </>
      ) : null}
      {note ? (
        <p id={`${id}-note`} className="text-sm font-bold text-ink">
          {note}
        </p>
      ) : null}
    </div>
  );
}
