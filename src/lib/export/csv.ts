import Papa from "papaparse";
import { escapeCell } from "./escape-cell";
import type { ExportCell } from "./rows";

/** A CSV file body: UTF-8 BOM (so Excel reads accents), CRLF line ends, formula-safe cells. */
export function toCsv(columns: string[], rows: ExportCell[][]): string {
  const safe = rows.map((row) =>
    row.map((cell) => {
      const plain =
        cell !== null && typeof cell === "object" ? cell.text : cell;
      return typeof plain === "string" ? escapeCell(plain) : (plain ?? "");
    }),
  );
  return `﻿${Papa.unparse({ fields: columns, data: safe }, { newline: "\r\n" })}\r\n`;
}
