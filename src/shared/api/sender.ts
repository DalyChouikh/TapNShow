import { z } from "zod";

/** Health of a Google connection. */
export const connectionStatusSchema = z.enum(["active", "broken"]);

/** `GET …/sender` response (spec §7.15). */
export const workspaceSenderSchema = z.object({
  sender: z
    .object({
      connectionId: z.uuid(),
      email: z.string(),
      status: connectionStatusSchema,
      connectedBy: z.string(),
      connectedAt: z.string(),
      isMine: z.boolean(),
      sentLast24h: z.number().int(),
      dailyLimit: z.number().int(),
    })
    .nullable(),
  ownerName: z.string(),
  myConnections: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      status: connectionStatusSchema,
      usedBy: z.array(z.string()),
    }),
  ),
});
/** The workspace's sender as one member sees it. */
export type WorkspaceSender = z.infer<typeof workspaceSenderSchema>;

/** `PUT …/sender` body (Owner: use one of my connections). */
export const setSenderBodySchema = z.object({ connectionId: z.uuid() });

/** `?gmail_error=` values the connect callback can return. */
export const GMAIL_CONNECT_ERRORS = [
  "unavailable",
  "owner_only",
  "cancelled",
  "scope_denied",
  "no_refresh_token",
  "failed",
] as const;
/** One connect failure reason. */
export type GmailConnectError = (typeof GMAIL_CONNECT_ERRORS)[number];
