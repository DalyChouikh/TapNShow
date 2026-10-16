import { NextResponse } from "next/server";
import { z } from "zod";
import { loadAdminContext } from "@/server/http/admin-context";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { readPageParams, toPage } from "@/server/http/pagination";
import { adminWorkspaces } from "@/server/queries/admin";
import {
  ADMIN_WORKSPACE_FILTERS,
  ADMIN_WORKSPACE_SORTS,
  adminWorkspaceRowSchema,
} from "@/shared/api/admin";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(ADMIN_WORKSPACE_FILTERS).default("all"),
  sort: z.enum(ADMIN_WORKSPACE_SORTS).default("newest"),
});
/** The keyset: the sort's value (as text) and the id. */
const cursorSchema = z.tuple([z.string().max(64), z.uuid()]);

/** `GET /api/admin/workspaces?q=&filter=&sort=&cursor=&limit=` (spec §10 Admin API). */
export async function GET(request: Request): Promise<NextResponse> {
  const search = new URL(request.url).searchParams;
  const query = querySchema.safeParse({
    q: search.get("q") ?? undefined,
    filter: search.get("filter") ?? undefined,
    sort: search.get("sort") ?? undefined,
  });
  if (!query.success) {
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
  const { data, error } = await adminWorkspaces(context.supabase, {
    q: query.data.q || null,
    filter: query.data.filter,
    sort: query.data.sort,
    after: page.after,
    limit: page.limit,
  });
  if (error) {
    return fromDatabaseError(error);
  }
  const result = toPage(data, page.limit, (row) => [row.sortValue, row.id]);
  // The cursor carries the sort value; the rows don't.
  return NextResponse.json({
    ...result,
    items: result.items.map((row) => adminWorkspaceRowSchema.parse(row)),
  });
}
