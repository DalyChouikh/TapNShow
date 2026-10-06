/** Cells of one sheet as text, row by row, header row included and blank rows kept. */
export type SheetGrid = string[][];

/** What a source column becomes in the roster. */
export type ColumnTarget = "fullName" | "email" | "lists" | "ignore";

/** The "Match columns" step's answer. */
export type ColumnMapping = { hasHeader: boolean; targets: ColumnTarget[] };

/** One sheet of a workbook (a CSV file is one sheet named after the file). */
export type ImportSheet = { name: string; grid: SheetGrid };
