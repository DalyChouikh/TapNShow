import { describe, expect, it } from "vitest";
import {
  periodFromParams,
  periodParams,
  presetPeriod,
  utcToday,
} from "./period";

const TODAY = "2026-10-16";

describe("admin periods", () => {
  it("reads today's UTC date", () => {
    expect(utcToday(new Date("2026-10-16T23:30:00-05:00"))).toBe("2026-10-17");
  });

  it.each([
    ["7d", "2026-10-10"],
    ["30d", "2026-09-17"],
    ["90d", "2026-07-19"],
    ["12m", "2025-11-01"],
  ] as const)("%s starts on %s and ends today", (preset, from) => {
    expect(presetPeriod(preset, TODAY)).toEqual({ from, to: TODAY });
  });

  it("reads a preset or a custom range from the address, 30 days otherwise", () => {
    const read = (query: string) =>
      periodFromParams(new URLSearchParams(query), TODAY);
    expect(read("")).toEqual({
      preset: "30d",
      period: presetPeriod("30d", TODAY),
    });
    expect(read("period=12m")).toEqual({
      preset: "12m",
      period: presetPeriod("12m", TODAY),
    });
    expect(read("from=2026-01-05&to=2026-03-01")).toEqual({
      preset: "custom",
      period: { from: "2026-01-05", to: "2026-03-01" },
    });
  });

  it.each([
    ["period=2y"],
    ["from=2026-03-01&to=2026-01-05"],
    ["from=2026-10-01&to=2026-10-17"],
    ["from=2024-10-15&to=2026-10-16"],
    ["from=2026-02-30&to=2026-03-01"],
    ["from=2026-10-01"],
  ])("falls back to 30 days for %s", (query) => {
    expect(periodFromParams(new URLSearchParams(query), TODAY)).toEqual({
      preset: "30d",
      period: presetPeriod("30d", TODAY),
    });
  });

  it("accepts two years exactly", () => {
    expect(
      periodFromParams(
        new URLSearchParams("from=2024-10-16&to=2026-10-16"),
        TODAY,
      ).preset,
    ).toBe("custom");
  });

  it("writes the address: nothing for the default, the preset, or the range", () => {
    expect(
      periodParams({ preset: "30d", period: presetPeriod("30d", TODAY) }),
    ).toBe("");
    expect(
      periodParams({ preset: "90d", period: presetPeriod("90d", TODAY) }),
    ).toBe("period=90d");
    expect(
      periodParams({
        preset: "custom",
        period: { from: "2026-01-05", to: "2026-03-01" },
      }),
    ).toBe("from=2026-01-05&to=2026-03-01");
  });
});
