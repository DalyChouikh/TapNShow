"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SwitchRow } from "@/components/forms/switch-row";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DELAY_OPTION_CHOICES,
  DELAY_OPTIONS_MAX,
  DURATION_CHOICES,
  FOOTER_NOTE_MAX,
} from "@/config/meetings";
import {
  useMeetingDefaults,
  useUpdateMeetingDefaults,
} from "@/hooks/use-meeting-defaults";
import {
  type MeetingDefaults,
  responseModeSchema,
  type UpdateMeetingDefaultsBody,
} from "@/shared/api/meeting-settings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Settings > Meeting defaults (spec §7.2): each change saves at once; Viewers read only. */
export function MeetingDefaultsSection({
  workspace,
}: {
  workspace: WorkspaceDetails;
}) {
  const t = useTranslations("Settings.defaults");
  const tw = useTranslations("Wizard");
  const tErrors = useTranslations("ApiErrors");
  const defaults = useMeetingDefaults(workspace.slug);
  const update = useUpdateMeetingDefaults(workspace.slug);
  const [footer, setFooter] = useState<string | null>(null);
  if (!defaults.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  const value: MeetingDefaults = defaults.data;
  const readOnly = workspace.myRole === "viewer";
  const save = (patch: UpdateMeetingDefaultsBody) =>
    update.mutate(patch, { onError: () => toast.error(tErrors("internal")) });
  const minutes = (count: number) =>
    count < 60
      ? tw("details.minutes", { count })
      : count % 60 === 0
        ? tw("details.hours", { hours: count / 60 })
        : tw("details.hoursMinutes", {
            hours: Math.floor(count / 60),
            minutes: count % 60,
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
      <Card as="section" className="flex flex-col gap-2">
        <h2 className="font-display text-xl">{t("title")}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-bold">{tw("responses.mode")}</dt>
          <dd>{tw(`review.mode.${value.responseMode}`)}</dd>
          <dt className="font-bold">{t("duration")}</dt>
          <dd>{minutes(value.durationMinutes)}</dd>
        </dl>
      </Card>
    );
  }
  return (
    <Card as="section" className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-xl">{t("title")}</h2>
        <p className="text-sm text-muted-ink">{t("help")}</p>
      </div>
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
        </>
      ) : null}
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
    </Card>
  );
}
