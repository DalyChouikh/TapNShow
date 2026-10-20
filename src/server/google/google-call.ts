import "server-only";
import { z } from "zod";

/** Why a Google call failed, for the workers (spec §8 errors). */
export type GoogleFailure =
  | { kind: "retry"; status: number }
  | { kind: "unauthorized" }
  | { kind: "access_lost" }
  | { kind: "not_found" }
  /** The file passed Google's cell limit (the Owner's own tabs count too). */
  | { kind: "full" }
  /** The Drive holding the file is out of storage. */
  | { kind: "drive_full" }
  | { kind: "bug"; status: number; reason: string };

/** A Google call's value, or why it failed. */
export type GoogleResult<T> = { kind: "ok"; value: T } | GoogleFailure;

/** The part of `fetch` the Google clients use (tests pass a fake). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const errorSchema = z.object({
  error: z.object({
    message: z.string().default(""),
    status: z.string().default(""),
    errors: z.array(z.object({ reason: z.string().optional() })).default([]),
    details: z.array(z.object({ reason: z.string().optional() })).default([]),
  }),
});
const RATE_LIMIT = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
/** Google's wording when a write would pass a spreadsheet's cell limit (the number may change). */
const CELL_LIMIT = /above the limit of [\d,]+ cells/i;
const DISABLED = new Set(["accessNotConfigured", "SERVICE_DISABLED"]);

/** Google's reasons and message from an error body (empty when it isn't Google's JSON). */
export function googleErrorReasons(body: string): {
  reasons: string[];
  message: string;
} {
  try {
    const parsed = errorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      return {
        reasons: [...parsed.data.error.errors, ...parsed.data.error.details]
          .map((entry) => entry.reason ?? "")
          .filter(Boolean),
        message: parsed.data.error.message,
      };
    }
  } catch {
    // Not JSON: no reasons.
  }
  return { reasons: [], message: "" };
}

/**
 * Maps a non-2xx Sheets or Drive response (Google's "Resolve errors" guides; S6). Drive reports
 * rate limits as 403, and a disabled API is our setup, not the Owner's, so neither pauses a sheet; a
 * full Drive or a file past the cell limit pauses it with its own plain line (#291).
 */
export function classifyGoogleResponse(
  status: number,
  body: string,
): GoogleFailure {
  const { reasons, message } = googleErrorReasons(body);
  if (status === 401) {
    return { kind: "unauthorized" };
  }
  if (status === 403) {
    if (reasons.some((reason) => RATE_LIMIT.has(reason))) {
      return { kind: "retry", status };
    }
    if (reasons.includes("storageQuotaExceeded")) {
      return { kind: "drive_full" };
    }
    const disabled = reasons.find((reason) => DISABLED.has(reason));
    return disabled
      ? { kind: "bug", status, reason: disabled }
      : { kind: "access_lost" };
  }
  if (status === 404) {
    return { kind: "not_found" };
  }
  if (status === 400) {
    if (CELL_LIMIT.test(message)) {
      return { kind: "full" };
    }
    return { kind: "bug", status, reason: reasons[0] ?? "bad_request" };
  }
  return { kind: "retry", status };
}

/**
 * One Google API call with a bearer token and a whole-request timeout; never throws (a network
 * failure or a timeout is a retry). A 2xx body is parsed with `schema` (an empty body as `{}`; a
 * body that doesn't fit is a bug); any other status goes through `classify`.
 */
export async function googleCall<T, F>(input: {
  fetchImpl: FetchLike;
  timeoutMs: number;
  token: string;
  url: string;
  method: "GET" | "POST" | "DELETE";
  body?: object;
  schema: z.ZodType<T>;
  classify: (status: number, body: string) => F;
}): Promise<{ kind: "ok"; value: T } | F | GoogleFailure> {
  try {
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.token}`,
        ...(input.body ? { "content-type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      return input.classify(response.status, text);
    }
    const parsed = input.schema.safeParse(text ? JSON.parse(text) : {});
    return parsed.success
      ? { kind: "ok", value: parsed.data }
      : { kind: "bug", status: response.status, reason: "unexpected_response" };
  } catch {
    return { kind: "retry", status: 0 };
  }
}
