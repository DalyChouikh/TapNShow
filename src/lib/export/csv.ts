import Papa from "papaparse";
import { escapeCell } from "./escape-cell";

/** A CSV file body: UTF-8 BOM (so Excel reads accents), CRLF line ends, formula-safe cells. */
export function toCsv(
  columns: string[],
  rows: (string | number | null)[][],
): string {
  const safe = rows.map((row) =>
    row.map((cell) =>
      typeof cell === "string" ? escapeCell(cell) : (cell ?? ""),
    ),
  );
  return `﻿${Papa.unparse({ fields: columns, data: safe }, { newline: "\r\n" })}\r\n`;
}
