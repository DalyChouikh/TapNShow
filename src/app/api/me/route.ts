import { after, NextResponse } from "next/server";
import {
  afterAccountDeleted,
  removeAuthUser,
} from "@/server/account/delete-account";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { deleteAccountData } from "@/server/queries/account";
import { getMe, updateProfile } from "@/server/queries/profile";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { deleteAccountBodySchema } from "@/shared/api/account";
import { mePatchBodySchema } from "@/shared/api/me";

/** Account deletion waits on Google and the admin API; the after-work runs within this budget. */
export const maxDuration = 60;

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

/**
 * Delete my account (spec §7.4, §11): the database erases, leaves and releases in one transaction,
 * then the auth user is deleted and the session ends. Revoking the released Google tokens and the
 * Owner emails run after the response, and run even when deleting the auth user fails: the
 * database part has committed, and a retry would find nothing left to revoke.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, deleteAccountBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await deleteAccountData(supabase, body.data.confirm);
  if (error || !data) {
    return error ? fromDatabaseError(error) : apiError("internal");
  }
  after(() => afterAccountDeleted(data));
  if (!(await removeAuthUser(user.id))) {
    return apiError("internal");
  }
  await supabase.auth.signOut({ scope: "local" });
  return ok();
}
