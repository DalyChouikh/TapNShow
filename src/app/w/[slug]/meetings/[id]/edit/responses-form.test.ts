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

  it("keeps the deadline before the start and in the future", () => {
    expect(
      validateResponses(
        {
          ...base,
          deadlineEnabled: true,
          deadlineDate: "2026-10-09",
          deadlineTime: "19:00",
        },
        startsAt,
        now,
      ),
    ).toEqual({
      deadline: "deadlineOrder",
    });
    expect(
      validateResponses(
        {
          ...base,
          deadlineEnabled: true,
          deadlineDate: "2026-10-09",
          deadlineTime: "12:00",
        },
        startsAt,
        now,
      ),
    ).toEqual({});
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
