import type { FillTone } from "@/design/tokens";
import { DETAIL_COLUMNS } from "@/lib/export/columns";
import {
  EXPORT_COLORS,
  EXPORT_FONT_FAMILY,
  EXPORT_FONT_SIZE,
  EXPORT_HEADER_ROWS,
} from "@/lib/export/theme";
import type { Json, SheetsRequest, TabContent } from "./types";
import type { SheetWords } from "./words";

const VISIBLE = DETAIL_COLUMNS.length;
/** Hidden helper columns after the table: band, Answer tone, Checked in tone (spec §8). */
const BAND_COLUMN = VISIBLE;
const ANSWER_TONE_COLUMN = VISIBLE + 1;
const CHECK_TONE_COLUMN = VISIBLE + 2;
/** Every column a TapNShow tab has. */
export const SHEET_COLUMNS = VISIBLE + 3;
const ANSWER = DETAIL_COLUMNS.findIndex((column) => column.key === "answer");
const CHECKED_IN = DETAIL_COLUMNS.findIndex(
  (column) => column.key === "checkedIn",
);
const TINTS: ReadonlyArray<FillTone> = [
  "success",
  "warning",
  "danger",
  "neutral",
];
/** How many colour rules `formatRequests` adds (two band rules, two per tint); a tab with fewer lost some. */
export const SHEET_RULE_COUNT = 2 + TINTS.length * 2;
/** Pixels per character, matching how Excel sizes the same widths. */
const PX_PER_CHAR = 7;

/** "A", …, "Z", "AA" for a zero-based column index. */
function letter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** `#C4B5FD` → Sheets' 0–1 colour, rounded to 3 decimals. */
function rgb(hex: string): { [key: string]: Json } {
  const part = (start: number) =>
    Math.round((parseInt(hex.slice(start, start + 2), 16) / 255) * 1000) / 1000;
  return { red: part(1), green: part(3), blue: part(5) };
}

const range = (
  sheetId: number,
  rows: [number, number?],
  columns: [number, number],
) => ({
  sheetId,
  startRowIndex: rows[0],
  ...(rows[1] === undefined ? {} : { endRowIndex: rows[1] }),
  startColumnIndex: columns[0],
  endColumnIndex: columns[1],
});

const border = { style: "SOLID", color: rgb(EXPORT_COLORS.ink) };
const font = (extra: { [key: string]: Json } = {}) => ({
  fontFamily: EXPORT_FONT_FAMILY,
  fontSize: EXPORT_FONT_SIZE,
  foregroundColor: rgb(EXPORT_COLORS.ink),
  ...extra,
});

/** A colour rule at `index`: the rule with the lowest index wins when several match (S6). */
function rule(
  sheetId: number,
  index: number,
  columns: [number, number],
  formula: string,
  color: string,
): SheetsRequest {
  return {
    addConditionalFormatRule: {
      index,
      rule: {
        ranges: [range(sheetId, [EXPORT_HEADER_ROWS], columns)],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: formula }],
          },
          format: { backgroundColor: rgb(color) },
        },
      },
    },
  };
}

/** A new TapNShow tab at `index` (our own id, so later requests in the batch can name it). */
export function addSheetRequest(
  sheetId: number,
  title: string,
  index: number,
): SheetsRequest {
  return { addSheet: { properties: { sheetId, title, index } } };
}

/** Removes a TapNShow tab that has nothing left to show. */
export function deleteSheetRequest(sheetId: number): SheetsRequest {
  return { deleteSheet: { sheetId } };
}

/**
 * The formatting a tab keeps between redraws (applied when it is created, when its format version
 * is old, or when someone removed it): title band merges and styles, the header, hidden helper
 * columns, colour rules on open-ended ranges, and the Meeting filter box. Old rules and slicers are
 * removed first, so applying it twice leaves the same tab.
 */
