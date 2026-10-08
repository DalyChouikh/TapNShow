import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import {
  type Answer,
  answerStatusSchema,
  type SubmitAnswerBody,
} from "@/shared/api/responses";
import { type TokenInfo, tokenInfoSchema } from "@/shared/api/tokens";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

const dbAnswerSchema = z
  .object({
    status: answerStatusSchema,
    delay_minutes: z.number().int().nullable(),
    reason: z.string(),
    comment: z.string(),
    after_deadline: z.boolean(),
    responded_at: z.string(),
    updated_at: z.string(),
  })
  .transform((db): Answer => ({
    status: db.status,
    delayMinutes: db.delay_minutes,
    reason: db.reason,
    comment: db.comment,
    afterDeadline: db.after_deadline,
    respondedAt: db.responded_at,
    updatedAt: db.updated_at,
  }));

const dbInfoSchema = z
  .object({
    workspace_name: z.string(),
    masked_email: z.string(),
    full_name: z.string(),
    unsubscribed: z.boolean(),
    reported: z.boolean(),
    calendar_requested: z.boolean(),
    meeting: z.object({
      title: z.string(),
      starts_at: z.string().nullable(),
      timezone: z.string(),
      duration_minutes: z.number().int(),
      location_mode: z.string(),
      location_text: z.string(),
      online_text: z.string().default(""),
      meeting_url: z.string(),
      agenda_md: z.string(),
      status: z.string(),
    }),
    answers: z.object({
      response_mode: z.string(),
      delay_options: z.array(z.number().int()),
      reason_required: z.boolean(),
      comments_enabled: z.boolean(),
      footer_note: z.string(),
      response_deadline: z.string().nullable(),
    }),
    answer: dbAnswerSchema.nullable(),
  })
  .transform((db): TokenInfo =>
    tokenInfoSchema.parse({
      workspaceName: db.workspace_name,
      maskedEmail: db.masked_email,
      fullName: db.full_name,
      unsubscribed: db.unsubscribed,
      reported: db.reported,
      calendarRequested: db.calendar_requested,
      meeting: {
        title: db.meeting.title,
        startsAt: db.meeting.starts_at,
        timezone: db.meeting.timezone,
        durationMinutes: db.meeting.duration_minutes,
        locationMode: db.meeting.location_mode,
        locationText: db.meeting.location_text,
        onlineText: db.meeting.online_text,
        meetingUrl: db.meeting.meeting_url,
        agendaMd: db.meeting.agenda_md,
        status: db.meeting.status,
      },
      answers: {
        responseMode: db.answers.response_mode,
        delayOptions: db.answers.delay_options,
        reasonRequired: db.answers.reason_required,
        commentsEnabled: db.answers.comments_enabled,
        footerNote: db.answers.footer_note,
        responseDeadline: db.answers.response_deadline,
      },
      answer: db.answer,
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

/** `token_submit_response()`: null for an unknown token. Service-role client only. */
export async function submitAnswer(
  client: Client,
  tokenHash: string,
  body: SubmitAnswerBody,
): Promise<{ data: Answer | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_submit_response", {
    p_token_hash: tokenHash,
    p_status: body.status,
    p_delay_minutes: sqlNullable(body.delayMinutes),
    p_reason: body.reason,
    p_comment: body.comment,
  });
  return error
    ? { data: null, error }
    : { data: data ? dbAnswerSchema.parse(data) : null, error: null };
}

/** `token_request_calendar()`: false for an unknown token. */
export async function requestCalendar(
  client: Client,
  tokenHash: string,
): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_request_calendar", {
    p_token_hash: tokenHash,
  });
  return { data: data ?? null, error };
}
