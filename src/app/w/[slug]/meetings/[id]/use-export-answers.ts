"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ExportFormat } from "@/components/forms/export-menu";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { fetchAllMeetingPeople } from "@/hooks/use-results";
import { rosterQueryOptions } from "@/hooks/use-roster";
import { useWorkspace } from "@/hooks/use-workspace";
import { listNamesByContact, meetingAnswerRows } from "@/lib/export/rows";
import { saveExport } from "@/lib/export/save";
import { formatDeadline, formatMeetingWhen } from "@/lib/meetings/format";
import type { Meeting } from "@/shared/api/meetings";

const WIDTHS = [24, 30, 20, 18, 12, 40, 40, 18, 16, 16, 14, 24, 14];
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
  "wasLateBy",
] as const;

/**
 * The meeting page's export (spec §7.7): every invitee with their answer, built on the device as
 * CSV or Excel, named `<workspace>-<title>-answers-<date>`. Excel's title band names the meeting,
 * the workspace, when it is and when it was exported.
 */
export function useExportAnswers(slug: string, meeting: Meeting) {
  const t = useTranslations("Export");
  const tStatus = useTranslations("MeetingPage.status");
  const labels = useAnswerLabels();
  const queryClient = useQueryClient();
  const workspace = useWorkspace(slug);
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
    const now = new Date();
    const context = meeting.startsAt
      ? t("meetingContext", {
          workspace: workspace.data?.name ?? slug,
          ...formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt }),
        })
      : (workspace.data?.name ?? slug);
    await saveExport(
      format,
      [
        {
          name: t("sheetAnswers"),
          title: t("title", { what: meeting.title, sheet: t("sheetAnswers") }),
          subtitle: t("exported", {
            context,
            at: formatDeadline(now.toISOString(), meeting.timezone),
          }),
          columns: COLUMNS.map((key, index) => ({
            header: t(`columns.${key}`),
            width: WIDTHS[index],
          })),
          rows,
        },
      ],
      [slug, meeting.title, "answers"],
      now,
    );
  };
}
