import { NextResponse } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { readPageParams } from "@/server/http/pagination";
import { requireUser } from "@/server/http/require-user";
import {
  getMyAnswers,
  myInvitesCursorSchema,
} from "@/server/queries/my-invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/**
 * One page of Download my answers (spec §7.4): every invite of the signed-in person, newest first,
 * with their reasons and comments, so it is never cached. Rate limited per page in the database.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const page = readPageParams(request, myInvitesCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const { data, error } = await getMyAnswers(supabase, page.limit, page.after);
  return error
    ? fromDatabaseError(error)
    : NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
