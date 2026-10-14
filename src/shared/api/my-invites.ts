import { z } from "zod";
import { responseModeSchema } from "./meeting-settings";
import { meetingStatusSchema } from "./meetings";
import { pageSchema } from "./pagination";
import { answerStatusSchema, markSchema } from "./responses";
import { ANSWER_PAGE_PREFIX, TOKEN_PATTERN } from "./tokens";

/** `/invites` tabs (spec §7.4). */
export const myInvitesTabSchema = z.enum(["upcoming", "past"]);
/** An `/invites` tab. */
export type MyInvitesTab = z.infer<typeof myInvitesTabSchema>;

/** Upcoming's chips: everything, or only what needs the person's answer. */
export const myInvitesFilterSchema = z.enum(["all", "needs"]);
/** An Upcoming chip. */
export type MyInvitesFilter = z.infer<typeof myInvitesFilterSchema>;

/** `?tab=&filter=` of `GET /api/me/invites`; Past has no filter (nothing to answer there). */
export const myInvitesQuerySchema = z
  .object({
    tab: myInvitesTabSchema.default("upcoming"),
    filter: myInvitesFilterSchema.default("all"),
  })
  .refine((query) => query.tab === "upcoming" || query.filter === "all");

/** One invite card. Twin: `private.my_invites`. */
export const myInviteSchema = z.object({
  inviteeId: z.uuid(),
  workspaceName: z.string(),
  title: z.string(),
  startsAt: z.string(),
  timezone: z.string(),
  durationMinutes: z.number().int(),
  status: meetingStatusSchema,
  responseMode: responseModeSchema,
  responseDeadline: z.string().nullable(),
  needsAnswer: z.boolean(),
  answer: z
    .object({
      status: answerStatusSchema,
      delayMinutes: z.number().int().nullable(),
      reason: z.string(),
      needsReconfirmation: z.boolean(),
    })
    .nullable(),
  mark: z
    .object({
      actual: markSchema.shape.actual,
      lateMinutes: z.number().int().nullable(),
    })
    .nullable(),
});
/** One invite card. */
export type MyInvite = z.infer<typeof myInviteSchema>;

/**
 * `GET /api/me/invites`: one page, how many upcoming invites need an answer, and `asOf`, the
 * server's time when the page was made (shown when the page is read offline).
 */
export const myInvitesPageSchema = pageSchema(myInviteSchema).extend({
  needsCount: z.number().int(),
  asOf: z.string(),
});
/** One `/invites` page. */
export type MyInvitesPage = z.infer<typeof myInvitesPageSchema>;

/** `GET /api/me/invites/[id]/link`: the invite's answer page, relative to the app. */
export const myInviteLinkSchema = z.object({
  path: z
    .string()
    .refine(
      (path) =>
        path.startsWith(ANSWER_PAGE_PREFIX) &&
        TOKEN_PATTERN.test(path.slice(ANSWER_PAGE_PREFIX.length)),
    ),
});
