import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { createList } from "@/server/queries/roster";
import { listBodySchema } from "@/shared/api/roster";

/** Creates a list (name unique ignoring case; at most `lists_per_workspace_max`). */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/lists">,
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
  const body = await parseJsonBody(request, listBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await createList(
    context.supabase,
    context.workspace.id,
    body.data.name,
  );
  return error
    ? fromDatabaseError(error, { "23505": "list_name_taken" })
    : NextResponse.json(data);
}
