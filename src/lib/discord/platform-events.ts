import type { DiscordEvent } from "./embed";
import { reportPercent } from "@/lib/admin/format";

/** The platform event kinds, in the order of `public.platform_event_kind` (its TS twin). */
export const PLATFORM_EVENT_KINDS = [
  "auto_suspended",
  "suspended",
  "lifted",
  "report",
  "report_reviewed",
  "admin_invited",
  "admin_joined",
  "admin_removed",
  "invite_revoked",
  "owner_set",
  "platform_email_cap",
  "worker_failing",
] as const;

/** One platform event kind. */
export type PlatformEventKind = (typeof PLATFORM_EVENT_KINDS)[number];

/** One claimed event (camelCase of `platform_events_claim`). */
export type PlatformEvent = {
  id: number;
  kind: PlatformEventKind;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceSlug: string | null;
  facts: Record<string, string | number | boolean>;
  createdAt: string;
  actorRole: "owner" | "admin" | null;
  emailedAt: string | null;
  attempts: number;
};

const TITLES: Record<PlatformEventKind, [DiscordEvent["tone"], string]> = {
  auto_suspended: ["attention", "Sending suspended automatically"],
  suspended: ["attention", "Sending suspended by an admin"],
  lifted: ["info", "Suspension lifted"],
  report: ["attention", "New report: Not my group"],
  report_reviewed: ["info", "Report reviewed"],
  admin_invited: ["info", "Admin invited"],
  admin_joined: ["success", "New admin joined"],
  admin_removed: ["info", "Admin removed"],
  invite_revoked: ["info", "Admin invite revoked"],
  owner_set: ["info", "Platform owner set"],
  platform_email_cap: ["attention", "Platform email limit reached for today"],
  worker_failing: ["failure", "A background worker is failing"],
};

const DESCRIPTIONS: Partial<Record<PlatformEventKind, string>> = {
  auto_suspended:
    "A workspace passed the report limit. Its queued emails are paused until an admin looks.",
  platform_email_cap:
    "Team invite emails and notices to Owners wait until tomorrow. Copy link still works.",
  worker_failing:
    "See Sentry for the error. It is posted at most once an hour.",
};

function rate(reports: number, people: number): string {
  return `${reports} of ${people} people · ${reportPercent(reports, people)}%`;
}

/** The `#platform` embed of one event (spec §5): counts, ids and workspace names only. */
export function platformEventMessage(
  event: PlatformEvent,
  appUrl: string,
): DiscordEvent {
  const [tone, title] = TITLES[event.kind];
  const fields: Array<{ name: string; value: string }> = [];
  if (event.workspaceName) {
    fields.push({ name: "Workspace", value: event.workspaceName });
  }
  const { reports, people, lane, cap } = event.facts;
  if (typeof reports === "number" && typeof people === "number") {
    fields.push({ name: "Reports (7 days)", value: rate(reports, people) });
  }
  if (event.actorRole) {
    fields.push({
      name: "By",
      value: event.actorRole === "owner" ? "the platform owner" : "an admin",
    });
  }
  if (typeof lane === "string") {
    fields.push({ name: "Worker", value: lane });
  }
  if (typeof cap === "number") {
    fields.push({ name: "Limit", value: `${cap} a day` });
  }
  const url = event.workspaceId
    ? `${appUrl}/admin/workspaces/${event.workspaceId}`
    : `${appUrl}/admin/log`;
  return {
    tone,
    title,
    url,
    description: DESCRIPTIONS[event.kind],
    fields,
    source: "platform",
    at: new Date(event.createdAt),
  };
}
