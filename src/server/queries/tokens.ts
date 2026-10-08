import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { type TokenInfo, tokenInfoSchema } from "@/shared/api/tokens";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

const dbInfoSchema = z
  .object({
    workspace_name: z.string(),
    masked_email: z.string(),
    unsubscribed: z.boolean(),
    reported: z.boolean(),
    meeting: z.object({
      title: z.string(),
      starts_at: z.string().nullable(),
      timezone: z.string(),
      duration_minutes: z.number().int(),
      location_mode: z.string(),
      location_text: z.string(),
      online_text: z.string().default(""),
      meeting_url: z.string(),
      status: z.string(),
    }),
  })
  .transform((db): TokenInfo =>
    tokenInfoSchema.parse({
      workspaceName: db.workspace_name,
      maskedEmail: db.masked_email,
      unsubscribed: db.unsubscribed,
      reported: db.reported,
      meeting: {
        title: db.meeting.title,
        startsAt: db.meeting.starts_at,
        timezone: db.meeting.timezone,
        durationMinutes: db.meeting.duration_minutes,
        locationMode: db.meeting.location_mode,
        locationText: db.meeting.location_text,
        onlineText: db.meeting.online_text,
        meetingUrl: db.meeting.meeting_url,
        status: db.meeting.status,
      },
    }),
  );

/** `token_invitee()`: null for an unknown token. Service-role client only. */
export async function lookupToken(
  client: Client,
  tokenHash: string,
): Promise<{ data: TokenInfo | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_invitee", {
    p_token_hash: tokenHash,
  });
  return error
    ? { data: null, error }
    : { data: data ? dbInfoSchema.parse(data) : null, error: null };
}

/** `token_unsubscribe()`: false for an unknown token. */
export async function unsubscribeToken(
  client: Client,
  tokenHash: string,
  via: "link" | "report",
): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_unsubscribe", {
    p_token_hash: tokenHash,
    p_via: via,
  });
  return { data: data ?? null, error };
}

/** `token_resubscribe()`: false for an unknown token. */
export async function resubscribeToken(
  client: Client,
  tokenHash: string,
): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_resubscribe", {
    p_token_hash: tokenHash,
  });
  return { data: data ?? null, error };
}

/** `check_token_rate_limit()`: false when this IP or this token is over its hourly budget. */
export async function checkTokenRateLimit(
  client: Client,
  ip: string,
  tokenHash: string,
): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("check_token_rate_limit", {
    p_ip: ip,
    p_token_hash: tokenHash,
  });
  return { data: data ?? null, error };
}
