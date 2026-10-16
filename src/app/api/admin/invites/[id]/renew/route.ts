import { NextResponse } from "next/server";
import { z } from "zod";
import { APP_NAME } from "@/config/app";
import { deliverAdminInvite } from "@/server/admin/deliver-admin-invite";
import { generateToken, sha256Hex } from "@/server/crypto/tokens";
import { loadAdminContext } from "@/server/http/admin-context";
import { appOriginFor } from "@/server/http/app-origin";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { adminInviteRenew } from "@/server/queries/admin";
import { getDisplayName } from "@/server/queries/profile";
import { adminRenewBodySchema } from "@/shared/api/admin";

/**
 * `POST /api/admin/invites/[id]/renew`: a fresh link and 7 more days for a waiting admin invite
 * (the old link stops working), sent again or copied (platform owner only).
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/admin/invites/[id]/renew">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) {
    return apiError("invalid_input");
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  if (context.role !== "owner") {
    return apiError("not_found");
  }
  const body = await parseJsonBody(request, adminRenewBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const token = generateToken();
  const renewed = await adminInviteRenew(
    context.supabase,
    id.data,
    sha256Hex(token),
  );
  if (renewed.error) {
    return fromDatabaseError(renewed.error);
  }
  return NextResponse.json(
    await deliverAdminInvite({
      supabase: context.supabase,
      token,
      email: renewed.data.email,
      expiresAt: renewed.data.expiresAt,
      delivery: body.data.delivery,
      origin: appOriginFor(request),
      inviterName:
        (await getDisplayName(context.supabase, context.user)) ?? APP_NAME,
    }),
  );
}
