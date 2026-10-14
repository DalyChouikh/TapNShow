import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSecret } from "@/config/secrets";
import { deriveInviteeToken } from "@/server/crypto/invitee-token";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { requireUser } from "@/server/http/require-user";
import { getMyInviteId } from "@/server/queries/my-invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { answerPagePath } from "@/shared/api/tokens";

/**
 * The answer page of one of the signed-in person's invites (spec §7.4, §10): derived from the
 * invitee id like the emailed link, only after the database confirms the invite is theirs. The
 * response carries a personal link, so it is never cached.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/me/invites/[id]/link">,
): Promise<NextResponse> {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) {
    return apiError("not_found");
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const { data, error } = await getMyInviteId(supabase, id.data);
  if (error || !data) {
    return error ? fromDatabaseError(error) : apiError("not_found");
  }
  const token = deriveInviteeToken(data, requireSecret("INVITE_TOKEN_SECRET"));
  return NextResponse.json(
    { path: answerPagePath(token) },
    { headers: { "cache-control": "no-store" } },
  );
}
