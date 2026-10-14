import "server-only";
import { createHash } from "node:crypto";
import webpush from "web-push";
import type { PushSendResult } from "./classify";

/** What a push needs besides the payload. */
export type PushSendOptions = {
  ttl: number;
  urgency: "high" | "normal";
  topic: string;
};

/** Sends one encrypted push to one browser endpoint (RFC 8030/8291/8292). */
export type PushSend = (
  target: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  options: PushSendOptions,
) => Promise<PushSendResult>;

/**
 * The `Topic` header for a notification tag: a resend replaces the pending one (RFC 8030 §5.4; at
 * most 32 URL-safe characters).
 */
export function pushTopic(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

/**
 * A push sender with our VAPID keys. `web-push` builds the signed, encrypted request; `fetch` sends
 * it with a deadline for the whole request (`timeoutMs`; the library's own timeout only covers an
 * idle socket) and never follows a redirect, so a push only ever reaches the stored endpoint.
 * Never throws: no answer is `{ status: null }`.
 */
export function createPushSender(
  vapid: { subject: string; publicKey: string; privateKey: string },
  timeoutMs: number,
): PushSend {
  return async (target, payload, options) => {
    try {
      const request = webpush.generateRequestDetails(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        {
          TTL: options.ttl,
          urgency: options.urgency,
          topic: options.topic,
          vapidDetails: vapid,
        },
      );
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        // fetch computes the length of the body itself.
        if (name.toLowerCase() !== "content-length") {
          headers.set(name, String(value));
        }
      }
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers,
        body: request.body ? new Uint8Array(request.body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      // The answer's body is never needed; releasing it frees the connection at once.
      await response.body?.cancel();
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
      };
    } catch {
      return { status: null };
    }
  };
}
