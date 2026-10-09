import readXlsxFile from "read-excel-file/universal";
import { describe, expect, it } from "vitest";
import { toXlsxBlob } from "./xlsx";

describe("toXlsxBlob", () => {
  it("writes the sheets with headers, and keeps formula-looking text as text", async () => {
    const blob = await toXlsxBlob([
      {
        name: "Summary",
        columns: [
          { header: "Name", width: 24 },
          { header: "Late", width: 8 },
        ],
        rows: [
          ["Amira B.", 3],
          ["=1+1", null],
        ],
      },
      {
        name: "Details",
        columns: [{ header: "Meeting", width: 24 }],
        rows: [["Weekly sync"]],
      },
    ]);
    const sheets = await readXlsxFile(await blob.arrayBuffer());
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Summary", "Details"]);
    expect(sheets[0].data[0]).toEqual(["Name", "Late"]);
    expect(sheets[0].data[1]).toEqual(["Amira B.", 3]);
    expect(sheets[0].data[2][0]).toBe("=1+1");
    expect(sheets[1].data[1]).toEqual(["Weekly sync"]);
  });
});
