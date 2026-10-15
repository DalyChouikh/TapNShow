import "server-only";
import { publicEnv } from "@/config/public-env";
import { logger } from "@/lib/logger";
import {
  type OwnerAlertInput,
  sendOwnerAlert,
} from "@/server/email/owner-alert";
import { createSystemMailer } from "@/server/email/system-mailer";
import {
  type ReleasedConnection,
  revokeReleased,
} from "@/server/google/release";
import type { AccountDeletion, OwnerAlert } from "@/server/queries/account";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/** What runs after the deletion commits (injected so tests use fakes). */
export type AfterDeletionDeps = {
  revoke: (released: ReadonlyArray<ReleasedConnection>) => Promise<void>;
  send: (to: string, alert: OwnerAlertInput) => Promise<void>;
};

function realDeps(): AfterDeletionDeps {
  const mailer = createSystemMailer();
  return {
    revoke: revokeReleased,
    send: (to, alert) =>
      sendOwnerAlert(mailer, publicEnv.NEXT_PUBLIC_APP_URL, to, alert),
  };
}

/** The one Owner email of a deletion: sending stopped, the sheet lost its access, or both. */
function alertFor(alert: OwnerAlert): OwnerAlertInput {
  const workspace = {
    workspaceName: alert.workspaceName,
    workspaceSlug: alert.workspaceSlug,
  };
  switch (alert.kind) {
    case "sender":
      return { kind: "senderRemoved", ...workspace };
    case "both":
      return { kind: "senderAndSheetRemoved", ...workspace };
    case "sheet":
      return { kind: "sheetPaused", reason: "access_lost", ...workspace };
  }
}

/**
 * Best-effort work after an account deletion commits (spec §11): revoke the released Google
 * tokens, and tell each affected Owner. Never throws; logs counts only.
 */
export async function afterAccountDeleted(
  result: AccountDeletion,
  deps: AfterDeletionDeps = realDeps(),
): Promise<void> {
  let failed = 0;
  try {
    await deps.revoke(result.released);
  } catch {
    failed += 1;
  }
  for (const alert of result.alerts) {
    try {
      await deps.send(alert.email, alertFor(alert));
    } catch {
      failed += 1;
    }
  }
  logger.info(
    {
      revoked: result.released.length,
      alerts: result.alerts.length,
      failed,
    },
    "account deleted",
  );
}

/** Deletes the auth user (admin API; cascades to the profile and push subscriptions). */
export async function removeAuthUser(userId: string): Promise<boolean> {
  const { error } =
    await createSupabaseAdminClient().auth.admin.deleteUser(userId);
  if (error) {
    logger.error({ status: error.status }, "auth user deletion failed");
  }
  return !error;
}
