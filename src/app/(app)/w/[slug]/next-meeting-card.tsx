"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { useMeetingsPage } from "@/hooks/use-meetings";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { MeetingStatusLine } from "./meetings/meeting-status-line";

/** Home: the next upcoming meeting with its answers (spec §4 Navigation). */
export function NextMeetingCard({ slug }: { slug: string }) {
  const t = useTranslations("WorkspaceHome.nextMeeting");
  const next = useMeetingsPage(slug, "upcoming", 1);
  const meeting = next.items[0];
  if (!meeting?.startsAt) {
    return null;
  }
  const when = formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt });
  return (
    <Card as="section" className="flex flex-col gap-2">
      <h2 className="text-sm font-bold text-muted-ink uppercase">
        {t("title")}
      </h2>
      <Link
        href={`/w/${slug}/meetings/${meeting.id}`}
        className="font-display text-xl break-words underline-offset-4 hover:underline"
      >
        {meeting.title}
      </Link>
      <p className="text-sm">{`${when.date}, ${when.start}–${when.end}`}</p>
      <p className="text-sm font-bold">
        <MeetingStatusLine meeting={meeting} />
      </p>
    </Card>
  );
}
