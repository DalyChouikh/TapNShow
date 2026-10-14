import { describe, expect, it } from "vitest";
import { weekGroup } from "./group";

// Wednesday 14 Oct 2026, 10:00 local; weeks start on Monday.
const now = new Date(2026, 9, 14, 10, 0);

describe("weekGroup", () => {
  it("splits by calendar week, Monday first", () => {
    expect(weekGroup(new Date(2026, 9, 18, 18, 0).toISOString(), now)).toBe(
      "thisWeek",
    );
    expect(weekGroup(new Date(2026, 9, 19, 9, 0).toISOString(), now)).toBe(
      "nextWeek",
    );
    expect(weekGroup(new Date(2026, 9, 25, 23, 59).toISOString(), now)).toBe(
      "nextWeek",
    );
    expect(weekGroup(new Date(2026, 9, 26, 0, 0).toISOString(), now)).toBe(
      "later",
    );
  });
});
