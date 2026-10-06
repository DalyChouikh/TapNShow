import { IMPORT_FILE_MAX_BYTES } from "@/config/roster";
import { decodeText } from "./decode-text";
import { parseDelimited } from "./parse-delimited";
import { parseXlsx } from "./parse-xlsx";
import type { ImportSheet } from "./types";

/** Why a chosen file cannot be imported (each has a message in `ListsImport.fileErrors`). */
export type ImportFileErrorReason =
  "too_large" | "xls" | "unsupported" | "unreadable" | "empty";

/** A file the import cannot read, with a reason the dialog explains. */
export class ImportFileError extends Error {
  constructor(readonly reason: ImportFileErrorReason) {
    super(reason);
    this.name = "ImportFileError";
  }
}

const DELIMITED_EXTENSIONS: readonly string[] = ["csv", "tsv", "txt"];

const hasContent = (sheet: ImportSheet): boolean =>
  sheet.grid.some((row) => row.some((cell) => cell !== ""));

/**
 * Reads a chosen file on the device (never uploaded): CSV/TSV/TXT or XLSX.
 * @throws ImportFileError when the file is too big, an old `.xls`, another type, broken, or empty
 */
export async function readImportFile(file: File): Promise<ImportSheet[]> {
  if (file.size > IMPORT_FILE_MAX_BYTES) {
    throw new ImportFileError("too_large");
  }
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (extension === "xls") {
    throw new ImportFileError("xls");
  }
  if (extension !== "xlsx" && !DELIMITED_EXTENSIONS.includes(extension)) {
    throw new ImportFileError("unsupported");
  }
  const bytes = await file.arrayBuffer();
  let sheets: ImportSheet[];
  if (extension === "xlsx") {
    try {
      sheets = await parseXlsx(bytes);
    } catch {
      throw new ImportFileError("unreadable");
    }
  } else {
    sheets = [{ name: file.name, grid: parseDelimited(decodeText(bytes)) }];
  }
  const withContent = sheets.filter(hasContent);
  if (withContent.length === 0) {
    throw new ImportFileError("empty");
  }
  return withContent;
}
