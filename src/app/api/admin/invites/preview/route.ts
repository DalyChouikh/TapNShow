import type { NextResponse } from "next/server";
import { sha256Hex } from "@/server/crypto/tokens";
import { adminJson } from "@/server/http/admin-context";
import { apiError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { adminInvitePreview } from "@/server/queries/admin";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { adminInviteTokenBodySchema } from "@/shared/api/admin";

/**
 * `POST /api/admin/invites/preview`: what an admin invite link shows the signed-in person (anyone
 * signed in: the person isn't an admin yet). The token arrives in the body, never in a URL.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, adminInviteTokenBodySchema);
  if (!body.ok) {
    return body.response;
  }
  return adminJson(
    await adminInvitePreview(supabase, sha256Hex(body.data.token)),
  );
}
