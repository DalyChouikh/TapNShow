"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { describeAnswer, lowerFirst } from "@/lib/responses/describe-answer";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import type { Answer } from "@/shared/api/responses";
import type { TokenInfo } from "@/shared/api/tokens";

/**
 * "Still going?" after the time changed (spec §7.3; owner's mockup A): the new time, what the person
 * said, one tap to confirm the same answer again, or Change my answer.
 */
export function ReconfirmBanner({
  meeting,
  answer,
  pending,
  onConfirm,
  onChange,
}: {
  meeting: TokenInfo["meeting"] & { startsAt: string };
  answer: Answer;
  pending: boolean;
  onConfirm: () => void;
  onChange: () => void;
}) {
  const t = useTranslations("AnswerPage");
  const labels = useAnswerLabels();
  const when = formatMeetingWhen(meeting);
  const said = describeAnswer(labels, answer);
  return (
    <Card className="flex flex-col gap-3 bg-fill-warning/25">
      <p className="font-bold">
        {t("reconfirmChanged", { when: `${when.date}, ${when.start}` })}
      </p>
      <p>{t("reconfirmYouSaid", { answer: said })}</p>
      <Button
        tone="primary"
        className="justify-center"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={onConfirm}
      >
        {t("reconfirmYes", { answer: lowerFirst(said) })}
      </Button>
      <button
        type="button"
        onClick={onChange}
        className="min-h-11 self-center font-bold underline underline-offset-4"
      >
        {t("reconfirmChange")}
      </button>
    </Card>
  );
}
