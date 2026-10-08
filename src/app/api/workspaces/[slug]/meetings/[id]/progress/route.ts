import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { getProgress } from "@/server/queries/meetings";

/** Live send progress (any member; polled while emails are queued). */
export async function GET(
  _request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/progress">,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getProgress(context.supabase, id);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
