import { describe, expect, it } from "vitest";
import { periodRange } from "./periods";

const NOW = new Date("2026-10-08T10:00:00Z");

describe("periodRange", () => {
  it("covers the last 30 days and the last 3 months up to now", () => {
    expect(periodRange("30d", NOW, "Africa/Tunis")).toEqual({
      from: "2026-09-08T10:00:00.000Z",
      to: null,
    });
    expect(periodRange("3m", NOW, "Africa/Tunis")).toEqual({
      from: "2026-07-08T10:00:00.000Z",
      to: null,
    });
  });

  it("starts this year at local midnight on 1 January in the workspace zone", () => {
    expect(periodRange("year", NOW, "Africa/Tunis")).toEqual({
      from: "2025-12-31T23:00:00.000Z",
      to: null,
    });
  });

  it("is open for all time", () => {
    expect(periodRange("all", NOW, "Africa/Tunis")).toEqual({
      from: null,
      to: null,
    });
  });

  it("includes the whole last day of a custom range", () => {
    expect(
      periodRange("custom", NOW, "Africa/Tunis", {
        from: "2026-09-15",
        to: "2026-09-30",
      }),
    ).toEqual({
      from: "2026-09-14T23:00:00.000Z",
      to: "2026-09-30T23:00:00.000Z",
    });
  });

  it("ends a custom range at the next local midnight across a DST change", () => {
    expect(
      periodRange("custom", NOW, "Europe/Paris", {
        from: "2026-10-20",
        to: "2026-10-25",
      }),
    ).toEqual({
      from: "2026-10-19T22:00:00.000Z",
      to: "2026-10-25T23:00:00.000Z",
    });
  });
});
