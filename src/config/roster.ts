/** Largest file the import dialog accepts; parsed on the device, never uploaded (spec §7.14). */
export const IMPORT_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Longest cell text sent to the import route. Above every database rule (name 120, email 254,
 * list 60), so the dry run still reports "too long" instead of the request being refused.
 */
export const IMPORT_CELL_MAX_CHARS = 500;

/** Most list names one row may carry. */
export const IMPORT_LISTS_PER_ROW_MAX = 50;

/** How long a deleted person can be restored with Undo before the delete is sent (spec §7.14). */
export const UNDO_DELETE_MS = 5000;

/** Separators inside one Lists cell: "Dev, Events" or "Dev; Events" or "Dev | Events" (spec §4). */
export const LIST_CELL_SEPARATORS = /[,;|]/;

/** From this width the roster shows the editable grid instead of cards (Tailwind `md`). */
export const ROSTER_GRID_MEDIA = "(min-width: 768px)";

/** First guess of a card's height before it is measured (virtualized list). */
export const ROSTER_CARD_ESTIMATE_PX = 104;
