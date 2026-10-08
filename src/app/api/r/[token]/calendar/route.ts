import { NextResponse } from "next/server";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadTokenContext } from "@/server/http/token-context";
import { requestCalendar } from "@/server/queries/tokens";

/** The dispatch kicked after a request may run this long (`DISPATCH_MAX_DURATION_S`). */
export const maxDuration = 60;

/** Announcement meetings: "Email me a calendar invite" (spec §7.3). Opening the page never does this. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/r/[token]/calendar">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await requestCalendar(
    context.client,
    context.tokenHash,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  if (!data) {
    return apiError("not_found");
  }
  scheduleDispatch();
  return ok();
}
