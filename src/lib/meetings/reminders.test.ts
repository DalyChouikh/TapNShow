import { describe, expect, it } from "vitest";
import { reminderDueAt, remindersSkippedAt } from "./reminders";

const meeting = {
  startsAt: "2026-10-19T09:00:00.000Z",
  responseDeadline: null,
  responseMode: "attendance" as const,
  reminderPendingHours: 24,
  reminderGoingHours: 2,
};

describe("reminderDueAt", () => {
  it("times the not-answered reminder from the deadline, else the start", () => {
    expect(reminderDueAt(meeting, "pending")?.toISOString()).toBe(
      "2026-10-18T09:00:00.000Z",
    );
    expect(
      reminderDueAt(
        { ...meeting, responseDeadline: "2026-10-18T18:00:00.000Z" },
        "pending",
      )?.toISOString(),
    ).toBe("2026-10-17T18:00:00.000Z");
  });

  it("times the Going and Late reminder from the start", () => {
    expect(reminderDueAt(meeting, "going")?.toISOString()).toBe(
      "2026-10-19T07:00:00.000Z",
    );
  });

  it("has no time when the reminder is off, the meeting asks for no answers, or has no start", () => {
    expect(
      reminderDueAt({ ...meeting, reminderGoingHours: null }, "going"),
    ).toBeNull();
    expect(
      reminderDueAt({ ...meeting, responseMode: "announcement" }, "pending"),
    ).toBeNull();
    expect(reminderDueAt({ ...meeting, startsAt: null }, "going")).toBeNull();
  });
});

describe("remindersSkippedAt", () => {
  it("names the reminders due at or before now, which won't go out", () => {
    expect(
      remindersSkippedAt(meeting, new Date("2026-10-18T18:00:00.000Z")),
    ).toEqual(["pending"]);
    expect(
      remindersSkippedAt(meeting, new Date("2026-10-19T07:00:00.000Z")),
    ).toEqual(["pending", "going"]);
  });

  it("names none while every reminder is still ahead, or off", () => {
    expect(
      remindersSkippedAt(meeting, new Date("2026-10-18T08:59:59.000Z")),
    ).toEqual([]);
    expect(
      remindersSkippedAt(
        { ...meeting, reminderPendingHours: null, reminderGoingHours: null },
        new Date("2026-10-19T08:00:00.000Z"),
      ),
    ).toEqual([]);
  });
});
