import { format } from "date-fns";

/**
 * Invisible characters that spreadsheets and copy-paste leave inside cells: zero-width spaces and
 * joiners, bidi marks/embeddings/isolates (common in Arabic-locale sheets), soft hyphens and BOMs.
 */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** ISO day, so a date cell is readable and stable. */
const DATE_FORMAT = "yyyy-MM-dd";

/**
 * Text of one spreadsheet cell, normalized for comparison: NFC accents, invisible characters
 * removed, any run of whitespace (non-breaking included) collapsed to one space, trimmed.
 * `object` covers the `Date` cells read-excel-file returns.
 */
export function cleanCell(
  value: string | number | boolean | object | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text =
    value instanceof Date ? format(value, DATE_FORMAT) : String(value);
  return text
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}
