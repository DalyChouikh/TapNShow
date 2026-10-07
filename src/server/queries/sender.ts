import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  type MeetingDefaults,
  meetingDefaultsSchema,
  type UpdateMeetingDefaultsBody,
} from "@/shared/api/meeting-settings";
import {
  type WorkspaceSender,
  workspaceSenderSchema,
} from "@/shared/api/sender";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

const dbSenderSchema = z
  .object({
    sender: z
      .object({
        connection_id: z.uuid(),
        email: z.string(),
        status: z.enum(["active", "broken"]),
        connected_by: z.string(),
        connected_at: z.string(),
        is_mine: z.boolean(),
        sent_last_24h: z.number().int(),
        daily_limit: z.number().int(),
      })
      .nullable(),
    owner_name: z.string(),
    my_connections: z.array(
      z.object({
        id: z.uuid(),
        email: z.string(),
        status: z.enum(["active", "broken"]),
        used_by: z.array(z.string()),
      }),
    ),
  })
  .transform((db): WorkspaceSender =>
    workspaceSenderSchema.parse({
      sender: db.sender && {
        connectionId: db.sender.connection_id,
        email: db.sender.email,
        status: db.sender.status,
        connectedBy: db.sender.connected_by,
        connectedAt: db.sender.connected_at,
        isMine: db.sender.is_mine,
        sentLast24h: db.sender.sent_last_24h,
        dailyLimit: db.sender.daily_limit,
      },
      ownerName: db.owner_name,
      myConnections: db.my_connections.map((c) => ({
        id: c.id,
        email: c.email,
        status: c.status,
        usedBy: c.used_by,
      })),
    }),
  );

/** `workspace_sender()` (any member). */
export async function getWorkspaceSender(
  client: Client,
  workspaceId: string,
): Promise<{ data: WorkspaceSender | null; error: DbError | null }> {
  const { data, error } = await client.rpc("workspace_sender", {
    p_workspace: workspaceId,
  });
  return error
    ? { data: null, error }
    : { data: dbSenderSchema.parse(data), error: null };
}

/** `set_workspace_sender()` (Owner; own active connection). */
export async function setWorkspaceSender(
  client: Client,
  workspaceId: string,
  connectionId: string,
): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("set_workspace_sender", {
    p_workspace: workspaceId,
    p_connection: connectionId,
  });
  return { error };
}

/**
 * `save_google_connection()`: upsert by (user, Google account); returns the connection id.
 * `client` must be the service-role client: the account id and email come from Google's verified
 * ID token in the callback, never from a browser (security review 2026-10-07).
 */
export async function saveGoogleConnection(
  client: Client,
  input: {
    userId: string;
    googleSub: string;
    googleEmail: string;
    scopes: string[];
    tokenEncrypted: string;
  },
): Promise<{ data: string | null; error: DbError | null }> {
  const { data, error } = await client.rpc("save_google_connection", {
    p_user: input.userId,
    p_google_sub: input.googleSub,
    p_google_email: input.googleEmail,
    p_scopes: input.scopes,
    p_token_encrypted: input.tokenEncrypted,
  });
  return { data: data ?? null, error };
}

const disconnectedSchema = z
  .object({ refresh_token_encrypted: z.string(), google_sub: z.string() })
  .transform((db) => ({
    tokenEncrypted: db.refresh_token_encrypted,
    googleSub: db.google_sub,
  }));

/** `disconnect_google_connection()`: deletes my connection, returns what revocation needs. */
export async function disconnectGoogleConnection(
  client: Client,
  connectionId: string,
): Promise<{
  data: z.output<typeof disconnectedSchema> | null;
  error: DbError | null;
}> {
  const { data, error } = await client.rpc("disconnect_google_connection", {
    p_connection: connectionId,
  });
  return error
    ? { data: null, error }
    : { data: disconnectedSchema.parse(data), error: null };
}

const DEFAULT_COLUMNS =
  "default_response_mode, default_delay_options, default_reason_required, default_comments_enabled, default_footer_note, default_duration_minutes";

/** The workspace's meeting defaults (any member). */
export async function getMeetingDefaults(
  client: Client,
  workspaceId: string,
): Promise<{ data: MeetingDefaults | null; error: DbError | null }> {
  const { data, error } = await client
    .from("workspaces")
    .select(DEFAULT_COLUMNS)
    .eq("id", workspaceId)
    .single();
  if (error) {
    return { data: null, error };
  }
  return {
    data: meetingDefaultsSchema.parse({
      responseMode: data.default_response_mode,
      delayOptions: data.default_delay_options,
      reasonRequired: data.default_reason_required,
      commentsEnabled: data.default_comments_enabled,
      footerNote: data.default_footer_note,
      durationMinutes: data.default_duration_minutes,
    }),
    error: null,
  };
}

/** Updates some defaults (Owner/Admin through RLS). */
export async function updateMeetingDefaults(
  client: Client,
  workspaceId: string,
  patch: UpdateMeetingDefaultsBody,
): Promise<{ error: DbError | null }> {
  const { error } = await client
    .from("workspaces")
    .update({
      default_response_mode: patch.responseMode,
      default_delay_options: patch.delayOptions,
      default_reason_required: patch.reasonRequired,
      default_comments_enabled: patch.commentsEnabled,
      default_footer_note: patch.footerNote,
      default_duration_minutes: patch.durationMinutes,
    })
    .eq("id", workspaceId);
  return { error };
}
