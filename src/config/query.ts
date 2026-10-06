/** How long fetched data counts as fresh before TanStack Query refetches it. */
export const QUERY_STALE_TIME_MS = 30_000;

/** Retries for failed queries (server errors and network failures only). */
export const QUERY_MAX_RETRIES = 2;
