import { describe, expect, it } from "vitest";
import { groupLabels, labelledBars, labelStride, pointName } from "./chart";

describe("labelStride", () => {
  it("dates every bar when the width is unknown or there is room", () => {
    expect(labelStride(30, null, 16)).toBe(1);
    expect(labelStride(12, 600, 16)).toBe(1);
  });

  it("dates every n-th bar when the labels would touch", () => {
    // 31 days on a 320 px phone: about 7.4 px a bar, so every third bar.
    expect(labelStride(31, 230, 16)).toBe(3);
  });
});

describe("labelledBars", () => {
  it("keeps the chosen bar dated and clears its close neighbours", () => {
    expect([...labelledBars(10, 4, 3)].sort((a, b) => a - b)).toEqual([
      0, 4, 9,
    ]);
    expect([...labelledBars(5, 2, 1)]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("groupLabels", () => {
  const months = ["Oct", "Nov", "Nov", "Nov", "Nov", "Dec"];

  it("writes a group's name on its first bar", () => {
    expect(groupLabels(months, null, 28)).toEqual([
      "Oct",
      "Nov",
      null,
      null,
      null,
      "Dec",
    ]);
  });

  it("leaves out a name its bars have no room for, so names never overlap or overflow", () => {
    // 10 px a bar: "Oct" and "Dec" have one bar (10 px) for a 28 px name; "Nov" has four (40 px).
    expect(groupLabels(months, 60, 28)).toEqual([
      null,
      "Nov",
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("pointName", () => {
  it("names a day by its date", () => {
    expect(
      pointName({ start: "2026-10-16", end: "2026-10-16" }, "day"),
    ).toEqual({ date: "16 Oct" });
  });

  it("names a week by its days, across months and years too", () => {
    expect(
      pointName({ start: "2026-10-05", end: "2026-10-11" }, "week"),
    ).toEqual({ start: "5", end: "11 Oct" });
    expect(
      pointName({ start: "2026-09-28", end: "2026-10-04" }, "week"),
    ).toEqual({ start: "28 Sep", end: "4 Oct" });
    expect(
      pointName({ start: "2025-12-29", end: "2026-01-04" }, "week"),
    ).toEqual({ start: "29 Dec 2025", end: "4 Jan 2026" });
  });

  it("names a week the period cuts to one day by that day", () => {
    expect(
      pointName({ start: "2026-10-11", end: "2026-10-11" }, "week"),
    ).toEqual({ date: "11 Oct" });
  });

  it("names a whole month by its name and a cut one by its days", () => {
    expect(
      pointName({ start: "2026-02-01", end: "2026-02-28" }, "month"),
    ).toEqual({ date: "February 2026" });
    expect(
      pointName({ start: "2025-10-20", end: "2025-10-31" }, "month"),
    ).toEqual({ start: "20", end: "31 Oct 2025" });
    expect(
      pointName({ start: "2026-10-01", end: "2026-10-16" }, "month"),
    ).toEqual({ start: "1", end: "16 Oct 2026" });
  });
});
