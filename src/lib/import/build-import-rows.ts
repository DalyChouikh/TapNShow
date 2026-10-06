import {
  IMPORT_CELL_MAX_CHARS,
  IMPORT_LISTS_PER_ROW_MAX,
  LIST_CELL_SEPARATORS,
} from "@/config/roster";
import type { ImportRowInput } from "@/shared/api/roster";
import type { ColumnMapping, ColumnTarget, SheetGrid } from "./types";

/** "Dev, Events" → ["Dev", "Events"] (also `;` and `|`, spec §4). */
export function splitListCell(cell: string): string[] {
  return cell
    .split(LIST_CELL_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

const clamp = (text: string): string => text.slice(0, IMPORT_CELL_MAX_CHARS);

/**
 * Rows for the import route. `row` is the 1-based row of the file, so the preview can say
 * "Row 41". Blank rows and the header are skipped; several Full name columns are joined in
 * column order ("Prénom" + "Nom"); several Lists columns are merged.
 */
export function buildImportRows(
  grid: SheetGrid,
  mapping: ColumnMapping,
): ImportRowInput[] {
  const headerIndex = mapping.hasHeader
    ? grid.findIndex((row) => row.some((cell) => cell !== ""))
    : -1;
  const cellsFor = (row: string[], target: ColumnTarget): string[] =>
    mapping.targets.flatMap((columnTarget, column) => {
      const cell = row[column] ?? "";
      return columnTarget === target && cell !== "" ? [cell] : [];
    });
  return grid.flatMap((row, index): ImportRowInput[] => {
    if (index <= headerIndex || row.every((cell) => cell === "")) {
      return [];
    }
    const fullName = cellsFor(row, "fullName").join(" ");
    const email = cellsFor(row, "email")[0] ?? "";
    return [
      {
        row: index + 1,
        fullName: fullName === "" ? null : clamp(fullName),
        email: email === "" ? null : clamp(email),
        lists: cellsFor(row, "lists")
          .flatMap(splitListCell)
          .map(clamp)
          .slice(0, IMPORT_LISTS_PER_ROW_MAX),
      },
    ];
  });
}
