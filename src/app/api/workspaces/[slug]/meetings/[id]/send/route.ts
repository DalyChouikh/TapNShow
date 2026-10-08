import { NextResponse, type NextRequest } from "next/server";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { rejectCrossOrigin } from "@/server/http/request";
import { sendMeeting } from "@/server/queries/meetings";

/** The dispatcher run started in `after()` inherits this limit (its budget is 50 s). */
export const maxDuration = 60;

/** Queues the invites (first send and Invite more), then starts a dispatcher run at once. */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/send">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const { data, error } = await sendMeeting(context.supabase, id);
  if (error) {
    return fromDatabaseError(error);
  }
  scheduleDispatch();
  return NextResponse.json(data);
}
