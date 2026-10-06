import { NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { getMe, updateProfile } from "@/server/queries/profile";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { mePatchBodySchema } from "@/shared/api/me";

/** Signed-in user's profile and workspaces. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  return NextResponse.json(await getMe(supabase, user));
}

/** Updates the display name and/or the remembered workspace. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, mePatchBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await updateProfile(supabase, user.id, body.data);
  return error ? fromDatabaseError(error) : ok();
}
