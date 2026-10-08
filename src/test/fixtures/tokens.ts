import type { TokenInfo } from "@/shared/api/tokens";

/** A personal link for Weekly sync (Fri 9 Oct 2026, 18:00 Africa/Tunis), not answered yet. */
export const tokenInfoFixture: TokenInfo = {
  workspaceName: "Robotics Club",
  maskedEmail: "a•••@uni.tn",
  fullName: "Amira Ben Ali",
  unsubscribed: false,
  reported: false,
  calendarRequested: false,
  meeting: {
    title: "Weekly sync",
    startsAt: "2026-10-09T17:00:00.000Z",
    timezone: "Africa/Tunis",
    durationMinutes: 60,
    locationMode: "in_person",
    locationText: "Room B12",
    onlineText: "",
    meetingUrl: "",
    agendaMd: "",
    status: "scheduled",
  },
  answers: {
    responseMode: "attendance",
    delayOptions: [10, 20, 30],
    reasonRequired: true,
    commentsEnabled: false,
    footerNote: "",
    responseDeadline: null,
  },
  answer: null,
};
