import { render, Text } from "react-email";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { AnswerButtons, PrimaryLinkButton } from "./answer-buttons";
import { EmailLayout } from "./email-layout";
import {
  bodyStyle as body,
  MeetingFooter,
  MeetingWhenWhere,
  upcomingDeadline,
} from "./meeting-blocks";
import type { MeetingInviteEmailProps } from "./meeting-invite-email";
import { getEmailTranslator } from "./translator";

/** One person's reminder (spec §7.6): `pending` hasn't answered; `going` said Going or Late. */
export type MeetingReminderEmailProps = MeetingInviteEmailProps & {
  audience: "pending" | "going";
};

/** A reminder: answer buttons for people who haven't answered, "See you" for people coming. */
export function MeetingReminderEmail({
  workspaceName,
  senderEmail,
  meeting,
  links,
  audience,
  now,
}: MeetingReminderEmailProps) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(meeting);
  const responseMode = meeting.responseMode;
  const deadline = upcomingDeadline(meeting, now);
  return (
    <EmailLayout
      sticker={workspaceName}
      preview={tr("meetingReminder.preview", { workspace: workspaceName })}
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
        {audience === "going"
          ? tr("meetingReminder.seeYou", { date: when.date, time: when.start })
          : deadline
            ? tr("meetingReminder.answerBy", { deadline })
            : tr("meetingReminder.answer", { workspace: workspaceName })}
      </Text>
      <MeetingWhenWhere meeting={meeting} />
      {responseMode === "announcement" ? null : audience === "pending" ? (
        <AnswerButtons responseMode={responseMode} respondUrl={links.respond} />
      ) : (
        <PrimaryLinkButton
          href={links.respond}
          label={tr("meetingReminder.change")}
        />
      )}
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one reminder. */
export async function renderMeetingReminderEmail(
  props: MeetingReminderEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(props.meeting);
  const values = {
    title: props.meeting.title,
    date: when.date,
    time: when.start,
  };
  const element = <MeetingReminderEmail {...props} />;
  return {
    subject:
      props.audience === "going"
        ? tr("meetingReminder.subjectGoing", values)
        : tr("meetingReminder.subjectPending", values),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
