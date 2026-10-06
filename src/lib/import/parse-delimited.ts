import Papa from "papaparse";
import { cleanCell } from "./clean-cell";
import type { SheetGrid } from "./types";

const TAB = "\t";

/**
 * Parses CSV/TSV text. Without `delimiter`, PapaParse picks the most consistent of `,` `;` tab `|`.
 * Blank lines stay in the grid so row numbers match the file.
 */
export function parseDelimited(text: string, delimiter = ""): SheetGrid {
  const result = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
  });
  return result.data.map((row) => row.map((cell) => cleanCell(cell)));
}

/** Text pasted from Google Sheets or Excel (tab-separated; a single column has no tabs). */
export function parsePaste(text: string): SheetGrid {
  return parseDelimited(text, text.includes(TAB) ? TAB : "");
}
