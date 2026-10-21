import { differenceInMilliseconds } from "date-fns";
import { PROGRESS_POLL_MS, THROTTLE_DEFER_MS } from "@/config/meetings";
import { RESULTS_POLL_MS } from "@/config/responses";
import type { MeetingResults } from "@/shared/api/responses";

/** Why sending is paused: the workspace is under review, or its Gmail is missing or broken. */
export type PauseReason = "suspended" | "broken" | "missing";

/** Where a meeting's invites stand (spec §7.2): one rule for the meeting page and Home. */
export type SendState =
  | { kind: "paused"; why: PauseReason }
  | { kind: "waiting"; resumesAt: string }
  | { kind: "sending" }
  | { kind: "sent" };

/**
 * A meeting's send state from its counts. A pause for review (spec §7.12) comes first, since
 * reconnecting Gmail wouldn't help, and only matters to emails still waiting.
 */
export function sendState(
  results: MeetingResults,
  suspended: boolean,
): SendState {
  if (results.emails.queued === 0 && results.paused === 0) {
    return { kind: "sent" };
  }
  if (suspended) {
    return { kind: "paused", why: "suspended" };
  }
  if (results.paused > 0 || results.senderState !== "ok") {
    return {
      kind: "paused",
      why: results.senderState === "broken" ? "broken" : "missing",
    };
  }
  return results.resumesAt
    ? { kind: "waiting", resumesAt: results.resumesAt }
    : { kind: "sending" };
}

/**
 * How soon to ask for a meeting's counts again: every few seconds while invites go out; at the
 * resume time while Gmail's limit holds them (an hour at most, the longest it defers); at the live
 * pace while the meeting is `live`; else never. A pause ends only when someone acts, and the page
 * asks again when it gets focus back.
 */
export function resultsPollMs(
  results: MeetingResults | undefined,
  suspended: boolean,
  live: boolean,
  now: Date,
): number | false {
  const state = results ? sendState(results, suspended) : null;
  if (state?.kind === "sending") {
    return PROGRESS_POLL_MS;
  }
  const livePace = live ? RESULTS_POLL_MS : false;
  if (state?.kind !== "waiting") {
    return livePace;
  }
  const untilResume = Math.min(
    Math.max(
      differenceInMilliseconds(new Date(state.resumesAt), now),
      PROGRESS_POLL_MS,
    ),
    THROTTLE_DEFER_MS,
  );
  return livePace === false ? untilResume : Math.min(untilResume, livePace);
}
