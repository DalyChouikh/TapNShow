import { NextResponse, type NextRequest } from "next/server";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { rejectCrossOrigin } from "@/server/http/request";
import { nudgeMeeting } from "@/server/queries/meetings";

/** The dispatcher run started in `after()` inherits this limit (its budget is 50 s). */
export const maxDuration = 60;

/** Remind everyone who hasn't answered (spec §7.6 Nudge), then start sending at once. */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/nudge">,
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
  const { data, error } = await nudgeMeeting(context.supabase, id);
  if (error) {
    return fromDatabaseError(error);
  }
  scheduleDispatch();
  return NextResponse.json(data);
}
