import readXlsxFile from "read-excel-file/universal";
import { describe, expect, it } from "vitest";
import { palette } from "@/design/tokens";
import type { ExportSheet } from "./save";
import { toXlsxBlob, xlsxSheet } from "./xlsx";

const summary: ExportSheet = {
  name: "Summary",
  title: "Attendance · Summary",
  subtitle: "GDG ISSAT · All time · Exported Sat 10 Oct, 19:30",
  columns: [
    { header: "Name", width: 24 },
    { header: "Going", width: 8, tone: "success" },
  ],
  rows: [
    ["Amira B.", 3],
    ["=1+1", null],
  ],
};

describe("toXlsxBlob", () => {
  it("writes each sheet under its title band, and keeps formula-looking text as text", async () => {
    const blob = await toXlsxBlob([
      summary,
      {
        name: "Details",
        title: "Attendance · Details",
        subtitle: "GDG ISSAT",
        columns: [{ header: "Answer", width: 24 }],
        rows: [[{ text: "Going", tone: "success" }]],
      },
    ]);
    const sheets = await readXlsxFile(await blob.arrayBuffer());
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Summary", "Details"]);
    const [title, subtitle, , header, first, second] = sheets[0].data;
    expect(title[0]).toBe("Attendance · Summary");
    expect(subtitle[0]).toBe(
      "GDG ISSAT · All time · Exported Sat 10 Oct, 19:30",
    );
    expect(header).toEqual(["Name", "Going"]);
    expect(first).toEqual(["Amira B.", 3]);
    expect(second[0]).toBe("=1+1");
    expect(sheets[1].data[4]).toEqual(["Going"]);
  });
});

describe("xlsxSheet (the app's look, owner-approved sample #257)", () => {
  const sheet = xlsxSheet({
    ...summary,
    rows: [[{ text: "Can't come", tone: "danger" }, null]],
  });
  const [title, subtitle, gap, header, row] = sheet.data;

  it("centres the title band over the whole table and freezes it with the header", () => {
    expect(title[0]).toMatchObject({
      value: "Attendance · Summary",
      columnSpan: 2,
      align: "center",
      fontWeight: "bold",
    });
    expect(subtitle[0]).toMatchObject({ columnSpan: 2, align: "center" });
    expect(gap).toEqual([]);
    expect(sheet.stickyRowsCount).toBe(4);
    expect(sheet).not.toHaveProperty("showGridLines");
  });

  it("fills the header like the app, tinted where a column has a tone", () => {
    expect(header[0]).toMatchObject({
      value: "Name",
      fontWeight: "bold",
      backgroundColor: palette.light.primary,
    });
    expect(header[1]).toMatchObject({ backgroundColor: palette.light.success });
  });

  it("tints answers and check-ins, and borders every table cell, empty ones too", () => {
    expect(row[0]).toMatchObject({
      value: "Can't come",
      backgroundColor: palette.light.danger,
      borderColor: palette.light.ink,
    });
    expect(row[1]).toMatchObject({ borderColor: palette.light.ink });
    expect(row[1]).not.toHaveProperty("value");
  });

  it("widens columns to fit their header and content", () => {
    const wide = xlsxSheet({
      ...summary,
      columns: [{ header: "After the deadline", width: 8 }],
      rows: [["x"]],
    });
    expect(wide.columns[0].width).toBeGreaterThanOrEqual(
      "After the deadline".length + 3,
    );
    expect(sheet.columns[0].width).toBeGreaterThanOrEqual(24);
  });
});
