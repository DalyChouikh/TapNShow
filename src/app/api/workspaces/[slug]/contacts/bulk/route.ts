import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { bulkContacts } from "@/server/queries/roster";
import { bulkContactsBodySchema } from "@/shared/api/roster";

/** Select-mode actions: delete, add to a list, remove from a list. */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/contacts/bulk">,
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
  const body = await parseJsonBody(request, bulkContactsBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await bulkContacts(context.supabase, {
    workspaceId: context.workspace.id,
    action: body.data.action,
    contactIds: body.data.contactIds,
    listId: body.data.action === "delete" ? undefined : body.data.listId,
  });
  return error
    ? fromDatabaseError(error)
    : NextResponse.json({ affected: data ?? 0 });
}
