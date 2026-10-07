import "server-only";
import { z } from "zod";
import { GMAIL_SEND_PATH } from "@/config/gmail";

/** What one `users.messages.send` call means for the dispatcher (spec §8 error table). */
export type GmailSendResult =
  | { kind: "sent"; id: string; threadId: string }
  | { kind: "invalid_recipient"; reason: string }
  | { kind: "thread_missing" }
  | { kind: "auth" }
  | { kind: "throttled" }
  | { kind: "retry"; status: number }
  | { kind: "forbidden"; reason: string }
  | { kind: "unknown"; reason: string };

const sentSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
});
const errorSchema = z.object({
  error: z.object({
    message: z.string().default(""),
    errors: z
      .array(
        z.object({
          domain: z.string().optional(),
          reason: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

const MAX_REASON = 200;
const THROTTLE_429 = /mail sending|bandwidth/i;

/** Classifies a non-2xx Gmail API response (Google's "Resolve errors" guide). */
export function classifyGmailResponse(
  status: number,
  body: string,
): GmailSendResult {
  let message = "";
  let domain = "";
  try {
    const parsed = errorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      message = parsed.data.error.message.slice(0, MAX_REASON);
      domain = parsed.data.error.errors[0]?.domain ?? "";
    }
  } catch {
    message = "";
  }
  if (status === 400) {
    return { kind: "invalid_recipient", reason: message || "bad_request" };
  }
  if (status === 401) {
    return { kind: "auth" };
  }
  if (status === 403) {
    return domain === "usageLimits"
      ? { kind: "throttled" }
      : { kind: "forbidden", reason: message || "forbidden" };
  }
  if (status === 404) {
    return { kind: "thread_missing" };
  }
  if (status === 429) {
    return THROTTLE_429.test(message)
      ? { kind: "throttled" }
      : { kind: "retry", status };
  }
  return { kind: "retry", status };
}

/**
 * Sends one raw message from the connected account. Never throws: a request that got no HTTP
 * response (network failure, timeout) is `unknown`, because Gmail may already have sent it.
 */
export async function sendGmailMessage(
  input: {
    baseUrl: string;
    accessToken: string;
    raw: string;
    threadId: string | null;
    timeoutMs: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<GmailSendResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${input.baseUrl}${GMAIL_SEND_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        input.threadId
          ? { raw: input.raw, threadId: input.threadId }
          : { raw: input.raw },
      ),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    return {
      kind: "unknown",
      reason: error instanceof Error ? error.name : "network",
    };
  }
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    return classifyGmailResponse(response.status, body);
  }
  try {
    const sent = sentSchema.parse(JSON.parse(body));
    return { kind: "sent", id: sent.id, threadId: sent.threadId };
  } catch {
    return { kind: "unknown", reason: "unreadable_success" };
  }
}
