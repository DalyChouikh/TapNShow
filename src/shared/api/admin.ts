import { z } from "zod";
import { PLATFORM_EVENT_KINDS } from "@/lib/discord/platform-events";

/**
 * The longest Overview period, in days (two years). Twin of `p_to - p_from > 730` in
 * `private.admin_overview` (pinned by the admin reads DB test).
 */
export const ADMIN_PERIOD_MAX_DAYS = 731;
/** The bar size of the Overview's chart: days up to 31 days, weeks up to 183, months beyond. */
export const ADMIN_SERIES_UNITS = ["day", "week", "month"] as const;
/** Workspaces list filters and sorts (spec §7.19). */
export const ADMIN_WORKSPACE_FILTERS = [
  "all",
  "suspended",
  "reported",
  "no_sender",
] as const;
/** Workspaces list sorts (spec §7.19). */
export const ADMIN_WORKSPACE_SORTS = ["newest", "reports", "emails"] as const;
/** Log filters. */
export const ADMIN_LOG_FILTERS = ["all", "suspensions", "admins"] as const;

const instant = z.iso.datetime({ offset: true });

const figuresSchema = z.object({
  workspacesTotal: z.number(),
  workspacesNew: z.number(),
  activeWorkspaces: z.number(),
  meetingsSent: z.number(),
  emailsSent: z.number(),
  emailsFailed: z.number(),
  answersRateBp: z.number().nullable(),
  accountsTotal: z.number(),
  accountsNew: z.number(),
  pushesSent: z.number(),
  pushesFailed: z.number(),
});
/** Platform figures for one period. */
export type AdminFigures = z.infer<typeof figuresSchema>;

/** `GET /api/admin/overview?from=&to=` (UTC dates, `yyyy-MM-dd`). */
export const adminOverviewQuerySchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((range) => range.from <= range.to);
/** One Overview period: its first and last UTC day. */
export type AdminPeriod = z.infer<typeof adminOverviewQuerySchema>;

/** `GET /api/admin/overview?from=&to=` */
export const adminOverviewSchema = z.object({
  attention: z.object({
    newReports: z.number(),
    openSuspensions: z.array(
      z.object({
        workspaceId: z.uuid(),
        workspaceName: z.string(),
        reason: z.enum(["auto_reports", "platform_admin"]),
        createdAt: instant,
      }),
    ),
    platformEmailUsed: z.number(),
    platformEmailCap: z.number(),
  }),
  current: figuresSchema,
  previous: figuresSchema,
  series: z.object({
    unit: z.enum(ADMIN_SERIES_UNITS),
    points: z.array(z.object({ start: z.iso.date(), meetings: z.number() })),
  }),
  health: z.object({
    queueWaiting: z.number(),
    queueOldest: instant.nullable(),
    sheetsPaused: z.number(),
    sheetsTotal: z.number(),
    sendersBroken: z.number(),
  }),
});
/** The admin Overview. */
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

/** One row of `GET /api/admin/workspaces`. */
export const adminWorkspaceRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: instant,
  ownerEmail: z.string().nullable(),
  team: z.number(),
  contacts: z.number(),
  meetings30d: z.number(),
  emails30d: z.number(),
  failed30d: z.number(),
  reports7d: z.number(),
  people7d: z.number(),
  suspended: z.boolean(),
  sender: z.enum(["none", "active", "broken"]),
  sheet: z.enum(["off", "on", "paused"]),
});
/** One workspaces-list row. */
export type AdminWorkspaceRow = z.infer<typeof adminWorkspaceRowSchema>;
/** `GET /api/admin/workspaces` (keyset page). */
export const adminWorkspacesPageSchema = z.object({
  items: z.array(adminWorkspaceRowSchema),
  nextCursor: z.string().nullable(),
});

