import { describe, expect, it } from "vitest";
import { lastDayAllowed, rangeFrom } from "./date-range";

const range = { from: "2026-09-01", to: "2026-10-01" };

describe("rangeFrom", () => {
  it("keeps the last day when the new first day still comes before it", () => {
    expect(rangeFrom(range, "2026-09-15", {})).toEqual({
      from: "2026-09-15",
      to: "2026-10-01",
    });
  });

  it("moves the last day to the first when the first goes past it", () => {
    expect(rangeFrom(range, "2026-10-05", {})).toEqual({
      from: "2026-10-05",
      to: "2026-10-05",
    });
  });

  it("pulls the last day in when the range would grow past its longest", () => {
    expect(rangeFrom(range, "2026-08-01", { maxDays: 10 })).toEqual({
      from: "2026-08-01",
      to: "2026-08-10",
    });
  });
});

describe("lastDayAllowed", () => {
  it("is the latest day, the longest range's end, whichever comes first", () => {
    expect(lastDayAllowed("2026-09-01", {})).toBeUndefined();
    expect(lastDayAllowed("2026-09-01", { latest: "2026-10-16" })).toBe(
      "2026-10-16",
    );
    expect(
      lastDayAllowed("2026-09-01", { latest: "2026-10-16", maxDays: 10 }),
    ).toBe("2026-09-10");
    expect(
      lastDayAllowed("2026-10-10", { latest: "2026-10-16", maxDays: 10 }),
    ).toBe("2026-10-16");
  });
});
