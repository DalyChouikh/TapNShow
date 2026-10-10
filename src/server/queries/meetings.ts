import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  type AddPeopleBody,
  type Audience,
  type AudienceBody,
  audienceSchema,
  type Meeting,
  meetingSchema,
  type MeetingSummary,
  meetingStatusSchema,
  type MeetingTab,
  sendResultSchema,
  type UpdateMeetingBody,
} from "@/shared/api/meetings";
import { sqlNullable } from "@/server/db/rpc-args";
import { encodeCursor } from "@/server/http/pagination";
import {
  locationModeSchema,
  responseModeSchema,
} from "@/shared/api/meeting-settings";
import type { Page } from "@/shared/api/pagination";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;
type Result<T> = { data: T | null; error: DbError | null };

const MEETING_COLUMNS =
  "id, workspace_id, title, agenda_md, starts_at, duration_minutes, timezone, location_mode, location_text, online_text, meeting_url, response_mode, response_deadline, delay_options, reason_required, comments_enabled, footer_note, status, sent_at";

type MeetingRow = Database["public"]["Tables"]["meetings"]["Row"];

function toMeeting(
  row: Pick<
    MeetingRow,
    | "id"
    | "title"
    | "agenda_md"
    | "starts_at"
    | "duration_minutes"
    | "timezone"
    | "location_mode"
    | "location_text"
    | "online_text"
    | "meeting_url"
    | "response_mode"
    | "response_deadline"
    | "delay_options"
    | "reason_required"
    | "comments_enabled"
    | "footer_note"
    | "status"
    | "sent_at"
  >,
): Meeting {
  return meetingSchema.parse({
    id: row.id,
    title: row.title,
    agendaMd: row.agenda_md,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    locationMode: row.location_mode,
    locationText: row.location_text,
    onlineText: row.online_text,
    meetingUrl: row.meeting_url,
    responseMode: row.response_mode,
    responseDeadline: row.response_deadline,
    delayOptions: row.delay_options,
    reasonRequired: row.reason_required,
    commentsEnabled: row.comments_enabled,
    footerNote: row.footer_note,
    status: row.status,
    sentAt: row.sent_at,
  });
}

/** The meeting if it belongs to `workspaceId` (RLS also hides other workspaces'). */
export async function getMeeting(
  client: Client,
  workspaceId: string,
  meetingId: string,
): Promise<Result<Meeting>> {
  const { data, error } = await client
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("id", meetingId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    return { data: null, error };
  }
  return { data: data ? toMeeting(data) : null, error: null };
}

const meetingRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  starts_at: z.string().nullable(),
  timezone: z.string(),
  duration_minutes: z.number().int(),
  status: meetingStatusSchema,
  location_mode: locationModeSchema,
  response_mode: responseModeSchema,
  sort_key: z.string().nullable(),
  counts: z.object({
    invited: z.number().int(),
    sent: z.number().int(),
    queued: z.number().int(),
    attending: z.number().int(),
    late: z.number().int(),
    absent: z.number().int(),
    no_reply: z.number().int(),
  }),
});

/** Keyset of the Meetings tabs: the sort time and the id of the last card shown. */
export const meetingCursorSchema = z.tuple([
  z.iso.datetime({ offset: true }),
  z.uuid(),
]);

/** One page of a Meetings tab (`meetings_page`). */
export async function listMeetingsPage(
  client: Client,
  workspaceId: string,
  tab: MeetingTab,
  limit: number,
  after: [string, string] | null,
): Promise<Result<Page<MeetingSummary>>> {
  const { data, error } = await client.rpc("meetings_page", {
    p_workspace: workspaceId,
    p_tab: tab,
    p_after_key: sqlNullable(after?.[0] ?? null),
    p_after_id: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = z
    .object({ has_more: z.boolean(), items: z.array(meetingRowSchema) })
    .parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      items: parsed.items.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.starts_at,
        timezone: r.timezone,
        durationMinutes: r.duration_minutes,
        status: r.status,
        locationMode: r.location_mode,
        responseMode: r.response_mode,
        counts: {
          invited: r.counts.invited,
          sent: r.counts.sent,
          queued: r.counts.queued,
          attending: r.counts.attending,
          late: r.counts.late,
          absent: r.counts.absent,
          noReply: r.counts.no_reply,
        },
      })),
      nextCursor:
        parsed.has_more && last?.sort_key
          ? encodeCursor([last.sort_key, last.id])
          : null,
    },
    error: null,
  };
}

/** `create_meeting()`: a draft from the workspace defaults. */
export async function createMeeting(
  client: Client,
  workspaceId: string,
): Promise<Result<string>> {
  const { data, error } = await client.rpc("create_meeting", {
    p_workspace: workspaceId,
  });
  return { data: data ?? null, error };
}

