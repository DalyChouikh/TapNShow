import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { AuthedUser } from "@/server/http/require-user";
import type { MeResponse } from "@/shared/api/me";

type Client = SupabaseClient<Database>;

/**
 * Profile and memberships of the signed-in user (RLS: own profile, own roles, member workspaces).
 * @throws Error when either read fails
 */
export async function getMe(
  client: Client,
  user: AuthedUser,
): Promise<MeResponse> {
  const [profile, roles] = await Promise.all([
    client
      .from("profiles")
      .select("display_name, avatar_url, last_workspace_id")
      .eq("user_id", user.id)
      .single(),
    client
      .from("workspace_roles")
      .select("role, workspaces (id, slug, name)")
      .eq("user_id", user.id),
  ]);
  if (profile.error) {
    throw new Error(profile.error.message);
  }
  if (roles.error) {
    throw new Error(roles.error.message);
  }
  const workspaces = roles.data
    .flatMap((row) =>
      row.workspaces ? [{ ...row.workspaces, role: row.role }] : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    userId: user.id,
    profile: {
      displayName: profile.data.display_name,
      avatarUrl: profile.data.avatar_url,
      email: user.email,
    },
    workspaces,
    lastWorkspaceSlug:
      workspaces.find(
        (workspace) => workspace.id === profile.data.last_workspace_id,
      )?.slug ?? null,
  };
}

/** Updates the caller's own profile; RLS rejects foreign `lastWorkspaceId` with 42501. */
export async function updateProfile(
  client: Client,
  userId: string,
  patch: { displayName?: string; lastWorkspaceId?: string },
): Promise<{ error: { code?: string; message: string } | null }> {
  const { error } = await client
    .from("profiles")
    .update({
      ...(patch.displayName !== undefined
        ? { display_name: patch.displayName }
        : {}),
      ...(patch.lastWorkspaceId !== undefined
        ? { last_workspace_id: patch.lastWorkspaceId }
        : {}),
    })
    .eq("user_id", userId);
  return { error };
}

/** Name shown as the inviter in emails: display name, else email, else the app name. */
export async function getDisplayName(
  client: Client,
  user: AuthedUser,
): Promise<string | null> {
  const { data } = await client
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.display_name ?? user.email;
}
