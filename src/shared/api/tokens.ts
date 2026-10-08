import { z } from "zod";
import { locationModeSchema } from "./meeting-settings";
import { meetingStatusSchema } from "./meetings";

/** Personal-link tokens: 32 bytes base64url (Task 3 `deriveInviteeToken`). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `GET /api/r/[token]`: only what the public pages show (spec §11 public token route). */
export const tokenInfoSchema = z.object({
  workspaceName: z.string(),
  maskedEmail: z.string(),
  unsubscribed: z.boolean(),
  reported: z.boolean(),
  meeting: z.object({
    title: z.string(),
    startsAt: z.string().nullable(),
    timezone: z.string(),
    durationMinutes: z.number().int(),
    locationMode: locationModeSchema,
    locationText: z.string(),
    meetingUrl: z.string(),
    status: meetingStatusSchema,
  }),
});
/** What one personal link shows. */
export type TokenInfo = z.infer<typeof tokenInfoSchema>;
