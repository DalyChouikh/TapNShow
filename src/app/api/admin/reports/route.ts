import { NextResponse } from "next/server";
import { z } from "zod";
import { loadAdminContext } from "@/server/http/admin-context";
import { fromDatabaseError } from "@/server/http/errors";
import { readPageParams, toPage } from "@/server/http/pagination";
import { adminReports } from "@/server/queries/admin";

/** The keyset: when it was reported, then the id. */
const cursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

/** `GET /api/admin/reports?cursor=&limit=`: "Not my group" reports, newest first (spec §7.19). */
export async function GET(request: Request): Promise<NextResponse> {
  const page = readPageParams(request, cursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await adminReports(
    context.supabase,
    page.after,
    page.limit,
  );
  return error
    ? fromDatabaseError(error)
    : NextResponse.json(
        toPage(data, page.limit, (row) => [row.reportedAt, row.id]),
      );
}
