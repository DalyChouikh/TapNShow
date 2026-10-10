import { describe, expect, it } from "vitest";
import { effectiveStatus } from "./effective-status";

const mark = (actual: "present" | "late" | "absent") => ({
  actual,
  markedAt: "2026-10-09T17:05:00.000Z",
  markedByName: "Daly",
  lateMinutes: null,
});

describe("effectiveStatus", () => {
  it("counts the check-in over the answer", () => {
    expect(effectiveStatus(mark("absent"), { status: "attending" })).toBe(
      "absent",
    );
    expect(effectiveStatus(mark("present"), null)).toBe("attending");
  });

  it("falls back to the answer; Not going counts as absent", () => {
    expect(effectiveStatus(null, { status: "not_attending" })).toBe("absent");
    expect(effectiveStatus(null, { status: "late" })).toBe("late");
    expect(effectiveStatus(null, null)).toBeNull();
  });
});
