import type { NextRequest, NextResponse } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { transferOwnership } from "@/server/queries/members";
import { transferBodySchema } from "@/shared/api/members";

/** Transfers ownership to an existing Admin (Owner only, typed name). */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]/transfer">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, transferBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await transferOwnership(context.supabase, {
    workspaceId: context.workspace.id,
    ...body.data,
  });
  return error ? fromDatabaseError(error) : ok();
}
