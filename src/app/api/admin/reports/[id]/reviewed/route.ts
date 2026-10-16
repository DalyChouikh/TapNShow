import type { NextResponse } from "next/server";
import { runAdminWrite } from "@/server/http/admin-write";
import { adminMarkReviewed } from "@/server/queries/admin";

/** `POST /api/admin/reports/[id]/reviewed`: marks one report reviewed (logged once). */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/admin/reports/[id]/reviewed">,
): Promise<NextResponse> {
  return runAdminWrite(request, (await ctx.params).id, {
    action: adminMarkReviewed,
  });
}
