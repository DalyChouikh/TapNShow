import "server-only";
import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/config/env";
import { GMAIL_SEND_TIMEOUT_MS } from "@/config/gmail";
import { publicEnv } from "@/config/public-env";
import { requireSecret } from "@/config/secrets";
import { deriveInviteeToken } from "@/server/crypto/invitee-token";
import { createSystemMailer } from "@/server/email/system-mailer";
import { sendGmailMessage } from "@/server/gmail/gmail-client";
import { googleTokenDeps } from "@/server/google/token-deps";
import { createDispatchStore } from "@/server/queries/dispatch";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { DispatchDeps } from "./run-dispatch";
import { sendOwnerAlert } from "@/server/email/owner-alert";

/**
 * Real dependencies for `runDispatch`.
 * @throws Error naming the first missing secret (sending cannot work without it)
 */
export function createDispatchDeps(): DispatchDeps {
  const env = getServerEnv();
  const inviteSecret = requireSecret("INVITE_TOKEN_SECRET", env);
  const mailer = createSystemMailer();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  return {
    store: createDispatchStore(createSupabaseAdminClient()),
    gmail: (input) =>
      sendGmailMessage({
        ...input,
        baseUrl: env.GMAIL_API_BASE_URL,
        timeoutMs: GMAIL_SEND_TIMEOUT_MS,
      }),
    ...googleTokenDeps(),
    tokenFor: (inviteeId) => deriveInviteeToken(inviteeId, inviteSecret),
    appUrl,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    alertBroken: async (alert) => {
      for (const target of alert) {
        await sendOwnerAlert(mailer, appUrl, target.email, {
          kind: "senderBroken",
          workspaceName: target.workspaceName,
          workspaceSlug: target.workspaceSlug,
        });
      }
    },
    newRunId: () => randomUUID(),
  };
}
