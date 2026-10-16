"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { lateMinutesSchema } from "@/shared/api/meeting-settings";

/**
 * How late someone was at the door (owner feedback #257): the meeting's delay choices, or Other
 * with any number of minutes (1–240), saved on Enter or when the field loses focus. Optional:
 * tapping the pressed choice clears the minutes.
 */
export function LateMinutes({
  inviteeId,
  name,
  options,
  value,
  onChange,
}: {
  inviteeId: string;
  name: string;
  options: number[];
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const t = useTranslations("MeetingPage.checkIn");
  const saved = value !== null && !options.includes(value) ? value : null;
  const [custom, setCustom] = useState(saved !== null);
  const [text, setText] = useState(saved === null ? "" : String(saved));
  const [invalid, setInvalid] = useState(false);
  const inputId = `late-minutes-${inviteeId}`;
  const commit = () => {
    const minutes = lateMinutesSchema.safeParse(Number(text));
    setInvalid(text !== "" && !minutes.success);
    if (minutes.success && minutes.data !== value) {
      onChange(minutes.data);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("lateGroup", { name })}
        className="flex flex-wrap gap-2"
      >
        {options.map((minutes) => {
          const pressed = !custom && value === minutes;
          return (
            <Chip
              key={minutes}
              tone="warning"
              pressed={pressed}
              onPressedChange={() => {
                setCustom(false);
                onChange(pressed ? null : minutes);
              }}
            >
              {t("lateChip", { minutes })}
            </Chip>
          );
        })}
        <Chip
          tone="warning"
          pressed={custom}
          onPressedChange={() => setCustom(!custom)}
        >
          {t("lateOther")}
        </Chip>
      </div>
      {custom ? (
        <Input
          id={inputId}
          label={t("lateCustom")}
          inputMode="numeric"
          value={text}
          error={invalid ? t("lateInvalid") : undefined}
          onChange={(event) => setText(event.target.value.replace(/\D/g, ""))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      ) : null}
    </div>
  );
}
