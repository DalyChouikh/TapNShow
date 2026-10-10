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

/** "Remind N who haven't answered" (spec §7.6 Nudge): once every 12 hours, after a confirm dialog. */
export function NudgeButton({
  slug,
  meeting,
  results,
}: {
  slug: string;
  meeting: Meeting;
  results: MeetingResults;
}) {
  const t = useTranslations("MeetingPage.nudge");
  const tErrors = useTranslations("ApiErrors");
  const sender = useWorkspaceSender(slug);
  const nudge = useNudgeMeeting(slug, meeting.id);
  const [confirming, setConfirming] = useState(false);
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
  const refusal = (error: Error) => {
    const code = errorCodeOf(error);
    if (code === "sender_not_connected" || code === "sender_broken") {
      return t("askOwner", { owner: sender.data?.ownerName ?? "" });
    }
    return code === "nothing_to_send" ? t("nothingToSend") : tErrors(code);
  };
  return (
    <div className="flex flex-col gap-1">
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
        <p className="text-sm font-bold">
          {t("askOwner", { owner: sender.data.ownerName })}
        </p>
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
            <p role="alert" className="font-bold">
              {refusal(nudge.error)}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