/** `GET /api/admin/workspaces/[id]` */
export const adminWorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: instant,
  ownerName: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  team: z.object({ owner: z.number(), admin: z.number(), viewer: z.number() }),
  contacts: z.number(),
  sender: z.enum(["none", "active", "broken"]),
  sheet: z.enum(["off", "on", "paused"]),
  suspended: z.boolean(),
  last30: z.object({
    meetingsSent: z.number(),
    emailsSent: z.number(),
    emailsFailed: z.number(),
    reports: z.number(),
    unsubscribes: z.number(),
  }),
  reports7d: z.number(),
  people7d: z.number(),
  suspensions: z.array(
    z.object({
      id: z.uuid(),
      reason: z.enum(["auto_reports", "platform_admin"]),
      createdAt: instant,
      createdByName: z.string().nullable(),
      liftedAt: instant.nullable(),
      liftedByName: z.string().nullable(),
    }),
  ),
});
/** One workspace in the admin area. */
export type AdminWorkspace = z.infer<typeof adminWorkspaceSchema>;

/** One row of `GET /api/admin/reports`. */
export const adminReportRowSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  reportedAt: instant,
  reviewedAt: instant.nullable(),
  reviewedByName: z.string().nullable(),
  reports7d: z.number(),
  people7d: z.number(),
});
/** One reports-list row. */
export type AdminReportRow = z.infer<typeof adminReportRowSchema>;
/** `GET /api/admin/reports` (keyset page). */
export const adminReportsPageSchema = z.object({
  items: z.array(adminReportRowSchema),
  nextCursor: z.string().nullable(),
});

/** `GET /api/admin/admins` (emails masked). */
export const adminAdminsSchema = z.object({
  admins: z.array(
    z.object({
      userId: z.uuid(),
      role: z.enum(["owner", "admin"]),
      name: z.string().nullable(),
      email: z.string(),
      since: instant,
    }),
  ),
  invites: z.array(
    z.object({ id: z.uuid(), email: z.string(), expiresAt: instant }),
  ),
});
/** The admins and their waiting invites. */
export type AdminAdmins = z.infer<typeof adminAdminsSchema>;

/** One row of `GET /api/admin/log`. */
export const adminLogItemSchema = z.object({
  id: z.number(),
  kind: z.enum(PLATFORM_EVENT_KINDS),
  workspaceId: z.uuid().nullable(),
  workspaceName: z.string().nullable(),
  actorName: z.string().nullable(),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  createdAt: instant,
});
/** One admin log line. */
export type AdminLogItem = z.infer<typeof adminLogItemSchema>;
/** `GET /api/admin/log` (keyset page). */
export const adminLogPageSchema = z.object({
  items: z.array(adminLogItemSchema),
  nextCursor: z.string().nullable(),
});

/** `POST /api/admin/invites` and `…/renew` (the owner picks email or a copied link). */
export const adminInviteBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  delivery: z.enum(["email", "link"]),
});
/** `POST /api/admin/invites/[id]/renew` body. */
export const adminRenewBodySchema = z.object({
  delivery: z.enum(["email", "link"]),
});
/** What creating or renewing an admin invite produced. */
export const adminInviteResultSchema = z.object({
  status: z.enum(["sent", "link", "email_limit", "email_failed"]),
  link: z.string().optional(),
});
/** What creating or renewing an admin invite produced. */
export type AdminInviteResult = z.infer<typeof adminInviteResultSchema>;

/** `POST /api/admin/invites/preview` and `…/accept` */
export const adminInviteTokenBodySchema = z.object({
  token: z.string().min(16).max(128),
});
/** What an admin invite link shows the signed-in person. */
export const adminInvitePreviewSchema = z.object({
  status: z.enum([
    "ready",
    "wrong_account",
    "expired",
    "revoked",
    "used",
    "already_admin",
    "not_found",
  ]),
  maskedEmail: z.string().nullable(),
});
/** What an admin invite link shows the signed-in person. */
export type AdminInvitePreview = z.infer<typeof adminInvitePreviewSchema>;
