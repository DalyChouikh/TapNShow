"use client";

import { CalendarBlank, Globe, MapPin, Plus } from "@phosphor-icons/react";
import { addMinutes, formatDistanceStrict } from "date-fns";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { LoadError } from "@/components/errors/load-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeeting, useMeetingsPage } from "@/hooks/use-meetings";
import { useMeetingResults } from "@/hooks/use-results";
import { useWorkspaceSender } from "@/hooks/use-sender";
import { formatDeadline, formatMeetingWhen } from "@/lib/meetings/format";
import { sendState } from "@/lib/meetings/send-state";
import { isLive } from "@/lib/responses/live-window";
import type { Meeting } from "@/shared/api/meetings";
import type { MeetingResults } from "@/shared/api/responses";
import { NudgeButton } from "./meetings/[id]/nudge-button";
import { ResultTiles } from "./meetings/[id]/result-tiles";
import { useHeldCaption } from "./meetings/[id]/send-progress";

/** The card's frame: "Next meeting" and what follows. */
function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations("WorkspaceHome.nextMeeting");
  return (
    <Card as="section" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-bold text-muted-ink uppercase">
        <CalendarBlank weight="bold" aria-hidden className="shrink-0" />
        {t("title")}
      </h2>
      {children}
    </Card>
  );
}

const CardSkeleton = () => <Skeleton className="h-64 w-full" />;

/**
 * Home's first card (design §2.2): the first meeting of the Meetings "upcoming" tab, which keeps
 * a meeting in progress until it ends. Owners and Admins can remind who hasn't answered; with
 * nothing coming up, they can start a new meeting. `now` drives "in 2 days", "Now" and moving
 * on once the meeting ends; `sendingSuspended` is the workspace's pause for review.
 */
export function NextMeetingCard({
  slug,
  canManage,
  canConnect,
  now,
  sendingSuspended,
  remindFor = null,
  onRemindFor,
}: {
  slug: string;
  canManage: boolean;
  /** The reader is the Owner, who connects the workspace's Gmail. */
  canConnect: boolean;
  now: Date;
  sendingSuspended: boolean;
  /** The meeting whose Remind dialog is open (held by Home, so it survives crossing lg). */
  remindFor?: string | null;
  onRemindFor?: (meetingId: string | null) => void;
}) {
  const next = useMeetingsPage(slug, "upcoming", 1);
  const item = next.items[0];
  if (next.query.isError && !next.query.data) {
    return <LoadError onRetry={() => void next.query.refetch()} />;
  }
  if (next.query.isPending) {
    return <CardSkeleton />;
  }
  if (!item?.startsAt) {
    return <NoMeeting slug={slug} canManage={canManage} />;
  }
  return (
    <NextMeeting
      key={item.id}
      slug={slug}
      id={item.id}
      canManage={canManage}
      canConnect={canConnect}
      now={now}
      sendingSuspended={sendingSuspended}
      refetchList={next.query.refetch}
      reminding={remindFor === item.id}
      onReminding={
        onRemindFor && ((open: boolean) => onRemindFor(open ? item.id : null))
      }
    />
  );
}

function NextMeeting({
  slug,
  id,
  canManage,
  canConnect,
  now,
  sendingSuspended,
  refetchList,
  reminding,
  onReminding,
}: {
  slug: string;
  id: string;
  canManage: boolean;
  canConnect: boolean;
  now: Date;
  sendingSuspended: boolean;
  /** The upcoming list's own (stable) refetch. */
  refetchList: ReturnType<typeof useMeetingsPage>["query"]["refetch"];
  reminding: boolean;
  onReminding?: (open: boolean) => void;
}) {
  const t = useTranslations("WorkspaceHome.nextMeeting");
  const meeting = useMeeting(slug, id);
  const startsAt = meeting.data?.startsAt ?? null;
  const live = meeting.data !== undefined && isLive(meeting.data, now);
  const results = useMeetingResults(slug, id, live, sendingSuspended);
  const ended =
    meeting.data !== undefined &&
    startsAt !== null &&
    now >= addMinutes(new Date(startsAt), meeting.data.durationMinutes);
  const refetchMeeting = meeting.refetch;
  // The list keeps a meeting until it ends; then ask again (every tick, in case the server's
  // clock is a little behind) and the next one takes this card. Its details too: someone may
  // have made it longer on another device, and then the list keeps it (#417).
  useEffect(() => {
    if (ended) {
      void refetchList();
      void refetchMeeting();
    }
  }, [ended, now, refetchList, refetchMeeting]);
  if (
    (meeting.isError && !meeting.data) ||
    (results.isError && !results.data)
  ) {
    return (
      <LoadError
        onRetry={() => {
          void meeting.refetch();
          void results.refetch();
        }}
      />
    );
  }
  if (!meeting.data || !results.data || startsAt === null || ended) {
    return <CardSkeleton />;
  }
  const href = `/w/${slug}/meetings/${id}`;
  const start = new Date(startsAt);
  const inProgress = start <= now;
  const when = formatMeetingWhen({ ...meeting.data, startsAt });
  return (
    <Frame>
      <Link
        href={href}
        className="font-display text-2xl break-words underline-offset-4 hover:underline"
      >
        {meeting.data.title}
      </Link>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold">{`${when.date}, ${when.start}–${when.end}`}</span>
        <Pill tone={inProgress ? "success" : "primary"}>
          {inProgress
            ? t("now")
            : t("startsIn", { time: formatDistanceStrict(start, now) })}
        </Pill>
      </p>
      <Place meeting={meeting.data} />
      <ResultTiles results={results.data} />
      <AnswerLine
        meeting={meeting.data}
        results={results.data}
        suspended={sendingSuspended}
        now={now}
      />
      <div className="flex flex-wrap items-start gap-2">
        {canManage ? (
          <NudgeButton
            slug={slug}
            meeting={meeting.data}
            results={results.data}
            canConnect={canConnect}
            confirming={onReminding ? reminding : undefined}
            onConfirmingChange={onReminding}
          />
        ) : null}
        <Button asChild tone={inProgress ? "primary" : "surface"}>
          <Link href={href}>{t("open")}</Link>
        </Button>
      </div>
    </Frame>
  );
}

