"use client";

import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui/chip";
import { DatePicker } from "@/components/ui/date-picker";
import { HISTORY_PERIODS } from "@/config/responses";
import type { HistoryPeriod } from "@/lib/responses/periods";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";

/**
 * History period chips (spec §7.7): last 30 days, last 3 months, this year, all time, and
 * "From…", which shows two date pickers (dates in the workspace's zone; the last day counts).
 */
export function PeriodChips({
  value,
  onChange,
  custom,
  onCustomChange,
  today,
}: {
  value: HistoryPeriod;
  onChange: (period: HistoryPeriod) => void;
  custom: { from: string; to: string };
  onCustomChange: (custom: { from: string; to: string }) => void;
  today: string;
}) {
  const t = useTranslations("History");
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t("period")} className={CHIP_ROW_CLASS}>
        {HISTORY_PERIODS.map((period) => (
          <Chip
            key={period}
            pressed={value === period}
            onPressedChange={() => onChange(period)}
            className="shrink-0"
          >
            {t(`periods.${period}`)}
          </Chip>
        ))}
      </div>
      {value === "custom" ? (
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <DatePicker
            id="period-from"
            label={t("from")}
            value={custom.from}
            today={today}
            onChange={(from) =>
              onCustomChange({ from, to: custom.to < from ? from : custom.to })
            }
          />
          <DatePicker
            id="period-to"
            label={t("to")}
            value={custom.to}
            today={today}
            min={custom.from}
            onChange={(to) => onCustomChange({ ...custom, to })}
          />
        </div>
      ) : null}
    </div>
  );
}
