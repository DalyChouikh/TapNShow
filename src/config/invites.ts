/**
 * Most addresses one "Invite someone" request may contain. Matches the per-workspace daily email
 * budget (`invite_email_workspace_per_day` in private.app_limits), so one full batch can still be
 * emailed; the database stays the authority on the budget itself.
 */
export const INVITE_BATCH_MAX = 20;
