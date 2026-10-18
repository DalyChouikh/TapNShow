"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MinutesInput } from "@/components/forms/minutes-input";
import { Chip } from "@/components/ui/chip";
import { lateMinutesMax } from "@/lib/meetings/late";
import { lateMinutesSchema } from "@/shared/api/meeting-settings";

/**
 * How late someone was at the door (owner feedback #257): the meeting's delay choices, or Other
 * with any number of minutes shorter than the meeting (#400), saved on Enter or when the field
 * loses focus. Optional: tapping the pressed choice clears the minutes.
 */
export function LateMinutes({
  inviteeId,
  name,
  options,
  durationMinutes,
  value,
  onChange,
}: {
  inviteeId: string;
  name: string;
  options: number[];
  /** The meeting's length: Other accepts 1 to one minute less. */
  durationMinutes: number;
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const t = useTranslations("MeetingPage.checkIn");
  const saved = value !== null && !options.includes(value) ? value : null;
  const [custom, setCustom] = useState(saved !== null);
  const [text, setText] = useState(saved === null ? "" : String(saved));
  const [invalid, setInvalid] = useState(false);
  const inputId = `late-minutes-${inviteeId}`;
  const max = lateMinutesMax(durationMinutes);
  const commit = () => {
    const minutes = lateMinutesSchema.max(max).safeParse(Number(text));
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
        <MinutesInput
          id={inputId}
          label={t("lateCustom")}
          value={text}
          error={invalid ? t("lateInvalid", { max }) : undefined}
          onValueChange={setText}
          onCommit={commit}
        />
      ) : null}
    </div>
  );
}
