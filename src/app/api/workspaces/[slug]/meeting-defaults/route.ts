import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import {
  getMeetingDefaults,
  updateMeetingDefaults,
} from "@/server/queries/sender";
import { updateMeetingDefaultsBodySchema } from "@/shared/api/meeting-settings";

/** Settings > Meeting defaults (any member reads). */
export async function GET(
  _request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meeting-defaults">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getMeetingDefaults(
    context.supabase,
    context.workspace.id,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/** Owner/Admin change some defaults; each field saves on its own (autosave). */
export async function PATCH(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meeting-defaults">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const body = await parseJsonBody(request, updateMeetingDefaultsBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await updateMeetingDefaults(
    context.supabase,
    context.workspace.id,
    body.data,
  );
  return error ? fromDatabaseError(error) : ok();
}
