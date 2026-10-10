import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { editSentMeeting } from "@/server/queries/meetings";
import { editMeetingBodySchema } from "@/shared/api/meetings";

/** Edit a sent meeting (spec §7.5): `dryRun` previews who would be told and writes nothing. */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/changes">,
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
  const body = await parseJsonBody(request, editMeetingBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await editSentMeeting(
    context.supabase,
    id,
    body.data,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
