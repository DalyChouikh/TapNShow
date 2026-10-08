import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { getRoster } from "@/server/queries/roster";

/** The whole roster (any member; Viewers read only). */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]/contacts">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getRoster(
    context.supabase,
    context.workspace.id,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
