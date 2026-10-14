import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import { encodeCursor } from "@/server/http/pagination";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import { meetingStatusSchema } from "@/shared/api/meetings";
import type {
  MyAnswersPage,
  MyInvitesFilter,
  MyInvitesPage,
  MyInvitesTab,
} from "@/shared/api/my-invites";
import { answerStatusSchema, markSchema } from "@/shared/api/responses";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;
type Result<T> = { data: T | null; error: DbError | null };

const iso = z.iso.datetime({ offset: true });

/** Keyset of `/invites`: start, then invitee id. */
export const myInvitesCursorSchema = z.tuple([iso, z.uuid()]);

/** A check-in as `my_invites` and `my_answers` return it. */
const dbMarkSchema = z
  .object({
    actual: markSchema.shape.actual,
    late_minutes: z.number().int().nullable(),
  })
  .nullable();

function toMark(mark: z.infer<typeof dbMarkSchema>) {
  return mark && { actual: mark.actual, lateMinutes: mark.late_minutes };
}

/** The next page's cursor: the last row's start and invitee id, when more rows exist. */
function nextCursorOf(
  hasMore: boolean,
  items: ReadonlyArray<{ starts_at: string; invitee_id: string }>,
): string | null {
  const last = items.at(-1);
  return hasMore && last
    ? encodeCursor([last.starts_at, last.invitee_id])
    : null;
}

const dbPageSchema = z.object({
  has_more: z.boolean(),
  needs_count: z.number().int(),
  as_of: z.string(),
  items: z.array(
    z.object({
      invitee_id: z.uuid(),
      workspace_name: z.string(),
      title: z.string(),
      starts_at: z.string(),
      timezone: z.string(),
      duration_minutes: z.number().int(),
      status: meetingStatusSchema,
      response_mode: responseModeSchema,
      response_deadline: z.string().nullable(),
      needs_answer: z.boolean(),
      answer: z
        .object({
          status: answerStatusSchema,
          delay_minutes: z.number().int().nullable(),
          reason: z.string(),
          needs_reconfirmation: z.boolean(),
        })
        .nullable(),
      mark: dbMarkSchema,
    }),
  ),
});

/** `my_invites()`: one page of the signed-in person's invites (spec §7.4). */
export async function getMyInvites(
  client: Client,
  tab: MyInvitesTab,
  filter: MyInvitesFilter,
  limit: number,
  after: [string, string] | null,
): Promise<Result<MyInvitesPage>> {
  const { data, error } = await client.rpc("my_invites", {
    p_tab: tab,
    p_filter: filter,
    p_after_starts: sqlNullable(after?.[0] ?? null),
    p_after_invitee: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const db = dbPageSchema.parse(data);
  return {
    data: {
      items: db.items.map((row) => ({
        inviteeId: row.invitee_id,
        workspaceName: row.workspace_name,
        title: row.title,
        startsAt: row.starts_at,
        timezone: row.timezone,
        durationMinutes: row.duration_minutes,
        status: row.status,
        responseMode: row.response_mode,
        responseDeadline: row.response_deadline,
        needsAnswer: row.needs_answer,
        answer: row.answer && {
          status: row.answer.status,
          delayMinutes: row.answer.delay_minutes,
          reason: row.answer.reason,
          needsReconfirmation: row.answer.needs_reconfirmation,
        },
        mark: toMark(row.mark),
      })),
      nextCursor: nextCursorOf(db.has_more, db.items),
      needsCount: db.needs_count,
      asOf: db.as_of,
    },
    error: null,
  };
}

/** `my_invite()`: the id when the invite is the caller's (else `tn:not_found`). */
export async function getMyInviteId(
  client: Client,
  id: string,
): Promise<Result<string>> {
  const { data, error } = await client.rpc("my_invite", { p_invitee: id });
  return error
    ? { data: null, error }
    : { data: z.uuid().parse(data), error: null };
}

const dbAnswersSchema = z.object({
  has_more: z.boolean(),
  items: z.array(
    z.object({
      invitee_id: z.uuid(),
      workspace_name: z.string(),
      title: z.string(),
      starts_at: z.string(),
      timezone: z.string(),
      response_mode: responseModeSchema,
      status: meetingStatusSchema,
      answer: z
        .object({
          status: answerStatusSchema,
          delay_minutes: z.number().int().nullable(),
          reason: z.string(),
          comment: z.string(),
          after_deadline: z.boolean(),
          updated_at: z.string(),
        })
        .nullable(),
      mark: dbMarkSchema,
    }),
  ),
});

/** `my_answers()`: one page of Download my answers, newest first (spec §7.4). */
export async function getMyAnswers(
  client: Client,
  limit: number,
  after: [string, string] | null,
): Promise<Result<MyAnswersPage>> {
  const { data, error } = await client.rpc("my_answers", {
    p_after_starts: sqlNullable(after?.[0] ?? null),
    p_after_invitee: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const db = dbAnswersSchema.parse(data);
  return {
    data: {
      items: db.items.map((row) => ({
        inviteeId: row.invitee_id,
        workspaceName: row.workspace_name,
        title: row.title,
        startsAt: row.starts_at,
        timezone: row.timezone,
        responseMode: row.response_mode,
        status: row.status,
        answer: row.answer && {
          status: row.answer.status,
          delayMinutes: row.answer.delay_minutes,
          reason: row.answer.reason,
          comment: row.answer.comment,
          afterDeadline: row.answer.after_deadline,
          updatedAt: row.answer.updated_at,
        },
        mark: toMark(row.mark),
      })),
      nextCursor: nextCursorOf(db.has_more, db.items),
    },
    error: null,
  };
}
