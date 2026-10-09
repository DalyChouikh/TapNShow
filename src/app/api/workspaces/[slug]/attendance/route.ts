import { NextResponse } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { readPeriod } from "@/server/http/pagination";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { getAttendanceSummary } from "@/server/queries/results";

/** The Attendance table (any member): every roster contact's counts for `?from=&to=`. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[slug]/attendance">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const period = readPeriod(request);
  if (!period.ok) {
    return period.response;
  }
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getAttendanceSummary(
    context.supabase,
    context.workspace.id,
    period.range,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
