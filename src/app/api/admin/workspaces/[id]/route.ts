import type { NextResponse } from "next/server";
import { z } from "zod";
import { adminJson, loadAdminContext } from "@/server/http/admin-context";
import { apiError } from "@/server/http/errors";
import { adminWorkspace } from "@/server/queries/admin";

/** `GET /api/admin/workspaces/[id]`: one workspace's facts (spec §7.19). */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/workspaces/[id]">,
): Promise<NextResponse> {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) {
    return apiError("invalid_input");
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  return adminJson(await adminWorkspace(context.supabase, id.data));
}
