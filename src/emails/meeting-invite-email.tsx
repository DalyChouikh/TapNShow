import { render, Text } from "react-email";
import { renderAgendaHtml } from "@/lib/markdown/agenda";
import { formatMeetingWhen, meetingSubject } from "@/lib/meetings/format";
import type { LocationMode, ResponseMode } from "@/shared/api/meeting-settings";
import { AnswerButtons, PrimaryLinkButton } from "./answer-buttons";
import { EmailLayout } from "./email-layout";
import {
  bodyStyle as body,
  labelStyle as label,
  MeetingFooter,
  MeetingWhenWhere,
  upcomingDeadline,
} from "./meeting-blocks";
import { emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** Everything one personal invite needs (spec §9 Meeting invite email). */
export type MeetingInviteEmailProps = {
  workspaceName: string;
  recipientName: string;
  senderEmail: string;
  meeting: {
    title: string;
    agendaMd: string;
    startsAt: string;
    durationMinutes: number;
    timezone: string;
    locationMode: LocationMode;
    locationText: string;
    onlineText: string;
    meetingUrl: string;
    responseMode: ResponseMode;
    responseDeadline: string | null;
  };
  links: { respond: string; unsubscribe: string; report: string };
  /** The send time (tests); the deadline line shows only while the deadline is ahead of it. */
  now?: Date;
  /**
   * They unsubscribed after adding the meeting to their calendar: the email only moves or removes
   * the event, so its footer has no unsubscribe link.
   */
  unsubscribed?: boolean;
};

/** One member's invite: meeting card, answer buttons by mode, and per-workspace opt-out links. */
export function MeetingInviteEmail({
  workspaceName,
  recipientName,
  senderEmail,
  meeting,
  links,
  now,
}: MeetingInviteEmailProps) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(meeting);
  const agendaHtml = renderAgendaHtml(meeting.agendaMd);
  const responseMode = meeting.responseMode;
  const deadline = upcomingDeadline(meeting, now);
  return (
    <EmailLayout
      sticker={workspaceName}
      preview={tr("meetingInvite.preview", {
        workspace: workspaceName,
        date: when.date,
        time: when.start,
      })}
      heading={meeting.title}
      footer={
        <MeetingFooter
          workspaceName={workspaceName}
          senderEmail={senderEmail}
          links={links}
        />
      }
    >
      <Text style={{ ...body, color: t.muted, margin: "0 0 12px" }}>
        {tr("meetingInvite.invitedBy", { workspace: workspaceName })}
      </Text>
      <Text style={body}>
        {tr("meetingInvite.greeting", { name: recipientName })}
      </Text>
      <MeetingWhenWhere meeting={meeting} />
      {agendaHtml ? (
        <>
          <Text style={label}>{tr("meetingInvite.agenda")}</Text>
          {/* renderAgendaHtml escapes raw HTML and keeps only http(s)/mailto links, so this is safe. */}
          <div
            style={{ fontSize: "15px", lineHeight: "22px" }}
            dangerouslySetInnerHTML={{ __html: agendaHtml }}
          />
        </>
      ) : null}
      {responseMode === "announcement" ? (
        <>
          <Text style={{ ...body, margin: "20px 0 0" }}>
            {tr("meetingInvite.noAnswer")}
          </Text>
          {/* Opens the page only; the member taps "Email me a calendar invite" there (scanners). */}
          <PrimaryLinkButton
            href={links.respond}
            label={tr("meetingInvite.addToCalendar")}
          />
        </>
      ) : (
        <>
          <AnswerButtons
            responseMode={responseMode}
            respondUrl={links.respond}
          />
          {deadline ? (
            <Text style={{ ...body, fontSize: "14px" }}>
              {tr("meetingInvite.deadline", { deadline })}
            </Text>
          ) : null}
          <Text
            style={{
              ...body,
              color: t.muted,
              fontSize: "13px",
              marginTop: "12px",
            }}
          >
            {tr("meetingInvite.visibility", { workspace: workspaceName })}
          </Text>
        </>
      )}
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one invite. */
export async function renderMeetingInviteEmail(
  props: MeetingInviteEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const element = <MeetingInviteEmail {...props} />;
  return {
    subject: meetingSubject(
      props.meeting.title,
      formatMeetingWhen(props.meeting),
    ),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
