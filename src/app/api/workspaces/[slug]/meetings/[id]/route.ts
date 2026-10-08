import { NextResponse, type NextRequest } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { deleteMeeting, updateMeeting } from "@/server/queries/meetings";
import { updateMeetingBodySchema } from "@/shared/api/meetings";

type Ctx = RouteContext<"/api/workspaces/[slug]/meetings/[id]">;

/** One meeting (any member). */
export async function GET(
  _request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  return context.ok ? NextResponse.json(context.meeting) : context.response;
}

/** Saves one wizard step on a draft (spec §7.2: every step change saves). */
export async function PATCH(
  request: NextRequest | Request,
  ctx: Ctx,
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
  if (context.meeting.status !== "draft") {
    return apiError("meeting_not_draft");
  }
  const body = await parseJsonBody(request, updateMeetingBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await updateMeeting(
    context.supabase,
    context.workspace.id,
    id,
    body.data,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? NextResponse.json(data) : apiError("meeting_not_draft");
}

/** Deletes a draft (the UI confirms first). */
export async function DELETE(
  request: NextRequest | Request,
  ctx: Ctx,
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
  if (context.meeting.status !== "draft") {
    return apiError("meeting_not_draft");
  }
  const { data, error } = await deleteMeeting(
    context.supabase,
    context.workspace.id,
    id,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? ok() : apiError("meeting_not_draft");
}
