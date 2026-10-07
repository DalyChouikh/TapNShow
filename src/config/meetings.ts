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
