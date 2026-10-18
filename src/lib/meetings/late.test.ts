import { describe, expect, it } from "vitest";
import {
  DELAY_OPTION_CHOICES,
  DURATION_MIN,
  LATE_MINUTES_MAX,
} from "@/config/meetings";
import { delayChoices, fittingDelays, lateMinutesMax } from "./late";

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
