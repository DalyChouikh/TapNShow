import { NextResponse } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { requireUser } from "@/server/http/require-user";
import { getMyAccount } from "@/server/queries/account";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** What `/account` and its delete dialog need (spec §7.4): owned workspaces and counts. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const { data, error } = await getMyAccount(supabase);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
