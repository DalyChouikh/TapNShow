/**
 * `/r/<token>` personal links, including percent-encoded slashes and any letter case.
 * Route patterns such as `/r/[token]` are left alone.
 */
const PERSONAL_LINK = /(?:\/|%2f)r(?:\/|%2f)(?!\[|%5b)[^/?#&\s"'\\]+/gi;

/** Request headers that may carry credentials or personal-link URLs. */
export const SENSITIVE_HEADERS = [
  "cookie",
  "authorization",
  "referer",
] as const;

/** Replacement for values stored under sensitive field names. */
export const REDACTED = "[REDACTED]";

/**
 * Field names (case/separator-insensitive substring match) whose values are always
 * redacted, e.g. `token`, `refresh_token`, `Authorization`, `apiKey`, `password`.
 */
const SENSITIVE_KEY =
  /token|secret|passw(or)?d|authorization|cookie|apikey|privatekey|dsn/;

/** True when a field name suggests its value is a credential or secret. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[^a-z]/g, ""));
}

/** Replacement for values beyond the walk depth or already visited (cycles). */
export const TRUNCATED = "[Truncated]";

/** Maximum nesting depth scrubbed before values are truncated. */
export const MAX_SCRUB_DEPTH = 20;

/**
 * Replaces personal response-link tokens with a placeholder so they never reach logs or
 * error reports.
 */
export function scrubUrl(url: string): string {
  return url.replace(PERSONAL_LINK, "/r/[REDACTED]");
}

/**
 * Returns a copy of a flat record with personal-link tokens scrubbed from every string value.
 * Non-string values are kept as-is.
 */
export function scrubRecord<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? scrubUrl(value) : value,
    ]),
  ) as T;
}

/**
 * Removes credential/referrer headers (case-insensitive) and scrubs the rest.
 */
export function scrubHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const kept = Object.entries(headers).filter(
    ([name]) =>
      !SENSITIVE_HEADERS.some((sensitive) => sensitive === name.toLowerCase()),
  );
  return scrubRecord(Object.fromEntries(kept));
}

/**
 * Returns a deep copy with personal-link tokens scrubbed from every string and key at any
 * depth, and values under sensitive field names (see `isSensitiveKey`) redacted.
 * Walks the structure (no regex over serialized JSON); cycles and over-deep values are
 * replaced with `TRUNCATED`. May throw on hostile inputs (e.g. throwing getters) — callers
 * must fail closed.
 */
export function scrubDeep<T>(
  value: T,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): T {
  if (typeof value === "string") {
    return scrubUrl(value) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth > MAX_SCRUB_DEPTH || seen.has(value)) {
    return TRUNCATED as T;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1, seen)) as T;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      scrubUrl(key),
      isSensitiveKey(key) && item !== undefined && item !== null
        ? REDACTED
        : scrubDeep(item, depth + 1, seen),
    ]),
  ) as T;
}
