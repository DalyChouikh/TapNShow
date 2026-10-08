"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { formatDeadline } from "@/lib/meetings/format";
import { cn } from "@/lib/utils";
import type { ResponseMode } from "@/shared/api/meeting-settings";
import {
  type Answer,
  type AnswerStatus,
  answerStatusSchema,
  needsReason,
  statusesFor,
  type SubmitAnswerBody,
} from "@/shared/api/responses";
import type { TokenInfo } from "@/shared/api/tokens";
import { AnswerFields } from "./answer-fields";

const CHECKED_FILL: Record<AnswerStatus, string> = {
  attending: "data-[state=checked]:bg-fill-success",
  late: "data-[state=checked]:bg-fill-warning",
  absent: "data-[state=checked]:bg-fill-danger",
  not_attending: "data-[state=checked]:bg-fill-danger",
};
// A light tint of the answer's color: the fields inside keep the theme's own ink and outlines,
// which stay readable in dark mode (a full pastel fill would not).
const BLOCK_TINT: Record<AnswerStatus, string> = {
  attending: "bg-fill-success/25",
  late: "bg-fill-warning/25",
  absent: "bg-fill-danger/25",
  not_attending: "bg-fill-danger/25",
};

type Translate = ReturnType<typeof useTranslations<"AnswerPage">>;

function choiceText(t: Translate, mode: ResponseMode, status: AnswerStatus) {
  if (status === "attending") {
    return mode === "rsvp" ? t("choice.rsvpAttending") : t("choice.attending");
  }
  return t(`choice.${status}`);
}

function confirmText(
  t: Translate,
  mode: ResponseMode,
  status: AnswerStatus,
  delay: number | null,
) {
  if (status === "attending") {
    return mode === "rsvp"
      ? t("confirm.rsvpAttending")
      : t("confirm.attending");
  }
  if (status === "late") {
    return delay === null
      ? t("confirm.lateNoDelay")
      : t("confirm.late", { minutes: delay });
  }
  return t(`confirm.${status}`);
}

/**
 * "Are you coming?": one large card per choice; the selected card shows its fields under its
 * header, and Confirm names the answer (spec §7.3, layout decided 2026-10-08). The email's
 * `?choice=` only pre-selects; nothing is saved before Confirm.
 */
export function ChoiceCards({
  info,
  initialStatus,
  initial,
  deadlinePassed,
  saving,
  errorText,
  onConfirm,
}: {
  info: TokenInfo;
  initialStatus: AnswerStatus | null;
  initial: Answer | null;
  deadlinePassed: boolean;
  saving: boolean;
  errorText: string | null;
  onConfirm: (body: SubmitAnswerBody) => void;
}) {
  const t = useTranslations("AnswerPage");
  const { answers } = info;
  const [status, setStatus] = useState<AnswerStatus | null>(initialStatus);
  const [delay, setDelay] = useState<number | null>(
    initial?.delayMinutes ?? null,
  );
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [tried, setTried] = useState(false);
  const delayMissing = status === "late" && delay === null;
  const reasonMissing =
    status !== null &&
    needsReason(status) &&
    answers.reasonRequired &&
    reason.trim() === "";

  const confirm = () => {
    setTried(true);
    if (status === null || delayMissing || reasonMissing) {
      return;
    }
    onConfirm({
      status,
      delayMinutes: status === "late" ? delay : null,
      reason: needsReason(status) ? reason.trim() : "",
      comment: answers.commentsEnabled ? comment.trim() : "",
    });
  };

  return (
    <section aria-labelledby="answer-question" className="flex flex-col gap-3">
      {answers.responseDeadline ? (
        <p className="text-sm font-bold">
          {deadlinePassed
            ? t("deadlinePassed")
            : t("deadline", {
                deadline: formatDeadline(
                  answers.responseDeadline,
                  info.meeting.timezone,
                ),
              })}
        </p>
      ) : null}
      <h2 id="answer-question" className="font-display text-xl">
        {t("question")}
      </h2>
      <RadioGroup
        aria-labelledby="answer-question"
        value={status ?? ""}
        onValueChange={(next) => setStatus(answerStatusSchema.parse(next))}
        className="gap-3"
      >
        {statusesFor(answers.responseMode).map((option) => (
          <div
            key={option}
            className={cn(
              "flex flex-col gap-3 rounded-card",
              status === option &&
                cn(
                  "border-[length:var(--tn-border-width)] border-outline p-2",
                  BLOCK_TINT[option],
                ),
            )}
          >
            <RadioCard
              value={option}
              className={cn("min-h-14 text-base", CHECKED_FILL[option])}
            >
              {choiceText(t, answers.responseMode, option)}
            </RadioCard>
            {status === option ? (
              <AnswerFields
                status={option}
                workspaceName={info.workspaceName}
                delayOptions={answers.delayOptions}
                reasonRequired={answers.reasonRequired}
                commentsEnabled={answers.commentsEnabled}
                delay={delay}
                onDelay={setDelay}
                reason={reason}
                onReason={setReason}
                comment={comment}
                onComment={setComment}
                delayError={tried && delayMissing ? t("delayError") : undefined}
                reasonError={
                  tried && reasonMissing ? t("reasonError") : undefined
                }
              />
            ) : null}
          </div>
        ))}
      </RadioGroup>
      {answers.footerNote ? (
        <p className="text-sm break-words whitespace-pre-line text-muted-ink">
          {answers.footerNote}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="font-bold">
          {errorText}
        </p>
      ) : null}
      <Button
        tone="primary"
        size="lg"
        className="justify-center"
        disabled={status === null || saving}
        aria-busy={saving}
        onClick={confirm}
      >
        {saving
          ? t("saving")
          : status === null
            ? t("pickAnswer")
            : confirmText(t, answers.responseMode, status, delay)}
      </Button>
    </section>
  );
}
