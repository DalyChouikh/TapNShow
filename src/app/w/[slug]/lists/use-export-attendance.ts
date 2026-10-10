"use client";

import { useTranslations } from "next-intl";
import type { ExportFormat } from "@/components/forms/export-menu";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { fetchAllAttendanceDetails } from "@/hooks/use-results";
import {
  attendanceDetailRows,
  attendanceSummaryRows,
  listNamesByContact,
} from "@/lib/export/rows";
import { saveExport } from "@/lib/export/save";
import { formatDeadline } from "@/lib/meetings/format";
import type { PeriodRange } from "@/shared/api/responses";
import type { Roster } from "@/shared/api/roster";

/** One Attendance row as shown (the view's filter and order). */
export type AttendanceExportRow = Parameters<
  typeof attendanceSummaryRows
>[0][number];

const SUMMARY = [
  ["name", 24],
  ["email", 30],
  ["lists", 20],
  ["invited", 10],
  ["attending", 10, "success"],
  ["late", 10, "warning"],
  ["absent", 10, "danger"],
  ["noReply", 10, "neutral"],
] as const;
const DETAILS = [
  ["meeting", 30],
  ["date", 18],
  ["name", 24],
  ["email", 30],
  ["lists", 20],
  ["answer", 18],
  ["lateBy", 12],
  ["reason", 40],
  ["comment", 40],
  ["afterDeadline", 16],
  ["emailStatus", 16],
  ["checkedIn", 14],
  ["checkedInBy", 24],
  ["wasLateBy", 14],
] as const;

/**
 * The Attendance export (spec §7.7): CSV is the summary as shown; Excel adds a Details sheet
 * (one row per person per counted meeting) for the same people and period. Excel's title band
 * names the sheet, the workspace, the period (`periodLabel`, as the chips say it) and the export
 * time in the workspace's zone.
 */
export function useExportAttendance(
  workspace: { slug: string; name: string; timezone: string },
  roster: Roster,
  range: PeriodRange,
  periodLabel: string,
) {
  const t = useTranslations("Export");
  const tStatus = useTranslations("MeetingPage.status");
  const labels = useAnswerLabels();
  const { slug } = workspace;
  const header = (columns: typeof SUMMARY | typeof DETAILS) =>
    columns.map(([key, width, tone]) => ({
      header: t(`columns.${key}`),
      width,
      tone,
    }));
  return async (
    format: ExportFormat,
    shown: AttendanceExportRow[],
  ): Promise<void> => {
    const listNames = listNamesByContact(roster);
    const now = new Date();
    const band = (sheet: string) => ({
      name: sheet,
      title: t("title", { what: t("attendance"), sheet }),
      subtitle: t("exported", {
        context: t("periodContext", {
          workspace: workspace.name,
          period: periodLabel,
        }),
        at: formatDeadline(now.toISOString(), workspace.timezone),
      }),
    });
    const summary = {
      ...band(t("sheetSummary")),
      columns: header(SUMMARY),
      rows: attendanceSummaryRows(shown, listNames),
    };
    if (format === "csv") {
      await saveExport(format, [summary], [slug, "attendance"], now);
      return;
    }
    const people = new Set(shown.map((row) => row.contactId));
    const details = (await fetchAllAttendanceDetails(slug, range)).filter(
      (row) => people.has(row.contactId),
    );
    await saveExport(
      format,
      [
        summary,
        {
          ...band(t("sheetDetails")),
          columns: header(DETAILS),
          rows: attendanceDetailRows(details, listNames, labels, {
            yes: t("yes"),
            noReply: t("columns.noReply"),
            emailStatus: (status) => tStatus(status),
            actual: (value) => t(`actual.${value}`),
          }),
        },
      ],
      [slug, "attendance"],
      now,
    );
  };
}
