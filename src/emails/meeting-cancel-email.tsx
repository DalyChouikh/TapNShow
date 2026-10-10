import { render, Text } from "react-email";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { EmailLayout } from "./email-layout";
import { bodyStyle as body, MeetingFooter } from "./meeting-blocks";
import type { MeetingInviteEmailProps } from "./meeting-invite-email";
import { getEmailTranslator } from "./translator";

/** One person's cancellation (spec §4 Cancel and delete). */
export type MeetingCancelEmailProps = MeetingInviteEmailProps & {
  /** The person had the event in their calendar: a `METHOD:CANCEL` part removes it. */
  calendar: boolean;
};

/** "<Workspace> cancelled <title> on <date> at <time>." — no answer buttons. */
export function MeetingCancelEmail({
  workspaceName,
  senderEmail,
  meeting,
  links,
  calendar,
  unsubscribed = false,
}: MeetingCancelEmailProps) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(meeting);
  return (
    <EmailLayout
      sticker={workspaceName}
      preview={tr("meetingCancel.preview", { workspace: workspaceName })}
      heading={meeting.title}
      footer={
        <MeetingFooter
          workspaceName={workspaceName}
          senderEmail={senderEmail}
          links={links}
          unsubscribed={unsubscribed}
        />
      }
    >
      <Text style={body}>
        {tr("meetingCancel.body", {
          workspace: workspaceName,
          title: meeting.title,
          date: when.date,
          time: when.start,
        })}
      </Text>
      {calendar ? (
        <Text style={{ ...body, fontSize: "14px", marginTop: "12px" }}>
          {tr("meetingCancel.calendar")}
        </Text>
      ) : null}
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one cancellation. */
export async function renderMeetingCancelEmail(
  props: MeetingCancelEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(props.meeting);
  const element = <MeetingCancelEmail {...props} />;
  return {
    subject: tr("meetingCancel.subject", {
      title: props.meeting.title,
      date: when.date,
      time: when.start,
    }),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
