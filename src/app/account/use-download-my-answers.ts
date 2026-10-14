"use client";

import type { ExportFormat } from "@/components/forms/export-menu";
import { useExportWords } from "@/hooks/use-answer-labels";
import { fetchAllPages } from "@/lib/api/fetch-all-pages";
import { MEMBER_ANSWER_COLUMNS } from "@/lib/export/columns";
import { memberAnswerRows } from "@/lib/export/rows";
import { saveExport } from "@/lib/export/save";
import { exportHeaders } from "@/lib/export/words";
import { formatDeadline } from "@/lib/meetings/format";
import { myAnswersPageSchema } from "@/shared/api/my-invites";

/**
 * Download my answers (spec §7.4): every invite of the signed-in person, as CSV or Excel, in the
 * organizers' export look. The band names the person's address and the export time on this device.
 */
export function useDownloadMyAnswers(email: string) {
  const words = useExportWords();
  const { t } = words;
  return async (format: ExportFormat): Promise<void> => {
    const rows = await fetchAllPages(
      "/api/me/answers",
      {},
      myAnswersPageSchema,
    );
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sheet = t("myAnswers");
    await saveExport(
      format,
      [
        {
          name: sheet,
          title: t("title", { what: sheet, sheet: email }),
          subtitle: t("exported", {
            context: email,
            at: formatDeadline(now.toISOString(), zone),
          }),
          columns: exportHeaders(words, MEMBER_ANSWER_COLUMNS),
          rows: memberAnswerRows(rows, words.labels, words.text),
        },
      ],
      ["my-answers"],
      now,
    );
  };
}
