"use client";

import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import type { AdminOverview } from "@/shared/api/admin";
import { useAdminFormat } from "./use-admin-format";

/** "3 Aug" from the SQL's UTC week start (a timestamp without an offset, read as a calendar date). */
function weekLabel(week: string): string {
  return format(parseISO(week), "d MMM");
}

/**
 * Meetings sent in each of the last 12 weeks (spec §7.19): plain CSS bars for the eye, the same
 * numbers in a visually hidden table for screen readers (no chart library).
 */
export function WeeklyChart({ weekly }: { weekly: AdminOverview["weekly"] }) {
  const t = useTranslations("Admin.weekly");
  const { count } = useAdminFormat();
  const max = Math.max(1, ...weekly.map((week) => week.meetings));
  const first = weekly.at(0);
  const last = weekly.at(-1);
  return (
    <Card
      as="section"
      aria-labelledby="admin-weekly"
      className="flex flex-col gap-3"
    >
      <h2 id="admin-weekly" className="font-bold">
        {t("title")}
      </h2>
      <div aria-hidden="true" className="flex h-32 items-end gap-1.5">
        {weekly.map((week) => (
          <div
            key={week.week}
            data-bar
            className={
              week.meetings > 0
                ? "flex-1 rounded-t-sm border-2 border-outline bg-fill-primary"
                : "min-h-0.5 flex-1 bg-outline/30"
            }
            style={{ height: `${(week.meetings / max) * 100}%` }}
          />
        ))}
      </div>
      {first && last ? (
        <div
          aria-hidden="true"
          className="flex justify-between text-xs text-muted-ink"
        >
          <span>{weekLabel(first.week)}</span>
          <span>{weekLabel(last.week)}</span>
        </div>
      ) : null}
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">{t("weekHeader")}</th>
            <th scope="col">{t("meetings")}</th>
          </tr>
        </thead>
        <tbody>
          {weekly.map((week) => (
            <tr key={week.week}>
              <th scope="row">{t("week", { date: weekLabel(week.week) })}</th>
              <td>{count(week.meetings)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
