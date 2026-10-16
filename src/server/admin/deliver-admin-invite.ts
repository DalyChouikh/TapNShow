import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { renderAdminInviteEmail } from "@/emails/admin-invite-email";
import type { Database } from "@/server/db/database.types";
import type { SystemEmail } from "@/server/email/system-mailer";
import { emailTokenLink } from "@/server/invites/deliver-invite";
import { consumeAdminInviteEmail } from "@/server/queries/admin";
import type { AdminInviteResult } from "@/shared/api/admin";

/**
 * Hands one fresh admin invite token to its person (spec §7.19): the `/admin/join/<token>` link,
 * or an email within the platform's daily budget, with the workspace invites' rules
 * (`emailTokenLink`): a spent budget or a failed send leaves the invite valid.
 * @throws Error when the budget can't be read (a database failure)
 */
export async function deliverAdminInvite(input: {
  supabase: SupabaseClient<Database>;
  token: string;
  email: string;
  expiresAt: string;
  delivery: "email" | "link";
  origin: string;
  inviterName: string;
  mailer?: { send: (email: SystemEmail) => Promise<void> };
}): Promise<AdminInviteResult> {
  const link = `${input.origin}/admin/join/${input.token}`;
  if (input.delivery === "link") {
    return { status: "link", link };
  }
  const outcome = await emailTokenLink({
    to: input.email,
    spendBudget: () => consumeAdminInviteEmail(input.supabase),
    render: () =>
      renderAdminInviteEmail({
        inviterName: input.inviterName,
        link,
        expiresInDays: differenceInCalendarDays(
          parseISO(input.expiresAt),
          new Date(),
        ),
      }),
    mailer: input.mailer,
    failureLog: "admin invite email failed",
  });
  if (outcome.status === "error") {
    throw new Error(outcome.error.message);
  }
  return outcome;
}
