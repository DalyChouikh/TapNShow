import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { rejectCrossOrigin } from "@/server/http/request";
import { duplicateMeeting } from "@/server/queries/meetings";

/** Duplicate (spec §7.9): a new draft with the same details and audience, and no date. */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/duplicate">,
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
  const { data, error } = await duplicateMeeting(context.supabase, id);
  if (error || !data) {
    return fromDatabaseError(error ?? { message: "no copy" });
  }
  return NextResponse.json({ id: data }, { status: 201 });
}
