import { render, Text } from "react-email";
import {
  type CardText,
  hasMemberChanges,
  markedCard,
} from "@/lib/meetings/changes";
import { formatMeetingWhen } from "@/lib/meetings/format";
import type { ChangeSet } from "@/shared/api/meeting-changes";
import { AnswerButtons, PrimaryLinkButton } from "./answer-buttons";
import { EmailLayout } from "./email-layout";
import { MarkedMeetingCard } from "./marked-meeting-card";
import { bodyStyle as body, MeetingFooter } from "./meeting-blocks";
import type { MeetingInviteEmailProps } from "./meeting-invite-email";
import { getEmailTranslator } from "./translator";

/** One person's update after a sent meeting changed (spec §7.5). */
export type MeetingUpdateEmailProps = Omit<
  MeetingInviteEmailProps,
  "meeting"
> & {
  /** The meeting as it is now (the footer note is member-visible on the answer page). */
  meeting: MeetingInviteEmailProps["meeting"] & { footerNote: string };
  changes: ChangeSet;
  /** false: only the calendar event changes (a short note). */
  notify: boolean;
  /** The time moved: ask again with the answer buttons. */
  reconfirm: boolean;
  /** The email carries a calendar update (`.ics` attached by the MIME builder). */
  calendar: boolean;
};

function cardText(tr: ReturnType<typeof getEmailTranslator>): CardText {
  return { none: tr("changes.none"), joinLink: (url) => url };
}

/** The update email: the marked meeting card, then the answer buttons or "Change my answer". */
export function MeetingUpdateEmail({
  workspaceName,
  recipientName,
  senderEmail,
  meeting,
  links,
  changes,
  notify,
  reconfirm,
  calendar,
}: MeetingUpdateEmailProps) {
  const tr = getEmailTranslator();
  const responseMode = meeting.responseMode;
  return (
    <EmailLayout
      sticker={workspaceName}
      preview={tr("meetingUpdate.preview", { workspace: workspaceName })}
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
        {notify
          ? tr("meetingUpdate.intro", {
              name: recipientName,
              workspace: workspaceName,
            })
          : tr("meetingUpdate.calendarOnly")}
      </Text>
      <MarkedMeetingCard
        sections={markedCard(meeting, notify ? changes : {}, cardText(tr))}
      />
      {responseMode !== "announcement" && notify && reconfirm ? (
        <>
          <Text style={{ ...body, marginTop: "16px", fontWeight: 700 }}>
            {tr("meetingUpdate.reconfirm")}
          </Text>
          <AnswerButtons
            responseMode={responseMode}
            respondUrl={links.respond}
          />
        </>
      ) : responseMode !== "announcement" && notify ? (
        <PrimaryLinkButton
          href={links.respond}
          label={tr("meetingUpdate.change")}
        />
      ) : null}
      {calendar && notify ? (
        <Text style={{ ...body, fontSize: "14px", marginTop: "12px" }}>
          {tr("meetingUpdate.calendar")}
        </Text>
      ) : null}
    </EmailLayout>
  );
}

/**
 * Subject + HTML + text: "Changed: …", "Please confirm: …" (the time moved and moved back), or
 * "Updated in your calendar: …" (only the calendar event changes).
 */
export async function renderMeetingUpdateEmail(
  props: MeetingUpdateEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(props.meeting);
  const values = {
    title: props.meeting.title,
    date: when.date,
    time: when.start,
  };
  const subject = !props.notify
    ? tr("meetingUpdate.subjectCalendar", values)
    : hasMemberChanges(props.changes)
      ? tr("meetingUpdate.subject", values)
      : tr("meetingUpdate.subjectConfirm", values);
  const element = <MeetingUpdateEmail {...props} />;
  return {
    subject,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
