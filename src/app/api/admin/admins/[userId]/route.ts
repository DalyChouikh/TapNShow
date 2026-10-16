import type { NextResponse } from "next/server";
import { runAdminWrite } from "@/server/http/admin-write";
import { adminRemove } from "@/server/queries/admin";

/** `DELETE /api/admin/admins/[userId]`: the platform owner removes an admin (never the owner). */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/admin/admins/[userId]">,
): Promise<NextResponse> {
  return runAdminWrite(request, (await ctx.params).userId, {
    ownerOnly: true,
    action: adminRemove,
  });
}
