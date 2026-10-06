import type { NextRequest, NextResponse } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import {
  changeRole,
  leaveWorkspace,
  removeMember,
} from "@/server/queries/members";
import { changeRoleBodySchema } from "@/shared/api/members";

type Ctx = RouteContext<"/api/workspaces/[slug]/members/[userId]">;

/** Changes a member's role / check-in permission (rules enforced by `change_role`). */
export async function PATCH(
  request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, userId } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, changeRoleBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await changeRole(context.supabase, {
    workspaceId: context.workspace.id,
    userId,
    ...body.data,
  });
  return error ? fromDatabaseError(error) : ok();
}

/** Removes a member, or leaves the workspace when the target is the caller. */
export async function DELETE(
  request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, userId } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { error } =
    userId === context.user.id
      ? await leaveWorkspace(context.supabase, context.workspace.id)
      : await removeMember(context.supabase, context.workspace.id, userId);
  return error ? fromDatabaseError(error) : ok();
}
