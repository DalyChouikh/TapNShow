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

/** What delivering one invite produced. */
export type DeliveryOutcome =
  | { status: "link"; link: string }
  | { status: "sent" }
  | { status: "email_limit" }
  | { status: "email_failed" }
  | { status: "not_found" }
  | { status: "error"; error: { code?: string; message: string } };

/** Everything needed to deliver one freshly (re)issued invite token. */
export type DeliveryInput = {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  inviteId: string;
  token: string;
  delivery: "email" | "link";
  origin: string;
  inviterName: string;
  workspaceName: string;
  mailer?: { send: (email: SystemEmail) => Promise<void> };
};

/** What emailing one token link produced (the link itself stays valid whatever happens). */
export type EmailedLink =
  | { status: "sent" }
  | { status: "email_limit" }
  | { status: "email_failed" }
  | { status: "error"; error: { code?: string; message: string } };

/**
 * Emails one token link within a sending budget: the budget is spent per attempt, failed SMTP
 * sends included, so retries can't hammer Gmail; over the budget or on a failed send the token
 * stays valid (the UI offers "Copy link"). The one place these rules live (workspace and admin
 * invites).
 */
export async function emailTokenLink(input: {
  to: string;
  spendBudget: () => PromiseLike<{
    data: boolean | null;
    error: { code?: string; message: string } | null;
  }>;
  render: () => Promise<{ subject: string; html: string; text: string }>;
  mailer?: { send: (email: SystemEmail) => Promise<void> };
  failureLog: string;
}): Promise<EmailedLink> {
  const budget = await input.spendBudget();
  if (budget.error) {
    return { status: "error", error: budget.error };
  }
  if (budget.data !== true) {
    return { status: "email_limit" };
  }
  try {
    const content = await input.render();
    await (input.mailer ?? createSystemMailer()).send({
      to: input.to,
      ...content,
    });
  } catch (error) {
    logger.error({ err: error }, input.failureLog);
    return { status: "email_failed" };
  }
  return { status: "sent" };
}

/**
 * Hands one invite token to its person: returns the link for "link" delivery, or emails it within
 * the workspace's budget (`emailTokenLink`).
 */
export async function deliverInviteOutcome(
  input: DeliveryInput,
): Promise<DeliveryOutcome> {
  const link = `${input.origin}/invite/${input.token}`;
  if (input.delivery === "link") {
    return { status: "link", link };
  }
  const invite = await getInvite(input.supabase, input.inviteId);
  if (!invite) {
    return { status: "not_found" };
  }
  return emailTokenLink({
    to: invite.email,
    spendBudget: () => consumeInviteEmail(input.supabase, input.workspaceId),
    render: () =>
      renderInviteEmail({
        workspaceName: input.workspaceName,
        inviterName: input.inviterName,
        role: invite.role,
        link,
        expiresInDays: differenceInCalendarDays(
          parseISO(invite.expiresAt),
          new Date(),
        ),
      }),
    mailer: input.mailer,
    failureLog: "invite email failed",
  });
}

/** Single-invite response (renew): the outcome as `inviteDeliveredSchema` or an API error. */
export async function deliverInvite(
  input: DeliveryInput,
): Promise<NextResponse> {
  const outcome = await deliverInviteOutcome(input);
  switch (outcome.status) {
    case "link":
      return NextResponse.json(
        { id: input.inviteId, delivery: "link", link: outcome.link },
        { status: 201 },
      );
    case "sent":
      return NextResponse.json(
        { id: input.inviteId, delivery: "email" },
        { status: 201 },
      );
    case "email_limit":
      return apiError("invite_email_limit", { inviteId: input.inviteId });
    case "email_failed":
      return apiError("email_failed", { inviteId: input.inviteId });
    case "not_found":
      return apiError("not_found");
    case "error":
      return fromDatabaseError(outcome.error);
  }
}
