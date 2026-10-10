import { NextResponse, type NextRequest } from "next/server";
import { PEOPLE_SEARCH_MAX } from "@/config/meetings";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { readPageParams } from "@/server/http/pagination";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { addPeople } from "@/server/queries/meetings";
import {
  listMeetingPeople,
  peopleCursorSchema,
} from "@/server/queries/results";
import { addPeopleBodySchema } from "@/shared/api/meetings";
import { peopleFilterSchema } from "@/shared/api/responses";

/** One page of a meeting's invitees with their answers (any member); `?filter=&search=&cursor=&limit=`. */
export async function GET(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/people">,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const filter = peopleFilterSchema.safeParse(
    new URL(request.url).searchParams.get("filter") ?? "all",
  );
  if (!filter.success) {
    return apiError("invalid_input");
  }
  const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
  if (search.length > PEOPLE_SEARCH_MAX) {
    return apiError("invalid_input");
  }
  const page = readPageParams(request, peopleCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listMeetingPeople(
    context.supabase,
    id,
    filter.data,
    page.limit,
    page.after,
    search || null,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

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
