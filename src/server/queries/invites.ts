import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAfter, parseISO } from "date-fns";
import type { Database } from "@/server/db/database.types";
import {
  invitePreviewSchema,
  type Invite,
  type InvitePreview,
} from "@/shared/api/invites";

type Client = SupabaseClient<Database>;
const INVITE_COLUMNS = "id, email, role, expires_at, created_at";

function toInvite(
  row: {
    id: string;
    email: string;
    role: "owner" | "admin" | "viewer";
    expires_at: string;
    created_at: string;
  },
  now: Date,
): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role === "admin" ? "admin" : "viewer",
    status: isAfter(parseISO(row.expires_at), now) ? "pending" : "expired",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Open (not accepted, not revoked) invites of a workspace, newest first. Columns are listed:
 * `token_hash` is not readable by `authenticated`.
 * @throws Error on database failures
 */
export async function listOpenInvites(
  client: Client,
  workspaceId: string,
  now: Date = new Date(),
): Promise<Invite[]> {
  const { data, error } = await client
    .from("workspace_invites")
    .select(INVITE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => toInvite(row, now));
}

/** One invite visible to the caller (Owner/Admin), or null. */
export async function getInvite(
  client: Client,
  inviteId: string,
): Promise<Invite | null> {
  const { data, error } = await client
    .from("workspace_invites")
    .select(INVITE_COLUMNS)
    .eq("id", inviteId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? toInvite(data, new Date()) : null;
}

/** `create_invite`; returns the new invite id. */
export function createInvite(
  client: Client,
  input: {
    workspaceId: string;
    email: string;
    role: "admin" | "viewer";
    tokenHash: string;
  },
) {
  return client.rpc("create_invite", {
    p_workspace: input.workspaceId,
    p_email: input.email,
    p_role: input.role,
    p_token_hash: input.tokenHash,
  });
}

/** `renew_invite`: new token hash + new expiry on the same row. */
export function renewInvite(
  client: Client,
  inviteId: string,
  tokenHash: string,
) {
  return client.rpc("renew_invite", {
    p_invite: inviteId,
    p_token_hash: tokenHash,
  });
}

/** `revoke_invite`. */
export function revokeInvite(client: Client, inviteId: string) {
  return client.rpc("revoke_invite", { p_invite: inviteId });
}

/** `consume_invite_email`: true while the workspace and platform budgets allow another email. */
export function consumeInviteEmail(client: Client, workspaceId: string) {
  return client.rpc("consume_invite_email", { p_workspace: workspaceId });
}

/**
 * `invite_preview` for the signed-in caller.
 * @throws Error on database failures
 */
export async function previewInvite(
  client: Client,
  tokenHash: string,
): Promise<InvitePreview> {
  const { data, error } = await client.rpc("invite_preview", {
    p_token_hash: tokenHash,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = data[0];
  return {
    status: invitePreviewSchema.shape.status.parse(row.status),
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    role: row.role,
    maskedEmail: row.masked_email,
  };
}

/** `accept_invite`; returns the workspace slug. */
export function acceptInvite(client: Client, tokenHash: string) {
  return client.rpc("accept_invite", { p_token_hash: tokenHash });
}
