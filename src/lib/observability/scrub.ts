/**
 * `/r/<token>` personal links and `/invite/<token>` invite links, including percent-encoded
 * slashes and any letter case. Route patterns such as `/r/[token]` are left alone.
 */
const TOKEN_LINK = /(?:\/|%2f)(r|invite)(?:\/|%2f)(?!\[|%5b)[^/?#&\s"'\\]+/gi;

/** Google OAuth callback URL with its query string (the `code` is a one-time credential). */
const OAUTH_CALLBACK = /\/api\/auth\/google\/callback\?[^#\s"']*/gi;

/** `code` and `state` values inside an OAuth callback query string. */
const OAUTH_SECRET_PARAM = /([?&](?:code|state)=)[^&#\s"']+/gi;

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

/**
 * Field names that are sensitive only as whole words (substring matching would hit
 * "author", "passenger"…): nodemailer's `auth.pass`, Web Push's `keys.auth`.
 */
const SENSITIVE_EXACT_KEYS = ["pass", "auth"] as const;

/** True when a field name suggests its value is a credential or secret. */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return (
    SENSITIVE_KEY.test(normalized) ||
    SENSITIVE_EXACT_KEYS.some((exact) => exact === normalized)
  );
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
  return url
    .replace(
      TOKEN_LINK,
      (_match, segment: string) => `/${segment.toLowerCase()}/[REDACTED]`,
    )
    .replace(OAUTH_CALLBACK, (callback) =>
      callback.replace(OAUTH_SECRET_PARAM, "$1[REDACTED]"),
    );
}

/** Credential shapes that must never appear in logs or error reports. */
const CREDENTIAL_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]"],
  [/\bya29\.[A-Za-z0-9._-]+/g, "[REDACTED_GOOGLE_TOKEN]"],
  [/\b1\/\/[A-Za-z0-9._-]{10,}/g, "[REDACTED_GOOGLE_TOKEN]"],
  [/\bsb_secret_[A-Za-z0-9_-]+/g, "[REDACTED_SUPABASE_KEY]"],
];

/**
 * Scrubs free text: personal-link tokens plus credential-shaped strings (Bearer
 * tokens, JWTs, Google OAuth tokens, Supabase secret keys).
 */
export function scrubText(text: string): string {
  return CREDENTIAL_PATTERNS.reduce(
    (scrubbed, [pattern, replacement]) =>
      scrubbed.replace(pattern, replacement),
    scrubUrl(text),
  );
}

/**
 * Returns a copy of a flat record with personal-link tokens scrubbed from every string value.
 * Non-string values are kept as-is.
 */
export function scrubRecord<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? scrubText(value) : value,
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
 * Walks the structure (no regex over serialized JSON); Errors become plain
 * `{ type, message, stack, cause }` objects; cycles and over-deep values are
 * replaced with `TRUNCATED`. May throw on hostile inputs (e.g. throwing getters) — callers
 * must fail closed.
 */
export function scrubDeep<T>(
  value: T,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): T {
  if (typeof value === "string") {
    return scrubText(value) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth > MAX_SCRUB_DEPTH || seen.has(value)) {
    return TRUNCATED as T;
  }
  seen.add(value);
  if (value instanceof Error) {
    // Error fields are non-enumerable; copy them explicitly so they survive the walk.
    return {
      type: value.name,
      message: scrubText(value.message),
      stack: value.stack ? scrubText(value.stack) : undefined,
      cause: scrubDeep(value.cause, depth + 1, seen),
    } as T;
  }
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
