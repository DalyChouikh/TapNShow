import type { NextResponse } from "next/server";
import { adminJson, loadAdminContext } from "@/server/http/admin-context";
import { apiError } from "@/server/http/errors";
import { adminOverview } from "@/server/queries/admin";
import { adminOverviewQuerySchema } from "@/shared/api/admin";

/**
 * `GET /api/admin/overview?from=&to=` (spec §7.19 Overview): one period of UTC days for the
 * figures and the chart. The database decides what range it accepts (up to two years, ending
 * today at the latest).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const search = new URL(request.url).searchParams;
  const period = adminOverviewQuerySchema.safeParse({
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  if (!period.success) {
    return apiError("invalid_input");
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  return adminJson(await adminOverview(context.supabase, period.data));
}
