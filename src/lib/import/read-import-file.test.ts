import { describe, expect, it } from "vitest";
import { IMPORT_FILE_MAX_BYTES } from "@/config/roster";
import { makeXlsx } from "@/test/fixtures/xlsx";
import { ImportFileError, readImportFile } from "./read-import-file";

const reason = async (file: File): Promise<string> =>
  readImportFile(file).then(
    () => "ok",
    (error: Error) =>
      error instanceof ImportFileError ? error.reason : error.message,
  );

describe("readImportFile", () => {
  it("reads CSV, TSV and XLSX files and skips empty sheets", async () => {
    expect(
      await readImportFile(new File(["Email\na@example.com\n"], "roster.CSV")),
    ).toEqual([
      { name: "roster.CSV", grid: [["Email"], ["a@example.com"], [""]] },
    ]);
    const xlsx = makeXlsx([
      { name: "Empty", rows: [] },
      { name: "Team", rows: [["Email"], ["a@example.com"]] },
    ]);
    expect(await readImportFile(new File([xlsx], "roster.xlsx"))).toEqual([
      { name: "Team", grid: [["Email"], ["a@example.com"]] },
    ]);
  });

  it("explains files it cannot read", async () => {
    expect(
      await reason(
        new File([new Uint8Array(IMPORT_FILE_MAX_BYTES + 1)], "big.csv"),
      ),
    ).toBe("too_large");
    expect(await reason(new File(["x"], "old.xls"))).toBe("xls");
    expect(await reason(new File(["x"], "notes.pdf"))).toBe("unsupported");
    expect(await reason(new File(["not a zip"], "broken.xlsx"))).toBe(
      "unreadable",
    );
    expect(await reason(new File(["\n\n \u00a0\n"], "blank.csv"))).toBe(
      "empty",
    );
  });
});
