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
  ["attending", 10],
  ["late", 10],
  ["absent", 10],
  ["noReply", 10],
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
] as const;

/**
 * The Attendance export (spec §7.7): CSV is the summary as shown; Excel adds a Details sheet
 * (one row per person per counted meeting) for the same people and period.
 */
export function useExportAttendance(
  slug: string,
  roster: Roster,
  range: PeriodRange,
) {
  const t = useTranslations("Export");
  const tStatus = useTranslations("MeetingPage.status");
  const labels = useAnswerLabels();
  const header = (columns: typeof SUMMARY | typeof DETAILS) =>
    columns.map(([key, width]) => ({ header: t(`columns.${key}`), width }));
  return async (
    format: ExportFormat,
    shown: AttendanceExportRow[],
  ): Promise<void> => {
    const listNames = listNamesByContact(roster);
    const summary = {
      name: t("sheetSummary"),
      columns: header(SUMMARY),
      rows: attendanceSummaryRows(shown, listNames),
    };
    if (format === "csv") {
      await saveExport(format, [summary], [slug, "attendance"], new Date());
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
          name: t("sheetDetails"),
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
      new Date(),
    );
  };
}
