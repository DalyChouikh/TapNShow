import "server-only";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { getServerEnv, type ServerEnv } from "@/config/env";
import { type PublicEnv, publicEnv } from "@/config/public-env";
import { PUSH_REQUEST_TIMEOUT_MS } from "@/config/push";
import { requireSecret } from "@/config/secrets";
import { createPushStore } from "@/server/queries/push";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { PushDeps } from "./run-push";
import { createPushSender } from "./send";

/** Reminders work only when the signing pair and the public key are all set (spec §8). */
export function pushConfigured(env: ServerEnv, pub: PublicEnv): boolean {
  return Boolean(
    env.VAPID_PRIVATE_KEY &&
    env.VAPID_SUBJECT &&
    pub.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  );
}

/**
 * Real dependencies for `runPush`.
 * @throws Error naming the missing key when push isn't configured
 */
export function createPushDeps(env: ServerEnv = getServerEnv()): PushDeps {
  const publicKey = publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey || !env.VAPID_SUBJECT) {
    throw new Error(
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_SUBJECT are required for reminders",
    );
  }
  return {
    store: createPushStore(createSupabaseAdminClient()),
    send: createPushSender(
      {
        subject: env.VAPID_SUBJECT,
        publicKey,
        privateKey: requireSecret("VAPID_PRIVATE_KEY", env),
      },
      PUSH_REQUEST_TIMEOUT_MS,
    ),
    reportBug: (status) => Sentry.captureMessage(`Web Push ${status}`, "error"),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newRunId: () => randomUUID(),
  };
}
