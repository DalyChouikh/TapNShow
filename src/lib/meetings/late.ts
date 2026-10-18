import { DELAY_OPTION_CHOICES, LATE_MINUTES_MAX } from "@/config/meetings";

/**
 * The longest late time a meeting of `durationMinutes` allows: shorter than the meeting (#400),
 * never over `LATE_MINUTES_MAX`. It bounds the delay choices, a member's late answer (one of those
 * choices) and a Late check-in. SQL twin: `private.late_minutes_max` (pinned by
 * `late-fits-meeting.db.test.ts`).
 */
export function lateMinutesMax(durationMinutes: number): number {
  return Math.min(LATE_MINUTES_MAX, durationMinutes - 1);
}

/**
 * The delay choices that fit a meeting of `durationMinutes`, in their order. SQL twin:
 * `private.fitting_delays`, which the meetings and workspace-defaults checks compare against.
 */
export function fittingDelays(
  options: readonly number[],
  durationMinutes: number,
): number[] {
  const max = lateMinutesMax(durationMinutes);
  return options.filter((minutes) => minutes <= max);
}

/** The delay chips a meeting of `durationMinutes` offers (wizard Answers step, Settings defaults). */
export function delayChoices(durationMinutes: number): number[] {
  return fittingDelays(DELAY_OPTION_CHOICES, durationMinutes);
}
