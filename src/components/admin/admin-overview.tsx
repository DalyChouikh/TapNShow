"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminOverview } from "@/hooks/use-admin";
import { ADMIN_OVERVIEW_DAYS } from "@/shared/api/admin";
import { AttentionList } from "./attention-list";
import { FigureTiles } from "./figure-tiles";
import { AdminLoadError } from "./load-error";
import { SystemHealth } from "./system-health";
import { WeeklyChart } from "./weekly-chart";

type Days = (typeof ADMIN_OVERVIEW_DAYS)[number];

const DEFAULT_DAYS: Days = 30;
/** Tiles `FigureTiles` draws (the skeleton keeps the same layout). */
const FIGURE_COUNT = 6;

function isDays(value: number): value is Days {
  return ADMIN_OVERVIEW_DAYS.some((days) => days === value);
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
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/**
 * `/admin` (spec §7.19): what needs attention first, then the figures for 7, 30 or 90 days
 * against the period before, meetings per week and the system's health.
 */
export function AdminOverviewView() {
  const t = useTranslations("Admin");
  const [days, setDays] = useState<Days>(DEFAULT_DAYS);
  const overview = useAdminOverview(days);
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
            <SegmentedControl
              label={t("period.label")}
              value={String(days)}
              onValueChange={(value) => {
                const next = Number(value);
                if (isDays(next)) {
                  setDays(next);
                }
              }}
              options={ADMIN_OVERVIEW_DAYS.map((option) => ({
                value: String(option),
                label: t(`period.${option}`),
              }))}
            />
            <FigureTiles
              current={overview.data.current}
              previous={overview.data.previous}
            />
          </section>
          <WeeklyChart weekly={overview.data.weekly} />
          <SystemHealth
            health={overview.data.health}
            pushes={overview.data.current}
          />
        </>
      )}
    </div>
  );
}
