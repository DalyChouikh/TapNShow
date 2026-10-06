import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deleteWorkspace } from "@/server/queries/members";
import { updateWorkspace } from "@/server/queries/workspaces";
import { confirmNameBodySchema } from "@/shared/api/members";
import { updateWorkspaceBodySchema } from "@/shared/api/workspaces";

type Ctx = RouteContext<"/api/workspaces/[slug]">;

/** A workspace the caller belongs to, with their role (401 / 404 otherwise). */
export async function GET(
  _request: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  const context = await loadWorkspaceContext((await ctx.params).slug);
  return context.ok ? NextResponse.json(context.workspace) : context.response;
}

/** Renames the workspace and/or changes its timezone (Owner/Admin via RLS). */
export async function PATCH(
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
  const body = await parseJsonBody(request, updateWorkspaceBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await updateWorkspace(
    context.supabase,
    context.workspace.id,
    body.data,
  );
  return error ? fromDatabaseError(error) : ok();
}

/** Deletes the workspace after the typed name (Owner only, `delete_workspace`). */
export async function DELETE(
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
  const body = await parseJsonBody(request, confirmNameBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await deleteWorkspace(
    context.supabase,
    context.workspace.id,
    body.data.confirmName,
  );
  return error ? fromDatabaseError(error) : ok();
}
