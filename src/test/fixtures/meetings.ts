import type { Audience, Meeting } from "@/shared/api/meetings";
import type { MeetingResults, PersonRow } from "@/shared/api/responses";

/** Stable UUIDs for meeting tests. */
export const MEETING_IDS = {
  meeting: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f601",
  amira: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f602",
  youssef: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f603",
  lina: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f604",
  members: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f605",
  committee: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f606",
  invitee: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f607",
};

/** A complete draft (Fri 9 Oct 2026, 18:00 Africa/Tunis). */
export const meetingFixture: Meeting = {
  id: MEETING_IDS.meeting,
  title: "Weekly sync",
  agendaMd: "- Recap",
  startsAt: "2026-10-09T17:00:00.000Z",
  durationMinutes: 60,
  timezone: "Africa/Tunis",
  locationMode: "in_person",
  locationText: "Room B12",
  onlineText: "",
  meetingUrl: "",
  responseMode: "attendance",
  responseDeadline: null,
  delayOptions: [5, 10, 15, 30],
  reasonRequired: true,
  commentsEnabled: false,
  footerNote: "",
  status: "draft",
  sentAt: null,
};

/** Members (Amira, Youssef) + Committee (Youssef, Lina — unsubscribed). */
export const audienceFixture: Audience = {
  listIds: [MEETING_IDS.members, MEETING_IDS.committee],
  people: [
    {
      id: MEETING_IDS.amira,
      fullName: "Amira B.",
      email: "amira@uni.tn",
      listIds: [MEETING_IDS.members],
      added: false,
      excluded: false,
      unsubscribed: false,
      reported: false,
      invited: false,
    },
    {
      id: MEETING_IDS.lina,
      fullName: "Lina M.",
      email: "lina@uni.tn",
      listIds: [MEETING_IDS.committee],
      added: false,
      excluded: false,
      unsubscribed: true,
      reported: false,
      invited: false,
    },
    {
      id: MEETING_IDS.youssef,
      fullName: "Youssef K.",
      email: "youssef@uni.tn",
      listIds: [MEETING_IDS.members, MEETING_IDS.committee],
      added: false,
      excluded: false,
      unsubscribed: false,
      reported: false,
      invited: false,
    },
  ],
  counts: { selected: 3, invited: 0, unsubscribed: 1, toInvite: 2 },
  maxInvitees: 500,
};

/** Counts of a meeting whose invites are still going out (one sent, one queued). */
export const resultsFixture: MeetingResults = {
  responseMode: "attendance",
  emails: { total: 2, queued: 1, sent: 1, skipped: 0, failed: 0, unknown: 0 },
  answers: {
    attending: 0,
    late: 0,
    absent: 0,
    notAttending: 0,
    noReply: 1,
    calendarRequested: 0,
  },
  paused: 0,
  resumesAt: null,
  senderState: "ok",
};

/** Two people: Amira answered Late with a reason, Youssef has not answered. */
export const peopleFixture: PersonRow[] = [
  {
    inviteeId: MEETING_IDS.invitee,
    contactId: MEETING_IDS.amira,
    fullName: "Amira B.",
    email: "amira@uni.tn",
    isAdhoc: false,
    emailStatus: "sent",
    emailError: null,
    sentAt: "2026-10-07T10:00:00.000Z",
    answer: {
      status: "late",
      delayMinutes: 20,
      reason: "Bus from campus",
      comment: "",
      afterDeadline: true,
      updatedAt: "2026-10-08T12:05:00.000Z",
    },
  },
  {
    inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f608",
    contactId: MEETING_IDS.youssef,
    fullName: "Youssef K.",
    email: "youssef@uni.tn",
    isAdhoc: true,
    emailStatus: "failed",
    emailError: null,
    sentAt: null,
    answer: null,
  },
];
