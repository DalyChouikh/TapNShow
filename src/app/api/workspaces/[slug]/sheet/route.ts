import { NextResponse, type NextRequest } from "next/server";
import { revokeReleased } from "@/server/google/release";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { getWorkspaceSheet, turnOffSheet } from "@/server/queries/sheets";

type Ctx = RouteContext<"/api/workspaces/[slug]/sheet">;

/** The workspace's Google Sheet as this member sees it (spec §7.17); any member. */
export async function GET(
  _request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getWorkspaceSheet(
    context.supabase,
    context.workspace.id,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/**
 * Turn off the Google Sheet (Owner, spec §7.17): it stops updating and stays in Drive; the Google
 * account is revoked only if nothing else uses it.
 */
export async function DELETE(
  request: NextRequest | Request,
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
  const { data, error } = await turnOffSheet(
    context.supabase,
    context.workspace.id,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  await revokeReleased([data]);
  return ok();
}
