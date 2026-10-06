import type { NextRequest, NextResponse } from "next/server";
import { generateToken, sha256Hex } from "@/server/crypto/tokens";
import { appOriginFor } from "@/server/http/app-origin";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deliverInvite } from "@/server/invites/deliver-invite";
import { renewInvite } from "@/server/queries/invites";
import { getDisplayName } from "@/server/queries/profile";
import { renewInviteBodySchema } from "@/shared/api/invites";

/** Issues a new token for an open invite (old link stops working) and delivers it again. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]/invites/[id]/renew">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, renewInviteBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const token = generateToken();
  const { error } = await renewInvite(context.supabase, id, sha256Hex(token));
  if (error) {
    return fromDatabaseError(error);
  }
  return deliverInvite({
    supabase: context.supabase,
    workspaceId: context.workspace.id,
    inviteId: id,
    token,
    delivery: body.data.delivery,
    origin: appOriginFor(request),
    inviterName:
      (await getDisplayName(context.supabase, context.user)) ??
      context.workspace.name,
    workspaceName: context.workspace.name,
  });
}
