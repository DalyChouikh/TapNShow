import { describe, expect, it } from "vitest";
import {
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
