import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAfter, parseISO } from "date-fns";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import { encodeCursor } from "@/server/http/pagination";
import {
  invitePreviewSchema,
  type Invite,
  type InvitePreview,
} from "@/shared/api/invites";
import { workspaceRoleSchema } from "@/shared/api/me";
import type { Page } from "@/shared/api/pagination";
import type { DbError } from "./roster";

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

/** Keyset of the open invites: creation time and id (newest first). */
export const inviteCursorSchema = z.tuple([
  z.iso.datetime({ offset: true }),
  z.uuid(),
]);

const inviteRowSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: workspaceRoleSchema,
  expires_at: z.string(),
  created_at: z.string(),
});

/** One page of open invites (`invites_page`; RLS returns none to Viewers). */
export async function listOpenInvitesPage(
  client: Client,
  workspaceId: string,
  limit: number,
  after: [string, string] | null,
  now: Date = new Date(),
): Promise<{ data: Page<Invite> | null; error: DbError | null }> {
  const { data, error } = await client.rpc("invites_page", {
    p_workspace: workspaceId,
    p_after_created: sqlNullable(after?.[0] ?? null),
    p_after_id: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = z
    .object({ has_more: z.boolean(), items: z.array(inviteRowSchema) })
    .parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      items: parsed.items.map((row) => toInvite(row, now)),
      nextCursor:
        parsed.has_more && last
          ? encodeCursor([last.created_at, last.id])
          : null,
    },
    error: null,
  };
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
