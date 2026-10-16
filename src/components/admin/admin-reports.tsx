"use client";

import { useTranslations } from "next-intl";
import { useAdminReports } from "@/hooks/use-admin";
import { PagedResults } from "./paged-results";
import { ReportRow } from "./report-row";

/** `/admin/reports` (spec §7.19): "not my group" reports, newest first, 25 at a time. */
export function AdminReportsView() {
  const t = useTranslations("Admin.reports");
  const list = useAdminReports();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <PagedResults list={list} empty={t("empty")} end={t("end")}>
        {(reports) => (
          <ul className="flex flex-col gap-3">
            {reports.map((report) => (
              <li key={report.id}>
                <ReportRow report={report} />
              </li>
            ))}
          </ul>
        )}
      </PagedResults>
    </div>
  );
}
