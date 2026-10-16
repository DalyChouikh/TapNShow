import type { NextResponse } from "next/server";
import { runAdminWrite } from "@/server/http/admin-write";
import { liftSuspension, suspendWorkspace } from "@/server/queries/admin";

type Ctx = RouteContext<"/api/admin/workspaces/[id]/suspension">;

/** `POST …/suspension`: pause the workspace's sending (spec §7.12; confirmed in the UI). */
export async function POST(request: Request, ctx: Ctx): Promise<NextResponse> {
  return runAdminWrite(request, (await ctx.params).id, {
    action: suspendWorkspace,
  });
}

/** `DELETE …/suspension`: lift it; the paused emails go out again. */
export async function DELETE(
  request: Request,
  ctx: Ctx,
): Promise<NextResponse> {
  return runAdminWrite(request, (await ctx.params).id, {
    action: liftSuspension,
  });
}
