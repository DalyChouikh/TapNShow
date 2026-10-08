import { NextResponse, type NextRequest } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { readPageParams } from "@/server/http/pagination";
import {
  createMeeting,
  listMeetingsPage,
  meetingCursorSchema,
} from "@/server/queries/meetings";
import { meetingTabSchema } from "@/shared/api/meetings";

type Ctx = RouteContext<"/api/workspaces/[slug]/meetings">;

/** One page of a Meetings tab (any member); `?tab=upcoming|past|drafts&cursor=&limit=`. */
export async function GET(
  request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const tab = meetingTabSchema.safeParse(
    new URL(request.url).searchParams.get("tab") ?? "upcoming",
  );
  if (!tab.success) {
    return apiError("invalid_input");
  }
  const page = readPageParams(request, meetingCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listMeetingsPage(
    context.supabase,
    context.workspace.id,
    tab.data,
    page.limit,
    page.after,
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
