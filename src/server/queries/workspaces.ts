import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type Client = SupabaseClient<Database>;

/** Calls `create_workspace` (caller becomes Owner). */
export function createWorkspace(
  client: Client,
  input: { name: string; slug: string; timezone: string },
) {
  return client.rpc("create_workspace", {
    p_name: input.name,
    p_slug: input.slug,
    p_timezone: input.timezone,
  });
}

/**
 * Workspace + the caller's role, or null when it doesn't exist or the caller isn't a member (RLS).
 * @throws Error on database failures
 */
export async function getWorkspaceBySlug(
  client: Client,
  userId: string,
  slug: string,
): Promise<WorkspaceDetails | null> {
  const workspace = await client
    .from("workspaces")
    .select("id, slug, name, timezone")
    .eq("slug", slug)
    .maybeSingle();
  if (workspace.error) {
    throw new Error(workspace.error.message);
  }
  if (!workspace.data) {
    return null;
  }
  const role = await client
    .from("workspace_roles")
    .select("role, can_check_in")
    .eq("workspace_id", workspace.data.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (role.error) {
    throw new Error(role.error.message);
  }
  return role.data
    ? {
        ...workspace.data,
        myRole: role.data.role,
        canCheckIn: role.data.can_check_in,
      }
    : null;
}

/**
 * Renames / changes the timezone (RLS: Owner/Admin). Zero updated rows means the caller may
 * not edit it, reported as `tn:forbidden` so routes map it like database refusals.
 */
export async function updateWorkspace(
  client: Client,
  workspaceId: string,
  patch: { name?: string; timezone?: string },
): Promise<{ error: { code?: string; message: string } | null }> {
  const { data, error } = await client
    .from("workspaces")
    .update(patch)
    .eq("id", workspaceId)
    .select("id");
  if (error) {
    return { error };
  }
  return {
    error:
      data.length === 0 ? { code: "P0001", message: "tn:forbidden" } : null,
  };
}
