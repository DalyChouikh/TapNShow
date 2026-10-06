import type { NextRequest, NextResponse } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { revokeInvite } from "@/server/queries/invites";

/** Revokes an open invite. */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]/invites/[id]">,
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
  const { error } = await revokeInvite(context.supabase, id);
  return error ? fromDatabaseError(error) : ok();
}
