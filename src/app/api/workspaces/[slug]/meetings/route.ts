import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { createMeeting, listMeetings } from "@/server/queries/meetings";

type Ctx = RouteContext<"/api/workspaces/[slug]/meetings">;

/** All meetings of the workspace (any member). */
export async function GET(
  _request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listMeetings(
    context.supabase,
    context.workspace.id,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/** "+": a new draft from the workspace defaults (rate-limited in `create_meeting`). */
export async function POST(
  request: NextRequest | Request,
  ctx: Ctx,
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
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const { data, error } = await createMeeting(
    context.supabase,
    context.workspace.id,
  );
  return error ? fromDatabaseError(error) : NextResponse.json({ id: data });
}
