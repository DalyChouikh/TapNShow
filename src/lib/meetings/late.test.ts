import { describe, expect, it } from "vitest";
import {
  DELAY_OPTION_CHOICES,
  DURATION_MIN,
  LATE_MINUTES_MAX,
} from "@/config/meetings";
import {
  addDelayOption,
  delayChoices,
  fittingDelays,
  lateMinutesMax,
} from "./late";

describe("lateMinutesMax", () => {
  it("is one minute shorter than the meeting", () => {
    expect(lateMinutesMax(30)).toBe(29);
    expect(lateMinutesMax(DURATION_MIN)).toBe(DURATION_MIN - 1);
  });

  it("never goes over the global cap, however long the meeting", () => {
    expect(lateMinutesMax(LATE_MINUTES_MAX + 1)).toBe(LATE_MINUTES_MAX);
    expect(lateMinutesMax(720)).toBe(LATE_MINUTES_MAX);
    expect(lateMinutesMax(LATE_MINUTES_MAX)).toBe(LATE_MINUTES_MAX - 1);
  });
});

describe("fittingDelays", () => {
  it("keeps only the late choices shorter than the meeting, in their order", () => {
    expect(fittingDelays([5, 10, 15, 20, 30, 45], 30)).toEqual([5, 10, 15, 20]);
    expect(fittingDelays([30, 5, 15], 16)).toEqual([5, 15]);
  });

  it("drops a choice exactly as long as the meeting", () => {
    expect(fittingDelays([5, 30], 30)).toEqual([5]);
    expect(fittingDelays([29], 30)).toEqual([29]);
  });

  it("can leave nothing for a very short meeting", () => {
    expect(fittingDelays([5, 10], DURATION_MIN)).toEqual([]);
    expect(fittingDelays([], 60)).toEqual([]);
  });
});

describe("delayChoices", () => {
  it("offers only the chips shorter than the meeting", () => {
    expect(delayChoices(30)).toEqual([5, 10, 15, 20]);
    expect(delayChoices(31)).toEqual([5, 10, 15, 20, 30]);
  });

  it("offers every chip for a long meeting, and none for the shortest", () => {
    expect(delayChoices(120)).toEqual([...DELAY_OPTION_CHOICES]);
    expect(delayChoices(DURATION_MIN)).toEqual([]);
  });
});

describe("addDelayOption (Other)", () => {
  it("adds a typed late time shorter than the meeting, in order", () => {
    expect(addDelayOption([5, 10], 25, 30)).toEqual({ options: [5, 10, 25] });
    expect(addDelayOption([10, 20], 3, 30)).toEqual({ options: [3, 10, 20] });
    expect(addDelayOption([], 4, DURATION_MIN)).toEqual({ options: [4] });
  });

  it("refuses a time that isn't 1 to one minute less than the meeting", () => {
    expect(addDelayOption([5], 30, 30)).toEqual({ problem: "range" });
    expect(addDelayOption([5], 0, 30)).toEqual({ problem: "range" });
    expect(addDelayOption([5], 2.5, 30)).toEqual({ problem: "range" });
    expect(addDelayOption([5], LATE_MINUTES_MAX + 1, 720)).toEqual({
      problem: "range",
    });
  });

  it("refuses a time already among the choices", () => {
    expect(addDelayOption([5, 25], 25, 30)).toEqual({ problem: "taken" });
  });

  it("refuses a seventh choice", () => {
    expect(addDelayOption([1, 2, 3, 4, 5, 6], 7, 30)).toEqual({
      problem: "full",
    });
  });
});
