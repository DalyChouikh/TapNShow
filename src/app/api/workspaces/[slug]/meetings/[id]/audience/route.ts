import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { getAudience, setAudience } from "@/server/queries/meetings";
import { audienceBodySchema } from "@/shared/api/meetings";

type Ctx = RouteContext<"/api/workspaces/[slug]/meetings/[id]/audience">;

/** The meeting's resolved audience (any member). */
export async function GET(
  _request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getAudience(context.supabase, id);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/** Replaces picked lists and individual include / exclude sets; answers the fresh audience. */
export async function PUT(
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
  const body = await parseJsonBody(request, audienceBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const saved = await setAudience(context.supabase, id, body.data);
  if (saved.error) {
    return fromDatabaseError(saved.error);
  }
  const { data, error } = await getAudience(context.supabase, id);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
