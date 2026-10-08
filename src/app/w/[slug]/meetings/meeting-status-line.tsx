"use client";

import { useTranslations } from "next-intl";
import type { MeetingSummary } from "@/shared/api/meetings";

/**
 * A card's status: "Draft", "N of M sent" while invites are queued, then the answers
 * ("17 going · 4 late · 6 no reply"; RSVP: "… not going …"); announcements keep the sent count.
 */
export function MeetingStatusLine({ meeting }: { meeting: MeetingSummary }) {
  const t = useTranslations("Meetings");
  const { counts } = meeting;
  if (meeting.status === "draft") {
    return t("draft");
  }
  if (meeting.responseMode === "announcement" || counts.queued > 0) {
    return t("sent", { sent: counts.sent, total: counts.invited });
  }
  return meeting.responseMode === "rsvp"
    ? t("answersRsvp", {
        attending: counts.attending,
        absent: counts.absent,
        noReply: counts.noReply,
      })
    : t("answers", {
        attending: counts.attending,
        late: counts.late,
        noReply: counts.noReply,
      });
}
