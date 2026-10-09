/** Rows per page when a list endpoint gets no `limit` (spec §10 Pagination contract). */
export const PAGE_SIZE_DEFAULT = 50;
/** Largest `limit` a list endpoint accepts. */
export const PAGE_SIZE_MAX = 100;
/**
 * Longest cursor a client may send back (base64url of a small JSON array). Sized for the largest
 * keyset: two ids, an instant and a sort name of up to `SORT_NAME_MAX` units in any script.
 */
export const CURSOR_MAX_LENGTH = 2048;
/**
 * Longest lower-cased name in a cursor, in UTF-16 units: contact names allow 120 characters, each
 * up to two units, and lower-casing can lengthen a few of them.
 */
export const SORT_NAME_MAX = 480;
