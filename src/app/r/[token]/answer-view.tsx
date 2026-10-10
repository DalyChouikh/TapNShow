"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { InvalidLink } from "@/components/public/invalid-link";
import { MeetingCard } from "@/components/public/meeting-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { useSubmitAnswer, useTokenInfo } from "@/hooks/use-token-page";
import { ApiClientError, errorCodeOf } from "@/lib/api-client";
import { describeAnswer } from "@/lib/responses/describe-answer";
import { choiceToStatus, type SubmitAnswerBody } from "@/shared/api/responses";
import type { TokenInfo } from "@/shared/api/tokens";
import { AnnouncementCalendar } from "./announcement-calendar";
import { AnswerSummary } from "./answer-summary";
import { ChoiceCards } from "./choice-cards";
import { NotYou } from "./not-you";
import { ReconfirmBanner } from "./reconfirm-banner";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** The meeting has started or was cancelled: the answer, read-only. */
function ClosedState({ info }: { info: TokenInfo }) {
  const t = useTranslations("AnswerPage");
  const labels = useAnswerLabels();
  return (
    <section className="flex flex-col gap-2">
      <p className="font-bold">
        {info.meeting.status === "cancelled"
          ? t("closedCancelled")
          : t("closed")}
      </p>
      {info.answers.responseMode === "announcement" ? null : (
        <p>
          {info.answer
            ? t("yourAnswer", { answer: describeAnswer(labels, info.answer) })
            : t("noAnswerYet")}
        </p>
      )}
    </section>
  );
}

/**
 * `/r/[token]` (spec §7.3): loading → invalid | closed | announcement | the saved answer |
 * the choice cards. The email's `?choice=` only pre-selects a card.
 */
export function AnswerView() {
  const t = useTranslations("AnswerPage");
  const tErrors = useTranslations("ApiErrors");
  const { token } = useParams<{ token: string }>();
  const search = useSearchParams();
  const info = useTokenInfo(token);
  const submit = useSubmitAnswer(token);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Once a save happens here, the email's ?choice= has been answered and no longer overrides.
  const [savedHere, setSavedHere] = useState(false);
  const [closedByServer, setClosedByServer] = useState(false);

  if (info.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (!info.data) {
    return (
      <InvalidLink
        limited={
          info.error instanceof ApiClientError &&
          info.error.code === "rate_limited"
        }
      />
    );
  }
  const data = info.data;
  const { meeting, answers, answer } = data;
  const started = !meeting.startsAt || new Date(meeting.startsAt) <= new Date();
  const closed = closedByServer || meeting.status !== "scheduled" || started;
  const emailChoice = choiceToStatus(
    search.get("choice"),
    answers.responseMode,
  );
  // A tapped email button that differs from the saved answer opens the cards on that choice.
  const emailOverride =
    answer !== null &&
    !savedHere &&
    emailChoice !== null &&
    emailChoice !== answer.status;
  // The time changed after this answer: ask once to confirm it again (spec §7.3).
  const reconfirming =
    !closed &&
    answer !== null &&
    answer.needsReconfirmation &&
    !editing &&
    !justSaved &&
    !emailOverride &&
    meeting.startsAt !== null;
  const deadlinePassed =
    answers.responseDeadline !== null &&
    new Date(answers.responseDeadline) < new Date();
  const error = submit.error;
  const errorText =
    error === null
      ? null
      : error instanceof ApiClientError && error.code !== "internal"
        ? tErrors(error.code)
        : t("saveFailed");

  const save = (body: SubmitAnswerBody) =>
    submit.mutate(body, {
      onSuccess: () => {
        setEditing(false);
        setJustSaved(true);
        setSavedHere(true);
      },
      onError: (failure) => {
        const code = errorCodeOf(failure);
        if (code === "answers_closed") {
          setClosedByServer(true);
        }
        // The organizer may now ask for something this answer lacks: open it on the cards.
        if (code === "reason_required" || code === "delay_required") {
          setEditing(true);
        }
      },
    });

  return (
    <Stagger className="flex flex-col gap-4">
      <StaggerItem className="flex items-center gap-3">
        <Sticker tone="primary">
          <span className="font-display text-xs">
            {initials(data.workspaceName)}
          </span>
        </Sticker>
        <span className="text-sm text-muted-ink">
          {t("invitedBy", { workspace: data.workspaceName })}
        </span>
      </StaggerItem>
      <StaggerItem>
        <MeetingCard
          meeting={meeting}
          previousStartsAt={reconfirming ? meeting.previousStartsAt : null}
        />
      </StaggerItem>
      <StaggerItem>
        {closed ? (
          <ClosedState info={data} />
        ) : answers.responseMode === "announcement" ? (
          <AnnouncementCalendar token={token} info={data} />
        ) : reconfirming && answer && meeting.startsAt ? (
          <ReconfirmBanner
            meeting={{ ...meeting, startsAt: meeting.startsAt }}
            answer={answer}
            pending={submit.isPending}
            errorText={errorText}
            onConfirm={() =>
              save({
                status: answer.status,
                delayMinutes: answer.delayMinutes,
                reason: answer.reason,
                comment: answer.comment,
              })
            }
            onChange={() => setEditing(true)}
          />
        ) : answer && !editing && !emailOverride ? (
          <AnswerSummary
            token={token}
            workspaceName={data.workspaceName}
            unsubscribed={data.unsubscribed}
            answer={answer}
            meeting={meeting}
            celebrate={justSaved}
            onChange={() => {
              setEditing(true);
              setJustSaved(false);
            }}
          />
        ) : (
          <ChoiceCards
            info={data}
            initialStatus={
              emailOverride || !answer ? emailChoice : answer.status
            }
            initial={answer}
            deadlinePassed={deadlinePassed}
            saving={submit.isPending}
            errorText={errorText}
            onConfirm={save}
          />
        )}
      </StaggerItem>
      <StaggerItem className="flex flex-col gap-1 border-t-2 border-dashed border-outline pt-3">
        <NotYou fullName={data.fullName} workspaceName={data.workspaceName} />
        {answers.responseMode === "announcement" ? null : (
          <p className="text-sm text-muted-ink">
            {t("visibility", { workspace: data.workspaceName })}
          </p>
        )}
      </StaggerItem>
    </Stagger>
  );
}
