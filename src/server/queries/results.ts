import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { SORT_NAME_MAX } from "@/config/pagination";
import { sqlNullable } from "@/server/db/rpc-args";
import { encodeCursor } from "@/server/http/pagination";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import { inviteeStatusSchema } from "@/shared/api/meetings";
import type { Page } from "@/shared/api/pagination";
import {
  type AttendanceDetailRow,
  type AttendanceSummary,
  answerStatusSchema,
  type HistoryPage,
  type MeetingResults,
  type PeopleFilter,
  type PeriodRange,
  type PersonRow,
} from "@/shared/api/responses";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;
type Result<T> = { data: T | null; error: DbError | null };

const count = z.number().int();
const iso = z.iso.datetime({ offset: true });

/** Keyset of a meeting's people: lower-cased name, then invitee id. */
export const peopleCursorSchema = z.tuple([
  z.string().max(SORT_NAME_MAX),
  z.uuid(),
]);
/** Keyset of a person's history: start time, then meeting id (newest first). */
export const historyCursorSchema = z.tuple([iso, z.uuid()]);
/** Keyset of the export details: start, meeting, lower-cased name, invitee. */
export const detailsCursorSchema = z.tuple([
  iso,
  z.uuid(),
  z.string().max(SORT_NAME_MAX),
  z.uuid(),
]);

const dbAnswerSchema = z
  .object({
    status: answerStatusSchema,
    delay_minutes: z.number().int().nullable(),
    reason: z.string(),
    comment: z.string(),
    after_deadline: z.boolean(),
    updated_at: z.string(),
    needs_reconfirmation: z.boolean().default(false),
  })
  .nullable()
  .transform((db) =>
    db
      ? {
          status: db.status,
          delayMinutes: db.delay_minutes,
          reason: db.reason,
          comment: db.comment,
          afterDeadline: db.after_deadline,
          updatedAt: db.updated_at,
          needsReconfirmation: db.needs_reconfirmation,
        }
      : null,
  );

/** A check-in mark as the database writes it (spec §7.8). Twin: `private.mark_json`. */
export const dbMarkSchema = z
  .object({
    actual: z.enum(["present", "late", "absent"]),
    marked_at: z.string(),
    marked_by_name: z.string().nullable(),
    late_minutes: z.number().int().nullable(),
  })
  .nullable()
  .transform((db) =>
    db
      ? {
          actual: db.actual,
          markedAt: db.marked_at,
          markedByName: db.marked_by_name,
          lateMinutes: db.late_minutes,
        }
      : null,
  );

const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ has_more: z.boolean(), items: z.array(item) });

/** `meeting_results()`: email and answer counts of one meeting. */
export async function getMeetingResults(
  client: Client,
  meetingId: string,
): Promise<Result<MeetingResults>> {
  const { data, error } = await client.rpc("meeting_results", {
    p_meeting: meetingId,
  });
  if (error) {
    return { data: null, error };
  }
  const db = z
    .object({
      response_mode: responseModeSchema,
      emails: z.object({
        total: count,
        queued: count,
        sent: count,
        skipped: count,
        failed: count,
        unknown: count,
      }),
      answers: z.object({
        attending: count,
        late: count,
        absent: count,
        not_attending: count,
        no_reply: count,
        calendar_requested: count,
        to_reconfirm: count,
        remindable: count,
        reachable: count,
      }),
      paused: count,
      resumes_at: z.string().nullable(),
      sender_state: z.enum(["ok", "missing", "broken"]),
      checked_in: count,
      nudge: z.object({
        last_at: z.string().nullable(),
        last_count: z.number().int().nullable(),
        next_at: z.string().nullable(),
      }),
    })
    .parse(data);
  return {
    data: {
      responseMode: db.response_mode,
      emails: db.emails,
      answers: {
        attending: db.answers.attending,
        late: db.answers.late,
        absent: db.answers.absent,
        notAttending: db.answers.not_attending,
        noReply: db.answers.no_reply,
        calendarRequested: db.answers.calendar_requested,
        toReconfirm: db.answers.to_reconfirm,
        remindable: db.answers.remindable,
        reachable: db.answers.reachable,
      },
      paused: db.paused,
      resumesAt: db.resumes_at,
      senderState: db.sender_state,
      checkedIn: db.checked_in,
      nudge: {
        lastAt: db.nudge.last_at,
        lastCount: db.nudge.last_count,
        nextAt: db.nudge.next_at,
      },
    },
    error: null,
  };
}

const dbPersonSchema = z.object({
  invitee_id: z.uuid(),
  contact_id: z.uuid(),
  full_name: z.string(),
  email: z.string(),
  is_adhoc: z.boolean(),
  sort_name: z.string(),
  email_status: inviteeStatusSchema,
  email_error: z.string().nullable(),
  sent_at: z.string().nullable(),
  answer: dbAnswerSchema,
  mark: dbMarkSchema,
});

