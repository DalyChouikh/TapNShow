"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReminderChoice } from "@/components/forms/reminder-choice";
import { DelayOptionsPicker } from "@/components/forms/delay-options-picker";
import { SwitchRow } from "@/components/forms/switch-row";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TimePicker } from "@/components/ui/time-picker";
import { DELAY_OPTIONS_MAX, FOOTER_NOTE_MAX } from "@/config/meetings";
import {
  REMINDER_GOING_DEFAULT,
  REMINDER_PENDING_DEFAULT,
  REMINDER_RECHECK_MS,
} from "@/config/reminders";
import { useNow } from "@/hooks/use-now";
import { utcToZonedParts } from "@/lib/meetings/format";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import {
  reminderRows,
  responsesPatch,
  validateResponses,
  type ReminderRow,
  type ResponsesErrors,
  type ResponsesValues,
} from "./responses-form";
import { StepSaveError } from "./step-save-error";
import { WizardFooter } from "./wizard-footer";
import { stepAfter, stepBefore, type WizardStepProps } from "./wizard-steps";

/**
 * How members answer and the reminders (spec §7.2, §7.6). Editing a sent meeting locks the answer
 * type and the delays, and keeps a deadline that already passed.
 */
export function ResponsesStep({
  meeting,
  saved,
  steps,
  goTo,
  mode,
  saver,
}: WizardStepProps) {
  const t = useTranslations("Wizard");
  const editing = mode === "edit";
  const savedDeadline = editing ? saved.responseDeadline : null;
  const after = stepAfter(steps, "responses");
  const before = stepBefore(steps, "responses");
  const deadline = meeting.responseDeadline
    ? utcToZonedParts(meeting.responseDeadline, meeting.timezone)
    : null;
  const [values, setValues] = useState<ResponsesValues>({
    responseMode: meeting.responseMode,
    delayOptions: meeting.delayOptions,
    reasonRequired: meeting.reasonRequired,
    commentsEnabled: meeting.commentsEnabled,
    footerNote: meeting.footerNote,
    deadlineEnabled: deadline !== null,
    deadlineDate: deadline?.date ?? null,
    deadlineTime: deadline?.time ?? null,
    timezone: meeting.timezone,
    reminderPendingHours: meeting.reminderPendingHours,
    reminderGoingHours: meeting.reminderGoingHours,
  });
  const [errors, setErrors] = useState<ResponsesErrors>({});
  const set = <K extends keyof ResponsesValues>(
    key: K,
    value: ResponsesValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  // Reminder times follow the meeting's time and the clock (#403): re-checked every minute here,
  // and again at the moment of saving.
  const now = useNow(REMINDER_RECHECK_MS);
  const rowsAt = (at: Date) =>
    reminderRows(values, meeting.startsAt, at, editing ? saved : null);
  const rows = rowsAt(now);
  const withReminders = (at: Date): ResponsesValues => {
    const { pending, going } = rowsAt(at);
    return {
      ...values,
      reminderPendingHours: pending.value,
      reminderGoingHours: going.value,
    };
  };
  const problems = (at: Date) =>
    validateResponses(withReminders(at), meeting.startsAt, at, savedDeadline);
  const next = () => {
    const at = new Date();
    const found = problems(at);
    setErrors(found);
    if (Object.keys(found).length === 0 && after) {
      saver.save(responsesPatch(withReminders(at)), () => goTo(after));
    }
  };
  const back = () => {
    const at = new Date();
    if (Object.keys(problems(at)).length === 0) {
      saver.save(responsesPatch(withReminders(at)));
    }
    if (before) {
      goTo(before);
    }
  };
  const reminderNote = (row: ReminderRow) => {
    if (row.locked) {
      return t("responses.reminderPassed");
    }
    if (row.tooClose) {
      return row.fromDeadline
        ? t("responses.reminderTooCloseDeadline")
        : t("responses.reminderTooCloseStart");
    }
    return row.replaced !== null && row.value !== null
      ? t("responses.reminderReplaced", { from: row.replaced, to: row.value })
      : undefined;
  };
  const today = utcToZonedParts(
    new Date().toISOString(),
    meeting.timezone,
  ).date;
  const meetingDay = meeting.startsAt
    ? utcToZonedParts(meeting.startsAt, meeting.timezone).date
    : undefined;
  const answers = values.responseMode !== "announcement";
  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl
        label={t("responses.mode")}
        disabled={editing}
        value={values.responseMode}
        onValueChange={(mode) =>
          set("responseMode", responseModeSchema.parse(mode))
        }
        options={[
          { value: "announcement", label: t("responses.announcement") },
          { value: "rsvp", label: t("responses.rsvp") },
          { value: "attendance", label: t("responses.attendance") },
        ]}
      />
      {editing ? (
        <p className="text-sm text-muted-ink">{t("responses.locked")}</p>
      ) : null}
      {!answers ? (
        <p className="text-muted-ink">{t("responses.announcementHint")}</p>
      ) : null}
      {values.responseMode === "attendance" ? (
        <DelayOptionsPicker
          id="delays"
          legend={t("responses.delays")}
          durationMinutes={meeting.durationMinutes}
          value={values.delayOptions}
          onChange={(next) => set("delayOptions", next)}
          disabled={editing}
          hint={t("responses.delaysHint", { max: DELAY_OPTIONS_MAX })}
          error={
            errors.delayOptions ? t(`errors.${errors.delayOptions}`) : undefined
          }
        />
      ) : null}
      {answers ? (
        <>
          <SwitchRow
            id="reason-required"
            label={
              values.responseMode === "rsvp"
                ? t("responses.reasonRequiredRsvp")
                : t("responses.reasonRequired")
            }
            checked={values.reasonRequired}
            onChange={(value) => set("reasonRequired", value)}
          />
          <SwitchRow
            id="comments-enabled"
            label={t("responses.comments")}
            checked={values.commentsEnabled}
            onChange={(value) => set("commentsEnabled", value)}
          />
          <Input
            id="footer-note"
            label={t("responses.footerNote")}
            maxLength={FOOTER_NOTE_MAX}
            value={values.footerNote}
            onChange={(event) => set("footerNote", event.target.value)}
          />
          <SwitchRow
            id="deadline-enabled"
            label={t("responses.deadline")}
            checked={values.deadlineEnabled}
            onChange={(value) => set("deadlineEnabled", value)}
          />
          {values.deadlineEnabled ? (
            <div className="grid grid-cols-2 gap-3">
              <DatePicker
                id="deadline-date"
                label={t("responses.deadlineDate")}
                value={values.deadlineDate}
                today={today}
                min={today}
                max={meetingDay}
                onChange={(date) => set("deadlineDate", date)}
                error={
                  errors.deadlineDate
                    ? t(`errors.${errors.deadlineDate}`)
                    : undefined
                }
              />
              <TimePicker
                id="deadline-time"
                label={t("responses.deadlineTime")}
                value={values.deadlineTime}
                onChange={(time) => set("deadlineTime", time)}
                error={
                  errors.deadlineTime
                    ? t(`errors.${errors.deadlineTime}`)
                    : undefined
                }
              />
            </div>
          ) : null}
          <ReminderChoice
            id="reminder-pending"
            label={t("responses.remindPending")}
            hint={t("responses.remindPendingHint")}
            value={rows.pending.value}
            choices={rows.pending.choices}
            fallback={REMINDER_PENDING_DEFAULT}
            onChange={(value) => set("reminderPendingHours", value)}
            disabled={rows.pending.tooClose || rows.pending.locked}
            note={reminderNote(rows.pending)}
          />
          <ReminderChoice
            id="reminder-going"
            label={t("responses.remindGoing")}
            hint={t("responses.remindGoingHint")}
            value={rows.going.value}
            choices={rows.going.choices}
            fallback={REMINDER_GOING_DEFAULT}
            onChange={(value) => set("reminderGoingHours", value)}
            disabled={rows.going.tooClose || rows.going.locked}
            note={reminderNote(rows.going)}
          />
        </>
      ) : null}
      <StepSaveError error={saver.error} />
      <WizardFooter
        backLabel={t("back")}
        onBack={back}
        nextLabel={after ? t(`next.${after}`) : ""}
        onNext={next}
        pending={saver.pending}
      />
    </div>
  );
}
