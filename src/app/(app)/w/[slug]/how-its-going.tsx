"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LoadError } from "@/components/errors/load-error";
import { PeriodChips } from "@/components/forms/period-chips";
import { Card } from "@/components/ui/card";
import { Refreshing } from "@/components/ui/refreshing";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceInsights } from "@/hooks/use-results";
import type { PeriodState } from "@/lib/responses/use-period";
import { InsightsChart } from "./insights-chart";

/** One of the three numbers: the value large, what it counts small under it. */
function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-baseline font-display text-2xl">{value}</span>
      <span className="text-xs text-muted-ink">{label}</span>
    </div>
  );
}

/**
 * "How it's going" (design §2.4), for every role: the period's chips, three numbers (meetings,
 * who came on average, who answered before the start) and a bar per counted meeting, counted like
 * Lists → Attendance. Before any meeting has counted it says what will appear here.
 */
export function HowItsGoing({
  slug,
  period,
}: {
  slug: string;
  period: PeriodState;
}) {
  const t = useTranslations("WorkspaceHome.howItsGoing");
  const format = useFormatter();
  const insights = useWorkspaceInsights(slug, period.range);
  const data = insights.data;
  // A period that fails keeps the title and the chips, so another period can still be picked.
  const failed = insights.isError && !data;
  const whole = (value: number) =>
    format.number(value, { maximumFractionDigits: 0 });
  return (
    <Card as="section" className="flex flex-col gap-3">
      <h2 className="font-display text-xl">{t("title")}</h2>
      {!data && !failed ? (
        <Skeleton className="h-64 w-full" />
      ) : data?.held === 0 ? (
        <p className="text-sm text-muted-ink">{t("firstMeeting")}</p>
      ) : (
        <>
          <PeriodChips
            value={period.period}
            onChange={period.setPeriod}
            custom={period.custom}
            onCustomChange={period.setCustom}
            today={period.today}
          />
          {!data ? (
            <LoadError bare onRetry={() => void insights.refetch()} />
          ) : (
            <Refreshing
              busy={insights.isPlaceholderData}
              className="flex flex-col gap-3"
            >
              <div
                role="group"
                aria-label={t("title")}
                className="grid grid-cols-3 gap-3"
              >
                <Stat
                  value={data.period.meetings}
                  label={t("meetings", { count: data.period.meetings })}
                />
                <Stat
                  value={
                    <>
                      {whole(data.period.cameAverage)}
                      <span className="ml-1 font-sans text-sm text-muted-ink">
                        {t("cameOf", {
                          invited: whole(data.period.invitedAverage),
                        })}
                      </span>
                    </>
                  }
                  label={t("came")}
                />
                <Stat
                  value={
                    data.period.answeredBeforeStart === null
                      ? t("noShare")
                      : format.number(data.period.answeredBeforeStart, {
                          style: "percent",
                          maximumFractionDigits: 0,
                        })
                  }
                  label={t("answeredBefore")}
                />
              </div>
              {data.period.meetings === 0 ? (
                <p className="text-sm text-muted-ink">{t("emptyPeriod")}</p>
              ) : (
                <>
                  {data.period.meetings > data.chart.length ? (
                    <p className="text-sm text-muted-ink">
                      {t("latest", {
                        shown: data.chart.length,
                        total: data.period.meetings,
                      })}
                    </p>
                  ) : null}
                  <InsightsChart slug={slug} meetings={data.chart} />
                </>
              )}
            </Refreshing>
          )}
        </>
      )}
    </Card>
  );
}
