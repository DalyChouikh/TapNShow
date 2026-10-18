import {
  DELAY_OPTION_CHOICES,
  DELAY_OPTIONS_MAX,
  LATE_MINUTES_MAX,
} from "@/config/meetings";

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

/** Why a typed late time can't join the choices: out of 1 to `lateMinutesMax`, a repeat, or a seventh. */
export type AddDelayProblem = "range" | "taken" | "full";

/**
 * Adds a typed late time ("Other") to the delay choices, kept in order, or says why it can't: the
 * same rules the database applies (`private.valid_delay_options`, `private.fitting_delays`).
 */
export function addDelayOption(
  options: readonly number[],
  minutes: number,
  durationMinutes: number,
): { options: number[] } | { problem: AddDelayProblem } {
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > lateMinutesMax(durationMinutes)
  ) {
    return { problem: "range" };
  }
  if (options.includes(minutes)) {
    return { problem: "taken" };
  }
  if (options.length >= DELAY_OPTIONS_MAX) {
    return { problem: "full" };
  }
  return { options: [...options, minutes].sort((a, b) => a - b) };
}
