import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import { encodeCursor } from "@/server/http/pagination";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import { meetingStatusSchema } from "@/shared/api/meetings";
import type {
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
      mark: z
        .object({
          actual: markSchema.shape.actual,
          late_minutes: z.number().int().nullable(),
        })
        .nullable(),
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
  const last = db.items.at(-1);
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
        mark: row.mark && {
          actual: row.mark.actual,
          lateMinutes: row.mark.late_minutes,
        },
      })),
      nextCursor:
        db.has_more && last
          ? encodeCursor([last.starts_at, last.invitee_id])
          : null,
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
