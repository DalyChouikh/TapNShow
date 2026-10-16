"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { RELATIVE_TIME_TICK_MS } from "@/config/query";
import type { AdminFigures, AdminOverview } from "@/shared/api/admin";
import { FactList } from "./fact-list";
import { useAdminFormat } from "./use-admin-format";

/**
 * The workers' state (spec §7.19): the email queue, the Google Sheets, the senders to reconnect,
 * and how many phone notifications arrived in the period (as in the approved mockup).
 */
export function SystemHealth({
  health,
  pushes,
}: {
  health: AdminOverview["health"];
  /** The period's phone notifications (sent and failed are separate counts). */
  pushes: Pick<AdminFigures, "pushesSent" | "pushesFailed">;
}) {
  const t = useTranslations("Admin.health");
  const format = useFormatter();
  const now = useNow({ updateInterval: RELATIVE_TIME_TICK_MS });
  const { count, delivered } = useAdminFormat();
  const queue =
    health.queueWaiting === 0
      ? t("queueEmpty")
      : health.queueOldest
        ? t("queueValue", {
            count: count(health.queueWaiting),
            age: format.relativeTime(new Date(health.queueOldest), now),
          })
        : t("queueCount", { count: count(health.queueWaiting) });
  const rows = [
    { label: t("queue"), value: queue },
    {
      label: t("sheets"),
      value: t("sheetsValue", {
        paused: count(health.sheetsPaused),
        total: count(health.sheetsTotal),
      }),
    },
    { label: t("senders"), value: count(health.sendersBroken) },
    {
      label: t("pushes"),
      value: delivered(
        pushes.pushesSent,
        pushes.pushesSent + pushes.pushesFailed,
      ),
    },
  ];
  return (
    <Card
      as="section"
      aria-labelledby="admin-health"
      className="flex flex-col gap-2"
    >
      <h2 id="admin-health" className="font-bold">
        {t("title")}
      </h2>
      <FactList facts={rows} />
    </Card>
  );
}
