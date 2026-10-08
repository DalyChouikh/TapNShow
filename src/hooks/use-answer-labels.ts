"use client";

import { useTranslations } from "next-intl";
import type { AnswerLabels } from "@/lib/responses/describe-answer";

/** `AnswerLabels` from the current messages (answer page, meeting page, history). */
export function useAnswerLabels(): AnswerLabels {
  const t = useTranslations("AnswerPage.answer");
  return {
    attending: t("attending"),
    late: (minutes) => t("late", { minutes }),
    absent: t("absent"),
    not_attending: t("not_attending"),
  };
}
