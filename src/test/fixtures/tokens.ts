import type { TokenInfo } from "@/shared/api/tokens";

/** A personal link for Weekly sync (Fri 9 Oct 2026, 18:00 Africa/Tunis). */
export const tokenInfoFixture: TokenInfo = {
  workspaceName: "Robotics Club",
  maskedEmail: "a•••@uni.tn",
  unsubscribed: false,
  reported: false,
  meeting: {
    title: "Weekly sync",
    startsAt: "2026-10-09T17:00:00.000Z",
    timezone: "Africa/Tunis",
    durationMinutes: 60,
    locationMode: "in_person",
    locationText: "Room B12",
    onlineText: "",
    meetingUrl: "",
    status: "scheduled",
  },
};
