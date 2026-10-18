import { describe, expect, it } from "vitest";
import {
  reminderRows,
  responsesPatch,
  validateResponses,
  type ResponsesValues,
} from "./responses-form";

const now = new Date("2026-10-07T10:00:00Z");
const startsAt = "2026-10-09T17:00:00.000Z";
const base: ResponsesValues = {
  responseMode: "attendance",
  delayOptions: [5, 10],
  reasonRequired: true,
  commentsEnabled: false,
  footerNote: "",
  deadlineEnabled: false,
  deadlineDate: null,
  deadlineTime: null,
  timezone: "Africa/Tunis",
  reminderPendingHours: 24,
  reminderGoingHours: 2,
};

describe("validateResponses", () => {
  it("needs a delay in attendance mode only", () => {
    expect(
      validateResponses({ ...base, delayOptions: [] }, startsAt, now),
    ).toEqual({ delayOptions: "delaysRequired" });
    expect(
      validateResponses(
        { ...base, responseMode: "rsvp", delayOptions: [] },
        startsAt,
        now,
      ),
    ).toEqual({});
  });

  describe("the deadline (meeting at 18:00 Tunis on 9 Oct)", () => {
    const deadline = (
      deadlineDate: string | null,
      deadlineTime: string | null,
      at = now,
    ) =>
      validateResponses(
        { ...base, deadlineEnabled: true, deadlineDate, deadlineTime },
        startsAt,
        at,
      );
    const meetingMorning = new Date("2026-10-09T08:00:00Z");

    it("accepts a time later the same day, before the start", () => {
      expect(deadline("2026-10-09", "17:45", meetingMorning)).toEqual({});
      expect(deadline("2026-10-09", "12:00")).toEqual({});
    });

    it("asks for the missing date or time on its own field", () => {
      expect(deadline(null, null)).toEqual({
        deadlineDate: "dateRequired",
        deadlineTime: "timeRequired",
      });
      expect(deadline("2026-10-09", null)).toEqual({
        deadlineTime: "timeRequired",
      });
      expect(deadline(null, "12:00")).toEqual({
        deadlineDate: "dateRequired",
      });
    });

    it("blames the time when it has passed today", () => {
      expect(deadline("2026-10-09", "08:00", meetingMorning)).toEqual({
        deadlineTime: "inPast",
      });
    });

    it("blames the time at or after the start on the meeting day", () => {
      expect(deadline("2026-10-09", "18:00")).toEqual({
        deadlineTime: "deadlineAfterStart",
      });
      expect(deadline("2026-10-09", "19:00")).toEqual({
        deadlineTime: "deadlineAfterStart",
      });
    });

    it("blames the date when it is after the meeting day", () => {
      expect(deadline("2026-10-10", "09:00")).toEqual({
        deadlineDate: "deadlineAfterStart",
      });
    });
  });
});

describe("responsesPatch", () => {
  it("clears the deadline when it is off and keeps delays only for attendance", () => {
    expect(responsesPatch({ ...base, responseMode: "rsvp" })).toMatchObject({
      responseMode: "rsvp",
      responseDeadline: null,
      delayOptions: [],
    });
    expect(
      responsesPatch({
        ...base,
        deadlineEnabled: true,
        deadlineDate: "2026-10-09",
        deadlineTime: "12:00",
      }).responseDeadline,
    ).toBe("2026-10-09T11:00:00.000Z");
  });
});

describe("reminderRows (#403)", () => {
  // The meeting starts Fri 9 Oct at 17:00 UTC (18:00 Tunis); defaults: 24 h and 2 h before.
  const at = (iso: string) => new Date(iso);
  const sent = {
    startsAt,
    responseDeadline: null,
    responseMode: "attendance" as const,
    reminderPendingHours: 24,
    reminderGoingHours: 2,
  };

  it("offers every time far ahead, as picked", () => {
    const rows = reminderRows(base, startsAt, now, null);
    expect(rows.pending).toMatchObject({
      choices: [1, 2, 6, 24, 48],
      value: 24,
    });
    expect(rows.going).toMatchObject({ choices: [1, 2, 6, 24], value: 2 });
  });

  it("picks the longest time left when the picked one has passed", () => {
    const rows = reminderRows(base, startsAt, at("2026-10-09T12:00:00Z"), null);
    expect(rows.pending).toMatchObject({
      choices: [1, 2],
      value: 2,
      replaced: 24,
      tooClose: false,
      locked: false,
    });
    expect(rows.going).toMatchObject({ value: 2, replaced: null });
  });

  it("counts the not-answered reminder back from the deadline", () => {
    const rows = reminderRows(
      {
        ...base,
        deadlineEnabled: true,
        deadlineDate: "2026-10-09",
        deadlineTime: "12:00",
      },
      startsAt,
      at("2026-10-09T09:30:00Z"),
      null,
    );
    expect(rows.pending).toMatchObject({
      choices: [1],
      value: 1,
      fromDeadline: true,
    });
    expect(rows.going).toMatchObject({
      choices: [1, 2, 6],
      fromDeadline: false,
    });
  });

  it("switches a reminder off when no time is left", () => {
    const rows = reminderRows(base, startsAt, at("2026-10-09T16:30:00Z"), null);
    expect(rows.going).toMatchObject({ value: null, tooClose: true });
  });

  it("locks a sent meeting's reminder whose time passed with the start unmoved", () => {
    const rows = reminderRows(base, startsAt, at("2026-10-09T12:00:00Z"), sent);
    expect(rows.pending).toMatchObject({
      choices: [24],
      value: 24,
      replaced: null,
      locked: true,
    });
    expect(rows.going).toMatchObject({ locked: false, value: 2 });
  });

  it("offers the times left again once the edit moves the start", () => {
    const moved = "2026-10-10T17:00:00.000Z";
    const rows = reminderRows(base, moved, at("2026-10-09T20:00:00Z"), sent);
    expect(rows.pending).toMatchObject({
      locked: false,
      choices: [1, 2, 6],
      value: 6,
      replaced: 24,
    });
  });
});
