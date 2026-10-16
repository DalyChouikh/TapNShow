import type { NextResponse } from "next/server";
import { sha256Hex } from "@/server/crypto/tokens";
import { adminOk } from "@/server/http/admin-context";
import { apiError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { acceptAdminInvite } from "@/server/queries/admin";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { scheduleWorkers } from "@/server/workers/schedule-workers";
import { adminInviteTokenBodySchema } from "@/shared/api/admin";

/**
 * `POST /api/admin/invites/accept`: the signed-in person becomes an admin when their verified
 * address is the invited one (`accept_admin_invite`), then `#platform` hears.
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
  const result = await acceptAdminInvite(supabase, sha256Hex(body.data.token));
  if (!result.error) {
    scheduleWorkers(["platform"]);
  }
  return adminOk(result);
}
