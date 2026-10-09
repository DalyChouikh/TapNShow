import type { ExportFormat } from "@/components/forms/export-menu";
import { toCsv } from "./csv";
import { downloadBlob } from "./download";
import { exportFileName } from "./file-name";
import type { ExportCell } from "./rows";

/** One sheet of an export: its name, column headers and widths, and rows. */
export type ExportSheet = {
  name: string;
  columns: { header: string; width: number }[];
  rows: ExportCell[][];
};

/**
 * Builds the file on the device and saves it (spec §7.7): CSV holds the first sheet, Excel every
 * sheet (its writer loads only when needed). Named from `fileParts` plus today's date.
 */
export async function saveExport(
  format: ExportFormat,
  sheets: ExportSheet[],
  fileParts: string[],
  today: Date,
): Promise<void> {
  const name = exportFileName(fileParts, format, today);
  if (format === "csv") {
    const [first] = sheets;
    const body = toCsv(
      first.columns.map((column) => column.header),
      first.rows,
    );
    downloadBlob(new Blob([body], { type: "text/csv;charset=utf-8" }), name);
    return;
  }
  const { toXlsxBlob } = await import("./xlsx");
  downloadBlob(await toXlsxBlob(sheets), name);
}
