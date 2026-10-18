import { describe, expect, it } from "vitest";
import { offerReminder, reminderDueAt, remindersSkippedAt } from "./reminders";

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

describe("offerReminder", () => {
  const CHOICES = [1, 2, 6, 24, 48] as const;
  // The reminder counts back from 2026-10-19 09:00 UTC.
  const base = "2026-10-19T09:00:00.000Z";
  const offer = (
    picked: number | null,
    now: string,
    from: string | null = base,
  ) =>
    offerReminder({ picked, choices: CHOICES, base: from, now: new Date(now) });

  it("offers only the times still ahead, and keeps a pick that is", () => {
    expect(offer(2, "2026-10-19T04:00:00.000Z")).toEqual({
      choices: [1, 2],
      value: 2,
      replaced: null,
      tooClose: false,
    });
  });

  it("picks the longest time left when the picked one has passed", () => {
    expect(offer(24, "2026-10-19T04:00:00.000Z")).toEqual({
      choices: [1, 2],
      value: 2,
      replaced: 24,
      tooClose: false,
    });
  });

  it("treats a time due right now as passed, like sending does", () => {
    expect(offer(2, "2026-10-19T07:00:00.000Z").choices).toEqual([1]);
  });

  it("turns the reminder off when no time is left", () => {
    expect(offer(24, "2026-10-19T08:30:00.000Z")).toEqual({
      choices: [],
      value: null,
      replaced: 24,
      tooClose: true,
    });
  });

  it("leaves a reminder that is off alone, and offers every time far ahead", () => {
    expect(offer(null, "2026-10-01T00:00:00.000Z")).toEqual({
      choices: [...CHOICES],
      value: null,
      replaced: null,
      tooClose: false,
    });
    expect(offer(null, "2026-10-19T08:30:00.000Z").tooClose).toBe(true);
  });

  it("offers every time while the meeting has no start yet", () => {
    expect(offer(24, "2026-10-19T08:30:00.000Z", null)).toEqual({
      choices: [...CHOICES],
      value: 24,
      replaced: null,
      tooClose: false,
    });
  });
});
