"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Chip } from "@/components/ui/chip";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimezonePicker } from "@/components/forms/timezone-picker";
import {
  AGENDA_MAX,
  DURATION_CHOICES,
  LOCATION_MAX,
  TITLE_MAX,
} from "@/config/meetings";
import { useUpdateMeeting } from "@/hooks/use-meetings";
import { utcToZonedParts } from "@/lib/meetings/format";
import { locationModeSchema } from "@/shared/api/meeting-settings";
import {
  detailsPatch,
  validateDetails,
  type DetailsErrors,
  type DetailsValues,
} from "./details-form";
import { WizardFooter } from "./wizard-footer";
import type { WizardStepProps } from "./wizard-steps";

/** Step 1: title, when, duration, where, agenda (spec §7.2). */
export function DetailsStep({ slug, meeting, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const update = useUpdateMeeting(slug, meeting.id);
  const parts = meeting.startsAt
    ? utcToZonedParts(meeting.startsAt, meeting.timezone)
    : null;
  const [values, setValues] = useState<DetailsValues>({
    title: meeting.title,
    date: parts?.date ?? null,
    time: parts?.time ?? null,
    timezone: meeting.timezone,
    durationMinutes: meeting.durationMinutes,
    locationMode: meeting.locationMode,
    locationText: meeting.locationText,
    meetingUrl: meeting.meetingUrl,
    agendaMd: meeting.agendaMd,
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [customDuration, setCustomDuration] = useState(
    !DURATION_CHOICES.some((d) => d === meeting.durationMinutes),
  );
  const set = <K extends keyof DetailsValues>(
    key: K,
    value: DetailsValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const saveQuietly = () => update.mutate(detailsPatch(values));
  const next = () => {
    const found = validateDetails(values, new Date());
    setErrors(found);
    if (Object.keys(found).length === 0) {
      update.mutate(detailsPatch(values), {
        onSuccess: () => goTo("audience"),
      });
    }
  };
  const today = utcToZonedParts(new Date().toISOString(), values.timezone).date;
  const error = (key: keyof DetailsErrors) =>
    errors[key] ? t(`errors.${errors[key]}`) : undefined;
  const hoursLabel = (minutes: number) =>
    minutes < 60
      ? t("details.minutes", { count: minutes })
      : minutes % 60 === 0
        ? t("details.hours", { hours: minutes / 60 })
        : t("details.hoursMinutes", {
            hours: Math.floor(minutes / 60),
            minutes: minutes % 60,
          });
  return (
    <div className="flex flex-col gap-5">
      <Input
        id="meeting-title"
        label={t("details.title")}
        placeholder={t("details.titlePlaceholder")}
        maxLength={TITLE_MAX}
        value={values.title}
        error={error("title")}
        onChange={(event) => set("title", event.target.value)}
        onBlur={saveQuietly}
      />
      <div className="grid grid-cols-2 gap-3">
        <DatePicker
          id="meeting-date"
          label={t("details.date")}
          value={values.date}
          today={today}
          min={today}
          error={error("date")}
          onChange={(date) => set("date", date)}
        />
        <TimePicker
          id="meeting-time"
          label={t("details.time")}
          value={values.time}
          error={error("time")}
          onChange={(time) => set("time", time)}
        />
      </div>
      <Popover>
        <p className="flex items-center gap-2 text-sm text-muted-ink">
          {t("details.zone", { zone: values.timezone })}
          <PopoverTrigger className="min-h-11 font-bold text-ink underline">
            {t("details.changeZone")}
          </PopoverTrigger>
        </p>
        <PopoverContent className="w-80 p-1.5">
          <TimezonePicker
            id="meeting-zone"
            label={t("details.zoneLabel")}
            value={values.timezone}
            onChange={(zone) => set("timezone", zone)}
          />
        </PopoverContent>
      </Popover>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold">{t("details.duration")}</legend>
        <div className="flex flex-wrap gap-2">
          {DURATION_CHOICES.map((minutes) => (
            <Chip
              key={minutes}
              pressed={!customDuration && values.durationMinutes === minutes}
              onPressedChange={() => {
                setCustomDuration(false);
                set("durationMinutes", minutes);
              }}
            >
              {hoursLabel(minutes)}
            </Chip>
          ))}
          <Chip
            pressed={customDuration}
            onPressedChange={() => setCustomDuration(true)}
          >
            {t("details.durationOther")}
          </Chip>
        </div>
        {customDuration ? (
          <Input
            id="meeting-duration"
            label={t("details.durationMinutes")}
            inputMode="numeric"
            value={String(values.durationMinutes)}
            error={error("durationMinutes")}
            onChange={(event) =>
              set(
                "durationMinutes",
                Number.parseInt(
                  event.target.value.replace(/\D/g, "") || "0",
                  10,
                ),
              )
            }
          />
        ) : null}
      </fieldset>
      <SegmentedControl
        label={t("details.where")}
        value={values.locationMode}
        onValueChange={(mode) =>
          set("locationMode", locationModeSchema.parse(mode))
        }
        options={[
          { value: "in_person", label: t("details.inPerson") },
          { value: "online", label: t("details.online") },
          { value: "hybrid", label: t("details.hybrid") },
        ]}
      />
      {values.locationMode !== "online" ? (
        <Input
          id="meeting-place"
          label={t("details.place")}
          placeholder={t("details.placePlaceholder")}
          maxLength={LOCATION_MAX}
          value={values.locationText}
          error={error("locationText")}
          onChange={(event) => set("locationText", event.target.value)}
          onBlur={saveQuietly}
        />
      ) : null}
      {values.locationMode !== "in_person" ? (
        <Input
          id="meeting-link"
          type="url"
          inputMode="url"
          label={t("details.link")}
          placeholder={t("details.linkPlaceholder")}
          value={values.meetingUrl}
          error={error("meetingUrl")}
          onChange={(event) => set("meetingUrl", event.target.value)}
          onBlur={saveQuietly}
        />
      ) : null}
      <MarkdownEditor
        id="meeting-agenda"
        label={t("details.agenda")}
        hint={t("details.agendaHint")}
        maxLength={AGENDA_MAX}
        value={values.agendaMd}
        onChange={(agenda) => set("agendaMd", agenda)}
        onBlur={saveQuietly}
      />
      {update.isError ? (
        <p role="alert" className="font-bold">
          {t("errors.saveFailed")}
        </p>
      ) : null}
      <WizardFooter
        backLabel={t("cancel")}
        onBack={() => {
          saveQuietly();
          history.back();
        }}
        nextLabel={t("next.audience")}
        onNext={next}
        pending={update.isPending}
      />
    </div>
  );
}
