import readXlsxFile from "read-excel-file/universal";
import { cleanCell } from "./clean-cell";
import type { ImportSheet } from "./types";

/** Every sheet of an `.xlsx` file as text grids (the `universal` build needs no Web Worker). */
export async function parseXlsx(bytes: ArrayBuffer): Promise<ImportSheet[]> {
  const sheets = await readXlsxFile(bytes);
  return sheets.map((sheet) => ({
    name: sheet.sheet,
    grid: sheet.data.map((row) => row.map((cell) => cleanCell(cell))),
  }));
}
