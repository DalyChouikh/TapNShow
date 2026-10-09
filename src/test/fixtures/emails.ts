import type { MeetingInviteEmailProps } from "@/emails/meeting-invite-email";

/** One member's meeting email props: Weekly sync, Fri 9 Oct 18:00 Tunis, Room B12, attendance. */
export const meetingEmailProps = {
  workspaceName: "GDG ISSAT",
  recipientName: "Amira",
  senderEmail: "club@gmail.com",
  meeting: {
    title: "Weekly sync",
    agendaMd: "",
    startsAt: "2026-10-09T17:00:00Z",
    durationMinutes: 60,
    timezone: "Africa/Tunis",
    locationMode: "in_person",
    locationText: "Room B12",
    onlineText: "",
    meetingUrl: "",
    responseMode: "attendance",
    responseDeadline: null,
  },
  links: {
    respond: "https://app.test/r/TOKEN",
    unsubscribe: "https://app.test/u/TOKEN",
    report: "https://app.test/report/TOKEN",
  },
  now: new Date("2026-10-08T10:00:00Z"),
} satisfies MeetingInviteEmailProps;

/** Asserts no emojis in the subject/text and no raw user HTML in the body. */
export const EMOJI = /\p{Extended_Pictographic}/u;
