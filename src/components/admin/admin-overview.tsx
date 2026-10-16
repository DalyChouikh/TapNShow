"use client";

import { addDays, format, parseISO } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";
import { DatePicker } from "@/components/ui/date-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminOverview } from "@/hooks/use-admin";
import {
  ADMIN_PERIOD_PRESETS,
  type AdminPeriodChoice,
  type AdminPeriodSelection,
  periodFromParams,
  periodParams,
  presetPeriod,
  utcToday,
} from "@/lib/admin/period";
import { ADMIN_PERIOD_MAX_DAYS, type AdminPeriod } from "@/shared/api/admin";
import { AttentionList } from "./attention-list";
import { FigureTiles } from "./figure-tiles";
import { AdminLoadError } from "./load-error";
import { MeetingsChart } from "./meetings-chart";
import { SystemHealth } from "./system-health";

/** Tiles `FigureTiles` draws (the skeleton keeps the same layout). */
const FIGURE_COUNT = 6;
const DAY = "yyyy-MM-dd";
const CHOICES: readonly AdminPeriodChoice[] = [
  ...ADMIN_PERIOD_PRESETS,
  "custom",
];

/** `day` moved by `days` (UTC calendar dates). */
function shiftDay(day: string, days: number): string {
  return format(addDays(parseISO(day), days), DAY);
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-11 w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: FIGURE_COUNT }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** The From and To pickers of a custom period, each limited so the range stays valid. */
function CustomRange({
  period,
  today,
  onChange,
}: {
  period: AdminPeriod;
  today: string;
  onChange: (period: AdminPeriod) => void;
}) {
  const t = useTranslations("Admin.period");
  const longest = ADMIN_PERIOD_MAX_DAYS - 1;
  const latestTo = shiftDay(period.from, longest);
  return (
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
      <DatePicker
        id="admin-period-from"
        label={t("from")}
        value={period.from}
        today={today}
        min={shiftDay(period.to, -longest)}
        max={period.to}
        onChange={(from) => onChange({ from, to: period.to })}
      />
      <DatePicker
        id="admin-period-to"
        label={t("to")}
        value={period.to}
        today={today}
        min={period.from}
        max={latestTo < today ? latestTo : today}
        onChange={(to) => onChange({ from: period.from, to })}
      />
    </div>
  );
}

/**
 * `/admin` (spec §7.19): what needs attention first, then one period (7, 30 or 90 days, 12
 * months, or a custom range of up to two years) for the figures, against the period before, and
 * for the chart of meetings sent, then the system's health. The address keeps the period, so a
 * reload or Back returns to it.
 */
export function AdminOverviewView() {
  const t = useTranslations("Admin");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = utcToday();
  const [selection, setSelection] = useState<AdminPeriodSelection>(() =>
    periodFromParams(params, today),
  );
  const overview = useAdminOverview(selection.period);

  const keepInAddress = useEffectEvent((query: string) => {
    if (query !== params.toString()) {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }
  });
  const query = periodParams(selection);
  useEffect(() => {
    keepInAddress(query);
  }, [query]);

  const choose = (choice: AdminPeriodChoice) =>
    setSelection(
      choice === "custom"
        ? { preset: "custom", period: selection.period }
        : { preset: choice, period: presetPeriod(choice, today) },
    );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">{t("nav.overview")}</h1>
      {overview.isError && !overview.data ? (
        <AdminLoadError onRetry={() => void overview.refetch()} />
      ) : !overview.data ? (
        <OverviewSkeleton />
      ) : (
        <>
          <AttentionList attention={overview.data.attention} />
          <section
            aria-labelledby="admin-figures"
            className="flex flex-col gap-3"
          >
            <h2 id="admin-figures" className="sr-only">
              {t("figures.title")}
            </h2>
            <div
              role="radiogroup"
              aria-label={t("period.label")}
              className={CHIP_ROW_CLASS}
            >
              {CHOICES.map((choice) => (
                <Chip
                  key={choice}
                  role="radio"
                  pressed={selection.preset === choice}
                  onPressedChange={() => choose(choice)}
                >
                  {t(`period.${choice}`)}
                </Chip>
              ))}
            </div>
            {selection.preset === "custom" ? (
              <CustomRange
                period={selection.period}
                today={today}
                onChange={(period) =>
                  setSelection({ preset: "custom", period })
                }
              />
            ) : null}
            <FigureTiles
              current={overview.data.current}
              previous={overview.data.previous}
            />
          </section>
          <MeetingsChart
            series={overview.data.series}
            live={selection.period.to === today}
          />
          <SystemHealth
            health={overview.data.health}
            pushes={overview.data.current}
          />
        </>
      )}
    </div>
  );
}
