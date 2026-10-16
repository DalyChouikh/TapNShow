import type { NextResponse } from "next/server";
import { adminJson, loadAdminContext } from "@/server/http/admin-context";
import { adminAdmins } from "@/server/queries/admin";

/** `GET /api/admin/admins`: the owner, the admins and the waiting invites (addresses masked). */
export async function GET(): Promise<NextResponse> {
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  return adminJson(await adminAdmins(context.supabase));
}
