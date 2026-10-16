import type { NextResponse } from "next/server";
import { z } from "zod";
import { adminJson, loadAdminContext } from "@/server/http/admin-context";
import { apiError } from "@/server/http/errors";
import { adminOverview } from "@/server/queries/admin";
import { ADMIN_OVERVIEW_DAYS } from "@/shared/api/admin";

const daysSchema = z.coerce
  .number()
  .pipe(z.union(ADMIN_OVERVIEW_DAYS.map((days) => z.literal(days))))
  .default(30);

/** `GET /api/admin/overview?days=7|30|90` (spec §7.19 Overview; 30 by default). */
export async function GET(request: Request): Promise<NextResponse> {
  const days = daysSchema.safeParse(
    new URL(request.url).searchParams.get("days") ?? undefined,
  );
  if (!days.success) {
    return apiError("invalid_input");
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  return adminJson(await adminOverview(context.supabase, days.data));
}
