import { NextResponse } from "next/server";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadTokenContext } from "@/server/http/token-context";
import { submitAnswer } from "@/server/queries/tokens";
import { submitAnswerBodySchema } from "@/shared/api/responses";

/** The dispatch kicked after an answer may run this long (`DISPATCH_MAX_DURATION_S`). */
export const maxDuration = 60;

/**
 * Saves the member's answer (spec §7.3). Only our page calls this, so it checks Origin like any
 * mutation; the token is the credential (no cookie). The database applies the meeting's rules and
 * refreshes the calendar job; a dispatch run is kicked so a due job goes out without waiting for cron.
 */
export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/r/[token]/response">,
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
  const body = await parseJsonBody(request, submitAnswerBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await submitAnswer(
    context.client,
    context.tokenHash,
    body.data,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  if (!data) {
    return apiError("not_found");
  }
  scheduleDispatch();
  return NextResponse.json(data);
}
