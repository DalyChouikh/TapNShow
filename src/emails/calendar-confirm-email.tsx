import { render, Text } from "react-email";
import { formatMeetingWhen } from "@/lib/meetings/format";
import type { ResponseMode } from "@/shared/api/meeting-settings";
import { PrimaryLinkButton } from "./answer-buttons";
import { EmailLayout } from "./email-layout";
import {
  bodyStyle as body,
  MeetingFooter,
  MeetingWhenWhere,
  type MeetingEmailMeeting,
} from "./meeting-blocks";
import { getEmailTranslator } from "./translator";

/** One calendar confirmation (spec §9): the add after Going/Late, or the removal after Absent. */
export type CalendarConfirmEmailProps = {
  action: "request" | "cancel";
  workspaceName: string;
  recipientName: string;
  senderEmail: string;
  meeting: MeetingEmailMeeting & { title: string; responseMode: ResponseMode };
  links: { respond: string; unsubscribe: string; report: string };
};

/** The email around the calendar invitation; the `.ics` itself is attached by the MIME builder. */
export function CalendarConfirmEmail({
  action,
  workspaceName,
  recipientName,
  senderEmail,
  meeting,
  links,
}: CalendarConfirmEmailProps) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(meeting);
  const request = action === "request";
  return (
    <EmailLayout
      sticker={workspaceName}
      preview={tr("calendarConfirm.preview", {
        title: meeting.title,
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
      <Text style={body}>
        {tr("calendarConfirm.greeting", { name: recipientName })}
      </Text>
      <Text style={{ ...body, marginTop: "12px" }}>
        {request
          ? tr("calendarConfirm.requestBody", { title: meeting.title })
          : tr("calendarConfirm.cancelBody", { title: meeting.title })}
      </Text>
      {request ? <MeetingWhenWhere meeting={meeting} /> : null}
      {request ? (
        <Text style={{ ...body, fontSize: "14px", marginTop: "16px" }}>
          {tr("calendarConfirm.notYet")}
        </Text>
      ) : null}
      {meeting.responseMode !== "announcement" ? (
        <PrimaryLinkButton
          href={links.respond}
          label={tr("calendarConfirm.change")}
        />
      ) : null}
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one calendar confirmation. */
export async function renderCalendarConfirmEmail(
  props: CalendarConfirmEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(props.meeting);
  const element = <CalendarConfirmEmail {...props} />;
  const values = {
    title: props.meeting.title,
    date: when.date,
    time: when.start,
  };
  return {
    subject:
      props.action === "request"
        ? tr("calendarConfirm.subjectRequest", values)
        : tr("calendarConfirm.subjectCancel", values),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
