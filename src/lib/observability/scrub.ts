/** `/r/<token>` paths; route patterns such as `/r/[token]` are left alone. */
const PERSONAL_LINK = /\/r\/(?!\[)[^/?#\s"']+/g;

/** Request headers that may carry credentials or personal-link URLs. */
export const SENSITIVE_HEADERS = [
  "cookie",
  "authorization",
  "referer",
] as const;

/**
 * Replaces personal response-link tokens (`/r/<token>`) with a placeholder so they never
 * reach logs or error reports.
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
