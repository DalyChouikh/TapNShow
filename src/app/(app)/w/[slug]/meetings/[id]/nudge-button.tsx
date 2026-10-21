"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useNudgeMeeting } from "@/hooks/use-meeting-lifecycle";
import { useWorkspaceSender } from "@/hooks/use-sender";
import { errorCodeOf } from "@/lib/api-client";
import { formatTime } from "@/lib/meetings/format";
import type { Meeting } from "@/shared/api/meetings";
import type { MeetingResults } from "@/shared/api/responses";
import { googleConnectHref } from "@/shared/api/google-connect";

/**
 * Why reminders can't go out without a working Gmail, as the reader can act on it (#420): the
 * Owner gets the way to connect or reconnect it (back to Settings, which shows how it went, like
 * Needs attention's button); an Admin is told to ask the Owner.
 */
function SenderNeeded({
  slug,
  canConnect,
  broken,
  ownerName,
}: {
  slug: string;
  canConnect: boolean;
  broken: boolean;
  ownerName: string;
}) {
  const t = useTranslations("MeetingPage.nudge");
  return canConnect ? (
    <Button asChild tone="surface" className="justify-center text-center">
      <a href={googleConnectHref(slug, "sending")}>
        {t(broken ? "reconnect" : "connect")}
      </a>
    </Button>
  ) : (
    <p className="text-sm font-bold">{t("askOwner", { owner: ownerName })}</p>
  );
}

/**
 * "Remind N who haven't answered" (spec §7.6 Nudge): once every 12 hours, after a confirm dialog.
 * The dialog's open state can be held by the page (`confirming`/`onConfirmingChange`), so it
 * survives the button remounting (Home's cards when the screen crosses lg, #417). `canConnect`:
 * the reader is the Owner, who connects the workspace's Gmail.
 */
export function NudgeButton({
  slug,
  meeting,
  results,
  canConnect,
  confirming: heldConfirming,
  onConfirmingChange,
}: {
  slug: string;
  meeting: Meeting;
  results: MeetingResults;
  canConnect: boolean;
  confirming?: boolean;
  onConfirmingChange?: (open: boolean) => void;
}) {
  const t = useTranslations("MeetingPage.nudge");
  const tErrors = useTranslations("ApiErrors");
  const sender = useWorkspaceSender(slug);
  const nudge = useNudgeMeeting(slug, meeting.id);
  const [ownConfirming, setOwnConfirming] = useState(false);
  const confirming = heldConfirming ?? ownConfirming;
  const setConfirming = onConfirmingChange ?? setOwnConfirming;
  const started =
    meeting.startsAt !== null && new Date(meeting.startsAt) <= new Date();
  if (
    meeting.status !== "scheduled" ||
    started ||
    meeting.responseMode === "announcement"
  ) {
    return null;
  }
  const { lastAt, lastCount, nextAt } = results.nudge;
  if (lastAt && nextAt && new Date(nextAt) > new Date()) {
    return (
      <p className="text-sm text-muted-ink">
        {t("done", {
          count: lastCount ?? 0,
          at: formatTime(lastAt, meeting.timezone),
          next: formatTime(nextAt, meeting.timezone),
        })}
      </p>
    );
  }
  const count = results.answers.remindable;
  if (count === 0) {
    return null;
  }
  const connection = sender.data?.sender ?? null;
  const usable = connection?.status === "active";
  const ownerName = sender.data?.ownerName ?? "";
  const refusal = (error: Error) => {
    const code = errorCodeOf(error);
    if (code === "sender_not_connected" || code === "sender_broken") {
      return (
        <SenderNeeded
          slug={slug}
          canConnect={canConnect}
          broken={code === "sender_broken"}
          ownerName={ownerName}
        />
      );
    }
    return (
      <p className="font-bold">
        {code === "nothing_to_send" ? t("nothingToSend") : tErrors(code)}
      </p>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        className="justify-center"
        disabled={!usable}
        onClick={() => {
          nudge.reset();
          setConfirming(true);
        }}
      >
        {t("action", { count })}
      </Button>
      {!usable && sender.data ? (
        <SenderNeeded
          slug={slug}
          canConnect={canConnect}
          broken={connection?.status === "broken"}
          ownerName={ownerName}
        />
      ) : null}
      {connection ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t("confirmTitle", { count, email: connection.email })}
          description={t("confirmBody")}
          confirmLabel={t("confirm")}
          pending={nudge.isPending}
          onConfirm={() =>
            nudge.mutate(undefined, {
              onSuccess: ({ reminded }) => {
                setConfirming(false);
                toast.success(t("sent", { count: reminded }));
              },
            })
          }
        >
          {nudge.error ? (
            <div role="alert" className="flex flex-col">
              {refusal(nudge.error)}
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
