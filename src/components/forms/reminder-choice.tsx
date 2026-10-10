"use client";

import { useTranslations } from "next-intl";
import { SwitchRow } from "@/components/forms/switch-row";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";

/**
 * A reminder setting (spec §7.6; owner's mockup B, 2026-10-09): a switch like the other switches
 * of the Answers step, then the hours before as one-choice chips while it is on. Switching on picks
 * `fallback` (the workspace default); switching off sends `null`.
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
}: {
  id: string;
  label: string;
  hint: string;
  value: number | null;
  choices: readonly number[];
  fallback: number;
  onChange: (value: number | null) => void;
  disabled?: boolean;
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
            aria-describedby={`${id}-hint`}
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
    </div>
  );
}
