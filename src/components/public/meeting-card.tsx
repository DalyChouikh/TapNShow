"use client";

import { ArrowSquareOut, CalendarDots, MapPin } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { formatMeetingWhen } from "@/lib/meetings/format";
import type { TokenInfo } from "@/shared/api/tokens";

/** The meeting basics on a public page: title, when (in its own zone), where. */
export function MeetingCard({ meeting }: { meeting: TokenInfo["meeting"] }) {
  const t = useTranslations("TokenPages");
  const when = meeting.startsAt
    ? formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt })
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
      {meeting.locationMode !== "in_person" && meeting.meetingUrl ? (
        <a
          href={meeting.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2 font-bold underline"
        >
          <ArrowSquareOut weight="bold" aria-hidden className="shrink-0" />
          {t("join")}
        </a>
      ) : null}
    </div>
  );
}
