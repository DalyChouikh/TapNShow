import type { NextResponse } from "next/server";
import { runAdminWrite } from "@/server/http/admin-write";
import { adminInviteRevoke } from "@/server/queries/admin";

/** `DELETE /api/admin/invites/[id]`: the platform owner revokes a waiting admin invite. */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/admin/invites/[id]">,
): Promise<NextResponse> {
  return runAdminWrite(request, (await ctx.params).id, {
    ownerOnly: true,
    action: adminInviteRevoke,
  });
}
