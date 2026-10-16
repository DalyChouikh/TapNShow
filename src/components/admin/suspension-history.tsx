"use client";

import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import type { AdminWorkspace } from "@/shared/api/admin";

/** "15 Oct" in the admin's own time zone. */
function day(instant: string): string {
  return format(parseISO(instant), "d MMM");
}

/**
 * Every suspension of a workspace, newest first as the API sends them (spec §7.19): when, why or
 * by whom, and whether and when it was lifted. A removed admin's name is unknown: "an admin".
 */
export function SuspensionHistory({
  suspensions,
}: {
  suspensions: AdminWorkspace["suspensions"];
}) {
  const t = useTranslations("Admin.workspace");
  return (
    <Card
      as="section"
      aria-labelledby="admin-suspension-history"
      className="flex flex-col gap-3"
    >
      <h2 id="admin-suspension-history" className="font-bold">
        {t("history")}
      </h2>
      {suspensions.length === 0 ? (
        <p className="text-muted-ink">{t("historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col">
          {suspensions.map((entry) => {
            const date = day(entry.createdAt);
            const started =
              entry.reason === "auto_reports"
                ? t("historyAuto", { date })
                : entry.createdByName
                  ? t("historyBy", { date, name: entry.createdByName })
                  : t("historyByAdmin", { date });
            const ended = entry.liftedAt
              ? entry.liftedByName
                ? t("historyLiftedBy", {
                    date: day(entry.liftedAt),
                    name: entry.liftedByName,
                  })
                : t("historyLifted", { date: day(entry.liftedAt) })
              : t("historyActive");
            return (
              <li
                key={entry.id}
                className="flex flex-wrap justify-between gap-x-4 border-b border-dashed border-outline/30 py-2 last:border-b-0"
              >
                <span>{started}</span>
                <span className="font-bold">{ended}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
