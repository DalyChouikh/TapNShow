import { describe, expect, it } from "vitest";
import { editDeadlineProblem, responseDeadlineProblem } from "./deadline";

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

describe("editDeadlineProblem (Review Focus 3)", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  const start = "2026-10-09T17:00:00.000Z";
  const passed = "2026-10-09T12:00:00.000Z";

  it("keeps a deadline that already passed when it is not changed", () => {
    expect(editDeadlineProblem(passed, start, now, passed)).toBeNull();
    expect(
      editDeadlineProblem("2026-10-09T12:00:00+00:00", start, now, passed),
    ).toBeNull();
  });

  it("still refuses a start moved to before that deadline", () => {
    expect(
      editDeadlineProblem(passed, "2026-10-09T11:00:00.000Z", now, passed),
    ).toBe("afterStart");
  });

  it("applies the full rule to a changed deadline", () => {
    expect(
      editDeadlineProblem("2026-10-09T13:00:00.000Z", start, now, passed),
    ).toBe("inPast");
    expect(
      editDeadlineProblem("2026-10-09T16:00:00.000Z", start, now, passed),
    ).toBeNull();
  });

  it("is the draft rule when nothing was saved", () => {
    expect(editDeadlineProblem(passed, start, now, null)).toBe("inPast");
  });
});
