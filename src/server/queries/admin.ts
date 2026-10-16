import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import type {
  AdminAdmins,
  AdminInvitePreview,
  AdminLogItem,
  AdminOverview,
  AdminPeriod,
  AdminReportRow,
  AdminWorkspace,
  AdminWorkspaceRow,
} from "@/shared/api/admin";
import {
  ADMIN_SERIES_UNITS,
  adminInvitePreviewSchema,
  adminLogItemSchema,
} from "@/shared/api/admin";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

/** An admin RPC's answer: parsed data, or the database error to map. */
export type AdminResult<T> =
  { data: T; error: null } | { data: null; error: DbError };

/** Parses a successful RPC's data; passes its error through untouched. */
function result<D, T>(
  response: { data: D; error: DbError | null },
  parse: (data: D) => T,
): AdminResult<T> {
  return response.error
    ? { data: null, error: response.error }
    : { data: parse(response.data), error: null };
}

const ok = () => true as const;

const sender = z.enum(["none", "active", "broken"]);
const sheet = z.enum(["off", "on", "paused"]);
const reason = z.enum(["auto_reports", "platform_admin"]);

const figuresRow = z.object({
  workspaces_total: z.number(),
  workspaces_new: z.number(),
  active_workspaces: z.number(),
  meetings_sent: z.number(),
  emails_sent: z.number(),
  emails_failed: z.number(),
  answers_rate_bp: z.number().nullable(),
  accounts_total: z.number(),
  accounts_new: z.number(),
  pushes_sent: z.number(),
  pushes_failed: z.number(),
});

function figures(row: z.infer<typeof figuresRow>): AdminOverview["current"] {
  return {
    workspacesTotal: row.workspaces_total,
    workspacesNew: row.workspaces_new,
    activeWorkspaces: row.active_workspaces,
    meetingsSent: row.meetings_sent,
    emailsSent: row.emails_sent,
    emailsFailed: row.emails_failed,
    answersRateBp: row.answers_rate_bp,
    accountsTotal: row.accounts_total,
    accountsNew: row.accounts_new,
    pushesSent: row.pushes_sent,
    pushesFailed: row.pushes_failed,
  };
}

const overviewRow = z.object({
  attention: z.object({
    new_reports: z.number(),
    open_suspensions: z.array(
      z.object({
        workspace_id: z.uuid(),
        workspace_name: z.string(),
        reason,
        created_at: z.string(),
      }),
    ),
    platform_email_used: z.number(),
    platform_email_cap: z.number(),
  }),
  current: figuresRow,
  previous: figuresRow,
  series: z.object({
    unit: z.enum(ADMIN_SERIES_UNITS),
    points: z.array(z.object({ start: z.string(), meetings: z.number() })),
  }),
  health: z.object({
    queue_waiting: z.number(),
    queue_oldest: z.string().nullable(),
    sheets_paused: z.number(),
    sheets_total: z.number(),
    senders_broken: z.number(),
  }),
});

/**
 * `admin_overview(from, to)`: needs attention, the period's figures against the one before, the
 * chart's bars, health.
 */
export async function adminOverview(
  client: Client,
  period: AdminPeriod,
): Promise<AdminResult<AdminOverview>> {
  return result(
    await client.rpc("admin_overview", {
      p_from: period.from,
      p_to: period.to,
    }),
    (data) => {
      const row = overviewRow.parse(data);
      return {
        attention: {
          newReports: row.attention.new_reports,
          openSuspensions: row.attention.open_suspensions.map((item) => ({
            workspaceId: item.workspace_id,
            workspaceName: item.workspace_name,
            reason: item.reason,
            createdAt: item.created_at,
          })),
          platformEmailUsed: row.attention.platform_email_used,
          platformEmailCap: row.attention.platform_email_cap,
        },
        current: figures(row.current),
        previous: figures(row.previous),
        series: row.series,
        health: {
          queueWaiting: row.health.queue_waiting,
          queueOldest: row.health.queue_oldest,
          sheetsPaused: row.health.sheets_paused,
          sheetsTotal: row.health.sheets_total,
          sendersBroken: row.health.senders_broken,
        },
      };
    },
  );
}

const workspaceRow = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  created_at: z.string(),
  owner_email: z.string().nullable(),
  team: z.number(),
  contacts: z.number(),
  meetings_30d: z.number(),
  emails_30d: z.number(),
  failed_30d: z.number(),
  reports_7d: z.number(),
  people_7d: z.number(),
  suspended: z.boolean(),
  sender,
  sheet,
  sort_value: z.string(),
});

/** A workspaces-list row with the keyset value its sort used (the cursor carries it). */
export type AdminWorkspaceRowWithKey = AdminWorkspaceRow & {
  sortValue: string;
};

