import { NextResponse } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { readPageParams } from "@/server/http/pagination";
import { requireUser } from "@/server/http/require-user";
import {
  getMyInvites,
  myInvitesCursorSchema,
} from "@/server/queries/my-invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { myInvitesQuerySchema } from "@/shared/api/my-invites";

/**
 * The signed-in person's invites across every workspace (spec §7.4):
 * `?tab=upcoming|past&filter=all|needs&cursor=&limit=`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const search = new URL(request.url).searchParams;
  const query = myInvitesQuerySchema.safeParse({
    tab: search.get("tab") ?? undefined,
    filter: search.get("filter") ?? undefined,
  });
  if (!query.success) {
    return apiError("invalid_input");
  }
  const page = readPageParams(request, myInvitesCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const { data, error } = await getMyInvites(
    supabase,
    query.data.tab,
    query.data.filter,
    page.limit,
    page.after,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
