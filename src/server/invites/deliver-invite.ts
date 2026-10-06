import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { NextResponse } from "next/server";
import { renderInviteEmail } from "@/emails/invite-email";
import { logger } from "@/lib/logger";
import type { Database } from "@/server/db/database.types";
import {
  createSystemMailer,
  type SystemEmail,
} from "@/server/email/system-mailer";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { consumeInviteEmail, getInvite } from "@/server/queries/invites";

/**
 * Hands a freshly (re)issued invite token to the person: returns the link for "link"
 * delivery, or spends email budget and emails it. On budget or SMTP failure the invite stays
 * valid and the error carries `inviteId` so the UI can offer "Copy link instead".
 */
export async function deliverInvite(input: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  inviteId: string;
  token: string;
  delivery: "email" | "link";
  origin: string;
  inviterName: string;
  workspaceName: string;
  mailer?: { send: (email: SystemEmail) => Promise<void> };
}): Promise<NextResponse> {
  const link = `${input.origin}/invite/${input.token}`;
  if (input.delivery === "link") {
    return NextResponse.json(
      { id: input.inviteId, delivery: "link", link },
      { status: 201 },
    );
  }
  const invite = await getInvite(input.supabase, input.inviteId);
  if (!invite) {
    return apiError("not_found");
  }
  // Budget is spent per attempt, including failed SMTP sends: retries cannot hammer Gmail.
  const budget = await consumeInviteEmail(input.supabase, input.workspaceId);
  if (budget.error) {
    return fromDatabaseError(budget.error);
  }
  if (budget.data !== true) {
    return apiError("invite_email_limit", { inviteId: input.inviteId });
  }
  try {
    const content = await renderInviteEmail({
      workspaceName: input.workspaceName,
      inviterName: input.inviterName,
      role: invite.role,
      link,
      expiresInDays: differenceInCalendarDays(
        parseISO(invite.expiresAt),
        new Date(),
      ),
    });
    await (input.mailer ?? createSystemMailer()).send({
      to: invite.email,
      ...content,
    });
  } catch (error) {
    logger.error({ err: error }, "invite email failed");
    return apiError("email_failed", { inviteId: input.inviteId });
  }
  return NextResponse.json(
    { id: input.inviteId, delivery: "email" },
    { status: 201 },
  );
}
