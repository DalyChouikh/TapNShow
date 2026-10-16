"use client";

import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui/chip";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_MAX, REASON_MAX } from "@/config/responses";
import { type AnswerStatus, needsReason } from "@/shared/api/responses";

/** The fields inside the selected choice card: delay chips (Late), reason, comment (spec §7.3). */
export function AnswerFields({
  status,
  workspaceName,
  delayOptions,
  reasonRequired,
  commentsEnabled,
  delay,
  onDelay,
  reason,
  onReason,
  comment,
  onComment,
  delayError,
  reasonError,
}: {
  status: AnswerStatus;
  workspaceName: string;
  delayOptions: number[];
  reasonRequired: boolean;
  commentsEnabled: boolean;
  delay: number | null;
  onDelay: (minutes: number | null) => void;
  reason: string;
  onReason: (value: string) => void;
  comment: string;
  onComment: (value: string) => void;
  delayError?: string;
  reasonError?: string;
}) {
  const t = useTranslations("AnswerPage");
  return (
    <div className="flex flex-col gap-3 px-1 pb-1">
      {status === "late" ? (
        <div className="flex flex-col gap-1.5">
          <span id="answer-delay-label" className="text-sm font-bold">
            {t("delay")}
          </span>
          <div
            role="group"
            aria-labelledby="answer-delay-label"
            aria-describedby={delayError ? "answer-delay-error" : undefined}
            className="flex flex-wrap gap-2"
          >
            {delayOptions.map((minutes) => (
              <Chip
                key={minutes}
                tone="warning"
                pressed={delay === minutes}
                onPressedChange={(pressed) => onDelay(pressed ? minutes : null)}
              >
                {t("delayChip", { minutes })}
              </Chip>
            ))}
          </div>
          {delayError ? (
            <p id="answer-delay-error" className="text-sm font-bold">
              {delayError}
            </p>
          ) : null}
        </div>
      ) : null}
      {needsReason(status) ? (
        <Textarea
          id="answer-reason"
          label={reasonRequired ? t("reason") : t("reasonOptional")}
          hint={t("reasonHint", { workspace: workspaceName })}
          error={reasonError}
          value={reason}
          maxLength={REASON_MAX}
          rows={3}
          onChange={(event) => onReason(event.target.value)}
        />
      ) : null}
      {commentsEnabled ? (
        <Textarea
          id="answer-comment"
          label={t("comment")}
          value={comment}
          maxLength={COMMENT_MAX}
          rows={2}
          onChange={(event) => onComment(event.target.value)}
        />
      ) : null}
    </div>
  );
}
