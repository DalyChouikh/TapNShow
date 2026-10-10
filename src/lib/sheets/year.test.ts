import { describe, expect, it } from "vitest";
import { sheetYear } from "./year";

describe("sheetYear (twin: private.sheet_year)", () => {
  it("uses the meeting's own zone", () => {
    expect(sheetYear("2026-12-31T23:30:00.000Z", "Africa/Tunis")).toBe(2027);
    expect(sheetYear("2026-12-31T23:30:00.000Z", "America/New_York")).toBe(
      2026,
    );
  });
});
