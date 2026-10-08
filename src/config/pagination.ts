/** Rows per page when a list endpoint gets no `limit` (spec §10 Pagination contract). */
export const PAGE_SIZE_DEFAULT = 50;
/** Largest `limit` a list endpoint accepts. */
export const PAGE_SIZE_MAX = 100;
/** Longest cursor a client may send back (base64url of a small JSON array). */
export const CURSOR_MAX_LENGTH = 512;
