import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/server/http/errors";
import { requireUser } from "@/server/http/require-user";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** A workspace the caller belongs to, with their role. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const workspace = await getWorkspaceBySlug(supabase, user.id, slug);
  return workspace ? NextResponse.json(workspace) : apiError("not_found");
}
