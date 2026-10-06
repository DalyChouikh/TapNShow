import { NextResponse } from "next/server";
import { generateWorkspaceSlug } from "@/lib/slug";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { createWorkspace } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { createWorkspaceBodySchema } from "@/shared/api/workspaces";

/** Slug collisions are rare (32^4 suffixes per name); retry this many times. */
const SLUG_ATTEMPTS = 3;

/** Creates a workspace owned by the caller. */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, createWorkspaceBodySchema);
  if (!body.ok) {
    return body.response;
  }
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const { data, error } = await createWorkspace(supabase, {
      ...body.data,
      slug: generateWorkspaceSlug(body.data.name),
    });
    if (!error && data) {
      return NextResponse.json({ slug: data.slug }, { status: 201 });
    }
    if (error?.code !== "23505") {
      return fromDatabaseError(
        error ?? { message: "create_workspace returned nothing" },
      );
    }
  }
  return apiError("conflict");
}
