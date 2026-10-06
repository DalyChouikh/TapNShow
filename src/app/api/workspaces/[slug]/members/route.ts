import { NextResponse, type NextRequest } from "next/server";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { listMembers } from "@/server/queries/members";

/** Members of the workspace (any member may read). */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]/members">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  return NextResponse.json(
    await listMembers(context.supabase, context.workspace.id),
  );
}
