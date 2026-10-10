import { describe, expect, it } from "vitest";
import {
  delayOptionsSchema,
  footerNoteSchema,
  updateMeetingDefaultsBodySchema,
} from "./meeting-settings";

describe("meeting settings schemas", () => {
  it("mirrors the database rule for delay options", () => {
    expect(delayOptionsSchema.parse([30, 5, 10])).toEqual([5, 10, 30]);
    expect(delayOptionsSchema.safeParse([5, 5]).success).toBe(false);
    expect(delayOptionsSchema.safeParse([0]).success).toBe(false);
    expect(delayOptionsSchema.safeParse([241]).success).toBe(false);
    expect(delayOptionsSchema.safeParse([1, 2, 3, 4, 5, 6, 7]).success).toBe(
      false,
    );
  });

  it("trims the footer note and caps it at 280", () => {
    expect(footerNoteSchema.parse("  Bring a laptop ")).toBe("Bring a laptop");
    expect(footerNoteSchema.safeParse("x".repeat(281)).success).toBe(false);
  });

  it("needs at least one field to update", () => {
    expect(updateMeetingDefaultsBodySchema.safeParse({}).success).toBe(false);
    expect(
      updateMeetingDefaultsBodySchema.parse({ durationMinutes: 90 }),
    ).toEqual({ durationMinutes: 90 });
  });
});

describe("reminder defaults (M6)", () => {
  it("accepts the reminder choices and off", () => {
    expect(
      updateMeetingDefaultsBodySchema.safeParse({
        reminderPendingHours: 48,
        reminderGoingHours: null,
      }).success,
    ).toBe(true);
    expect(
      updateMeetingDefaultsBodySchema.safeParse({ reminderGoingHours: 3 })
        .success,
    ).toBe(false);
  });
});