/** Saves some draft fields; `data` is null when no draft row matched (sent, cancelled or gone). */
export async function updateMeeting(
  client: Client,
  workspaceId: string,
  meetingId: string,
  patch: UpdateMeetingBody,
): Promise<Result<Meeting>> {
  const { data, error } = await client
    .from("meetings")
    .update({
      title: patch.title,
      agenda_md: patch.agendaMd,
      starts_at: patch.startsAt,
      duration_minutes: patch.durationMinutes,
      timezone: patch.timezone,
      location_mode: patch.locationMode,
      location_text: patch.locationText,
      online_text: patch.onlineText,
      meeting_url: patch.meetingUrl,
      response_mode: patch.responseMode,
      response_deadline: patch.responseDeadline,
      delay_options: patch.delayOptions,
      reason_required: patch.reasonRequired,
      comments_enabled: patch.commentsEnabled,
      footer_note: patch.footerNote,
    })
    .eq("id", meetingId)
    .eq("workspace_id", workspaceId)
    .select(MEETING_COLUMNS)
    .maybeSingle();
  if (error) {
    return { data: null, error };
  }
  return { data: data ? toMeeting(data) : null, error: null };
}

/** Deletes a draft; false when no draft row matched. */
export async function deleteMeeting(
  client: Client,
  workspaceId: string,
  meetingId: string,
): Promise<Result<boolean>> {
  const { data, error } = await client
    .from("meetings")
    .delete()
    .eq("id", meetingId)
    .eq("workspace_id", workspaceId)
    .select("id");
  return error
    ? { data: null, error }
    : { data: (data ?? []).length > 0, error: null };
}

const dbAudienceSchema = z
  .object({
    list_ids: z.array(z.uuid()),
    people: z.array(
      z.object({
        id: z.uuid(),
        full_name: z.string(),
        email: z.string(),
        list_ids: z.array(z.uuid()),
        added: z.boolean(),
        excluded: z.boolean(),
        unsubscribed: z.boolean(),
        reported: z.boolean(),
        invited: z.boolean(),
      }),
    ),
    counts: z.object({
      selected: z.number(),
      invited: z.number(),
      unsubscribed: z.number(),
      to_invite: z.number(),
    }),
    max_invitees: z.number(),
  })
  .transform((db): Audience =>
    audienceSchema.parse({
      listIds: db.list_ids,
      people: db.people.map((p) => ({
        id: p.id,
        fullName: p.full_name,
        email: p.email,
        listIds: p.list_ids,
        added: p.added,
        excluded: p.excluded,
        unsubscribed: p.unsubscribed,
        reported: p.reported,
        invited: p.invited,
      })),
      counts: {
        selected: db.counts.selected,
        invited: db.counts.invited,
        unsubscribed: db.counts.unsubscribed,
        toInvite: db.counts.to_invite,
      },
      maxInvitees: db.max_invitees,
    }),
  );

/** `meeting_audience()`. */
export async function getAudience(
  client: Client,
  meetingId: string,
): Promise<Result<Audience>> {
  const { data, error } = await client.rpc("meeting_audience", {
    p_meeting: meetingId,
  });
  return error
    ? { data: null, error }
    : { data: dbAudienceSchema.parse(data), error: null };
}

/** `set_meeting_audience()`. */
export async function setAudience(
  client: Client,
  meetingId: string,
  body: AudienceBody,
): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("set_meeting_audience", {
    p_meeting: meetingId,
    p_list_ids: body.listIds,
    p_include: body.include,
    p_exclude: body.exclude,
  });
  return { error };
}

/** `add_meeting_people()`. */
export async function addPeople(
  client: Client,
  meetingId: string,
  body: AddPeopleBody,
): Promise<Result<string[]>> {
  const { data, error } = await client.rpc("add_meeting_people", {
    p_meeting: meetingId,
    p_people: body.people.map((p) => ({
      email: p.email,
      full_name: p.fullName,
    })),
    p_save_to_roster: body.saveToRoster,
  });
  if (error) {
    return { data: null, error };
  }
  return {
    data: z.object({ contact_ids: z.array(z.uuid()) }).parse(data).contact_ids,
    error: null,
  };
}

/** `duplicate_meeting()`: the new draft's id (spec §7.9). */
export async function duplicateMeeting(
  client: Client,
  meetingId: string,
): Promise<Result<string>> {
  const { data, error } = await client.rpc("duplicate_meeting", {
    p_meeting: meetingId,
  });
  return { data: data ?? null, error };
}

/** `send_meeting()` (first send and Invite more). */
export async function sendMeeting(
  client: Client,
  meetingId: string,
): Promise<Result<z.infer<typeof sendResultSchema>>> {
  const { data, error } = await client.rpc("send_meeting", {
    p_meeting: meetingId,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = z
    .object({ invited: z.number(), skipped_unsubscribed: z.number() })
    .parse(data);
  return {
    data: {
      invited: parsed.invited,
      skippedUnsubscribed: parsed.skipped_unsubscribed,
    },
    error: null,
  };
}
