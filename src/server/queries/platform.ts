import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  PLATFORM_EVENT_KINDS,
  type PlatformEvent,
} from "@/lib/discord/platform-events";
import type { Database } from "@/server/db/database.types";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

/** A worker lane `record_worker_failure` accepts (its SQL check names the same four). */
export type WorkerLane = "emails" | "sheets" | "push" | "platform";

/** The Owner to email about a suspension or a lift (`owner_alert_target`'s answer). */
export type PlatformOwnerTarget = {
  email: string;
  workspaceName: string;
  workspaceSlug: string;
};

/** What the platform-events lane needs from the database (injected, so tests use fakes). */
export type PlatformStore = {
  claim(limit: number, leaseSeconds: number): Promise<PlatformEvent[]>;
  ownerTarget(id: number): Promise<PlatformOwnerTarget | null>;
  done(id: number): Promise<void>;
  failed(id: number): Promise<number>;
};

const claimedEventSchema = z
  .object({
    id: z.number().int(),
    kind: z.enum(PLATFORM_EVENT_KINDS),
    workspace_id: z.uuid().nullable(),
    workspace_name: z.string().nullable(),
    workspace_slug: z.string().nullable(),
    facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    created_at: z.string(),
    actor_role: z.enum(["owner", "admin"]).nullable(),
    emailed_at: z.string().nullable(),
    attempts: z.number().int(),
  })
  .transform((row): PlatformEvent => ({
    id: row.id,
    kind: row.kind,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    facts: row.facts,
    createdAt: row.created_at,
    actorRole: row.actor_role,
    emailedAt: row.emailed_at,
    attempts: row.attempts,
  }));

const ownerTargetSchema = z
  .object({
    email: z.string(),
    workspace_name: z.string(),
    workspace_slug: z.string(),
  })
  .transform((row): PlatformOwnerTarget => ({
    email: row.email,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
  }))
  .nullable();

function check<T>(name: string, result: { data: T; error: DbError | null }): T {
  if (result.error) {
    throw new Error(`${name} failed: ${result.error.code ?? ""}`);
  }
  return result.data;
}

/** The platform-events store over the service-role client. Database errors throw. */
export function createPlatformStore(admin: Client): PlatformStore {
  return {
    claim: async (limit, leaseSeconds) =>
      z.array(claimedEventSchema).parse(
        check(
          "platform_events_claim",
          await admin.rpc("platform_events_claim", {
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          }),
        ),
      ),
    ownerTarget: async (id) =>
      ownerTargetSchema.parse(
        check(
          "platform_event_owner_target",
          await admin.rpc("platform_event_owner_target", { p_event: id }),
        ),
      ),
    done: async (id) => {
      check(
        "platform_event_done",
        await admin.rpc("platform_event_done", { p_event: id }),
      );
    },
    failed: async (id) =>
      z
        .number()
        .int()
        .parse(
          check(
            "platform_event_failed",
            await admin.rpc("platform_event_failed", { p_event: id }),
          ),
        ),
  };
}

/** `record_worker_failure()`: notes a crashed lane, at most once an hour per lane (service role). */
export async function recordWorkerFailure(
  admin: Client,
  lane: WorkerLane,
): Promise<void> {
  check(
    "record_worker_failure",
    await admin.rpc("record_worker_failure", { p_lane: lane }),
  );
}
