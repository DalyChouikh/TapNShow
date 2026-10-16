"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { ConfirmStamp } from "@/components/motion/confirm-stamp";
import { Button } from "@/components/ui/button";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { describeAnswer } from "@/lib/responses/describe-answer";
import type { Answer } from "@/shared/api/responses";
import type { TokenInfo } from "@/shared/api/tokens";
import { CalendarLinks } from "./calendar-links";

/**
 * The saved answer: the CONFIRMED stamp right after a save (confetti for Going; focus moves here), the answer in
 * words, reason and comment as plain text, the calendar line and links, and Change (spec §7.3).
 */
export function AnswerSummary({
  token,
  workspaceName,
  unsubscribed,
  answer,
  meeting,
  celebrate,
  onChange,
}: {
  token: string;
  workspaceName: string;
  unsubscribed: boolean;
  answer: Answer;
  meeting: TokenInfo["meeting"];
  celebrate: boolean;
  onChange: () => void;
}) {
  const t = useTranslations("AnswerPage");
  const labels = useAnswerLabels();
  const inCalendar = answer.status === "attending" || answer.status === "late";
  const ref = useRef<HTMLDivElement>(null);
  // WCAG 2.4.3: right after a save, focus moves to the result once it is on screen.
  useEffect(() => {
    if (celebrate) {
      ref.current?.focus();
    }
  }, [celebrate]);
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
      {inCalendar ? <CalendarLinks token={token} meeting={meeting} /> : null}
      <Button className="justify-center" onClick={onChange}>
        {t("change")}
      </Button>
    </div>
  );
}
