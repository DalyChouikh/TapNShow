import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { Member } from "@/shared/api/members";

type Client = SupabaseClient<Database>;

/**
 * Members with names and emails (`list_members`, members only).
 * @throws Error with the database message (`tn:forbidden` for non-members)
 */
export async function listMembers(
  client: Client,
  workspaceId: string,
): Promise<Member[]> {
  const { data, error } = await client.rpc("list_members", {
    p_workspace: workspaceId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => ({
    userId: row.user_id,
    role: row.role,
    canCheckIn: row.can_check_in,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    email: row.email,
    joinedAt: row.joined_at,
  }));
}

/** `change_role` (Owner-only for Admin changes). */
export function changeRole(
  client: Client,
  input: {
    workspaceId: string;
    userId: string;
    role: "admin" | "viewer";
    canCheckIn: boolean;
  },
) {
  return client.rpc("change_role", {
    p_workspace: input.workspaceId,
    p_user: input.userId,
    p_role: input.role,
    p_can_check_in: input.canCheckIn,
  });
}

/** `remove_member` (never the Owner, never yourself). */
export function removeMember(
  client: Client,
  workspaceId: string,
  userId: string,
) {
  return client.rpc("remove_member", {
    p_workspace: workspaceId,
    p_user: userId,
  });
}

/** `leave_workspace` (the Owner must transfer first). */
export function leaveWorkspace(client: Client, workspaceId: string) {
  return client.rpc("leave_workspace", { p_workspace: workspaceId });
}

/** `transfer_ownership` to an existing Admin after typing the name. */
export function transferOwnership(
  client: Client,
  input: { workspaceId: string; userId: string; confirmName: string },
) {
  return client.rpc("transfer_ownership", {
    p_workspace: input.workspaceId,
    p_new_owner: input.userId,
    p_confirm_name: input.confirmName,
  });
}

/** `delete_workspace` (Owner only, typed name). */
export function deleteWorkspace(
  client: Client,
  workspaceId: string,
  confirmName: string,
) {
  return client.rpc("delete_workspace", {
    p_workspace: workspaceId,
    p_confirm_name: confirmName,
  });
}
