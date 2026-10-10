import { NextResponse, type NextRequest } from "next/server";
import { canCheckIn } from "@/lib/responses/check-in";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { rejectCrossOrigin } from "@/server/http/request";
import { markRestAsDeclared } from "@/server/queries/check-in";

/** "Mark the rest as they said" (spec §7.8): everyone not checked in yet, from their answer. */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/check-in/rest">,
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
  const { data, error } = await markRestAsDeclared(context.supabase, id);
  return error ? fromDatabaseError(error) : NextResponse.json({ marked: data });
}
