import { NextResponse } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { readPeriod } from "@/server/http/pagination";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { getWorkspaceInsights } from "@/server/queries/results";

/** Home's insights (any member, Viewers too): roster counts and how `?from=&to=` went. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[slug]/insights">,
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
  const { data, error } = await getWorkspaceInsights(
    context.supabase,
    context.workspace.id,
    period.range,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
