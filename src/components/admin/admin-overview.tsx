"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";
import { DateRangeFields } from "@/components/forms/date-range-fields";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminOverview } from "@/hooks/use-admin";
import {
  ADMIN_PERIOD_PRESETS,
  type AdminPeriodChoice,
  type AdminPeriodSelection,
  periodFromParams,
  periodParams,
  selectedPeriod,
  utcToday,
} from "@/lib/admin/period";
import { cn } from "@/lib/utils";
import { ADMIN_PERIOD_MAX_DAYS } from "@/shared/api/admin";
import { AttentionList } from "./attention-list";
import { FigureTiles } from "./figure-tiles";
import { LoadError } from "@/components/errors/load-error";
import { MeetingsChart } from "./meetings-chart";
import { SystemHealth } from "./system-health";

/** Tiles `FigureTiles` draws (the skeleton keeps the same layout). */
const FIGURE_COUNT = 6;
const CHOICES: readonly AdminPeriodChoice[] = [
  ...ADMIN_PERIOD_PRESETS,
  "custom",
];
/** The last period's figures stay on screen, dimmed, while the next one loads. */
const LOADING_CLASS = "transition-opacity motion-reduce:transition-none";

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
  const period = selectedPeriod(selection, today);
  const overview = useAdminOverview(period);
  const { data } = overview;
  // The switch stays usable when a period can't load, so the admin can pick another one.
  const failed = overview.isError && !data;
  const loading = overview.isPlaceholderData;

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
      choice === "custom" ? { preset: "custom", period } : { preset: choice },
    );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">{t("nav.overview")}</h1>
      {data ? (
        <AttentionList attention={data.attention} />
      ) : failed ? null : (
        <Skeleton className="h-24 w-full" />
      )}
      <section
        aria-labelledby="admin-figures"
        aria-busy={loading || !data}
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
          <DateRangeFields
            id="admin-period"
            value={period}
            today={today}
            bounds={{ latest: today, maxDays: ADMIN_PERIOD_MAX_DAYS }}
            onChange={(range) =>
              setSelection({ preset: "custom", period: range })
            }
          />
        ) : null}
        {data ? (
          <div className={cn(LOADING_CLASS, loading && "opacity-60")}>
            <FigureTiles current={data.current} previous={data.previous} />
          </div>
        ) : failed ? (
          <LoadError onRetry={() => void overview.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: FIGURE_COUNT }, (_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
        )}
      </section>
      {data ? (
        <>
          <div
            aria-busy={loading}
            className={cn(LOADING_CLASS, loading && "opacity-60")}
          >
            <MeetingsChart series={data.series} today={today} />
          </div>
          <SystemHealth health={data.health} pushes={data.current} />
        </>
      ) : failed ? null : (
        <Skeleton className="h-64 w-full" />
      )}
    </div>
  );
}
