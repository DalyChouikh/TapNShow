import { describe, expect, it } from "vitest";
import {
  periodFromSearchParams,
  periodRange,
  periodSearchParams,
} from "./periods";

const NOW = new Date("2026-10-08T10:00:00Z");

describe("periodRange", () => {
  it("covers the last 30 days and the last 3 months from local midnight, up to now", () => {
    expect(periodRange("30d", NOW, "Africa/Tunis")).toEqual({
      from: "2026-09-07T23:00:00.000Z",
      to: null,
    });
    expect(periodRange("3m", NOW, "Africa/Tunis")).toEqual({
      from: "2026-07-07T23:00:00.000Z",
      to: null,
    });
  });

  // #417: the same day asks the same question, so a second visit reuses the first answer.
  it.each(["30d", "3m"] as const)(
    "gives %s the same range all day long",
    (period) => {
      const early = new Date("2026-10-07T23:30:00Z"); // 00:30 in Tunis
      const late = new Date("2026-10-08T22:30:00Z"); // 23:30 in Tunis
      expect(periodRange(period, early, "Africa/Tunis")).toEqual(
        periodRange(period, late, "Africa/Tunis"),
      );
    },
  );

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

describe("a period in a link (#417)", () => {
  it("carries a chip, and a From… range with its days", () => {
    expect(periodSearchParams({ period: "30d" }).toString()).toBe("period=30d");
    const custom = {
      period: "custom",
      custom: { from: "2026-09-01", to: "2026-09-30" },
    } as const;
    expect(periodSearchParams(custom).toString()).toBe(
      "period=custom&from=2026-09-01&to=2026-09-30",
    );
    expect(periodFromSearchParams(periodSearchParams(custom))).toEqual(custom);
    expect(periodFromSearchParams(new URLSearchParams("period=3m"))).toEqual({
      period: "3m",
    });
  });

  it.each([
    "",
    "period=week",
    "period=custom",
    "period=custom&from=2026-09-30&to=2026-09-01",
    "period=custom&from=2026-13-01&to=2026-13-02",
    "period=custom&from=yesterday&to=today",
  ])("ignores a link without a usable period (%s)", (query) => {
    expect(periodFromSearchParams(new URLSearchParams(query))).toBeNull();
  });
});
