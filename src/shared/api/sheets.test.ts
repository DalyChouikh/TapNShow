import { describe, expect, it } from "vitest";
import { sheetStatusSchema } from "./sheets";

const base = {
  spreadsheetId: "file-abcdefghij",
  pausedReason: null,
  syncedAt: "2026-10-12T21:15:00.000Z",
  behind: false,
  createdAt: "2026-10-10T09:00:00.000Z",
  turnedOnBy: "Daly",
  accountEmail: null,
  ownerName: "Daly",
  tabs: [{ year: 2026, googleSheetId: 11, startsFrom: null, startsTo: null }],
  sharing: null,
};

describe("sheetStatusSchema", () => {
  it("reads the four states", () => {
    expect(sheetStatusSchema.parse({ ...base, state: "on" }).state).toBe("on");
    expect(
      sheetStatusSchema.parse({
        ...base,
        state: "creating",
        spreadsheetId: null,
      }).spreadsheetId,
    ).toBeNull();
    expect(
      sheetStatusSchema.parse({
        ...base,
        state: "paused",
        pausedReason: "trashed",
      }).pausedReason,
    ).toBe("trashed");
    expect(
      sheetStatusSchema.parse({
        ...base,
        state: "off",
        spreadsheetId: null,
        tabs: [],
      }).state,
    ).toBe("off");
  });

  it("rejects an unknown state or reason", () => {
    expect(
      sheetStatusSchema.safeParse({ ...base, state: "broken" }).success,
    ).toBe(false);
    expect(
      sheetStatusSchema.safeParse({
        ...base,
        state: "paused",
        pausedReason: "lost",
      }).success,
    ).toBe(false);
  });
});
