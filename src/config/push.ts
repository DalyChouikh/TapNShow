import { DISPATCH_MAX_DURATION_S } from "./meetings";

/** Phone notification tuning (spec §8 Push worker). */

/** One push run's time, inside the internal route's 60 s `maxDuration` (like the other workers). */
export const PUSH_BUDGET_MS = 50_000;
/** A push service request gives up after this long (then it is retried). */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000;
/** A batch starts only with this much budget left, so a run never passes `maxDuration`. */
export const PUSH_MIN_LEFT_MS = PUSH_REQUEST_TIMEOUT_MS + 2_000;
/** Deliveries sent side by side, and claimed per batch (`push_claim`'s `p_limit`). */
export const PUSH_CONCURRENCY = 10;
/** Lease length: twice the route's `maxDuration`, so a run is dead before its lease can be taken. */
export const PUSH_LEASE_SECONDS = 2 * DISPATCH_MAX_DURATION_S;
/** While the email worker still runs, an empty claim waits this long and looks again. */
export const PUSH_IDLE_POLL_MS = 2_000;
/** How long a push service keeps a cancellation for an offline phone. */
export const PUSH_CANCEL_TTL_SECONDS = 86_400;
/** Shortest TTL we send (a meeting about to start). */
export const PUSH_TTL_MIN_SECONDS = 60;
/** Longest TTL push services accept (FCM: 4 weeks). */
export const PUSH_TTL_MAX_SECONDS = 2_419_200;
/** Longest title or body; the payload stays far under the 4 KB push limit. */
export const PUSH_TEXT_MAX = 240;
/** Longest back-off. Twin: `private.app_limits.push_retry_max_minutes` (30). */
export const PUSH_BACKOFF_MAX_SECONDS = 1_800;
