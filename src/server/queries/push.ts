import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  type PushItem,
  type PushSubscriptionBody,
  pushItemSchema,
} from "@/shared/api/push";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

/** What the push lane needs from the database (injected, so tests use fakes). */
export type PushStore = {
  claim(
    run: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<{ dropped: number; items: PushItem[] }>;
  done(id: string, run: string): Promise<boolean>;
  retry(id: string, run: string, afterSeconds: number): Promise<boolean>;
  drop(id: string, run: string): Promise<void>;
  gone(id: string, run: string): Promise<void>;
};

/** The push store over the service-role client. Database errors throw (the run logs and stops). */
export function createPushStore(admin: Client): PushStore {
  const check = <T>(
    name: string,
    result: { data: T; error: DbError | null },
  ): T => {
    if (result.error) {
      throw new Error(`${name} failed: ${result.error.code ?? ""}`);
    }
    return result.data;
  };
  return {
    claim: async (run, limit, leaseSeconds) =>
      z
        .object({ dropped: z.number().int(), items: z.array(pushItemSchema) })
        .parse(
          check(
            "push_claim",
            await admin.rpc("push_claim", {
              p_run: run,
              p_limit: limit,
              p_lease_seconds: leaseSeconds,
            }),
          ),
        ),
    done: async (id, run) =>
      z
        .boolean()
        .parse(
          check(
            "push_done",
            await admin.rpc("push_done", { p_delivery: id, p_run: run }),
          ),
        ),
    retry: async (id, run, afterSeconds) =>
      z.boolean().parse(
        check(
          "push_retry",
          await admin.rpc("push_retry", {
            p_delivery: id,
            p_run: run,
            p_after_seconds: afterSeconds,
          }),
        ),
      ),
    drop: async (id, run) => {
      check(
        "push_drop",
        await admin.rpc("push_drop", { p_delivery: id, p_run: run }),
      );
    },
    gone: async (id, run) => {
      check(
        "push_gone",
        await admin.rpc("push_gone", { p_delivery: id, p_run: run }),
      );
    },
  };
}

/** `push_subscribe()` for the signed-in person (spec §7.4). */
export async function subscribePush(
  client: Client,
  body: PushSubscriptionBody,
): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("push_subscribe", {
    p_endpoint: body.endpoint,
    p_p256dh: body.keys.p256dh,
    p_auth: body.keys.auth,
  });
  return { error };
}

/** `push_unsubscribe()`: removes only the caller's own endpoint. */
export async function unsubscribePush(
  client: Client,
  endpoint: string,
): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("push_unsubscribe", {
    p_endpoint: endpoint,
  });
  return { error };
}
