import { describe, expect, it } from "vitest";
import {
  deliveredPercent,
  percentFromBasisPoints,
  reportPercent,
  trend,
} from "./format";

describe("admin number formats", () => {
  it("turns basis points into a percent with up to two decimals", () => {
    expect(percentFromBasisPoints(9860)).toBe(98.6);
    expect(percentFromBasisPoints(1)).toBe(0.01);
    expect(percentFromBasisPoints(null)).toBeNull();
  });

  it("gives the report rate with one decimal (the mockups' 4.1%)", () => {
    expect(reportPercent(3, 74)).toBe(4.1);
    expect(reportPercent(0, 74)).toBe(0);
    expect(reportPercent(2, 0)).toBe(100);
  });

  it("gives the delivered share with one decimal, none when nothing was tried", () => {
    expect(deliveredPercent(9870, 10_000)).toBe(98.7);
    expect(deliveredPercent(0, 0)).toBeNull();
    expect(deliveredPercent(-3, 10)).toBe(0);
  });

  it("compares with the previous period", () => {
    expect(trend(214, 181)).toEqual({ change: 18, tone: "up" });
    expect(trend(10, 20)).toEqual({ change: -50, tone: "down" });
    expect(trend(5, 5)).toEqual({ change: 0, tone: "flat" });
    expect(trend(4, 0)).toEqual({ change: null, tone: "up" });
    expect(trend(0, 0)).toEqual({ change: 0, tone: "flat" });
  });
});
