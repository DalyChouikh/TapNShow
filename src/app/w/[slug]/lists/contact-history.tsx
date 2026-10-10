"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PeriodChips } from "@/components/forms/period-chips";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { useContactHistory } from "@/hooks/use-results";
import { describeCheckIn } from "@/lib/responses/describe-answer";
import { usePeriod } from "@/lib/responses/use-period";
import { cn } from "@/lib/utils";
import type { HistoryRow } from "@/shared/api/responses";

const COUNT_FILL = {
  attending: "bg-fill-success",
  late: "bg-fill-warning",
  absent: "bg-fill-danger",
  noReply: "bg-fill-neutral",
} as const;

function RowAnswer({ row }: { row: HistoryRow }) {
  const t = useTranslations("History");
  const labels = useAnswerLabels();
  if (row.answer || row.mark) {
    return (
      <span className="font-bold">
        {describeCheckIn(
          labels,
          {
            noReply: t("noReply"),
            didntAnswer: t("didntAnswer"),
            said: (answer) => t("saidAnswer", { answer }),
            actual: (value) => t(`actual.${value}`),
            saidWas: (said, was) => t("saidWas", { said, was }),
          },
          row.answer,
          row.mark,
        )}
      </span>
    );
  }
  return (
    <span className="text-muted-ink">
      {row.emailStatus === "failed" || row.emailStatus === "skipped"
        ? t("notDelivered")
        : t("noReply")}
    </span>
  );
}

/**
 * A person's history in their sheet (spec §7.7): period chips, four counts, then the past meetings
 * newest first with answer, delay and reason (plain text), paged.
 */
export function ContactHistory({
  slug,
  contactId,
  timezone,
}: {
  slug: string;
  contactId: string;
  timezone: string;
}) {
  const t = useTranslations("History");
  const period = usePeriod(timezone);
  const history = useContactHistory(slug, contactId, period.range);
  return (
    <section className="flex flex-col gap-3 border-t-2 border-dashed border-outline pt-3">
      <h3 className="font-display text-lg">{t("title")}</h3>
      <PeriodChips
        value={period.period}
        onChange={period.setPeriod}
        custom={period.custom}
        onCustomChange={period.setCustom}
        today={period.today}
      />
      {history.counts ? (
        <div
          role="group"
          aria-label={t("title")}
          className="grid grid-cols-4 gap-2"
        >
          {(["attending", "late", "absent", "noReply"] as const).map((key) => (
            <div
              key={key}
              className={cn(
                "flex flex-col items-center rounded-control border-[length:var(--tn-border-width)] border-outline p-1.5 text-on-fill",
                COUNT_FILL[key],
              )}
            >
              <span className="text-xs font-bold">{t(`counts.${key}`)}</span>
              <span className="font-display text-lg">
                {history.counts?.[key]}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Skeleton className="h-16 w-full" />
      )}
      {history.query.isPending ? null : history.items.length === 0 ? (
        <p className="text-sm text-muted-ink">{t("empty")}</p>
      ) : (
        <ul>
          {history.items.map((row) => (
            <li
              key={row.meetingId}
              className="flex flex-col gap-0.5 border-b border-dashed border-outline/30 py-2 text-sm last:border-b-0"
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/w/${slug}/meetings/${row.meetingId}`}
                  className="font-bold break-words underline-offset-4 hover:underline"
                >
                  {row.title}
                </Link>
                <span className="text-muted-ink">
                  {format(new TZDate(row.startsAt, row.timezone), "EEE d MMM")}
                </span>
              </span>
              <RowAnswer row={row} />
              {row.answer?.reason ? (
                <span className="break-words whitespace-pre-line text-muted-ink">
                  {row.answer.reason}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ShowMore
        hasMore={history.hasMore}
        loading={history.isLoadingMore}
        onMore={history.loadMore}
      />
    </section>
  );
}
