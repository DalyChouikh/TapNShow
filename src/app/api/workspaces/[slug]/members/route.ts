import { NextResponse, type NextRequest } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { readPageParams } from "@/server/http/pagination";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { listMembersPage, memberCursorSchema } from "@/server/queries/members";
import { workspaceRoleSchema } from "@/shared/api/me";

/** One page of the workspace's members (any member may read); `?role=&cursor=&limit=`. */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]/members">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const roleParam = request.nextUrl.searchParams.get("role");
  const role = workspaceRoleSchema.nullable().safeParse(roleParam);
  if (!role.success) {
    return apiError("invalid_input");
  }
  const page = readPageParams(request, memberCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listMembersPage(
    context.supabase,
    context.workspace.id,
    role.data,
    page.limit,
    page.after,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
