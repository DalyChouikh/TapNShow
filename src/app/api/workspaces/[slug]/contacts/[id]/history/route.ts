import { NextResponse } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { readPageParams, readPeriod } from "@/server/http/pagination";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import {
  getContactHistory,
  historyCursorSchema,
} from "@/server/queries/results";

/**
 * One person's history (any member, spec §7.7): the period's counts and one page of past
 * meetings, newest first; `?from=&to=&cursor=&limit=`. Another workspace's contact is 404.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[slug]/contacts/[id]/history">,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const period = readPeriod(request);
  if (!period.ok) {
    return period.response;
  }
  const page = readPageParams(request, historyCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getContactHistory(
    context.supabase,
    id,
    period.range,
    page.limit,
    page.after,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
