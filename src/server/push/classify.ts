import { PUSH_BACKOFF_MAX_SECONDS } from "@/config/push";

/** What a push service answered: an HTTP status (with `Retry-After`), or nothing (network, timeout). */
export type PushSendResult =
  { status: number; retryAfter: string | null } | { status: null };

/** What to do with a delivery after one attempt (spec §8). */
export type PushOutcome =
  | { kind: "sent" }
  | { kind: "gone" }
  | { kind: "retry"; afterSeconds: number }
  | { kind: "drop"; report: true };

function retryAfterSeconds(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const at = Date.parse(header);
  return Number.isNaN(at)
    ? null
    : Math.max(1, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Sorts a push service's answer (RFC 8030): 2xx sent; 404/410 the device is gone; 429, 5xx or no
 * answer retry (honouring `Retry-After`, else 1, 2, 4… minutes up to 30); anything else (400, 401,
 * 403, 413) is a bug on our side, dropped and reported.
 */
export function classifyPushResult(
  result: PushSendResult,
  attempts: number,
): PushOutcome {
  const { status } = result;
  if (status !== null && status >= 200 && status < 300) {
    return { kind: "sent" };
  }
  if (status === 404 || status === 410) {
    return { kind: "gone" };
  }
  if (status === null || status === 429 || status >= 500) {
    const backoff = Math.min(
      PUSH_BACKOFF_MAX_SECONDS,
      60 * 2 ** Math.max(0, attempts - 1),
    );
    const asked = status === null ? null : retryAfterSeconds(result.retryAfter);
    return {
      kind: "retry",
      afterSeconds: Math.min(PUSH_BACKOFF_MAX_SECONDS, asked ?? backoff),
    };
  }
  return { kind: "drop", report: true };
}
