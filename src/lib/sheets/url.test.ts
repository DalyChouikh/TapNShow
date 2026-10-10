import { describe, expect, it } from "vitest";
import { sheetUrl, tabForMeeting } from "./url";

const tabs = [
  {
    googleSheetId: 11,
    year: 2026,
    startsFrom: "2026-05-01T00:00:00Z",
    startsTo: "2026-10-15T17:00:00Z",
  },
  {
    googleSheetId: 12,
    year: 2026,
    startsFrom: "2026-01-03T00:00:00Z",
    startsTo: "2026-04-28T17:00:00Z",
  },
  {
    googleSheetId: 13,
    year: 2025,
    startsFrom: "2025-02-01T00:00:00Z",
    startsTo: "2025-12-01T17:00:00Z",
  },
];

describe("sheet links", () => {
  it("opens the spreadsheet, or one tab of it", () => {
    expect(sheetUrl("abc123")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/edit",
    );
    expect(sheetUrl("abc123", 12)).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/edit#gid=12",
    );
  });

  it("finds the tab holding a meeting, else the newest tab", () => {
    expect(tabForMeeting(tabs, "2026-02-10T17:00:00Z", "Africa/Tunis")).toBe(
      12,
    );
    expect(tabForMeeting(tabs, "2025-06-01T17:00:00Z", "Africa/Tunis")).toBe(
      13,
    );
    expect(tabForMeeting(tabs, null, "Africa/Tunis")).toBe(11);
    expect(tabForMeeting([], null, "Africa/Tunis")).toBeUndefined();
    // Same instant as the newest tab's end, written with another offset.
    expect(
      tabForMeeting(tabs, "2026-10-15T18:00:00+01:00", "Africa/Tunis"),
    ).toBe(11);
    expect(
      tabForMeeting(tabs, "2026-04-28T18:00:00+01:00", "Africa/Tunis"),
    ).toBe(12);
  });
});
