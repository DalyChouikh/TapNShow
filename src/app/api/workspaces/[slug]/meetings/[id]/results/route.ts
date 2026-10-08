import { NextResponse } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { getMeetingResults } from "@/server/queries/results";

/** A meeting's email and answer counts (any member; refreshed while the page is live). */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/results">,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getMeetingResults(context.supabase, id);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
