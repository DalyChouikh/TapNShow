import { z } from "zod";
import { COMMENT_MAX, REASON_MAX } from "@/config/responses";
import { responseModeSchema, type ResponseMode } from "./meeting-settings";

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

/** `PUT /api/r/[token]/response`. The database applies the meeting's rules (spec §7.3). */
export const submitAnswerBodySchema = z.object({
  status: answerStatusSchema,
  delayMinutes: z.number().int().min(1).max(240).nullable(),
  reason: z.string().max(REASON_MAX),
  comment: z.string().max(COMMENT_MAX),
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
