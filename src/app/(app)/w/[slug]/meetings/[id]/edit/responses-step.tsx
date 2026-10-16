"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReminderChoice } from "@/components/forms/reminder-choice";
import { SwitchRow } from "@/components/forms/switch-row";
import { Chip } from "@/components/ui/chip";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TimePicker } from "@/components/ui/time-picker";
import {
  DELAY_OPTION_CHOICES,
  DELAY_OPTIONS_MAX,
  FOOTER_NOTE_MAX,
} from "@/config/meetings";
import {
  REMINDER_GOING_CHOICES,
  REMINDER_GOING_DEFAULT,
  REMINDER_PENDING_CHOICES,
  REMINDER_PENDING_DEFAULT,
} from "@/config/reminders";
import { utcToZonedParts } from "@/lib/meetings/format";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import {
  responsesPatch,
  validateResponses,
  type ResponsesErrors,
  type ResponsesValues,
} from "./responses-form";
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
  const toggleDelay = (minutes: number) =>
    set(
      "delayOptions",
      values.delayOptions.includes(minutes)
        ? values.delayOptions.filter((value) => value !== minutes)
        : values.delayOptions.length < DELAY_OPTIONS_MAX
          ? [...values.delayOptions, minutes].sort((a, b) => a - b)
          : values.delayOptions,
    );
  const problems = () =>
    validateResponses(values, meeting.startsAt, new Date(), savedDeadline);
  const next = () => {
    const found = problems();
    setErrors(found);
    if (Object.keys(found).length === 0 && after) {
      saver.save(responsesPatch(values), () => goTo(after));
    }
  };
  const back = () => {
    if (Object.keys(problems()).length === 0) {
      saver.save(responsesPatch(values));
    }
    if (before) {
      goTo(before);
    }
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
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby="delays-hint"
        >
          <legend className="text-sm font-bold">{t("responses.delays")}</legend>
          <div className="flex flex-wrap gap-2">
            {DELAY_OPTION_CHOICES.map((minutes) => (
              <Chip
                key={minutes}
                disabled={editing}
                pressed={values.delayOptions.includes(minutes)}
                onPressedChange={() => toggleDelay(minutes)}
              >
                {t("details.minutes", { count: minutes })}
              </Chip>
            ))}
          </div>
          <p id="delays-hint" className="text-sm text-muted-ink">
            {errors.delayOptions ? (
              <strong className="text-ink">
                {t(`errors.${errors.delayOptions}`)}
              </strong>
            ) : (
              t("responses.delaysHint", { max: DELAY_OPTIONS_MAX })
            )}
          </p>
        </fieldset>
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
            value={values.reminderPendingHours}
            choices={REMINDER_PENDING_CHOICES}
            fallback={REMINDER_PENDING_DEFAULT}
            onChange={(value) => set("reminderPendingHours", value)}
          />
          <ReminderChoice
            id="reminder-going"
            label={t("responses.remindGoing")}
            hint={t("responses.remindGoingHint")}
            value={values.reminderGoingHours}
            choices={REMINDER_GOING_CHOICES}
            fallback={REMINDER_GOING_DEFAULT}
            onChange={(value) => set("reminderGoingHours", value)}
          />
        </>
      ) : null}
      {saver.failed ? (
        <p role="alert" className="font-bold">
          {t("errors.saveFailed")}
        </p>
      ) : null}
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