/** Where: the room, or "Online" (or the online note) for an online meeting. */
function Place({ meeting }: { meeting: Meeting }) {
  const t = useTranslations("WorkspaceHome.nextMeeting");
  if (meeting.locationMode === "online") {
    return (
      <p className="flex items-center gap-1 break-words">
        <Globe weight="bold" aria-hidden className="shrink-0" />
        {meeting.onlineText || t("online")}
      </p>
    );
  }
  return meeting.locationText ? (
    <p className="flex items-center gap-1 break-words">
      <MapPin weight="bold" aria-hidden className="shrink-0" />
      {meeting.locationText}
    </p>
  ) : null;
}

/**
 * "24 of 30 answered" with a bar and the deadline, or the send progress while invites are still
 * going out (or why they're held, as on the meeting page). Answers are what people said;
 * check-ins count on the meeting page.
 */
function AnswerLine({
  meeting,
  results,
  suspended,
  now,
}: {
  meeting: Meeting;
  results: MeetingResults;
  suspended: boolean;
  now: Date;
}) {
  const t = useTranslations("WorkspaceHome.nextMeeting");
  const heldCaption = useHeldCaption();
  const { emails, answers } = results;
  const state = sendState(results, suspended);
  if (state.kind !== "sent") {
    const done = emails.total - emails.queued;
    return (
      <div className="flex flex-col gap-1">
        <ProgressBar
          label={t("sendingLabel")}
          value={done}
          max={emails.total}
        />
        <p className="text-sm font-bold">
          {heldCaption(state, emails.queued) ??
            t("sending", { done, total: emails.total })}
        </p>
      </div>
    );
  }
  if (meeting.responseMode === "announcement") {
    return null;
  }
  const answered =
    answers.attending + answers.late + answers.absent + answers.notAttending;
  const counts = { answered, total: emails.total };
  const deadline = meeting.responseDeadline;
  return (
    <div className="flex flex-col gap-1">
      <ProgressBar
        label={t("answeredLabel")}
        value={answered}
        max={emails.total}
      />
      <p className="text-sm font-bold">
        {deadline
          ? t(new Date(deadline) > now ? "answeredClosing" : "answeredClosed", {
              ...counts,
              deadline: formatDeadline(deadline, meeting.timezone),
            })
          : t("answered", counts)}
      </p>
    </div>
  );
}

/** Nothing upcoming: say so, and let Owners and Admins start one. */
function NoMeeting({ slug, canManage }: { slug: string; canManage: boolean }) {
  const t = useTranslations("WorkspaceHome.nextMeeting");
  const sender = useWorkspaceSender(slug);
  return (
    <Frame>
      <p className="font-bold">{t("none")}</p>
      {canManage && sender.data && !sender.data.sender ? (
        <p className="text-sm text-muted-ink">{t("noSender")}</p>
      ) : null}
      {canManage ? (
        <Button asChild tone="primary" className="self-start">
          <Link href={`/w/${slug}/meetings/new`}>
            <Plus weight="bold" aria-hidden />
            {t("newMeeting")}
          </Link>
        </Button>
      ) : null}
    </Frame>
  );
}
