import type {
  AdminAdmins,
  AdminFigures,
  AdminLogItem,
  AdminOverview,
  AdminReportRow,
  AdminWorkspace,
  AdminWorkspaceRow,
} from "@/shared/api/admin";

/** A workspace id used across admin tests. */
export const ADMIN_WORKSPACE_ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** Platform figures for one period (the mockup's numbers). */
export const figuresFixture: AdminFigures = {
  workspacesTotal: 48,
  workspacesNew: 6,
  activeWorkspaces: 31,
  meetingsSent: 214,
  emailsSent: 10_000,
  emailsFailed: 130,
  answersRateBp: 7100,
  accountsTotal: 620,
  accountsNew: 54,
  pushesSent: 991,
  pushesFailed: 9,
};

/** The Overview with something needing attention. */
export const overviewFixture: AdminOverview = {
  attention: {
    newReports: 2,
    openSuspensions: [
      {
        workspaceId: ADMIN_WORKSPACE_ID,
        workspaceName: "Robotics Club",
        reason: "auto_reports",
        createdAt: "2026-10-16T07:12:00+00:00",
      },
    ],
    platformEmailUsed: 82,
    platformEmailCap: 100,
  },
  current: figuresFixture,
  previous: { ...figuresFixture, meetingsSent: 181 },
  // Twelve Mondays from 27 Jul 2026 (the SQL's UTC week starts, without an offset).
  weekly: Array.from({ length: 12 }, (_, index) => ({
    week: new Date(Date.UTC(2026, 6, 27 + index * 7))
      .toISOString()
      .slice(0, 19),
    meetings: index * 2,
  })),
  health: {
    queueWaiting: 12,
    queueOldest: "2026-10-16T09:58:00+00:00",
    sheetsPaused: 2,
    sheetsTotal: 19,
    sendersBroken: 3,
  },
};

/** One workspaces-list row (masked Owner email, as the API sends it). */
export const workspaceRowFixture: AdminWorkspaceRow = {
  id: ADMIN_WORKSPACE_ID,
  name: "Robotics Club",
  slug: "robotics-ab12",
  createdAt: "2026-10-02T10:00:00+00:00",
  ownerEmail: "a•••@example.test",
  team: 6,
  contacts: 74,
  meetings30d: 6,
  emails30d: 402,
  failed30d: 16,
  reports7d: 3,
  people7d: 74,
  suspended: true,
  sender: "active",
  sheet: "off",
};

/** One workspace's page (the full Owner email, as the API sends it). */
export function workspaceDetailFixture(
  overrides: Partial<AdminWorkspace> = {},
): AdminWorkspace {
  return {
    id: ADMIN_WORKSPACE_ID,
    name: "Robotics Club",
    slug: "robotics-ab12",
    createdAt: "2026-10-02T10:00:00+00:00",
    ownerName: "Amira",
    ownerEmail: "amira@example.test",
    team: { owner: 1, admin: 2, viewer: 3 },
    contacts: 74,
    sender: "active",
    sheet: "off",
    suspended: false,
    last30: {
      meetingsSent: 6,
      emailsSent: 402,
      emailsFailed: 16,
      reports: 3,
      unsubscribes: 5,
    },
    reports7d: 3,
    people7d: 74,
    suspensions: [],
    ...overrides,
  };
}

/** One unreviewed report about Robotics Club. */
export const reportRowFixture: AdminReportRow = {
  id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  workspaceId: ADMIN_WORKSPACE_ID,
  workspaceName: "Robotics Club",
  reportedAt: "2026-10-16T08:00:00+00:00",
  reviewedAt: null,
  reviewedByName: null,
  reports7d: 3,
  people7d: 74,
};

/** The platform owner's user id in admin fixtures. */
export const PLATFORM_OWNER_ID = "0a0a0a0a-0000-4000-8000-000000000001";
/** An admin's user id in admin fixtures. */
export const PLATFORM_ADMIN_ID = "0a0a0a0a-0000-4000-8000-000000000002";

/** The owner, one admin and one waiting invite (addresses masked, as the API sends them). */
export const adminsFixture: AdminAdmins = {
  admins: [
    {
      userId: PLATFORM_ADMIN_ID,
      role: "admin",
      name: "Sami",
      email: "s•••@example.test",
      since: "2026-10-03T08:00:00+00:00",
    },
    {
      userId: PLATFORM_OWNER_ID,
      role: "owner",
      name: "Amira Ben Ali",
      email: "a•••@example.test",
      since: "2026-10-01T08:00:00+00:00",
    },
  ],
  invites: [
    {
      id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      email: "l•••@example.test",
      expiresAt: "2026-10-22T08:00:00+00:00",
    },
  ],
};

/** One admin log line. */
export function logItemFixture(
  overrides: Partial<AdminLogItem> = {},
): AdminLogItem {
  return {
    id: 1,
    kind: "suspended",
    workspaceId: ADMIN_WORKSPACE_ID,
    workspaceName: "Robotics Club",
    actorName: "Sami",
    facts: {},
    createdAt: "2026-10-03T21:05:00+00:00",
    ...overrides,
  };
}
