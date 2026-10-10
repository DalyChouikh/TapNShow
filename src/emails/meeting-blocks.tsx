import { Link, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { formatDeadline, formatMeetingWhen } from "@/lib/meetings/format";
import { meetingPlatform } from "@/lib/meetings/platform";
import type { LocationMode } from "@/shared/api/meeting-settings";
import { emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

const SAFE_URL = /^https?:\/\//i;

/** Small uppercase label above a block (When, Where, Agenda). */
export const labelStyle = {
  fontSize: "13px",
  fontWeight: 700,
  margin: "16px 0 4px",
  textTransform: "uppercase" as const,
};

/** Body text of meeting emails. */
export const bodyStyle = { fontSize: "16px", lineHeight: "24px", margin: 0 };

/** The meeting fields both meeting emails show. */
export type MeetingEmailMeeting = {
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  locationMode: LocationMode;
  locationText: string;
  onlineText: string;
  meetingUrl: string;
};

/**
 * The answer deadline in words while it is still ahead of `now`, else null: an invite sent after
 * the deadline (Invite more, #220) or a late reminder doesn't ask for a past date.
 */
export function upcomingDeadline(
  meeting: { responseDeadline: string | null; timezone: string },
  now: Date = new Date(),
): string | null {
  return meeting.responseDeadline && new Date(meeting.responseDeadline) > now
    ? formatDeadline(meeting.responseDeadline, meeting.timezone)
    : null;
}

/** When (in the meeting's zone, zone named) and Where (place, online words, platform-named Join). */
export function MeetingWhenWhere({
  meeting,
}: {
  meeting: MeetingEmailMeeting;
}) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(meeting);
  const showPlace =
    meeting.locationMode !== "online" && meeting.locationText !== "";
  const showOnline =
    meeting.locationMode !== "in_person" && meeting.onlineText !== "";
  const showLink =
    meeting.locationMode !== "in_person" && SAFE_URL.test(meeting.meetingUrl);
  const platform = showLink ? meetingPlatform(meeting.meetingUrl) : null;
  return (
    <>
      <Text style={labelStyle}>{tr("meetingInvite.when")}</Text>
      <Text style={{ ...bodyStyle, fontWeight: 700 }}>
        {tr("meetingInvite.whenValue", {
          date: when.date,
          start: when.start,
          end: when.end,
          zone: when.zone,
        })}
      </Text>
      {showPlace || showOnline || showLink ? (
        <Text style={labelStyle}>{tr("meetingInvite.where")}</Text>
      ) : null}
      {showPlace ? <Text style={bodyStyle}>{meeting.locationText}</Text> : null}
      {showOnline ? <Text style={bodyStyle}>{meeting.onlineText}</Text> : null}
      {showLink ? (
        <Text style={bodyStyle}>
          <Link
            href={meeting.meetingUrl}
            style={{ color: t.ink, fontWeight: 700 }}
          >
            {platform
              ? tr("meetingInvite.joinOn", { platform })
              : tr("meetingInvite.joinOnline")}
          </Link>
        </Text>
      ) : null}
    </>
  );
}

/**
 * "Sent from … with TapNShow", "Unsubscribe from <Workspace>", "Not my group" (spec §7.16). Someone
 * who already unsubscribed gets no unsubscribe link.
 */
export function MeetingFooter({
  workspaceName,
  senderEmail,
  links,
  unsubscribed = false,
}: {
  workspaceName: string;
  senderEmail: string;
  links: { unsubscribe: string; report: string };
  unsubscribed?: boolean;
}) {
  const tr = getEmailTranslator();
  return (
    <>
      {tr("meetingInvite.sentFrom", { email: senderEmail, appName: APP_NAME })}{" "}
      {unsubscribed ? null : (
        <>
          <Link
            href={links.unsubscribe}
            style={{ color: t.muted, textDecoration: "underline" }}
          >
            {tr("meetingInvite.unsubscribe", { workspace: workspaceName })}
          </Link>
          {" · "}
        </>
      )}
      <Link
        href={links.report}
        style={{ color: t.muted, textDecoration: "underline" }}
      >
        {tr("meetingInvite.report")}
      </Link>
    </>
  );
}
