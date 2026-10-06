import { NextResponse } from "next/server";
import { sha256Hex } from "@/server/crypto/tokens";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { acceptInvite } from "@/server/queries/invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { inviteTokenBodySchema } from "@/shared/api/invites";

/** Accepts the invite for the signed-in, matching, verified email (`accept_invite`). */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, inviteTokenBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data: slug, error } = await acceptInvite(
    supabase,
    sha256Hex(body.data.token),
  );
  return error || !slug
    ? fromDatabaseError(error ?? { message: "accept_invite returned nothing" })
    : NextResponse.json({ slug });
}
