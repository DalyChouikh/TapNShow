"use client";

import { useTranslations } from "next-intl";
import { DatePicker } from "@/components/ui/date-picker";
import {
  type DayRange,
  type DayRangeBounds,
  lastDayAllowed,
  rangeFrom,
} from "@/lib/date-range";

/**
 * The From and To pickers of a custom period (History, the admin Overview). Only valid ranges can
 * be picked: To never comes before From, nor after `bounds.latest`, nor makes the range longer
 * than `bounds.maxDays`; moving From past either end carries To with it.
 */
export function DateRangeFields({
  id,
  value,
  onChange,
  today,
  bounds = {},
}: {
  /** Prefix of the two pickers' ids. */
  id: string;
  value: DayRange;
  onChange: (range: DayRange) => void;
  today: string;
  bounds?: DayRangeBounds;
}) {
  const t = useTranslations("Pickers");
  return (
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
      <DatePicker
        id={`${id}-from`}
        label={t("from")}
        value={value.from}
        today={today}
        max={bounds.latest}
        onChange={(from) => onChange(rangeFrom(value, from, bounds))}
      />
      <DatePicker
        id={`${id}-to`}
        label={t("to")}
        value={value.to}
        today={today}
        min={value.from}
        max={lastDayAllowed(value.from, bounds)}
        onChange={(to) => onChange({ from: value.from, to })}
      />
    </div>
  );
}