/** One page of workspaces (`limit + 1` rows, so the route knows whether more exist). */
export async function adminWorkspaces(
  client: Client,
  input: {
    q: string | null;
    filter: string;
    sort: string;
    after: readonly [string, string] | null;
    limit: number;
  },
): Promise<AdminResult<AdminWorkspaceRowWithKey[]>> {
  return result(
    await client.rpc("admin_workspaces", {
      p_search: sqlNullable(input.q),
      p_filter: input.filter,
      p_sort: input.sort,
      p_after_value: sqlNullable(input.after?.[0] ?? null),
      p_after_id: sqlNullable(input.after?.[1] ?? null),
      p_limit: input.limit + 1,
    }),
    (data) =>
      z
        .object({ items: z.array(workspaceRow) })
        .parse(data)
        .items.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          createdAt: row.created_at,
          ownerEmail: row.owner_email,
          team: row.team,
          contacts: row.contacts,
          meetings30d: row.meetings_30d,
          emails30d: row.emails_30d,
          failed30d: row.failed_30d,
          reports7d: row.reports_7d,
          people7d: row.people_7d,
          suspended: row.suspended,
          sender: row.sender,
          sheet: row.sheet,
          sortValue: row.sort_value,
        })),
  );
}

const workspaceDetail = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  created_at: z.string(),
  owner_name: z.string().nullable(),
  owner_email: z.string().nullable(),
  team: z.object({ owner: z.number(), admin: z.number(), viewer: z.number() }),
  contacts: z.number(),
  sender,
  sheet,
  suspended: z.boolean(),
  last_30: z.object({
    meetings_sent: z.number(),
    emails_sent: z.number(),
    emails_failed: z.number(),
    reports: z.number(),
    unsubscribes: z.number(),
  }),
  reports_7d: z.number(),
  people_7d: z.number(),
  suspensions: z.array(
    z.object({
      id: z.uuid(),
      reason,
      created_at: z.string(),
      created_by_name: z.string().nullable(),
      lifted_at: z.string().nullable(),
      lifted_by_name: z.string().nullable(),
    }),
  ),
});

/** `admin_workspace(id)`: one workspace's facts (the Owner email in full, for Copy). */
export async function adminWorkspace(
  client: Client,
  id: string,
): Promise<AdminResult<AdminWorkspace>> {
  return result(
    await client.rpc("admin_workspace", { p_workspace: id }),
    (data) => {
      const row = workspaceDetail.parse(data);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: row.created_at,
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        team: row.team,
        contacts: row.contacts,
        sender: row.sender,
        sheet: row.sheet,
        suspended: row.suspended,
        last30: {
          meetingsSent: row.last_30.meetings_sent,
          emailsSent: row.last_30.emails_sent,
          emailsFailed: row.last_30.emails_failed,
          reports: row.last_30.reports,
          unsubscribes: row.last_30.unsubscribes,
        },
        reports7d: row.reports_7d,
        people7d: row.people_7d,
        suspensions: row.suspensions.map((item) => ({
          id: item.id,
          reason: item.reason,
          createdAt: item.created_at,
          createdByName: item.created_by_name,
          liftedAt: item.lifted_at,
          liftedByName: item.lifted_by_name,
        })),
      };
    },
  );
}

const reportRow = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  workspace_name: z.string(),
  reported_at: z.string(),
  reviewed_at: z.string().nullable(),
  reviewed_by_name: z.string().nullable(),
  reports_7d: z.number(),
  people_7d: z.number(),
});

/** One page of reports, newest first (`limit + 1` rows). */
export async function adminReports(
  client: Client,
  after: readonly [string, string] | null,
  limit: number,
): Promise<AdminResult<AdminReportRow[]>> {
  return result(
    await client.rpc("admin_reports", {
      p_after_at: sqlNullable(after?.[0] ?? null),
      p_after_id: sqlNullable(after?.[1] ?? null),
      p_limit: limit + 1,
    }),
    (data) =>
      z
        .object({ items: z.array(reportRow) })
        .parse(data)
        .items.map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          reportedAt: row.reported_at,
          reviewedAt: row.reviewed_at,
          reviewedByName: row.reviewed_by_name,
          reports7d: row.reports_7d,
          people7d: row.people_7d,
        })),
  );
}

/** `admin_mark_reviewed(report)` (logged once). */
export async function adminMarkReviewed(
  client: Client,
  id: string,
): Promise<AdminResult<true>> {
  return result(await client.rpc("admin_mark_reviewed", { p_report: id }), ok);
}

const adminsRow = z.object({
  admins: z.array(
    z.object({
      user_id: z.uuid(),
      role: z.enum(["owner", "admin"]),
      name: z.string().nullable(),
      email: z.string(),
      since: z.string(),
    }),
  ),
  invites: z.array(
    z.object({ id: z.uuid(), email: z.string(), expires_at: z.string() }),
  ),
});

/** `admin_admins()`: the owner and admins, and the waiting invites (addresses masked). */
export async function adminAdmins(
  client: Client,
): Promise<AdminResult<AdminAdmins>> {
  return result(await client.rpc("admin_admins"), (data) => {
    const row = adminsRow.parse(data);
    return {
      admins: row.admins.map((item) => ({
        userId: item.user_id,
        role: item.role,
        name: item.name,
        email: item.email,
        since: item.since,
      })),
      invites: row.invites.map((item) => ({
        id: item.id,
        email: item.email,
        expiresAt: item.expires_at,
      })),
    };
  });
}

