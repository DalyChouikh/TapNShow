import { describe, expect, it } from "vitest";
import { IMPORT_CELL_MAX_CHARS } from "@/config/roster";
import { buildImportRows, splitListCell } from "./build-import-rows";
import { parsePaste } from "./parse-delimited";

describe("splitListCell", () => {
  it("splits on , ; and | and drops empty parts", () => {
    expect(splitListCell("Dev, Events;Media | ;")).toEqual([
      "Dev",
      "Events",
      "Media",
    ]);
  });
});

describe("buildImportRows", () => {
  it("joins first and last name in column order and keeps file row numbers (Review Focus 3)", () => {
    const grid = parsePaste(
      "Prénom\tNom\tEmail\tÉquipe\n\nInès\tBen Salah\tines@example.com\tDev|Media\nYoussef\t\ty@example.com\t",
    );
    expect(
      buildImportRows(grid, {
        hasHeader: true,
        targets: ["fullName", "fullName", "email", "lists"],
      }),
    ).toEqual([
      {
        row: 3,
        fullName: "Inès Ben Salah",
        email: "ines@example.com",
        lists: ["Dev", "Media"],
      },
      { row: 4, fullName: "Youssef", email: "y@example.com", lists: [] },
    ]);
  });

  it("keeps the first row as data without a header, sends empty cells as null", () => {
    const grid = parsePaste("ines@example.com\t\nsara@example.com\tSarra");
    expect(
      buildImportRows(grid, {
        hasHeader: false,
        targets: ["email", "fullName"],
      }),
    ).toEqual([
      { row: 1, fullName: null, email: "ines@example.com", lists: [] },
      { row: 2, fullName: "Sarra", email: "sara@example.com", lists: [] },
    ]);
  });

  it("merges several Lists columns and clamps oversized cells", () => {
    const long = "x".repeat(IMPORT_CELL_MAX_CHARS + 10);
    const grid = [
      ["Name", "Email", "Team", "Cell"],
      [long, "a@example.com", "Dev", "Media"],
    ];
    const [row] = buildImportRows(grid, {
      hasHeader: true,
      targets: ["fullName", "email", "lists", "lists"],
    });
    expect(row.fullName).toHaveLength(IMPORT_CELL_MAX_CHARS);
    expect(row.lists).toEqual(["Dev", "Media"]);
  });
});
