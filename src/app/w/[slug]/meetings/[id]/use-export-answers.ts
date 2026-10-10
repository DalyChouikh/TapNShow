"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ExportFormat } from "@/components/forms/export-menu";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { fetchAllMeetingPeople } from "@/hooks/use-results";
import { rosterQueryOptions } from "@/hooks/use-roster";
import { listNamesByContact, meetingAnswerRows } from "@/lib/export/rows";
import { saveExport } from "@/lib/export/save";
import type { Meeting } from "@/shared/api/meetings";

const WIDTHS = [24, 30, 20, 18, 12, 40, 40, 18, 16, 16, 14, 24];
const COLUMNS = [
  "name",
  "email",
  "lists",
  "answer",
  "lateBy",
  "reason",
  "comment",
  "answeredAt",
  "afterDeadline",
  "emailStatus",
  "checkedIn",
  "checkedInBy",
] as const;

/**
 * The meeting page's export (spec §7.7): every invitee with their answer, built on the device as
 * CSV or Excel, named `<workspace>-<title>-answers-<date>`.
 */
export function useExportAnswers(slug: string, meeting: Meeting) {
  const t = useTranslations("Export");
  const tStatus = useTranslations("MeetingPage.status");
  const labels = useAnswerLabels();
  const queryClient = useQueryClient();
  return async (format: ExportFormat): Promise<void> => {
    const [people, roster] = await Promise.all([
      fetchAllMeetingPeople(slug, meeting.id),
      queryClient.fetchQuery(rosterQueryOptions(slug)),
    ]);
    const rows = meetingAnswerRows(
      people,
      listNamesByContact(roster),
      labels,
      {
        yes: t("yes"),
        noReply: t("columns.noReply"),
        emailStatus: (status) => tStatus(status),
        actual: (value) => t(`actual.${value}`),
      },
      meeting.timezone,
    );
    await saveExport(
      format,
      [
        {
          name: t("sheetAnswers"),
          columns: COLUMNS.map((key, index) => ({
            header: t(`columns.${key}`),
            width: WIDTHS[index],
          })),
          rows,
        },
      ],
      [slug, meeting.title, "answers"],
      new Date(),
    );
  };
}
