import { describe, expect, it } from "vitest";
import { responseDeadlineProblem } from "./deadline";

// 18:00 in Tunis on the meeting day; "now" is 14:00 the same day.
const startsAt = "2026-10-09T17:00:00.000Z";
const now = new Date("2026-10-09T13:00:00.000Z");

describe("responseDeadlineProblem", () => {
  it("accepts a deadline later the same day, before the start", () => {
    expect(
      responseDeadlineProblem("2026-10-09T16:45:00.000Z", startsAt, now),
    ).toBeNull();
  });

  it("refuses a deadline at or after the start", () => {
    expect(responseDeadlineProblem(startsAt, startsAt, now)).toBe("afterStart");
    expect(
      responseDeadlineProblem("2026-10-09T18:00:00.000Z", startsAt, now),
    ).toBe("afterStart");
  });

  it("refuses a deadline that has passed or is right now", () => {
    expect(
      responseDeadlineProblem("2026-10-09T11:00:00.000Z", startsAt, now),
    ).toBe("inPast");
    expect(responseDeadlineProblem(now.toISOString(), startsAt, now)).toBe(
      "inPast",
    );
  });

  it("checks only the past while the start is unknown", () => {
    expect(
      responseDeadlineProblem("2026-10-20T10:00:00.000Z", null, now),
    ).toBeNull();
  });
});
