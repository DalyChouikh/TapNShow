import { NextResponse } from "next/server";
import { APP_NAME } from "@/config/app";
import { deliverAdminInvite } from "@/server/admin/deliver-admin-invite";
import { generateToken, sha256Hex } from "@/server/crypto/tokens";
import { loadAdminContext } from "@/server/http/admin-context";
import { appOriginFor } from "@/server/http/app-origin";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { adminInvite } from "@/server/queries/admin";
import { getDisplayName } from "@/server/queries/profile";
import { scheduleWorkers } from "@/server/workers/schedule-workers";
import { adminInviteBodySchema } from "@/shared/api/admin";

/**
 * `POST /api/admin/invites`: the platform owner invites one address to help run TapNShow (spec
 * §7.19). Only the token's hash is stored; the token goes out by email or as a link to copy.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  if (context.role !== "owner") {
    return apiError("not_found");
  }
  const body = await parseJsonBody(request, adminInviteBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const token = generateToken();
  const created = await adminInvite(
    context.supabase,
    body.data.email,
    sha256Hex(token),
  );
  if (created.error) {
    return fromDatabaseError(created.error);
  }
  scheduleWorkers(["platform"]);
  return NextResponse.json(
    await deliverAdminInvite({
      supabase: context.supabase,
      token,
      email: body.data.email,
      expiresAt: created.data.expiresAt,
      delivery: body.data.delivery,
      origin: appOriginFor(request),
      inviterName:
        (await getDisplayName(context.supabase, context.user)) ?? APP_NAME,
    }),
  );
}
