import { NextResponse } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { readPageParams, readPeriod } from "@/server/http/pagination";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import {
  detailsCursorSchema,
  listAttendanceDetails,
} from "@/server/queries/results";

/** One page of per-person, per-meeting rows for exports (any member); `?from=&to=&cursor=`. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[slug]/attendance/details">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const period = readPeriod(request);
  if (!period.ok) {
    return period.response;
  }
  const page = readPageParams(request, detailsCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listAttendanceDetails(
    context.supabase,
    context.workspace.id,
    period.range,
    page.limit,
    page.after,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
