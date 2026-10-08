import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import { encodeCursor } from "@/server/http/pagination";
import { type WorkspaceRole, workspaceRoleSchema } from "@/shared/api/me";
import type { Member } from "@/shared/api/members";
import type { Page } from "@/shared/api/pagination";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

const memberRowSchema = z.object({
  user_id: z.uuid(),
  role: workspaceRoleSchema,
  can_check_in: z.boolean(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  email: z.string(),
  joined_at: z.string(),
  sort_name: z.string(),
});

/** Keyset of the members list: role, lower-cased name, user id. */
export const memberCursorSchema = z.tuple([
  workspaceRoleSchema,
  z.string().max(320),
  z.uuid(),
]);

/** One page of members, optionally one role (`members_page`, members only). */
export async function listMembersPage(
  client: Client,
  workspaceId: string,
  role: WorkspaceRole | null,
  limit: number,
  after: [WorkspaceRole, string, string] | null,
): Promise<{ data: Page<Member> | null; error: DbError | null }> {
  const { data, error } = await client.rpc("members_page", {
    p_workspace: workspaceId,
    p_role: sqlNullable(role),
    p_after_role: sqlNullable(after?.[0] ?? null),
    p_after_name: sqlNullable(after?.[1] ?? null),
    p_after_id: sqlNullable(after?.[2] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = z
    .object({ has_more: z.boolean(), items: z.array(memberRowSchema) })
    .parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      items: parsed.items.map((row) => ({
        userId: row.user_id,
        role: row.role,
        canCheckIn: row.can_check_in,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        email: row.email,
        joinedAt: row.joined_at,
      })),
      nextCursor:
        parsed.has_more && last
          ? encodeCursor([last.role, last.sort_name, last.user_id])
          : null,
    },
    error: null,
  };
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
