const PERSONAL_LINK = /\/r\/[^/?#]+/g;

/**
 * Replaces personal response-link tokens (`/r/<token>`) with a placeholder so they never
 * reach logs or error reports.
 */
export function scrubUrl(url: string): string {
  return url.replace(PERSONAL_LINK, "/r/[REDACTED]");
}
