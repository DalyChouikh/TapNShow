import "server-only";

/** A Google call not made because the run's budget is spent: the work waits for the next run. */
export type Late = { kind: "late" };

/** The one `Late` value. */
export const LATE: Late = { kind: "late" };

/**
 * Wraps a run's Google calls (spec §8): a call starts only while `canCall()` (the run keeps
 * `minLeftMs` of its budget for it), and a 401 gets one fresh token and one more try. `refresh`
 * renews the token behind `token()`, and reports "stop" when the run must give up (it has already
 * paused or rescheduled the work).
 */
export function budgetedGoogle(input: {
  canCall: () => boolean;
  refresh: () => Promise<"ok" | "stop">;
  token: () => string;
}): <R extends { kind: string }>(
  call: (token: string) => Promise<R>,
) => Promise<R | Late> {
  return async (call) => {
    if (!input.canCall()) {
      return LATE;
    }
    const first = await call(input.token());
    if (first.kind !== "unauthorized") {
      return first;
    }
    if (!input.canCall()) {
      return LATE;
    }
    if ((await input.refresh()) === "stop") {
      return first;
    }
    return input.canCall() ? call(input.token()) : LATE;
  };
}
