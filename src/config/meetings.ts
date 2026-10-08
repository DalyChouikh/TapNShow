import type { ResponseMode } from "@/shared/api/meeting-settings";

/** Delay chips offered for "I'll be late" (minutes; spec §4 attendance mode). */
export const DELAY_OPTION_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const;

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

/** One dispatcher run sends for at most this long, leaving headroom under the 60 s route limit. */
export const DISPATCH_BUDGET_MS = 50_000;
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
 * Whether Gmail keeps a custom From display name set by the Gmail API (checked at Task 10's first
 * real send; see the M4 ledger). When false, the Review step shows only the address.
 */
export const FROM_NAME_KEPT = true;