export function formatRequests(
  sheetId: number,
  existing: { conditionalFormats: number; slicerIds: number[] },
  words: SheetWords,
  slicerId: number,
): SheetsRequest[] {
  const whole: [number, number] = [0, VISIBLE];
  const helper = (column: number) =>
    `$${letter(column)}${EXPORT_HEADER_ROWS + 1}`;
  // Tone rules come first (lowest indexes), so a tinted cell keeps its tint on a banded row; the
  // old rules are all deleted above, so indexes 0, 1, 2 … are free in order.
  const rules: [[number, number], string, string][] = [
    ...TINTS.flatMap((tint): [[number, number], string, string][] => [
      [
        [ANSWER, ANSWER + 1],
        `=${helper(ANSWER_TONE_COLUMN)}="${tint}"`,
        EXPORT_COLORS[tint],
      ],
      [
        [CHECKED_IN, CHECKED_IN + 1],
        `=${helper(CHECK_TONE_COLUMN)}="${tint}"`,
        EXPORT_COLORS[tint],
      ],
    ]),
    [whole, `=${helper(BAND_COLUMN)}="odd"`, EXPORT_COLORS.background],
    [whole, `=${helper(BAND_COLUMN)}="cancelled"`, EXPORT_COLORS.neutral],
  ];
  return [
    ...Array.from({ length: existing.conditionalFormats }, () => ({
      deleteConditionalFormatRule: { sheetId, index: 0 },
    })),
    ...existing.slicerIds.map((objectId) => ({
      deleteEmbeddedObject: { objectId },
    })),
    { unmergeCells: { range: range(sheetId, [0, 2], whole) } },
    {
      mergeCells: {
        range: range(sheetId, [0, 1], whole),
        mergeType: "MERGE_ALL",
      },
    },
    {
      mergeCells: {
        range: range(sheetId, [1, 2], whole),
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: range(sheetId, [0, 1], whole),
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            textFormat: font({ bold: true, fontSize: 16 }),
          },
        },
        fields:
          "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
      },
    },
    {
      repeatCell: {
        range: range(sheetId, [1, 2], whole),
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            textFormat: font({ foregroundColor: rgb(EXPORT_COLORS.muted) }),
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    },
    {
      repeatCell: {
        range: range(
          sheetId,
          [EXPORT_HEADER_ROWS - 1, EXPORT_HEADER_ROWS],
          whole,
        ),
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(EXPORT_COLORS.primary),
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
            textFormat: font({ bold: true }),
            borders: {
              top: { ...border, style: "SOLID_MEDIUM" },
              bottom: { ...border, style: "SOLID_MEDIUM" },
              left: border,
              right: border,
            },
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,verticalAlignment,wrapStrategy,textFormat,borders)",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: VISIBLE,
          endIndex: SHEET_COLUMNS,
        },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
    ...rules.map(([columns, formula, color], index) =>
      rule(sheetId, index, columns, formula, color),
    ),
    {
      addSlicer: {
        slicer: {
          slicerId,
          spec: {
            dataRange: range(sheetId, [EXPORT_HEADER_ROWS - 1], whole),
            columnIndex: 0,
            title: words.column("meeting"),
            applyToPivotTables: false,
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId,
                rowIndex: EXPORT_HEADER_ROWS - 2,
                columnIndex: 0,
              },
              widthPixels: 240,
              heightPixels: 30,
            },
          },
        },
      },
    },
  ];
}

const value = (cell: string | number | null): { [key: string]: Json } =>
  cell === null || cell === ""
    ? {}
    : {
        userEnteredValue:
          typeof cell === "number"
            ? { numberValue: cell }
            : { stringValue: cell },
      };

/**
 * One redraw (spec §8): exact row count (leftover rows go), our title back, borders and fonts on the
 * data rows, fitted widths, and every value from A1 (values only; colours come from the rules).
 */
export function redrawRequests(
  sheetId: number,
  title: string,
  content: TabContent,
  slicerId: number,
): SheetsRequest[] {
  const rows = Math.max(content.values.length, 1);
  const lastRow = EXPORT_HEADER_ROWS + rows;
  const blank = (count: number) => Array.from({ length: count }, () => ({}));
  return [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          title,
          gridProperties: {
            rowCount: lastRow,
            columnCount: SHEET_COLUMNS,
            frozenRowCount: EXPORT_HEADER_ROWS,
          },
        },
        fields: "title,gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    },
    {
      // S6: a slicer keeps the row count it was created with, so each redraw resets its range.
      updateSlicerSpec: {
        slicerId,
        spec: {
          dataRange: range(
            sheetId,
            [EXPORT_HEADER_ROWS - 1, lastRow],
            [0, VISIBLE],
          ),
        },
        fields: "dataRange",
      },
    },
    {
      repeatCell: {
        range: range(sheetId, [EXPORT_HEADER_ROWS, lastRow], [0, VISIBLE]),
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            textFormat: font(),
            borders: {
              top: border,
              bottom: border,
              left: border,
              right: border,
            },
          },
        },
        fields: "userEnteredFormat(verticalAlignment,textFormat,borders)",
      },
    },
    ...content.widths.map((width, index) => ({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: index,
          endIndex: index + 1,
        },
        properties: { pixelSize: width * PX_PER_CHAR },
        fields: "pixelSize",
      },
    })),
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: [
          { values: [value(content.band), ...blank(SHEET_COLUMNS - 1)] },
          { values: [value(content.subtitle), ...blank(SHEET_COLUMNS - 1)] },
          { values: blank(SHEET_COLUMNS) },
          { values: [...content.header.map(value), ...blank(3)] },
          ...(content.values.length === 0
            ? [{ values: blank(SHEET_COLUMNS) }]
            : content.values.map((row, index) => ({
                values: [
                  ...row.map(value),
                  ...content.helpers[index].map(value),
                ],
              }))),
        ],
        fields: "userEnteredValue",
      },
    },
  ];
}
