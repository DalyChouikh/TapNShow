import { describe, expect, it } from "vitest";
import {
  choiceToStatus,
  historyPageSchema,
  peopleFilterSchema,
  periodQuerySchema,
  statusesFor,
  submitAnswerBodySchema,
} from "./responses";

describe("choiceToStatus", () => {
  it("maps the email's choices to statuses the mode allows", () => {
    expect(choiceToStatus("late", "attendance")).toBe("late");
    expect(choiceToStatus("going", "rsvp")).toBe("attending");
    expect(choiceToStatus("not_going", "rsvp")).toBe("not_attending");
    expect(choiceToStatus("attending", "rsvp")).toBe("attending");
  });

  it("ignores a choice that does not fit the mode, or junk", () => {
    expect(choiceToStatus("late", "rsvp")).toBeNull();
    expect(choiceToStatus("absent", "announcement")).toBeNull();
    expect(choiceToStatus("<script>", "attendance")).toBeNull();
    expect(choiceToStatus(null, "attendance")).toBeNull();
    expect(choiceToStatus("constructor", "attendance")).toBeNull();
  });
});

describe("statusesFor", () => {
  it("lists the cards per mode", () => {
    expect(statusesFor("attendance")).toEqual(["attending", "late", "absent"]);
    expect(statusesFor("rsvp")).toEqual(["attending", "not_attending"]);
    expect(statusesFor("announcement")).toEqual([]);
  });
});

describe("submitAnswerBodySchema", () => {
  it("caps reason and comment at 500 characters", () => {
    const base = { status: "absent", delayMinutes: null, comment: "" };
    expect(
      submitAnswerBodySchema.safeParse({ ...base, reason: "x".repeat(500) })
        .success,
    ).toBe(true);
    expect(
      submitAnswerBodySchema.safeParse({ ...base, reason: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
});

describe("organizer schemas", () => {
  it("accepts an open or bounded period, never an inverted one", () => {
    expect(periodQuerySchema.safeParse({}).success).toBe(true);
    expect(
      periodQuerySchema.safeParse({ from: "2026-09-01T00:00:00.000Z" }).success,
    ).toBe(true);
    expect(
      periodQuerySchema.safeParse({
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(periodQuerySchema.safeParse({ from: "yesterday" }).success).toBe(
      false,
    );
  });

  it("knows the people filters", () => {
    expect(peopleFilterSchema.safeParse("no_reply").success).toBe(true);
    expect(peopleFilterSchema.safeParse("maybe").success).toBe(false);
  });

  it("parses a history page with its counts", () => {
    expect(
      historyPageSchema.parse({
        counts: { attending: 1, late: 0, absent: 0, noReply: 2 },
        items: [],
        nextCursor: null,
      }).counts.noReply,
    ).toBe(2);
  });
});
