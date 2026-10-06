import type { NextRequest, NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deleteList, renameList } from "@/server/queries/roster";
import { listBodySchema } from "@/shared/api/roster";

type Ctx = RouteContext<"/api/workspaces/[slug]/lists/[id]">;

/** Renames a list. */
export async function PATCH(
  request: NextRequest | Request,
  ctx: Ctx,
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
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const body = await parseJsonBody(request, listBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await renameList(
    context.supabase,
    context.workspace.id,
    id,
    body.data.name,
  );
  if (error) {
    return fromDatabaseError(error, { "23505": "list_name_taken" });
  }
  return data?.length ? ok() : apiError("not_found");
}

/** Deletes a list; its people stay in the roster. */
export async function DELETE(
  request: NextRequest | Request,
  ctx: Ctx,
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
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const { data, error } = await deleteList(
    context.supabase,
    context.workspace.id,
    id,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  return data?.length ? ok() : apiError("not_found");
}
