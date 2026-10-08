"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { useUpdateMeeting } from "@/hooks/use-meetings";
import { utcToZonedParts } from "@/lib/meetings/format";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import {
  responsesPatch,
  validateResponses,
  type ResponsesErrors,
  type ResponsesValues,
} from "./responses-form";
import { WizardFooter } from "./wizard-footer";
import type { WizardStepProps } from "./wizard-steps";

/** Step 3: how members answer (spec §7.2; reminders arrive in M6). */
export function ResponsesStep({ slug, meeting, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const update = useUpdateMeeting(slug, meeting.id);
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
  const next = () => {
    const found = validateResponses(values, meeting.startsAt, new Date());
    setErrors(found);
    if (Object.keys(found).length === 0) {
      update.mutate(responsesPatch(values), {
        onSuccess: () => goTo("review"),
      });
    }
  };
  const back = () => {
    if (
      Object.keys(validateResponses(values, meeting.startsAt, new Date()))
        .length === 0
    ) {
      update.mutate(responsesPatch(values));
    }
    goTo("audience");
  };
  const today = utcToZonedParts(
    new Date().toISOString(),
    meeting.timezone,
  ).date;
  const answers = values.responseMode !== "announcement";
  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl
        label={t("responses.mode")}
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
                onChange={(date) => set("deadlineDate", date)}
                error={
                  errors.deadline ? t(`errors.${errors.deadline}`) : undefined
                }
              />
              <TimePicker
                id="deadline-time"
                label={t("responses.deadlineTime")}
                value={values.deadlineTime}
                onChange={(time) => set("deadlineTime", time)}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {update.isError ? (
        <p role="alert" className="font-bold">
          {t("errors.saveFailed")}
        </p>
      ) : null}
      <WizardFooter
        backLabel={t("back")}
        onBack={back}
        nextLabel={t("next.review")}
        onNext={next}
        pending={update.isPending}
      />
    </div>
  );
}
