import type { WorkspaceInsights } from "@/shared/api/insights";

/** Stable UUIDs for Home insights tests. */
export const INSIGHTS_IDS = {
  firstMeeting: "7b2a3c4d-5e6f-4a70-8b81-c2d3e4f5a601",
  secondMeeting: "7b2a3c4d-5e6f-4a70-8b81-c2d3e4f5a602",
  amira: "7b2a3c4d-5e6f-4a70-8b81-c2d3e4f5a603",
};

/** Two counted meetings in a 30-member workspace (Africa/Tunis), one member often missing. */
export const insightsFixture: WorkspaceInsights = {
  roster: { members: 30, lists: 2, committee: 1 },
  held: 8,
  period: {
    meetings: 2,
    cameAverage: 22.5,
    invitedAverage: 30,
    answeredBeforeStart: 0.9,
  },
  chart: [
    {
      id: INSIGHTS_IDS.firstMeeting,
      title: "Weekly sync 1",
      startsAt: "2026-10-05T17:00:00+00:00",
      timezone: "Africa/Tunis",
      attending: 18,
      late: 4,
      absent: 5,
      noReply: 3,
    },
    {
      id: INSIGHTS_IDS.secondMeeting,
      title: "Weekly sync 2",
      startsAt: "2026-10-12T17:00:00+00:00",
      timezone: "Africa/Tunis",
      attending: 20,
      late: 3,
      absent: 4,
      noReply: 3,
    },
  ],
  oftenMissing: [
    {
      contactId: INSIGHTS_IDS.amira,
      fullName: "Amira Ben Salah",
      invited: 2,
      missed: 2,
      absent: 1,
      noReply: 1,
    },
  ],
};
