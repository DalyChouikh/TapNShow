import "server-only";
import { createHmac } from "node:crypto";
import { sha256Hex } from "./tokens";

/**
 * Personal-link token for one invitee (spec §6 Identity rules): HMAC-SHA256 of the invitee id with
 * `INVITE_TOKEN_SECRET`, so any later email can rebuild the same link without storing it.
 */
export function deriveInviteeToken(inviteeId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`invitee:${inviteeId}`)
    .digest("base64url");
}

/** What the database stores and looks up (`meeting_invitees.token_hash`). */
export function inviteeTokenHash(token: string): string {
  return sha256Hex(token);
}
