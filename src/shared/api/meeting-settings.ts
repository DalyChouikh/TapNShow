import { z } from "zod";
import {
  REMINDER_GOING_CHOICES,
  REMINDER_PENDING_CHOICES,
} from "@/config/reminders";
import {
  DELAY_OPTIONS_MAX,
  DURATION_MAX,
  DURATION_MIN,
  FOOTER_NOTE_MAX,
  LOCATION_MAX,
  MEETING_URL_MAX,
} from "@/config/meetings";

/** How members answer (spec §4 Response modes). */
export const responseModeSchema = z.enum([
  "announcement",
  "rsvp",
  "attendance",
]);
/** A response mode. */
export type ResponseMode = z.infer<typeof responseModeSchema>;

/** Where the meeting happens. */
export const locationModeSchema = z.enum(["in_person", "online", "hybrid"]);
/** A location mode. */
export type LocationMode = z.infer<typeof locationModeSchema>;

/** Delay options in minutes: distinct, 1–240, at most six, sorted ascending. */
export const delayOptionsSchema = z
  .array(z.number().int().min(1).max(240))
  .max(DELAY_OPTIONS_MAX)
  .refine((values) => new Set(values).size === values.length)
  .transform((values) => [...values].sort((a, b) => a - b));

/** Footer note under the response form ("" = none). */
export const footerNoteSchema = z.string().trim().max(FOOTER_NOTE_MAX);

/** Meeting length in minutes. */
export const durationMinutesSchema = z
  .number()
  .int()
  .min(DURATION_MIN)
  .max(DURATION_MAX);

/** A meeting link: empty, or an http(s) URL (the database check agrees). */
export const meetingUrlSchema = z.union([
  z.literal(""),
  z.url({ protocol: /^https?$/ }).max(MEETING_URL_MAX),
]);

/** Where an online meeting happens, in words (e.g. "Club Discord, Meetings voice channel"). */
export const onlineTextSchema = z.string().trim().max(LOCATION_MAX);

const oneOf = (choices: readonly number[]) =>
  z
    .number()
    .int()
    .refine((value) => choices.includes(value));
/**
 * "People who haven't answered" reminder, hours before the deadline (else the start); null = off.
 * Choices: src/config/reminders.ts (DB twin: the reminder_pending_hours checks).
 */
export const reminderPendingSchema = oneOf(REMINDER_PENDING_CHOICES).nullable();
/** "Going and Late" reminder, hours before the start; null = off (DB twin: the checks). */
export const reminderGoingSchema = oneOf(REMINDER_GOING_CHOICES).nullable();

/** Settings > Meeting defaults (spec §7.2, §6 workspaces). */
export const meetingDefaultsSchema = z.object({
  responseMode: responseModeSchema,
  delayOptions: delayOptionsSchema,
  reasonRequired: z.boolean(),
  commentsEnabled: z.boolean(),
  footerNote: footerNoteSchema,
  durationMinutes: durationMinutesSchema,
  /** The usual online place new meetings start with. */
  onlineText: onlineTextSchema,
  /** The usual online link new meetings start with. */
  meetingUrl: meetingUrlSchema,
  /** Reminders new meetings start with (spec §7.6). */
  reminderPendingHours: reminderPendingSchema,
  reminderGoingHours: reminderGoingSchema,
});
/** Workspace meeting defaults. */
export type MeetingDefaults = z.infer<typeof meetingDefaultsSchema>;

/** `PATCH …/meeting-defaults` body. */
export const updateMeetingDefaultsBodySchema = meetingDefaultsSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0);
/** A partial defaults update. */
export type UpdateMeetingDefaultsBody = z.infer<
  typeof updateMeetingDefaultsBodySchema
>;
