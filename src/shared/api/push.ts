import { z } from "zod";
import { REMINDER_AUDIENCES } from "@/config/reminders";
import { locationModeSchema, responseModeSchema } from "./meeting-settings";

/** One leased delivery with what its notification says, DB-shaped in, camelCase out. Twin: `private.push_claim`. */
export const pushItemSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["invite", "update", "cancel", "reminder"]),
    audience: z.enum(REMINDER_AUDIENCES).nullable(),
    attempts: z.number().int(),
    invitee_id: z.uuid(),
    endpoint: z.string(),
    p256dh: z.string(),
    auth: z.string(),
    workspace_name: z.string(),
    locale: z.string(),
    title: z.string(),
    starts_at: z.string(),
    timezone: z.string(),
    duration_minutes: z.number().int(),
    location_mode: locationModeSchema,
    location_text: z.string(),
    online_text: z.string(),
    response_mode: responseModeSchema,
    answered: z.boolean(),
    needs_reconfirmation: z.boolean(),
  })
  .transform((db) => ({
    id: db.id,
    kind: db.kind,
    audience: db.audience,
    attempts: db.attempts,
    inviteeId: db.invitee_id,
    endpoint: db.endpoint,
    p256dh: db.p256dh,
    auth: db.auth,
    workspaceName: db.workspace_name,
    locale: db.locale,
    title: db.title,
    startsAt: db.starts_at,
    timezone: db.timezone,
    durationMinutes: db.duration_minutes,
    locationMode: db.location_mode,
    locationText: db.location_text,
    onlineText: db.online_text,
    responseMode: db.response_mode,
    answered: db.answered,
    needsReconfirmation: db.needs_reconfirmation,
  }));
/** One leased delivery with what its notification says. */
export type PushItem = z.output<typeof pushItemSchema>;

/** `POST /api/me/push-subscriptions`: the browser's `PushSubscription.toJSON()`. Twin: the checks on `push_subscriptions`. */
export const pushSubscriptionBodySchema = z.object({
  endpoint: z.url().startsWith("https://").max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{21,24}={0,2}$/),
  }),
});
/** A browser subscription. */
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;
/** `DELETE /api/me/push-subscriptions`. */
export const pushUnsubscribeBodySchema = pushSubscriptionBodySchema.pick({
  endpoint: true,
});
