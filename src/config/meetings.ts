import type { ResponseMode } from "@/shared/api/meeting-settings";

/** Delay chips offered for "I'll be late" (minutes; spec §4 attendance mode). */
export const DELAY_OPTION_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const;

/**
 * How late someone can be, in minutes (1 to this): an answer's delay, a delay option and a Late
 * check-in. Database twins: the checks on `responses.delay_minutes` and
 * `attendance_marks.late_minutes`, `private.valid_delay_options`, `private.mark_attendance`.
 */
export const LATE_MINUTES_MAX = 240;

/** At most this many delay options per meeting (database: `private.valid_delay_options`). */
export const DELAY_OPTIONS_MAX = 6;

/** Duration chips in the wizard (minutes); "Other" allows any value in range. */
export const DURATION_CHOICES = [30, 60, 90, 120] as const;

/** Duration range (database check on `meetings` and `workspaces`). */
export const DURATION_MIN = 5;
export const DURATION_MAX = 720;

/** Footer note length (database check). */
export const FOOTER_NOTE_MAX = 280;

/** An answer a member can give from an email button (spec §7.3). */
export type ResponseChoice =
  "attending" | "late" | "absent" | "going" | "not_going";

/** The buttons each response mode shows, in order. */
export const RESPONSE_CHOICES: Record<ResponseMode, readonly ResponseChoice[]> =
  {
    announcement: [],
    rsvp: ["going", "not_going"],
    attendance: ["attending", "late", "absent"],
  };

/** Time list step in the TimePicker (minutes). */
export const TIME_STEP_MINUTES = 15;

/** The dispatcher routes' `maxDuration` (seconds); route files repeat it as a literal (Next needs one). */
export const DISPATCH_MAX_DURATION_S = 60;
/** Room for the last send's bookkeeping after Gmail answers. */
export const DISPATCH_SAFETY_MARGIN_MS = 5_000;
/**
 * A run starts no new send after this long, so the slowest send (Gmail timeout) still finishes
 * before the function is stopped (#168): 35 s + 20 s + 5 s = 60 s.
 */
export const DISPATCH_BUDGET_MS = 35_000;
/** Pause between two sends from one Gmail account (≤ 60/min, spec §8). */
export const DISPATCH_PACE_MS = 1_000;
/** Jobs claimed per sender per round (one budget's worth at the pace above). */
export const DISPATCH_BATCH_SIZE = 50;
/** Sender lease and job lock length; longer than the budget so a live run never loses them. */
export const DISPATCH_LEASE_SECONDS = 70;
/** Gmail said "slow down": that sender waits this long (its block lasts 1–24 h). */
export const THROTTLE_DEFER_MS = 3_600_000;
/** Google's token endpoint failed transiently: retry that sender after this long. */
export const REFRESH_FAILURE_DEFER_MS = 300_000;

/** How often the meeting page refreshes while emails are queued. */
export const PROGRESS_POLL_MS = 3_000;
/** Field limits (mirror the database checks on `meetings`). */
export const TITLE_MAX = 120;
export const AGENDA_MAX = 5_000;
export const LOCATION_MAX = 200;
export const MEETING_URL_MAX = 500;
/** "Add people" accepts this many rows per save (`meeting_people_per_call_max`). */
export const PEOPLE_PER_ADD_MAX = 50;

/** Audience rows shown before "Show N more". */
export const AUDIENCE_PAGE_SIZE = 50;

/**
 * Whether Gmail keeps a custom From display name set by the Gmail API: confirmed on the first real
 * send (2026-10-08, the inbox showed the workspace name). When false, Review shows only the address.
 */
export const FROM_NAME_KEPT = true;

/** Longest search in a meeting's people list and check-in (DB twin: `meeting_people` refuses longer). */
export const PEOPLE_SEARCH_MAX = 120;

/** Wait after the last keystroke before searching the check-in list (ms). */
export const SEARCH_DEBOUNCE_MS = 250;
