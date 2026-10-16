import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import { contactHref } from "@/config/legal";
import { revokeReleased } from "@/server/google/release";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deleteWorkspace } from "@/server/queries/members";
import {
  getSendingSuspension,
  updateWorkspace,
} from "@/server/queries/workspaces";
import { confirmNameBodySchema } from "@/shared/api/members";
import {
  type WorkspaceResponse,
  updateWorkspaceBodySchema,
} from "@/shared/api/workspaces";

type Ctx = RouteContext<"/api/workspaces/[slug]">;

/**
 * A workspace the caller belongs to, with their role and, while its sending is paused for review,
 * since when and how to reach us (401 / 404 otherwise).
 */
export async function GET(
  _request: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const suspension = await getSendingSuspension(
    context.supabase,
    context.workspace.id,
  );
  const body: WorkspaceResponse = {
    ...context.workspace,
    sendingSuspension: suspension
      ? {
          since: suspension.since,
          contact: contactHref(getServerEnv().SMTP_FROM),
        }
      : null,
  };
  return NextResponse.json(body);
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

/**
 * Deletes the workspace after the typed name (Owner only, `delete_workspace`), then revokes the
 * Google accounts it released (best effort).
 */
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
  const { data, error } = await deleteWorkspace(
    context.supabase,
    context.workspace.id,
    body.data.confirmName,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  await revokeReleased(data?.released ?? []);
  return ok();
}
