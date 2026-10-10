"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ReminderChoice } from "@/components/forms/reminder-choice";
import { SwitchRow } from "@/components/forms/switch-row";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DELAY_OPTION_CHOICES,
  DELAY_OPTIONS_MAX,
  DURATION_CHOICES,
  FOOTER_NOTE_MAX,
  LOCATION_MAX,
  MEETING_URL_MAX,
} from "@/config/meetings";
import {
  REMINDER_GOING_CHOICES,
  REMINDER_GOING_DEFAULT,
  REMINDER_PENDING_CHOICES,
  REMINDER_PENDING_DEFAULT,
} from "@/config/reminders";
import {
  useMeetingDefaults,
  useUpdateMeetingDefaults,
} from "@/hooks/use-meeting-defaults";
import { durationText } from "@/lib/meetings/format";
import {
  type MeetingDefaults,
  responseModeSchema,
  type UpdateMeetingDefaultsBody,
  meetingUrlSchema,
} from "@/shared/api/meeting-settings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { SettingsSection } from "./settings-section";

/** Settings > Meeting defaults (spec §7.2): each change saves at once; Viewers read only. */
export function MeetingDefaultsSection({
  workspace,
  defaultOpen = true,
}: {
  workspace: WorkspaceDetails;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("Settings.defaults");
  const tw = useTranslations("Wizard");
  const tErrors = useTranslations("ApiErrors");
  const defaults = useMeetingDefaults(workspace.slug);
  const update = useUpdateMeetingDefaults(workspace.slug);
  const [footer, setFooter] = useState<string | null>(null);
  const [onlineText, setOnlineText] = useState<string | null>(null);
  const [onlineLink, setOnlineLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  if (!defaults.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  const value: MeetingDefaults = defaults.data;
  const readOnly = workspace.myRole === "viewer";
  const save = (patch: UpdateMeetingDefaultsBody) =>
    update.mutate(patch, { onError: () => toast.error(tErrors("internal")) });
  const minutes = (total: number) =>
    durationText(total, {
      minutes: (count) => tw("details.minutes", { count }),
      hours: (hours) => tw("details.hours", { hours }),
      hoursMinutes: (hours, rest) =>
        tw("details.hoursMinutes", { hours, minutes: rest }),
    });
  const toggleDelay = (delay: number) => {
    const next = value.delayOptions.includes(delay)
      ? value.delayOptions.filter((d) => d !== delay)
      : value.delayOptions.length < DELAY_OPTIONS_MAX
        ? [...value.delayOptions, delay].sort((a, b) => a - b)
        : value.delayOptions;
    if (next !== value.delayOptions) {
      save({ delayOptions: next });
    }
  };
  if (readOnly) {
    return (
      <SettingsSection
        id="meeting-defaults"
        title={t("title")}
        defaultOpen={defaultOpen}
        className="gap-2"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-bold">{tw("responses.mode")}</dt>
          <dd>{tw(`review.mode.${value.responseMode}`)}</dd>
          <dt className="font-bold">{t("duration")}</dt>
          <dd>{minutes(value.durationMinutes)}</dd>
          <dt className="font-bold">{t("reminders")}</dt>
          <dd>
            {t("remindersValue", {
              pending: t("remindPendingValue", {
                hours: String(value.reminderPendingHours ?? "off"),
              }),
              going: t("remindGoingValue", {
                hours: String(value.reminderGoingHours ?? "off"),
              }),
            })}
          </dd>
        </dl>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection
      id="meeting-defaults"
      title={t("title")}
      defaultOpen={defaultOpen}
    >
      <p className="text-sm text-muted-ink">{t("help")}</p>
      <SegmentedControl
        label={tw("responses.mode")}
        value={value.responseMode}
        onValueChange={(mode) =>
          save({ responseMode: responseModeSchema.parse(mode) })
        }
        options={[
          { value: "announcement", label: tw("responses.announcement") },
          { value: "rsvp", label: tw("responses.rsvp") },
          { value: "attendance", label: tw("responses.attendance") },
        ]}
      />
      {value.responseMode === "attendance" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-bold">
            {tw("responses.delays")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {DELAY_OPTION_CHOICES.map((delay) => (
              <Chip
                key={delay}
                pressed={value.delayOptions.includes(delay)}
                onPressedChange={() => toggleDelay(delay)}
              >
                {tw("details.minutes", { count: delay })}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}
      {value.responseMode !== "announcement" ? (
        <>
          <SwitchRow
            id="default-reason"
            label={tw("responses.reasonRequired")}
            checked={value.reasonRequired}
            onChange={(checked) => save({ reasonRequired: checked })}
          />
          <SwitchRow
            id="default-comments"
            label={tw("responses.comments")}
            checked={value.commentsEnabled}
            onChange={(checked) => save({ commentsEnabled: checked })}
          />
          <Input
            id="default-footer"
            label={tw("responses.footerNote")}
            maxLength={FOOTER_NOTE_MAX}
            value={footer ?? value.footerNote}
            onChange={(event) => setFooter(event.target.value)}
            onBlur={() => {
              if (footer !== null && footer.trim() !== value.footerNote) {
                save({ footerNote: footer.trim() });
              }
              setFooter(null);
            }}
          />
          <ReminderChoice
            id="default-reminder-pending"
            label={tw("responses.remindPending")}
            hint={tw("responses.remindPendingHint")}
            value={value.reminderPendingHours}
            choices={REMINDER_PENDING_CHOICES}
            fallback={REMINDER_PENDING_DEFAULT}
            onChange={(hours) => save({ reminderPendingHours: hours })}
          />
          <ReminderChoice
            id="default-reminder-going"
            label={tw("responses.remindGoing")}
            hint={tw("responses.remindGoingHint")}
            value={value.reminderGoingHours}
            choices={REMINDER_GOING_CHOICES}
            fallback={REMINDER_GOING_DEFAULT}
            onChange={(hours) => save({ reminderGoingHours: hours })}
          />
        </>
      ) : null}
      <Input
        id="default-online-place"
        label={t("onlinePlace")}
        hint={t("onlinePlaceHint")}
        placeholder={tw("details.onlinePlacePlaceholder")}
        maxLength={LOCATION_MAX}
        value={onlineText ?? value.onlineText}
        onChange={(event) => setOnlineText(event.target.value)}
        onBlur={() => {
          if (onlineText !== null && onlineText.trim() !== value.onlineText) {
            save({ onlineText: onlineText.trim() });
          }
          setOnlineText(null);
        }}
      />
      <Input
        id="default-online-link"
        type="url"
        inputMode="url"
        label={t("onlineLink")}
        placeholder={tw("details.linkPlaceholder")}
        maxLength={MEETING_URL_MAX}
        value={onlineLink ?? value.meetingUrl}
        error={linkError ? tw("errors.linkInvalid") : undefined}
        onChange={(event) => {
          setOnlineLink(event.target.value);
          setLinkError(false);
        }}
        onBlur={() => {
          if (onlineLink === null || onlineLink.trim() === value.meetingUrl) {
            setOnlineLink(null);
            return;
          }
          const parsed = meetingUrlSchema.safeParse(onlineLink.trim());
          if (!parsed.success) {
            setLinkError(true);
            return;
          }
          save({ meetingUrl: parsed.data });
          setOnlineLink(null);
        }}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold">{t("duration")}</legend>
        <div className="flex flex-wrap gap-2">
          {DURATION_CHOICES.map((duration) => (
            <Chip
              key={duration}
              pressed={value.durationMinutes === duration}
              onPressedChange={() => save({ durationMinutes: duration })}
            >
              {minutes(duration)}
            </Chip>
          ))}
        </div>
      </fieldset>
    </SettingsSection>
  );
}
