import { Button, render, Section, Text } from "react-email";
import { RESPONSE_CHOICES, type ResponseChoice } from "@/config/meetings";
import { renderAgendaHtml } from "@/lib/markdown/agenda";
import {
  formatDeadline,
  formatMeetingWhen,
  meetingSubject,
} from "@/lib/meetings/format";
import type { LocationMode, ResponseMode } from "@/shared/api/meeting-settings";
import { EmailLayout } from "./email-layout";
import {
  bodyStyle as body,
  labelStyle as label,
  MeetingFooter,
  MeetingWhenWhere,
} from "./meeting-blocks";
import { brutalBox, emailTheme as t } from "./theme";
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
};

const CHOICE_FILL: Record<ResponseChoice, string> = {
  attending: t.success,
  going: t.success,
  late: t.warning,
  absent: t.danger,
  not_going: t.danger,
};

/** One member's invite: meeting card, answer buttons by mode, and per-workspace opt-out links. */
export function MeetingInviteEmail({
  workspaceName,
  recipientName,
  senderEmail,
  meeting,
  links,
}: MeetingInviteEmailProps) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(meeting);
  const agendaHtml = renderAgendaHtml(meeting.agendaMd);
  const choices = RESPONSE_CHOICES[meeting.responseMode];
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
      <Section style={{ margin: "20px 0 8px" }}>
        {choices.length === 0 ? (
          <>
            <Text style={{ ...body, margin: "0 0 12px" }}>
              {tr("meetingInvite.noAnswer")}
            </Text>
            {/* Opens the page only; the member taps "Email me a calendar invite" there (scanners). */}
            <Button
              href={links.respond}
              style={{
                ...brutalBox(t.primary, t.radiusControl),
                color: t.ink,
                display: "inline-block",
                fontFamily: t.fontDisplay,
                fontSize: "15px",
                padding: "12px 18px",
                textDecoration: "none",
              }}
            >
              {tr("meetingInvite.addToCalendar")}
            </Button>
          </>
        ) : (
          choices.map((choice) => (
            <Button
              key={choice}
              href={`${links.respond}?choice=${choice}`}
              style={{
                ...brutalBox(CHOICE_FILL[choice], t.radiusControl),
                color: t.ink,
                display: "inline-block",
                fontFamily: t.fontDisplay,
                fontSize: "15px",
                margin: "0 8px 8px 0",
                padding: "12px 18px",
                textDecoration: "none",
              }}
            >
              {tr(`meetingInvite.choice.${choice}`)}
            </Button>
          ))
        )}
      </Section>
      {choices.length > 0 && meeting.responseDeadline ? (
        <Text style={{ ...body, fontSize: "14px" }}>
          {tr("meetingInvite.deadline", {
            deadline: formatDeadline(
              meeting.responseDeadline,
              meeting.timezone,
            ),
          })}
        </Text>
      ) : null}
      {choices.length > 0 ? (
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
      ) : null}
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
