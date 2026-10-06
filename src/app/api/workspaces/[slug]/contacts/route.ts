import { NextResponse, type NextRequest } from "next/server";
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
  return NextResponse.json(
    await getRoster(context.supabase, context.workspace.id),
  );
}
