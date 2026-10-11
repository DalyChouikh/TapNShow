import { type NextRequest, type NextResponse } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { retrySheet } from "@/server/queries/sheets";
import { scheduleWorkers } from "@/server/workers/schedule-workers";

/** `after()` work may run this long (the sheet worker keeps to its own budget inside it). */
export const maxDuration = 60;

/**
 * Try again (Owner, rate limited, spec §7.17): redraw now, and resume a sheet whose file was
 * restored from the trash. The sheet worker starts after the response.
 */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/sheet/retry">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const { error } = await retrySheet(context.supabase, context.workspace.id);
  if (error) {
    return fromDatabaseError(error);
  }
  scheduleWorkers(["sheets"]);
  return ok();
}
