import { NextResponse } from "next/server";
import { sha256Hex } from "@/server/crypto/tokens";
import { apiError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { previewInvite } from "@/server/queries/invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { inviteTokenBodySchema } from "@/shared/api/invites";

/** What `/invite/[token]` shows to the signed-in user. POST keeps the token out of URLs and logs. */
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
  return NextResponse.json(
    await previewInvite(supabase, sha256Hex(body.data.token)),
  );
}
