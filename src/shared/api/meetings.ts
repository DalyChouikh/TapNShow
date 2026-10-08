import { z } from "zod";
import {
  AGENDA_MAX,
  LOCATION_MAX,
  PEOPLE_PER_ADD_MAX,
  TITLE_MAX,
} from "@/config/meetings";
import { emailSchema } from "./common";
import { pageSchema } from "./pagination";
import {
  delayOptionsSchema,
  durationMinutesSchema,
  footerNoteSchema,
  locationModeSchema,
  meetingUrlSchema,
  onlineTextSchema,
  responseModeSchema,
} from "./meeting-settings";
import { timezoneSchema } from "./workspaces";

/** Lifecycle of a meeting. */
export const meetingStatusSchema = z.enum(["draft", "scheduled", "cancelled"]);

export { meetingUrlSchema } from "./meeting-settings";

const isoInstant = z.iso.datetime({ offset: true });

/** `GET …/meetings/[id]` and `PATCH` responses. */
export const meetingSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  agendaMd: z.string(),
  startsAt: z.string().nullable(),
  durationMinutes: z.number().int(),
  timezone: z.string(),
  locationMode: locationModeSchema,
  locationText: z.string(),
  onlineText: z.string(),
  meetingUrl: z.string(),
  responseMode: responseModeSchema,
  responseDeadline: z.string().nullable(),
  delayOptions: z.array(z.number().int()),
  reasonRequired: z.boolean(),
  commentsEnabled: z.boolean(),
  footerNote: z.string(),
  status: meetingStatusSchema,
  sentAt: z.string().nullable(),
});
/** A meeting as the editor and meeting page see it. */
export type Meeting = z.infer<typeof meetingSchema>;

/** Meetings page tabs (spec §10). */
export const meetingTabSchema = z.enum(["upcoming", "past", "drafts"]);
/** A Meetings page tab. */
export type MeetingTab = z.infer<typeof meetingTabSchema>;

/** Answer and invite counts on a card (RSVP "not going" counts as absent). */
export const meetingCountsSchema = z.object({
  invited: z.number().int(),
  sent: z.number().int(),
  /** Invite emails still waiting to go out. */
  queued: z.number().int(),
  attending: z.number().int(),
  late: z.number().int(),
  absent: z.number().int(),
  noReply: z.number().int(),
});
/** Counts on a meeting card. */
export type MeetingCounts = z.infer<typeof meetingCountsSchema>;

/** One card on the Meetings page. */
export const meetingSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.string().nullable(),
  timezone: z.string(),
  durationMinutes: z.number().int(),
  status: meetingStatusSchema,
  locationMode: locationModeSchema,
  responseMode: responseModeSchema,
  counts: meetingCountsSchema,
});
/** A meeting in the list. */
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;
/** `GET …/meetings?tab=`: one page of cards. */
export const meetingPageSchema = pageSchema(meetingSummarySchema);

/** `POST …/meetings` response (a new draft). */
export const createMeetingResponseSchema = z.object({ id: z.uuid() });

/** `PATCH …/meetings/[id]`: one wizard step's fields (drafts only). */
export const updateMeetingBodySchema = z
  .object({
    title: z.string().trim().max(TITLE_MAX),
    agendaMd: z.string().max(AGENDA_MAX),
    startsAt: isoInstant.nullable(),
    durationMinutes: durationMinutesSchema,
    timezone: timezoneSchema,
    locationMode: locationModeSchema,
    locationText: z.string().trim().max(LOCATION_MAX),
    onlineText: onlineTextSchema,
    meetingUrl: meetingUrlSchema,
    responseMode: responseModeSchema,
    responseDeadline: isoInstant.nullable(),
    delayOptions: delayOptionsSchema,
    reasonRequired: z.boolean(),
    commentsEnabled: z.boolean(),
    footerNote: footerNoteSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0);
/** A partial draft update. */
export type UpdateMeetingBody = z.infer<typeof updateMeetingBodySchema>;

/** `PUT …/audience`: picked lists and individual include / exclude sets (replaced as a whole). */
export const audienceBodySchema = z.object({
  listIds: z.array(z.uuid()).max(50),
  include: z.array(z.uuid()).max(500),
  exclude: z.array(z.uuid()).max(2000),
});
/** An audience update. */
export type AudienceBody = z.infer<typeof audienceBodySchema>;

/** One person in the Audience step. */
export const audiencePersonSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  listIds: z.array(z.uuid()),
  added: z.boolean(),
  excluded: z.boolean(),
  unsubscribed: z.boolean(),
  reported: z.boolean(),
  invited: z.boolean(),
});
/** A person in a meeting's audience. */
export type AudiencePerson = z.infer<typeof audiencePersonSchema>;

/** `GET/PUT …/audience` response. */
export const audienceSchema = z.object({
  listIds: z.array(z.uuid()),
  people: z.array(audiencePersonSchema),
  counts: z.object({
    selected: z.number().int(),
    invited: z.number().int(),
    unsubscribed: z.number().int(),
    toInvite: z.number().int(),
  }),
  maxInvitees: z.number().int(),
});
/** A meeting's resolved audience. */
export type Audience = z.infer<typeof audienceSchema>;

/** `POST …/people`: several people at once (spec §7.2 "Add people"). */
export const addPeopleBodySchema = z.object({
  people: z
    .array(
      z.object({
        fullName: z.string().trim().min(1).max(120),
        email: emailSchema,
      }),
    )
    .min(1)
    .max(PEOPLE_PER_ADD_MAX),
  saveToRoster: z.boolean(),
});
/** An "Add people" save. */
export type AddPeopleBody = z.infer<typeof addPeopleBodySchema>;
/** `POST …/people` response. */
export const addPeopleResponseSchema = z.object({
  contactIds: z.array(z.uuid()),
});

/** `POST …/send` response. */
export const sendResultSchema = z.object({
  invited: z.number().int(),
  skippedUnsubscribed: z.number().int(),
});

/** Delivery state of one invitee. */
export const inviteeStatusSchema = z.enum([
  "queued",
  "sent",
  "skipped",
  "failed",
  "unknown",
]);

/** `GET …/progress` response. */
export const progressSchema = z.object({
  counts: z.object({
    total: z.number().int(),
    queued: z.number().int(),
    sent: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    unknown: z.number().int(),
  }),
  paused: z.number().int(),
  resumesAt: z.string().nullable(),
  senderState: z.enum(["ok", "missing", "broken"]),
  invitees: z.array(
    z.object({
      id: z.uuid(),
      contactId: z.uuid(),
      fullName: z.string(),
      email: z.string(),
      status: inviteeStatusSchema,
      error: z.string().nullable(),
      sentAt: z.string().nullable(),
    }),
  ),
});
/** Live send progress of one meeting. */
export type MeetingProgress = z.infer<typeof progressSchema>;

/** `GET …/preview`: the invite as one example recipient would see it. */
export const previewSchema = z.object({
  subject: z.string(),
  html: z.string(),
  fromName: z.string(),
  fromEmail: z.string().nullable(),
  recipientName: z.string(),
});
