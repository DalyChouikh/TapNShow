"use client";

import { ArrowSquareOut, Globe, MapPin } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { browserTimezone } from "@/lib/timezones";
import type { Meeting } from "@/shared/api/meetings";
import { meetingPlatform } from "@/lib/meetings/platform";

/** Title, when (with the viewer's own time if their zone differs) and where (spec §7.10). */
export function MeetingHeader({ meeting }: { meeting: Meeting }) {
  const t = useTranslations("MeetingPage");
  const platform = meetingPlatform(meeting.meetingUrl);
  const when = meeting.startsAt
    ? formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt })
    : null;
  const viewerZone = browserTimezone();
  const local =
    meeting.startsAt && viewerZone !== meeting.timezone
      ? formatMeetingWhen({
          ...meeting,
          startsAt: meeting.startsAt,
          timezone: viewerZone,
        })
      : null;
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-display text-3xl break-words">{meeting.title}</h1>
      {when ? (
        <p className="font-bold">
          {when.date}, {when.start}–{when.end} ({when.zone})
          {local ? (
            <span className="block text-sm font-normal text-muted-ink">
              ({t("yourTime", { time: `${local.date}, ${local.start}` })})
            </span>
          ) : null}
        </p>
      ) : null}
      {meeting.locationMode !== "online" && meeting.locationText ? (
        <p className="flex items-center gap-1 break-words">
          <MapPin weight="bold" aria-hidden className="shrink-0" />
          {meeting.locationText}
        </p>
      ) : null}
      {meeting.locationMode !== "in_person" && meeting.onlineText ? (
        <p className="flex items-center gap-1 break-words">
          <Globe weight="bold" aria-hidden className="shrink-0" />
          {meeting.onlineText}
        </p>
      ) : null}
      {meeting.locationMode !== "in_person" && meeting.meetingUrl ? (
        <a
          href={meeting.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-1 font-bold break-all underline"
        >
          <ArrowSquareOut weight="bold" aria-hidden className="shrink-0" />
          {platform ? t("joinOn", { platform }) : t("openLink")}
        </a>
      ) : null}
    </header>
  );
}