/** One page of a meeting's people (`meeting_people`). */
export async function listMeetingPeople(
  client: Client,
  meetingId: string,
  filter: PeopleFilter,
  limit: number,
  after: [string, string] | null,
  search: string | null = null,
): Promise<Result<Page<PersonRow>>> {
  const { data, error } = await client.rpc("meeting_people", {
    p_meeting: meetingId,
    p_filter: filter,
    p_after_name: sqlNullable(after?.[0] ?? null),
    p_after_id: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
    p_search: sqlNullable(search),
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = pageOf(dbPersonSchema).parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      items: parsed.items.map((row) => ({
        inviteeId: row.invitee_id,
        contactId: row.contact_id,
        fullName: row.full_name,
        email: row.email,
        isAdhoc: row.is_adhoc,
        emailStatus: row.email_status,
        emailError: row.email_error,
        sentAt: row.sent_at,
        answer: row.answer,
        mark: row.mark,
      })),
      nextCursor:
        parsed.has_more && last
          ? encodeCursor([last.sort_name, last.invitee_id])
          : null,
    },
    error: null,
  };
}

/** `contact_history()`: one page of a person's past meetings and the period's counts. */
export async function getContactHistory(
  client: Client,
  contactId: string,
  range: PeriodRange,
  limit: number,
  after: [string, string] | null,
): Promise<Result<HistoryPage>> {
  const { data, error } = await client.rpc("contact_history", {
    p_contact: contactId,
    p_from: sqlNullable(range.from),
    p_to: sqlNullable(range.to),
    p_after_starts: sqlNullable(after?.[0] ?? null),
    p_after_meeting: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = z
    .object({
      counts: z.object({
        attending: count,
        late: count,
        absent: count,
        no_reply: count,
      }),
      has_more: z.boolean(),
      items: z.array(
        z.object({
          meeting_id: z.uuid(),
          title: z.string(),
          starts_at: z.string(),
          timezone: z.string(),
          response_mode: responseModeSchema,
          email_status: inviteeStatusSchema,
          answer: dbAnswerSchema,
          mark: dbMarkSchema,
        }),
      ),
    })
    .parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      counts: {
        attending: parsed.counts.attending,
        late: parsed.counts.late,
        absent: parsed.counts.absent,
        noReply: parsed.counts.no_reply,
      },
      items: parsed.items.map((row) => ({
        meetingId: row.meeting_id,
        title: row.title,
        startsAt: row.starts_at,
        timezone: row.timezone,
        responseMode: row.response_mode,
        emailStatus: row.email_status,
        answer: row.answer,
        mark: row.mark,
      })),
      nextCursor:
        parsed.has_more && last
          ? encodeCursor([last.starts_at, last.meeting_id])
          : null,
    },
    error: null,
  };
}

/** `attendance_summary()`: every roster contact's counts for a period. */
export async function getAttendanceSummary(
  client: Client,
  workspaceId: string,
  range: PeriodRange,
): Promise<Result<AttendanceSummary>> {
  const { data, error } = await client.rpc("attendance_summary", {
    p_workspace: workspaceId,
    p_from: sqlNullable(range.from),
    p_to: sqlNullable(range.to),
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = z
    .object({
      meetings: count,
      rows: z.array(
        z.object({
          contact_id: z.uuid(),
          invited: count,
          attending: count,
          late: count,
          absent: count,
          no_reply: count,
        }),
      ),
    })
    .parse(data);
  return {
    data: {
      meetings: parsed.meetings,
      rows: parsed.rows.map((row) => ({
        contactId: row.contact_id,
        invited: row.invited,
        attending: row.attending,
        late: row.late,
        absent: row.absent,
        noReply: row.no_reply,
      })),
    },
    error: null,
  };
}

/** One page of `attendance_details()` (exports). */
export async function listAttendanceDetails(
  client: Client,
  workspaceId: string,
  range: PeriodRange,
  limit: number,
  after: [string, string, string, string] | null,
): Promise<Result<Page<AttendanceDetailRow>>> {
  const { data, error } = await client.rpc("attendance_details", {
    p_workspace: workspaceId,
    p_from: sqlNullable(range.from),
    p_to: sqlNullable(range.to),
    p_after_starts: sqlNullable(after?.[0] ?? null),
    p_after_meeting: sqlNullable(after?.[1] ?? null),
    p_after_name: sqlNullable(after?.[2] ?? null),
    p_after_invitee: sqlNullable(after?.[3] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = pageOf(
    z.object({
      meeting_id: z.uuid(),
      title: z.string(),
      starts_at: z.string(),
      timezone: z.string(),
      response_mode: responseModeSchema,
      invitee_id: z.uuid(),
      contact_id: z.uuid(),
      full_name: z.string(),
      email: z.string(),
      sort_name: z.string(),
      email_status: inviteeStatusSchema,
      answer: dbAnswerSchema,
      mark: dbMarkSchema,
    }),
  ).parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      items: parsed.items.map((row) => ({
        meetingId: row.meeting_id,
        title: row.title,
        startsAt: row.starts_at,
        timezone: row.timezone,
        responseMode: row.response_mode,
        inviteeId: row.invitee_id,
        contactId: row.contact_id,
        fullName: row.full_name,
        email: row.email,
        emailStatus: row.email_status,
        answer: row.answer,
        mark: row.mark,
      })),
      nextCursor:
        parsed.has_more && last
          ? encodeCursor([
              last.starts_at,
              last.meeting_id,
              last.sort_name,
              last.invitee_id,
            ])
          : null,
    },
    error: null,
  };
}
