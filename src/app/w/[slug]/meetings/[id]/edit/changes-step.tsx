"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { SwitchRow } from "@/components/forms/switch-row";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MEMBER_VISIBLE_FIELDS,
  PLACE_FIELDS,
  SCHEDULE_FIELDS,
} from "@/config/meeting-edit";
import { useEditPreview, useSaveEdit } from "@/hooks/use-meeting-lifecycle";
import { useWorkspaceSender } from "@/hooks/use-sender";
import { ApiClientError } from "@/lib/api-client";
import { markedCard } from "@/lib/meetings/changes";
import { quotaLine } from "@/lib/meetings/quota-line";
import type { ChangeSet, ChangeValue } from "@/shared/api/meeting-changes";
import { MarkedCard } from "./marked-card";
import { WizardFooter } from "./wizard-footer";
import { stepBefore, type WizardStepProps } from "./wizard-steps";

/** Organizer-only settings a Review changes list names (members never see these). */
const SETTING_FIELDS = [
  "reason_required",
  "comments_enabled",
  "reminder_pending_hours",
  "reminder_going_hours",
] as const;

const touches = (changes: ChangeSet, fields: readonly string[]) =>
  fields.some((field) => field in changes);

/**
 * The last step of editing a sent meeting (spec §7.5): the meeting with its changes marked, who is
 * told, then save (behind an "Are you sure?" when it emails people).
 */
export function ChangesStep({
  slug,
  meeting,
  saved,
  steps,
  goTo,
  editDraft,
}: WizardStepProps) {
  const t = useTranslations("Wizard");
  const tc = useTranslations("Wizard.changes");
  const tCard = useTranslations("Email.changes");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const fields = editDraft?.fields ?? null;
  const [notify, setNotify] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const preview = useEditPreview(
    slug,
    saved.id,
    fields ?? {},
    notify,
    fields !== null,
  );
  const save = useSaveEdit(slug, saved.id);
  const sender = useWorkspaceSender(slug);
  const meetingPage = `/w/${slug}/meetings/${saved.id}`;
  const before = stepBefore(steps, "changes");
  const back = () => (before ? goTo(before) : undefined);
  const errorText = (error: Error | null) =>
    error
      ? tErrors(error instanceof ApiClientError ? error.code : "internal")
      : null;

  if (fields === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-ink">{tc("nothing")}</p>
        <WizardFooter backLabel={t("back")} onBack={back} />
      </div>
    );
  }
  if (preview.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (preview.error) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="font-bold">
          {errorText(preview.error)}
        </p>
        <WizardFooter backLabel={t("back")} onBack={back} />
      </div>
    );
  }
  const { changes, emails, calendarOnly, reconfirm } = preview.data;
  const settingValue = (field: string, value: ChangeValue) =>
    typeof value === "boolean"
      ? tc(value ? "on" : "off")
      : value === null
        ? tc("off")
        : field.startsWith("reminder_")
          ? t("responses.hoursBefore", { count: Number(value) })
          : String(value);
  const settings = SETTING_FIELDS.filter((field) => field in changes);
  const offerNotify =
    touches(changes, MEMBER_VISIBLE_FIELDS) &&
    !touches(changes, SCHEDULE_FIELDS) &&
    !touches(changes, PLACE_FIELDS);
  const connection = sender.data?.sender ?? null;
  const toSend = emails + calendarOnly;
  // Nobody is emailed about it, but calendar holders get a short note that moves their event.
  const calendarOnlyNote = emails === 0 && calendarOnly > 0;
  const quota =
    connection && toSend > 0
      ? quotaLine({
          toSend,
          sentLast24h: connection.sentLast24h,
          dailyLimit: connection.dailyLimit,
        })
      : null;
  const senderWaiting =
    sender.data !== undefined && connection?.status !== "active";
  const saveLabel =
    emails > 0 ? tc("saveAndEmail", { count: emails }) : tc("save");
  const commit = () =>
    save.mutate(
      { fields, notify },
      {
        onSuccess: () => {
          editDraft?.clear();
          toast.success(tc("saved"));
          router.push(meetingPage);
        },
        onError: () => setConfirming(false),
      },
    );
  return (
    <div className="flex flex-col gap-4">
      {meeting.startsAt ? (
        <MarkedCard
          sections={markedCard(
            { ...meeting, startsAt: meeting.startsAt },
            changes,
            { none: tCard("none"), joinLink: (url) => url },
          )}
        />
      ) : null}
      {settings.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-bold">{tc("settings")}</h2>
          <ul className="flex flex-col gap-0.5 text-sm text-muted-ink">
            {settings.map((field) => (
              <li key={field}>
                {tc(`setting.${field}`)}:{" "}
                {settingValue(field, changes[field][0])} →{" "}
                {settingValue(field, changes[field][1])}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Card className="flex flex-col gap-2">
        <h2 className="font-display text-lg">{tc("whoIsTold")}</h2>
        <p className="font-bold">{tc("emails", { count: emails })}</p>
        {reconfirm ? <p>{tc("reconfirm")}</p> : null}
        {calendarOnlyNote ? (
          <p>{tc("calendarNote", { count: calendarOnly })}</p>
        ) : null}
        {quota ? (
          <p className="text-sm text-muted-ink">
            {quota.queued > 0
              ? t("review.quotaQueued", {
                  now: quota.now,
                  queued: quota.queued,
                })
              : t("review.quota", { now: quota.now, left: quota.leftAfter })}
          </p>
        ) : null}
        {senderWaiting ? (
          <p className="text-sm font-bold">{tc("senderWaiting")}</p>
        ) : null}
        {offerNotify ? (
          <SwitchRow
            id="edit-notify"
            label={tc("notify")}
            checked={notify}
            onChange={setNotify}
          />
        ) : null}
      </Card>
      {save.error ? (
        <p role="alert" className="font-bold">
          {errorText(save.error)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setDiscarding(true)}
        className="min-h-11 self-start font-bold underline underline-offset-4"
      >
        {tc("discard")}
      </button>
      <WizardFooter
        backLabel={t("back")}
        onBack={back}
        nextLabel={saveLabel}
        pending={save.isPending}
        onNext={() =>
          emails + calendarOnly > 0 ? setConfirming(true) : commit()
        }
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          calendarOnlyNote
            ? tc("confirmCalendarTitle", { count: calendarOnly })
            : tc("confirmTitle", { count: emails })
        }
        description={
          calendarOnlyNote
            ? tc("confirmCalendarBody")
            : reconfirm
              ? tc("confirmReconfirm")
              : tc("confirmBody")
        }
        confirmLabel={saveLabel}
        pending={save.isPending}
        onConfirm={commit}
      />
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={tc("discardTitle")}
        description={tc("discardBody")}
        confirmLabel={tc("discard")}
        tone="danger"
        onConfirm={() => {
          editDraft?.clear();
          setDiscarding(false);
          router.push(meetingPage);
        }}
      />
    </div>
  );
}
