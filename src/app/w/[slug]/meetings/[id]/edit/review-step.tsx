"use client";

import { EnvelopeSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FROM_NAME_KEPT } from "@/config/meetings";
import {
  useDeleteMeeting,
  useMeetingAudience,
  useMeetingPreview,
  useSendMeeting,
} from "@/hooks/use-meetings";
import { useRoster } from "@/hooks/use-roster";
import { gmailConnectHref, useWorkspaceSender } from "@/hooks/use-sender";
import { ApiClientError } from "@/lib/api-client";
import { responseDeadlineProblem } from "@/lib/meetings/deadline";
import { formatDeadline, formatMeetingWhen } from "@/lib/meetings/format";
import { quotaLine } from "@/lib/meetings/quota-line";
import { GmailConnectResult } from "@/app/w/[slug]/settings/gmail-connect-result";
import { EmailPreviewDialog } from "./email-preview-dialog";
import { WizardFooter } from "./wizard-footer";
import {
  stepBefore,
  type WizardStep,
  type WizardStepProps,
} from "./wizard-steps";

function Summary({
  title,
  onEdit,
  editLabel,
  children,
}: {
  title: string;
  onEdit?: () => void;
  editLabel: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        {onEdit ? (
          <button
            type="button"
            className="min-h-11 px-2 font-bold underline"
            onClick={onEdit}
          >
            {editLabel}
          </button>
        ) : null}
      </div>
      <div className="text-sm text-muted-ink">{children}</div>
    </Card>
  );
}

