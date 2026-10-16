/** The platform-events lane (spec §8 M9). Lease and budget stay inside the route's 60 s maxDuration. */
export const PLATFORM_BUDGET_MS = 40_000;
/** Events claimed per round. */
export const PLATFORM_BATCH = 10;
/** How long a claimed event stays leased (twice the route's maxDuration). */
export const PLATFORM_LEASE_SECONDS = 120;