/** `admin_invite(email, tokenHash)`: a new email-bound admin invite (platform owner only). */
export async function adminInvite(
  client: Client,
  email: string,
  tokenHash: string,
): Promise<AdminResult<{ id: string; expiresAt: string }>> {
  return result(
    await client.rpc("admin_invite", {
      p_email: email,
      p_token_hash: tokenHash,
    }),
    (data) => {
      const row = z
        .object({ id: z.uuid(), expires_at: z.string() })
        .parse(data);
      return { id: row.id, expiresAt: row.expires_at };
    },
  );
}

/** `admin_invite_renew(id, tokenHash)`: a fresh link and 7 more days. */
export async function adminInviteRenew(
  client: Client,
  id: string,
  tokenHash: string,
): Promise<AdminResult<{ id: string; email: string; expiresAt: string }>> {
  return result(
    await client.rpc("admin_invite_renew", {
      p_invite: id,
      p_token_hash: tokenHash,
    }),
    (data) => {
      const row = z
        .object({ id: z.uuid(), email: z.string(), expires_at: z.string() })
        .parse(data);
      return { id: row.id, email: row.email, expiresAt: row.expires_at };
    },
  );
}

/** `admin_invite_revoke(id)`. */
export async function adminInviteRevoke(
  client: Client,
  id: string,
): Promise<AdminResult<true>> {
  return result(await client.rpc("admin_invite_revoke", { p_invite: id }), ok);
}

/** `admin_remove(userId)` (never the owner). */
export async function adminRemove(
  client: Client,
  userId: string,
): Promise<AdminResult<true>> {
  return result(await client.rpc("admin_remove", { p_user: userId }), ok);
}

/** Spends one unit of the platform's daily email budget for an admin invite email. */
export async function consumeAdminInviteEmail(
  client: Client,
): Promise<AdminResult<boolean>> {
  return result(await client.rpc("consume_admin_invite_email"), (data) =>
    z.boolean().parse(data),
  );
}

/** `admin_invite_preview(tokenHash)`: what the link shows the signed-in person. */
export async function adminInvitePreview(
  client: Client,
  tokenHash: string,
): Promise<AdminResult<AdminInvitePreview>> {
  return result(
    await client.rpc("admin_invite_preview", { p_token_hash: tokenHash }),
    (data) => {
      const [row] = z
        .array(
          z.object({ status: z.string(), masked_email: z.string().nullable() }),
        )
        .length(1)
        .parse(data);
      return adminInvitePreviewSchema.parse({
        status: row.status,
        maskedEmail: row.masked_email,
      });
    },
  );
}

/** `accept_admin_invite(tokenHash)`: the signed-in, verified invited address becomes an admin. */
export async function acceptAdminInvite(
  client: Client,
  tokenHash: string,
): Promise<AdminResult<true>> {
  return result(
    await client.rpc("accept_admin_invite", { p_token_hash: tokenHash }),
    ok,
  );
}

const logRow = z.object({
  id: z.number(),
  kind: z.string(),
  workspace_id: z.uuid().nullable(),
  workspace_name: z.string().nullable(),
  actor_name: z.string().nullable(),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  created_at: z.string(),
});

/** One page of the admin log, newest first (`limit + 1` rows). */
export async function adminLog(
  client: Client,
  filter: string,
  afterId: number | null,
  limit: number,
): Promise<AdminResult<AdminLogItem[]>> {
  return result(
    await client.rpc("admin_log", {
      p_filter: filter,
      p_after_id: sqlNullable(afterId),
      p_limit: limit + 1,
    }),
    (data) =>
      z
        .object({ items: z.array(logRow) })
        .parse(data)
        .items.map((row) =>
          adminLogItemSchema.parse({
            id: row.id,
            kind: row.kind,
            workspaceId: row.workspace_id,
            workspaceName: row.workspace_name,
            actorName: row.actor_name,
            facts: row.facts,
            createdAt: row.created_at,
          }),
        ),
  );
}

/** `admin_suspend(workspace)`. */
export async function suspendWorkspace(
  client: Client,
  id: string,
): Promise<AdminResult<true>> {
  return result(await client.rpc("admin_suspend", { p_workspace: id }), ok);
}

/** `admin_lift(workspace)`. */
export async function liftSuspension(
  client: Client,
  id: string,
): Promise<AdminResult<true>> {
  return result(await client.rpc("admin_lift", { p_workspace: id }), ok);
}

/**
 * The signed-in person's platform role, or null for everyone else.
 * @throws Error on database failures
 */
export async function myPlatformRole(
  client: Client,
): Promise<"owner" | "admin" | null> {
  const { data, error } = await client.rpc("my_platform_role");
  if (error) {
    throw new Error(error.message);
  }
  return data === "owner" || data === "admin" ? data : null;
}
