"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { InvalidLink } from "@/components/public/invalid-link";
import { MeetingCard } from "@/components/public/meeting-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { useSubmitAnswer, useTokenInfo } from "@/hooks/use-token-page";
import { ApiClientError } from "@/lib/api-client";
import { describeAnswer } from "@/lib/responses/describe-answer";
import { choiceToStatus, type SubmitAnswerBody } from "@/shared/api/responses";
import type { TokenInfo } from "@/shared/api/tokens";
import { AnnouncementCalendar } from "./announcement-calendar";
import { AnswerSummary } from "./answer-summary";
import { ChoiceCards } from "./choice-cards";
import { NotYou } from "./not-you";

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
      <p>
        {info.answer
          ? t("yourAnswer", { answer: describeAnswer(labels, info.answer) })
          : t("noAnswerYet")}
      </p>
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
  const [closedByServer, setClosedByServer] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

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
        // WCAG 2.4.3: move focus to the result once it has rendered.
        requestAnimationFrame(() => summaryRef.current?.focus());
      },
      onError: (failure) => {
        if (
          failure instanceof ApiClientError &&
          failure.code === "answers_closed"
        ) {
          setClosedByServer(true);
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
        <MeetingCard meeting={meeting} />
      </StaggerItem>
      <StaggerItem>
        {closed ? (
          <ClosedState info={data} />
        ) : answers.responseMode === "announcement" ? (
          <AnnouncementCalendar token={token} info={data} />
        ) : answer && !editing ? (
          <AnswerSummary
            ref={summaryRef}
            token={token}
            workspaceName={data.workspaceName}
            unsubscribed={data.unsubscribed}
            answer={answer}
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
              answer?.status ??
              choiceToStatus(search.get("choice"), answers.responseMode)
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
