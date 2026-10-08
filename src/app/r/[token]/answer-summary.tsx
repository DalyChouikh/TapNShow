"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Ref } from "react";
import { ConfirmStamp } from "@/components/motion/confirm-stamp";
import { Button } from "@/components/ui/button";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { describeAnswer } from "@/lib/responses/describe-answer";
import type { Answer } from "@/shared/api/responses";

/**
 * The saved answer: the CONFIRMED stamp right after a save (confetti for Going), the answer in
 * words, reason and comment as plain text, the calendar line, and Change (spec §7.3).
 */
export function AnswerSummary({
  ref,
  token,
  workspaceName,
  unsubscribed,
  answer,
  celebrate,
  onChange,
}: {
  ref?: Ref<HTMLDivElement>;
  token: string;
  workspaceName: string;
  unsubscribed: boolean;
  answer: Answer;
  celebrate: boolean;
  onChange: () => void;
}) {
  const t = useTranslations("AnswerPage");
  const labels = useAnswerLabels();
  const inCalendar = answer.status === "attending" || answer.status === "late";
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="answer-summary"
      className="flex flex-col gap-3 rounded-control focus-visible:outline-2"
    >
      <ConfirmStamp
        label={t("confirmed")}
        show={celebrate}
        confetti={answer.status === "attending"}
      />
      <p className="font-display text-xl">
        {t("yourAnswer", { answer: describeAnswer(labels, answer) })}
      </p>
      {answer.reason ? (
        <p className="break-words whitespace-pre-line">{answer.reason}</p>
      ) : null}
      {answer.comment ? (
        <p className="break-words whitespace-pre-line text-muted-ink">
          {answer.comment}
        </p>
      ) : null}
      {answer.afterDeadline ? (
        <p className="text-sm text-muted-ink">{t("afterDeadline")}</p>
      ) : null}
      {inCalendar ? (
        unsubscribed ? (
          <p className="text-sm">
            {t("calendarUnsubscribed", { workspace: workspaceName })}{" "}
            <Link href={`/u/${token}`} className="font-bold underline">
              {t("subscribeAgain")}
            </Link>
          </p>
        ) : (
          <p className="text-sm font-bold">{t("calendarSent")}</p>
        )
      ) : null}
      <Button className="justify-center" onClick={onChange}>
        {t("change")}
      </Button>
    </div>
  );
}
