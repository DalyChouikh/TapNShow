import { NextResponse, type NextRequest } from "next/server";
import { canCheckIn } from "@/lib/responses/check-in";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { markAttendance } from "@/server/queries/check-in";
import { markBodySchema } from "@/shared/api/responses";

/**
 * Check one person in (spec §7.8). Viewers with check-in pass here; the database is the gate
 * (`forbidden`, `check_in_closed` before the start).
 */
export async function PUT(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/check-in">,
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
  if (!canCheckIn(context.workspace)) {
    return apiError("forbidden");
  }
  const body = await parseJsonBody(request, markBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await markAttendance(
    context.supabase,
    id,
    body.data.inviteeId,
    body.data.actual,
  );
  return error ? fromDatabaseError(error) : NextResponse.json({ mark: data });
}
