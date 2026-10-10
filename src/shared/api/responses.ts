import { z } from "zod";
import { COMMENT_MAX, REASON_MAX } from "@/config/responses";
import {
  lateMinutesSchema,
  responseModeSchema,
  type ResponseMode,
} from "./meeting-settings";
import { inviteeStatusSchema } from "./meetings";
import { pageSchema } from "./pagination";

/** A member's answer (spec §6 `responses.status`; RSVP uses attending / not_attending). */
export const answerStatusSchema = z.enum([
  "attending",
  "late",
  "absent",
  "not_attending",
]);
/** An answer status. */
export type AnswerStatus = z.infer<typeof answerStatusSchema>;

/** A saved answer as the member's page and the organizer screens see it. */
export const answerSchema = z.object({
  status: answerStatusSchema,
  delayMinutes: z.number().int().nullable(),
  reason: z.string(),
  comment: z.string(),
  afterDeadline: z.boolean(),
  respondedAt: z.string(),
  updatedAt: z.string(),
  /** The time changed after this answer: asked to confirm again (spec §7.3). */
  needsReconfirmation: z.boolean().default(false),
});
/** A saved answer. */
export type Answer = z.infer<typeof answerSchema>;

/** The meeting's answer settings shown on `/r/[token]`. */
export const answerSettingsSchema = z.object({
  responseMode: responseModeSchema,
  delayOptions: z.array(z.number().int()),
  reasonRequired: z.boolean(),
  commentsEnabled: z.boolean(),
  footerNote: z.string(),
  responseDeadline: z.string().nullable(),
});
/** Answer settings of one meeting. */
export type AnswerSettings = z.infer<typeof answerSettingsSchema>;

/** Postgres text cannot hold NUL (22P05); a pasted one is dropped rather than failing the save. */
const answerText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.replaceAll("\u0000", ""));

/** `PUT /api/r/[token]/response`. The database applies the meeting's rules (spec §7.3). */
export const submitAnswerBodySchema = z.object({
  status: answerStatusSchema,
  delayMinutes: lateMinutesSchema.nullable(),
  reason: answerText(REASON_MAX),
  comment: answerText(COMMENT_MAX),
});
/** An answer save. */
export type SubmitAnswerBody = z.infer<typeof submitAnswerBodySchema>;

const STATUSES: Record<ResponseMode, AnswerStatus[]> = {
  attendance: ["attending", "late", "absent"],
  rsvp: ["attending", "not_attending"],
  announcement: [],
};

/** The answer cards a mode shows, in order. */
export function statusesFor(mode: ResponseMode): AnswerStatus[] {
  return STATUSES[mode];
}

const CHOICE_TO_STATUS: Record<string, AnswerStatus> = {
  attending: "attending",
  going: "attending",
  late: "late",
  absent: "absent",
  not_going: "not_attending",
};

/** The email button's `?choice=` as a status this mode allows, or null (spec §7.3: pre-select only). */
export function choiceToStatus(
  choice: string | null,
  mode: ResponseMode,
): AnswerStatus | null {
  // hasOwn: a crafted `?choice=constructor` must not reach Object.prototype.
  const status =
    choice && Object.hasOwn(CHOICE_TO_STATUS, choice)
      ? CHOICE_TO_STATUS[choice]
      : undefined;
  return status && STATUSES[mode].includes(status) ? status : null;
}

/** Late, Absent and Not going may carry a reason; Going never does (spec §4 Reasons). */
export function needsReason(status: AnswerStatus): boolean {
  return status !== "attending";
}

const count = z.number().int();

/** An organizer-side answer (the reads return `updated_at`, not `responded_at`). */
const organizerAnswerSchema = answerSchema.omit({ respondedAt: true });

/** `GET …/meetings/[id]/results`: email and answer counts (spec §7.7). */
export const meetingResultsSchema = z.object({
  responseMode: responseModeSchema,
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
    notAttending: count,
    noReply: count,
    calendarRequested: count,
    /** Asked to confirm again after a time change (not in Going/Late/Absent meanwhile). */
    toReconfirm: count,
    /** Who a Nudge would email now. */
    remindable: count,
    /** Who a Cancel would email. */
    reachable: count,
  }),
  paused: count,
  resumesAt: z.string().nullable(),
  senderState: z.enum(["ok", "missing", "broken"]),
  checkedIn: count,
  nudge: z.object({
    lastAt: z.string().nullable(),
    lastCount: z.number().int().nullable(),
    nextAt: z.string().nullable(),
  }),
});
/** A meeting's counts. */
export type MeetingResults = z.infer<typeof meetingResultsSchema>;

