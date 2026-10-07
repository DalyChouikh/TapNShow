import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import {
  getWorkspaceSender,
  setWorkspaceSender,
} from "@/server/queries/sender";
import { setSenderBodySchema } from "@/shared/api/sender";

/** The workspace's sender Gmail, its usage today, and my own connections (spec §7.15). */
export async function GET(
  _request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/sender">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getWorkspaceSender(
    context.supabase,
    context.workspace.id,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/** Owner: make one of my connected Gmail accounts the workspace sender ("Use <address>"). */
export async function PUT(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/sender">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, setSenderBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await setWorkspaceSender(
    context.supabase,
    context.workspace.id,
    body.data.connectionId,
  );
  return error ? fromDatabaseError(error) : ok();
}
