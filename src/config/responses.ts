/** Reason and comment length (database checks on `responses`). */
export const REASON_MAX = 500;
export const COMMENT_MAX = 500;

/** The meeting page refreshes answers this often while visible (spec §7.7). */
export const RESULTS_POLL_MS = 10_000;
/** …and stops this long after the meeting ends (3 h). */
export const RESULTS_POLL_STOP_AFTER_END_MS = 10_800_000;

/** History period chips (spec §7.7): last 30 days, last 3 months, this year, all time, from–to. */
export const HISTORY_PERIODS = ["30d", "3m", "year", "all", "custom"] as const;
/** The chip selected by default. */
export const HISTORY_DEFAULT_PERIOD = "3m";
