"use client";

import { TZDate } from "@date-fns/tz";
import {
  ArrowSquareOut,
  CalendarDots,
  CaretDown,
  Globe,
  MapPin,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { renderAgendaHtml } from "@/lib/markdown/agenda";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { useIsClient } from "@/lib/use-is-client";
import type { TokenInfo } from "@/shared/api/tokens";
import { meetingPlatform } from "@/lib/meetings/platform";

/**
 * The meeting basics on a public page: title, when (in its own zone, plus the member's own time
 * when their browser is elsewhere, spec §7.10), where, and the agenda folded.
 */
export function MeetingCard({ meeting }: { meeting: TokenInfo["meeting"] }) {
  const t = useTranslations("TokenPages");
  const platform = meetingPlatform(meeting.meetingUrl);
  const when = meeting.startsAt
    ? formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt })
    : null;
  const [agendaOpen, setAgendaOpen] = useState(false);
  // Read only after hydration so the server HTML and the first client render match.
  const browserZone = useIsClient()
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : null;
  const yourTime =
    meeting.startsAt && browserZone && browserZone !== meeting.timezone
      ? format(new TZDate(meeting.startsAt, browserZone), "EEE d MMM, HH:mm")
      : null;
  return (
    <div className="flex flex-col gap-2 rounded-control border-[length:var(--tn-border-width)] border-outline p-3">
      <h2 className="font-display text-xl break-words">{meeting.title}</h2>
      {meeting.status === "cancelled" ? (
        <p className="font-bold">{t("cancelled")}</p>
      ) : null}
      {when ? (
        <p className="flex items-start gap-2">
          <CalendarDots weight="bold" aria-hidden className="mt-1 shrink-0" />
          <span>
            <span className="sr-only">{t("when")}: </span>
            {`${when.date}, ${when.start}–${when.end} (${when.zone})`}
            {yourTime ? (
              <span className="block text-sm text-muted-ink">
                {t("yourTime", { time: yourTime })}
              </span>
            ) : null}
          </span>
        </p>
      ) : null}
      {meeting.locationMode !== "online" && meeting.locationText ? (
        <p className="flex items-start gap-2 break-words">
          <MapPin weight="bold" aria-hidden className="mt-1 shrink-0" />
          <span>
            <span className="sr-only">{t("where")}: </span>
            {meeting.locationText}
          </span>
        </p>
      ) : null}
      {meeting.locationMode !== "in_person" && meeting.onlineText ? (
        <p className="flex items-start gap-2 break-words">
          <Globe weight="bold" aria-hidden className="mt-1 shrink-0" />
          <span>
            <span className="sr-only">{t("where")}: </span>
            {meeting.onlineText}
          </span>
        </p>
      ) : null}
      {meeting.locationMode !== "in_person" && meeting.meetingUrl ? (
        <a
          href={meeting.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2 font-bold underline"
        >
          <ArrowSquareOut weight="bold" aria-hidden className="shrink-0" />
          {platform ? t("joinOn", { platform }) : t("join")}
        </a>
      ) : null}
      {meeting.agendaMd ? (
        <>
          <Button
            className="w-full"
            aria-expanded={agendaOpen}
            aria-controls="meeting-agenda"
            onClick={() => setAgendaOpen((open) => !open)}
          >
            {agendaOpen ? t("hideAgenda") : t("showAgenda")}
            <CaretDown
              weight="bold"
              aria-hidden
              className={agendaOpen ? "rotate-180" : undefined}
            />
          </Button>
          {agendaOpen ? (
            // renderAgendaHtml escapes raw HTML and keeps only http(s)/mailto links, so this is safe.
            <div
              id="meeting-agenda"
              className="agenda-preview text-sm break-words"
              dangerouslySetInnerHTML={{
                __html: renderAgendaHtml(meeting.agendaMd),
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
