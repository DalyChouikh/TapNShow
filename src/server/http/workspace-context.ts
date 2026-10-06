import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database } from "@/server/db/database.types";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { apiError } from "./errors";
import { requireUser, type AuthedUser } from "./require-user";

/** Everything a `/api/workspaces/[slug]/**` handler needs, or the error response to return. */
export type WorkspaceContext =
  | {
      ok: true;
      supabase: SupabaseClient<Database>;
      user: AuthedUser;
      workspace: WorkspaceDetails;
    }
  | { ok: false; response: NextResponse };

/** Resolves session + membership once per request (401 / 404). Role rules stay in Postgres. */
export async function loadWorkspaceContext(
  slug: string,
): Promise<WorkspaceContext> {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return { ok: false, response: apiError("unauthenticated") };
  }
  const workspace = await getWorkspaceBySlug(supabase, user.id, slug);
  return workspace
    ? { ok: true, supabase, user, workspace }
    : { ok: false, response: apiError("not_found") };
}
