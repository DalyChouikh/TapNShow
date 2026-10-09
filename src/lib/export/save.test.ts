import readXlsxFile from "read-excel-file/universal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "./download";
import { saveExport } from "./save";

vi.mock("./download", () => ({ downloadBlob: vi.fn() }));

const today = new Date(2026, 9, 9, 12);
const sheets = [
  {
    name: "Summary",
    columns: [
      { header: "Name", width: 24 },
      { header: "Late", width: 8 },
    ],
    rows: [
      ["Amira B.", 3],
      ["=HYPERLINK(1)", null],
    ],
  },
  {
    name: "Details",
    columns: [{ header: "Meeting", width: 24 }],
    rows: [["Weekly sync"]],
  },
];

beforeEach(() => vi.clearAllMocks());

describe("saveExport", () => {
  it("saves the first sheet as a formula-safe CSV named after the parts and the date", async () => {
    await saveExport("csv", sheets, ["Robotics Club", "Attendance"], today);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe("robotics-club-attendance-2026-10-09.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await blob.arrayBuffer(),
    );
    expect(body).toBe("﻿Name,Late\r\nAmira B.,3\r\n'=HYPERLINK(1),\r\n");
  });

  it("saves every sheet as an .xlsx file", async () => {
    await saveExport("xlsx", sheets, ["Robotics Club", "Attendance"], today);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe("robotics-club-attendance-2026-10-09.xlsx");
    const read = await readXlsxFile(await blob.arrayBuffer());
    expect(read.map((sheet) => sheet.sheet)).toEqual(["Summary", "Details"]);
    expect(read[0].data[2][0]).toBe("=HYPERLINK(1)");
  });
});