/** Step 4: summary, email preview, sender and quota, then Send behind a confirm dialog (spec §7.2). */
export function ReviewStep({
  slug,
  meeting,
  workspace,
  steps,
  goTo,
}: WizardStepProps) {
  const t = useTranslations("Wizard");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const audience = useMeetingAudience(slug, meeting.id);
  const roster = useRoster(slug);
  const sender = useWorkspaceSender(slug);
  const preview = useMeetingPreview(
    slug,
    meeting.id,
    meeting.startsAt !== null,
  );
  const send = useSendMeeting(slug, meeting.id);
  const remove = useDeleteMeeting(slug);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!audience.data || !sender.data || !roster.data) {
    return <Skeleton className="h-96 w-full" />;
  }
  const inviteMore = meeting.status === "scheduled";
  const editable = (step: WizardStep) =>
    steps.includes(step) ? () => goTo(step) : undefined;
  const count = audience.data.counts.toInvite;
  const connection = sender.data.sender;
  const usable = connection?.status === "active";
  const isOwner = workspace.myRole === "owner";
  const when = meeting.startsAt
    ? formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt })
    : null;
  const places = [
    meeting.locationMode !== "online" ? meeting.locationText : "",
    meeting.locationMode !== "in_person" ? meeting.onlineText : "",
  ].filter(Boolean);
  const listNames = roster.data.lists
    .filter((l) => audience.data.listIds.includes(l.id))
    .map((l) => l.name);
  const quota = connection
    ? quotaLine({
        toSend: count,
        sentLast24h: connection.sentLast24h,
        dailyLimit: connection.dailyLimit,
      })
    : null;
  // A later Details edit (or the clock) can break a deadline the Responses step accepted.
  const deadlineProblem =
    !inviteMore &&
    meeting.responseMode !== "announcement" &&
    meeting.responseDeadline
      ? responseDeadlineProblem(
          meeting.responseDeadline,
          meeting.startsAt,
          new Date(),
        )
      : null;
  const editUrl = `/w/${slug}/meetings/${meeting.id}/edit?step=review`;
  const confirmSend = () =>
    send.mutate(undefined, {
      onSuccess: ({ invited }) => {
        setConfirming(false);
        toast.success(t("review.sending", { count: invited }));
        router.push(`/w/${slug}/meetings/${meeting.id}`);
      },
      onError: () => setConfirming(false),
    });
  return (
    <div className="flex flex-col gap-3">
      <GmailConnectResult />
      <Summary
        title={meeting.title}
        editLabel={t("review.edit")}
        onEdit={editable("details")}
      >
        {when
          ? `${when.date}, ${when.start}–${when.end} (${when.zone})`
          : t("review.addDate")}
        {places.map((place) => ` · ${place}`).join("")}
      </Summary>
      <Summary
        title={
          inviteMore
            ? t("review.newPeople", { count })
            : t("review.people", { count })
        }
        editLabel={t("review.edit")}
        onEdit={editable("audience")}
      >
        {listNames.join(", ")}
        {audience.data.counts.unsubscribed > 0 ? (
          <span className="block">
            {t("review.unsubscribedSkipped", {
              count: audience.data.counts.unsubscribed,
            })}
          </span>
        ) : null}
      </Summary>
      {!inviteMore ? (
        <Summary
          title={t(`review.mode.${meeting.responseMode}`)}
          editLabel={t("review.edit")}
          onEdit={editable("responses")}
        >
          {meeting.responseMode !== "announcement" && meeting.reasonRequired
            ? t("review.reasonRequired")
            : null}
          {meeting.responseDeadline
            ? ` · ${t("review.deadline", { deadline: formatDeadline(meeting.responseDeadline, meeting.timezone) })}`
            : null}
          {deadlineProblem ? (
            <strong className="block text-ink">
              {t(`review.deadlineProblem.${deadlineProblem}`)}
            </strong>
          ) : null}
        </Summary>
      ) : null}
      <Card className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <EnvelopeSimple weight="bold" aria-hidden />
          <span className="truncate font-bold">
            {preview.data?.subject ?? t("review.preview")}
          </span>
        </div>
        <Button disabled={!preview.data} onClick={() => setPreviewOpen(true)}>
          {t("review.open")}
        </Button>
      </Card>
      {connection && usable ? (
        <div className="px-1 text-sm text-muted-ink">
          <p className="font-bold text-ink">
            {FROM_NAME_KEPT
              ? t("review.fromNamed", {
                  name: workspace.name,
                  email: connection.email,
                })
              : t("review.fromEmail", { email: connection.email })}
          </p>
          {quota ? (
            <p>
              {quota.queued > 0
                ? t("review.quotaQueued", {
                    now: quota.now,
                    queued: quota.queued,
                  })
                : t("review.quota", { now: quota.now, left: quota.leftAfter })}
            </p>
          ) : null}
        </div>
      ) : isOwner ? (
        <Button asChild tone="primary">
          <a href={gmailConnectHref(slug, editUrl)}>{t("review.connect")}</a>
        </Button>
      ) : (
        <p className="px-1 text-sm font-bold">
          {t("review.askOwner", { owner: sender.data.ownerName })}
        </p>
      )}
      {send.error instanceof ApiClientError ? (
        <p role="alert" className="font-bold">
          {tErrors(send.error.code)}
        </p>
      ) : null}
      {!inviteMore ? (
        <button
          type="button"
          className="min-h-11 self-start px-1 font-bold underline"
          onClick={() => setDeleting(true)}
        >
          {t("review.deleteDraft")}
        </button>
      ) : null}
      {preview.data ? (
        <EmailPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          html={preview.data.html}
          subject={preview.data.subject}
          recipientName={preview.data.recipientName}
        />
      ) : null}
      {connection ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={
            inviteMore
              ? t("review.confirmSendMore", { count, email: connection.email })
              : t("review.confirmSend", { count, email: connection.email })
          }
          description={t("review.confirmBody")}
          confirmLabel={
            inviteMore
              ? t("review.sendMore", { count })
              : t("review.send", { count })
          }
          pending={send.isPending}
          onConfirm={confirmSend}
        />
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("review.deleteTitle")}
        description={t("review.deleteBody")}
        confirmLabel={t("review.deleteDraft")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(meeting.id, {
            onSuccess: () => router.push(`/w/${slug}/meetings`),
          })
        }
      />
      {usable ? (
        <WizardFooter
          backLabel={inviteMore ? t("back") : t("review.saveDraft")}
          onBack={() =>
            inviteMore ? goTo("audience") : router.push(`/w/${slug}/meetings`)
          }
          nextLabel={
            inviteMore
              ? t("review.sendMore", { count })
              : t("review.send", { count })
          }
          nextDisabled={
            count === 0 || meeting.startsAt === null || deadlineProblem !== null
          }
          onNext={() => setConfirming(true)}
        />
      ) : (
        <WizardFooter
          backLabel={t("back")}
          onBack={() => {
            const before = stepBefore(steps, "review");
            if (before) {
              goTo(before);
            }
          }}
          nextLabel={t("review.saveDraft")}
          onNext={() => router.push(`/w/${slug}/meetings`)}
        />
      )}
    </div>
  );
}