/** Filters of a meeting's people list (the tiles; "all" when none is pressed). */
export const peopleFilterSchema = z.enum([
  "all",
  "attending",
  "late",
  "absent",
  "not_attending",
  "no_reply",
  "not_delivered",
  "to_reconfirm",
]);
/** A people filter. */
export type PeopleFilter = z.infer<typeof peopleFilterSchema>;

/** A check-in mark (spec §7.8). */
export const markSchema = z.object({
  actual: z.enum(["present", "late", "absent"]),
  markedAt: z.string(),
  markedByName: z.string().nullable(),
  /** How late, when marked Late with minutes (#257). */
  lateMinutes: z.number().int().nullable(),
});
/** A check-in mark. */
export type Mark = z.infer<typeof markSchema>;

/** `PUT …/check-in`: one person's check-in, or null to clear it; minutes only with Late. */
export const markBodySchema = z
  .object({
    inviteeId: z.uuid(),
    actual: markSchema.shape.actual.nullable(),
    lateMinutes: lateMinutesSchema.nullable().default(null),
  })
  .refine((body) => body.lateMinutes === null || body.actual === "late", {
    path: ["lateMinutes"],
  });
/** A check-in change. */
export type MarkBody = z.infer<typeof markBodySchema>;
/** `PUT …/check-in` response: the mark as saved (null when cleared). */
export const markResultSchema = z.object({ mark: markSchema.nullable() });
/** `POST …/check-in/rest` response: how many were marked. */
export const markRestResultSchema = z.object({ marked: z.number().int() });

/** One invitee with their answer (meeting page). */
export const personRowSchema = z.object({
  inviteeId: z.uuid(),
  contactId: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  isAdhoc: z.boolean(),
  emailStatus: inviteeStatusSchema,
  emailError: z.string().nullable(),
  sentAt: z.string().nullable(),
  answer: organizerAnswerSchema.nullable(),
  mark: markSchema.nullable(),
});
/** A person on the meeting page. */
export type PersonRow = z.infer<typeof personRowSchema>;
/** `GET …/meetings/[id]/people`. */
export const peoplePageSchema = pageSchema(personRowSchema);

/** History counts for one person over a period. */
export const historyCountsSchema = z.object({
  attending: count,
  late: count,
  absent: count,
  noReply: count,
});
/** One past meeting in a person's history. */
export const historyRowSchema = z.object({
  meetingId: z.uuid(),
  title: z.string(),
  startsAt: z.string(),
  timezone: z.string(),
  responseMode: responseModeSchema,
  emailStatus: inviteeStatusSchema,
  answer: organizerAnswerSchema.nullable(),
  /** What happened at the door (check-in wins in the counts). */
  mark: markSchema.nullable(),
});
/** A history row. */
export type HistoryRow = z.infer<typeof historyRowSchema>;
/** `GET …/contacts/[id]/history`: one page plus the period's counts. */
export const historyPageSchema = pageSchema(historyRowSchema).extend({
  counts: historyCountsSchema,
});
/** A history page. */
export type HistoryPage = z.infer<typeof historyPageSchema>;

/** `GET …/attendance`: every roster contact's counts for a period. */
export const attendanceSummarySchema = z.object({
  meetings: count,
  rows: z.array(
    z.object({
      contactId: z.uuid(),
      invited: count,
      attending: count,
      late: count,
      absent: count,
      noReply: count,
    }),
  ),
});
/** The Attendance table's data. */
export type AttendanceSummary = z.infer<typeof attendanceSummarySchema>;

/** One person in one counted meeting (exports). */
export const attendanceDetailRowSchema = z.object({
  meetingId: z.uuid(),
  title: z.string(),
  startsAt: z.string(),
  timezone: z.string(),
  responseMode: responseModeSchema,
  inviteeId: z.uuid(),
  contactId: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  emailStatus: inviteeStatusSchema,
  answer: organizerAnswerSchema.nullable(),
  mark: markSchema.nullable(),
});
/** An export detail row. */
export type AttendanceDetailRow = z.infer<typeof attendanceDetailRowSchema>;
/** `GET …/attendance/details`. */
export const attendanceDetailsPageSchema = pageSchema(
  attendanceDetailRowSchema,
);

const instant = z.iso.datetime({ offset: true });

/** `?from=&to=` (instants; a missing bound is open). */
export const periodQuerySchema = z
  .object({ from: instant.optional(), to: instant.optional() })
  .refine((p) => !p.from || !p.to || new Date(p.from) < new Date(p.to));

/** The instants a history period covers (null = open). */
export type PeriodRange = { from: string | null; to: string | null };
