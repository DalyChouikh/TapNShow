import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { addPeople } from "@/server/queries/meetings";
import { addPeopleBodySchema } from "@/shared/api/meetings";

/** "Add people": several people at once, as guests or saved to the roster (spec §7.2). */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/people">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const body = await parseJsonBody(request, addPeopleBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await addPeople(context.supabase, id, body.data);
  return error
    ? fromDatabaseError(error)
    : NextResponse.json({ contactIds: data });
}
