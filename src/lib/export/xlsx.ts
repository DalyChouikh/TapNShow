import writeExcelFile from "write-excel-file/universal";

/** One sheet of an export. */
export type XlsxSheet = {
  name: string;
  columns: { header: string; width: number }[];
  rows: (string | number | Date | null)[][];
};

/** An .xlsx file built on the device (spec §7.7); text stays text, numbers stay numbers. */
export async function toXlsxBlob(sheets: XlsxSheet[]): Promise<Blob> {
  return writeExcelFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      columns: sheet.columns.map((column) => ({ width: column.width })),
      data: [
        sheet.columns.map((column) => ({ value: column.header, fontWeight: "bold" as const })),
        ...sheet.rows.map((row) => row.map((value) => (value === null ? null : { value }))),
      ],
    })),
  ).toBlob();
}
