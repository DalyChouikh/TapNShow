import writeExcelFile, {
  type CellObject,
  type SheetData,
} from "write-excel-file/universal";
import { palette } from "@/design/tokens";
import type { ExportCell } from "./rows";
import type { ExportSheet } from "./save";

const COLORS = palette.light;
/** Arial ships with Excel, Numbers and Google Sheets; the app's Space Grotesk does not. */
const FONT = { fontFamily: "Arial", fontSize: 11 } as const;
const BORDER = { borderColor: COLORS.ink, borderStyle: "thin" } as const;
/** Title, subtitle, a gap, then the header: all four stay in place while scrolling. */
const HEADER_ROWS = 4;
/** Column width bounds, in characters. */
const WIDTH_MAX = 60;

/** A column wide enough for its header (bold) and its longest value, at least its set width. */
function columnWidth(sheet: ExportSheet, index: number): number {
  const column = sheet.columns[index];
  const longest = Math.max(
    0,
    ...sheet.rows.map((row) => String(cellText(row[index]) ?? "").length),
  );
  return Math.min(
    WIDTH_MAX,
    Math.max(
      column.width,
      Math.ceil(column.header.length * 1.25) + 3,
      Math.ceil(longest * 1.1) + 2,
    ),
  );
}

const cellText = (cell: ExportCell | undefined) =>
  cell !== null && typeof cell === "object" ? cell.text : cell;

/** A table cell: bordered (empty ones too, so the table reads as one), tinted when it has a tone. */
function tableCell(cell: ExportCell | undefined): CellObject {
  const style = { ...BORDER, alignVertical: "center", height: 22 } as const;
  if (cell === null || cell === undefined || cell === "") {
    return style;
  }
  if (typeof cell === "object") {
    return { ...style, value: cell.text, backgroundColor: COLORS[cell.tone] };
  }
  return { ...style, value: cell };
}

/** One centred line across the whole table (the title band). */
function bandRow(
  value: string,
  span: number,
  style: Pick<CellObject, "fontSize" | "fontWeight" | "textColor" | "height">,
): CellObject[] {
  return [
    {
      value,
      columnSpan: span,
      align: "center",
      alignVertical: "center",
      ...style,
    },
  ];
}

/**
 * One sheet in the app's look (owner-approved sample, #257): a centred title band, a bold header
 * filled like the app (or with its column's tone), tinted answer and check-in cells, ink borders,
 * the title and header frozen, grid lines kept, widths that fit.
 */
export function xlsxSheet(sheet: ExportSheet) {
  const span = sheet.columns.length;
  const data: SheetData = [
    bandRow(sheet.title, span, {
      fontSize: 16,
      fontWeight: "bold",
      textColor: COLORS.ink,
      height: 30,
    }),
    bandRow(sheet.subtitle, span, { textColor: COLORS.muted, height: 20 }),
    [],
    sheet.columns.map((column) => ({
      value: column.header,
      fontWeight: "bold",
      textColor: COLORS.ink,
      backgroundColor: COLORS[column.tone ?? "primary"],
      alignVertical: "center",
      height: 28,
      wrap: true,
      borderColor: COLORS.ink,
      borderStyle: "medium",
    })),
    ...sheet.rows.map((row) =>
      sheet.columns.map((_, index) => tableCell(row[index])),
    ),
  ];
  return {
    sheet: sheet.name,
    data,
    columns: sheet.columns.map((_, index) => ({
      width: columnWidth(sheet, index),
    })),
    stickyRowsCount: HEADER_ROWS,
  };
}

/** An .xlsx file built on the device (spec §7.7); text stays text, numbers stay numbers. */
export async function toXlsxBlob(sheets: ExportSheet[]): Promise<Blob> {
  return writeExcelFile(sheets.map(xlsxSheet), FONT).toBlob();
}
