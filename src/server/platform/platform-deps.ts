import "server-only";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { postToDiscord } from "@/lib/discord/send";
import { sendOwnerAlert } from "@/server/email/owner-alert";
import { createSystemMailer } from "@/server/email/system-mailer";
import { createPlatformStore } from "@/server/queries/platform";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { PlatformDeps } from "./run-platform-events";

/** Real dependencies for `runPlatformEvents` (the webhook is optional: see `PlatformDeps`). */
export function createPlatformDeps(): PlatformDeps {
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  const mailer = createSystemMailer();
  return {
    appUrl,
    webhook: getServerEnv().DISCORD_PLATFORM_WEBHOOK,
    now: () => Date.now(),
    store: createPlatformStore(createSupabaseAdminClient()),
    post: (webhook, message) => postToDiscord(webhook, message),
    alertOwner: (to, alert) => sendOwnerAlert(mailer, appUrl, to, alert),
  };
}
