"use client";

import { useTranslations } from "next-intl";
import type { FillTone } from "@/design/tokens";
import { Pill } from "@/components/ui/pill";
import { percentFromBasisPoints, trend } from "@/lib/admin/format";
import type { AdminFigures } from "@/shared/api/admin";
import { StatTile } from "./stat-tile";
import { useAdminFormat } from "./use-admin-format";

const TREND_TONE: Record<ReturnType<typeof trend>["tone"], FillTone> = {
  up: "success",
  down: "danger",
  flat: "neutral",
};

/**
 * The Overview's figures for the chosen period (spec §7.19), the meetings sent compared with the
 * period before. `emailsSent` counts every reserved send, and the failures are among them.
 */
export function FigureTiles({
  current,
  previous,
}: {
  current: AdminFigures;
  previous: AdminFigures;
}) {
  const t = useTranslations("Admin.figures");
  const { count, percent, delivered } = useAdminFormat();
  const meetings = trend(current.meetingsSent, previous.meetingsSent);
  const meetingsLine =
    meetings.change === null
      ? t("trendNew")
      : meetings.tone === "up"
        ? t("trendUp", { change: meetings.change })
        : meetings.tone === "down"
          ? t("trendDown", { change: Math.abs(meetings.change) })
          : t("trendFlat");
  const emailsDelivered = Math.max(
    current.emailsSent - current.emailsFailed,
    0,
  );
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <StatTile
        label={t("workspaces")}
        value={count(current.workspacesTotal)}
        line={t("workspacesNew", { count: count(current.workspacesNew) })}
      />
      <StatTile
        label={t("active")}
        value={count(current.activeWorkspaces)}
        line={t("activeHint")}
      />
      <StatTile
        label={t("meetings")}
        value={count(current.meetingsSent)}
        line={<Pill tone={TREND_TONE[meetings.tone]}>{meetingsLine}</Pill>}
      />
      <StatTile
        label={t("emails")}
        value={count(emailsDelivered)}
        line={delivered(emailsDelivered, current.emailsSent)}
      />
      <StatTile
        label={t("answers")}
        value={percent(percentFromBasisPoints(current.answersRateBp))}
        line={t("answersHint")}
      />
      <StatTile
        label={t("accounts")}
        value={count(current.accountsTotal)}
        line={t("accountsNew", { count: count(current.accountsNew) })}
      />
    </dl>
  );
}
