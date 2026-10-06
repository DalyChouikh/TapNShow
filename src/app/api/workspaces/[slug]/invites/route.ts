import { NextResponse, type NextRequest } from "next/server";
import { generateToken, sha256Hex } from "@/server/crypto/tokens";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deliverInvite } from "@/server/invites/deliver-invite";
import { createInvite, listOpenInvites } from "@/server/queries/invites";
import { getDisplayName } from "@/server/queries/profile";
import { createInviteBodySchema } from "@/shared/api/invites";

type Ctx = RouteContext<"/api/workspaces/[slug]/invites">;

/** Open invites (Owner/Admin; RLS returns none to Viewers). */
export async function GET(
  _request: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  return NextResponse.json(
    await listOpenInvites(context.supabase, context.workspace.id),
  );
}

/** Creates an email-bound invite and delivers it by email or as a copyable link. */
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
  const token = generateToken();
  const { data: inviteId, error } = await createInvite(context.supabase, {
    workspaceId: context.workspace.id,
    email: body.data.email,
    role: body.data.role,
    tokenHash: sha256Hex(token),
  });
  if (error || !inviteId) {
    return fromDatabaseError(
      error ?? { message: "create_invite returned nothing" },
    );
  }
  return deliverInvite({
    supabase: context.supabase,
    workspaceId: context.workspace.id,
    inviteId,
    token,
    delivery: body.data.delivery,
    origin: request.nextUrl.origin,
    inviterName:
      (await getDisplayName(context.supabase, context.user)) ??
      context.workspace.name,
    workspaceName: context.workspace.name,
  });
}
