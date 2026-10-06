import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { importContacts } from "@/server/queries/roster";
import { importBodySchema } from "@/shared/api/roster";

/** Import preview (`dryRun: true`) or commit; also used by "+ Add" with one row (spec §6). */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/contacts/import">,
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
  const body = await parseJsonBody(request, importBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await importContacts(context.supabase, {
    workspaceId: context.workspace.id,
    ...body.data,
  });
  return result.error
    ? fromDatabaseError(result.error)
    : NextResponse.json(result.data);
}
