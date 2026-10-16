import { NextResponse } from "next/server";
import { z } from "zod";
import { loadAdminContext } from "@/server/http/admin-context";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { readPageParams, toPage } from "@/server/http/pagination";
import { adminLog } from "@/server/queries/admin";
import { ADMIN_LOG_FILTERS } from "@/shared/api/admin";

const filterSchema = z.enum(ADMIN_LOG_FILTERS).default("all");
/** The keyset: the event id (newest first). */
const cursorSchema = z.tuple([z.number().int().positive()]);

/** `GET /api/admin/log?filter=&cursor=&limit=`: who did what and when (spec §7.19). */
export async function GET(request: Request): Promise<NextResponse> {
  const filter = filterSchema.safeParse(
    new URL(request.url).searchParams.get("filter") ?? undefined,
  );
  if (!filter.success) {
    return apiError("invalid_input");
  }
  const page = readPageParams(request, cursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await adminLog(
    context.supabase,
    filter.data,
    page.after?.[0] ?? null,
    page.limit,
  );
  return error
    ? fromDatabaseError(error)
    : NextResponse.json(toPage(data, page.limit, (row) => [row.id]));
}
