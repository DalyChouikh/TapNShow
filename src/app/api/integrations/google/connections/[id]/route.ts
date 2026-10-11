import { NextResponse, type NextRequest } from "next/server";
import { revokeReleased } from "@/server/google/release";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { disconnectGoogleConnection } from "@/server/queries/sender";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/**
 * Disconnects one of my Google connections from sending (workspaces sending from it pause, spec
 * §7.15). The account is released and its token revoked at Google (best effort) only when no
 * Google Sheet lives in it.
 */
export async function DELETE(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/integrations/google/connections/[id]">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const { data, error } = await disconnectGoogleConnection(supabase, id);
  if (error || !data) {
    return error ? fromDatabaseError(error) : apiError("not_found");
  }
  await revokeReleased([data.released]);
  return ok();
}
