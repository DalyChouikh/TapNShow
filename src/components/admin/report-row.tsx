"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { RELATIVE_TIME_TICK_MS } from "@/config/query";
import { useMarkReviewed } from "@/hooks/use-admin";
import { reportPercent } from "@/lib/admin/format";
import { errorCodeOf } from "@/lib/api-client";
import type { AdminReportRow } from "@/shared/api/admin";
import { useAdminFormat } from "./use-admin-format";

/**
 * One "not my group" report (spec §7.19): the workspace, its 7-day numbers (the suspension rule's
 * own), when, and Mark reviewed or who reviewed it. Never who reported or why.
 */
export function ReportRow({ report }: { report: AdminReportRow }) {
  const t = useTranslations("Admin.reports");
  const tErrors = useTranslations("ApiErrors");
  const format = useFormatter();
  const now = useNow({ updateInterval: RELATIVE_TIME_TICK_MS });
  const { percent } = useAdminFormat();
  const markReviewed = useMarkReviewed();
  const rate =
    report.people7d > 0
      ? t("rate", {
          reports: report.reports7d,
          people: report.people7d,
          percent: percent(reportPercent(report.reports7d, report.people7d)),
        })
      : t("count", { reports: report.reports7d });
  return (
    <Card as="article" className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg break-words">
          {report.workspaceName}
        </h2>
        <p className="text-sm text-muted-ink">
          {t("row", {
            rate,
            when: format.relativeTime(new Date(report.reportedAt), now),
          })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link href={`/admin/workspaces/${report.workspaceId}`}>
            {t("openWorkspace")}
          </Link>
        </Button>
        {report.reviewedAt ? (
          <Pill tone="success">
            {report.reviewedByName
              ? t("reviewed", { name: report.reviewedByName })
              : t("reviewedNoName")}
          </Pill>
        ) : (
          <Button
            tone="primary"
            disabled={markReviewed.isPending}
            onClick={() =>
              markReviewed.mutate(report.id, {
                onSuccess: () => toast(t("markedReviewed")),
                onError: (error) => toast.error(tErrors(errorCodeOf(error))),
              })
            }
          >
            {t("markReviewed")}
          </Button>
        )}
      </div>
    </Card>
  );
}
