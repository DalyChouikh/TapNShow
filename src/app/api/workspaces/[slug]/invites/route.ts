import { NextResponse, type NextRequest } from "next/server";
import { generateToken, sha256Hex } from "@/server/crypto/tokens";
import { appOriginFor } from "@/server/http/app-origin";
import { fromDatabaseError } from "@/server/http/errors";
import { readPageParams } from "@/server/http/pagination";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import {
  deliverInviteOutcome,
  type DeliveryOutcome,
} from "@/server/invites/deliver-invite";
import {
  createInvite,
  inviteCursorSchema,
  listOpenInvitesPage,
} from "@/server/queries/invites";
import { getDisplayName } from "@/server/queries/profile";
import {
  createInviteBodySchema,
  type InviteResult,
} from "@/shared/api/invites";

type Ctx = RouteContext<"/api/workspaces/[slug]/invites">;

/** One page of open invites (Owner/Admin; RLS returns none to Viewers); `?cursor=&limit=`. */
export async function GET(
  request: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  const page = readPageParams(request, inviteCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listOpenInvitesPage(
    context.supabase,
    context.workspace.id,
    page.limit,
    page.after,
    new Date(),
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/** Maps one address's delivery outcome to its result row. */
function toResult(
  email: string,
  inviteId: string,
  outcome: DeliveryOutcome,
): InviteResult {
  switch (outcome.status) {
    case "link":
      return { email, status: "link", inviteId, link: outcome.link };
    case "sent":
    case "email_limit":
    case "email_failed":
      return { email, status: outcome.status, inviteId };
    default:
      return { email, status: "error", inviteId };
  }
}

/**
 * Invites up to INVITE_BATCH_MAX addresses: each gets its own email-bound, single-use invite and
 * token, delivered by email or returned as a link. Results come back per address; the whole batch
 * is refused only when the caller may not invite at all.
 */
export async function POST(
  request: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, createInviteBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const origin = appOriginFor(request);
  const inviterName =
    (await getDisplayName(context.supabase, context.user)) ??
    context.workspace.name;
  const results: InviteResult[] = [];
  for (const email of body.data.emails) {
    const token = generateToken();
    const { data: inviteId, error } = await createInvite(context.supabase, {
      workspaceId: context.workspace.id,
      email,
      role: body.data.role,
      tokenHash: sha256Hex(token),
    });
    if (error?.message === "tn:forbidden") {
      return fromDatabaseError(error);
    }
    if (error || !inviteId) {
      results.push({
        email,
        status:
          error?.message === "tn:already_member" ? "already_member" : "error",
      });
      continue;
    }
    const outcome = await deliverInviteOutcome({
      supabase: context.supabase,
      workspaceId: context.workspace.id,
      inviteId,
      token,
      delivery: body.data.delivery,
      origin,
      inviterName,
      workspaceName: context.workspace.name,
    });
    results.push(toResult(email, inviteId, outcome));
  }
  return NextResponse.json({ results });
}
