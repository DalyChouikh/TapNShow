/** Rows per page in every admin list (spec §7.19: 25 at a time). */
export const ADMIN_PAGE_SIZE = 25;

/**
 * The Overview warns about the platform's daily invite-email budget from this share of
 * `invite_email_platform_per_day` (`private.app_limits`) on.
 */
export const PLATFORM_EMAIL_WARN_SHARE = 0.8;

/** Open suspensions the Overview lists one by one; the rest link to the Suspended filter. */
export const ATTENTION_SUSPENSIONS_SHOWN = 3;

/**
 * Admin reads count as stale at once, so every admin page asks again when it opens: an admin
 * removed meanwhile gets the API's 404 (and the not-found view) instead of cached figures.
 */
export const ADMIN_STALE_TIME_MS = 0;
