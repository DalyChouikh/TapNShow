"use client";

import { CalendarPlus, DownloadSimple } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { googleCalendarLink } from "@/lib/calendar/google-link";
import { icsDescription, icsLocation } from "@/lib/calendar/ics";
import type { TokenInfo } from "@/shared/api/tokens";

/**
 * For mail that can't add the calendar email's event (S2: iCloud on the web), "Add to Google
 * Calendar" and "Download calendar file" (spec §9 fallback). Opening either writes nothing.
 */
export function CalendarLinks({
  token,
  meeting,
}: {
  token: string;
  meeting: TokenInfo["meeting"];
}) {
  const t = useTranslations("AnswerPage");
  if (!meeting.startsAt) {
    return null;
  }
  const online =
    meeting.locationMode !== "in_person" && meeting.meetingUrl
      ? meeting.meetingUrl
      : "";
  const google = googleCalendarLink({
    title: meeting.title,
    start: new Date(meeting.startsAt),
    durationMinutes: meeting.durationMinutes,
    details: [icsDescription(meeting), online].filter(Boolean).join("\n\n"),
    location: icsLocation(meeting),
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-ink">{t("calendarLinksIntro")}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={google} target="_blank" rel="noopener noreferrer">
            <CalendarPlus weight="bold" aria-hidden />
            {t("addToGoogle")}
          </a>
        </Button>
        <Button asChild>
          <a href={`/api/r/${token}/ics`}>
            <DownloadSimple weight="bold" aria-hidden />
            {t("downloadIcs")}
          </a>
        </Button>
      </div>
    </div>
  );
}
