import { describe, expect, it } from "vitest";
import { makeXlsx } from "@/test/fixtures/xlsx";
import { parseXlsx } from "./parse-xlsx";

describe("parseXlsx", () => {
  it("reads every sheet with text cells, numbers as text and empty rows kept", async () => {
    const workbook = makeXlsx([
      {
        name: "Members 2026",
        rows: [
          ["Nom complet", "E-mail", "Équipe", "Year"],
          ["Inès Ben Salah", " Ines@Example.com ", "Dev, Events", 2],
          [null, null, null, null],
          ["Youssef", "y@example.com", "Design", 3],
        ],
      },
      { name: "Old", rows: [["x"]] },
    ]);
    expect(await parseXlsx(workbook)).toEqual([
      {
        name: "Members 2026",
        grid: [
          ["Nom complet", "E-mail", "Équipe", "Year"],
          ["Inès Ben Salah", "Ines@Example.com", "Dev, Events", "2"],
          ["", "", "", ""],
          ["Youssef", "y@example.com", "Design", "3"],
        ],
      },
      { name: "Old", grid: [["x"]] },
    ]);
  });
});
