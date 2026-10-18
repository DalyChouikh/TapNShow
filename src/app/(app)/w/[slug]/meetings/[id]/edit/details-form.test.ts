import { describe, expect, it } from "vitest";
import {
  delaysRemoved,
  detailsPatch,
  validateDetails,
  type DetailsValues,
} from "./details-form";

const now = new Date("2026-10-07T10:00:00Z");
const valid: DetailsValues = {
  title: "Weekly sync",
  date: "2026-10-09",
  time: "18:00",
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  locationMode: "in_person",
  locationText: "Room B12",
  onlineText: "",
  meetingUrl: "",
  agendaMd: "",
};

describe("validateDetails", () => {
  it("accepts a complete future meeting", () => {
    expect(validateDetails(valid, now)).toEqual({});
  });

  it("names every missing or wrong field", () => {
    expect(
      validateDetails({ ...valid, title: " ", date: null, time: null }, now),
    ).toEqual({
      title: "titleRequired",
      date: "dateRequired",
      time: "timeRequired",
    });
    expect(
      validateDetails({ ...valid, date: "2026-10-07", time: "09:00" }, now),
    ).toEqual({ time: "inPast" });
    expect(
      validateDetails(
        {
          ...valid,
          locationMode: "hybrid",
          locationText: "",
          meetingUrl: "meet.example",
        },
        now,
      ),
    ).toEqual({
      locationText: "placeRequired",
      meetingUrl: "linkInvalid",
    });
    expect(
      validateDetails(
        { ...valid, locationMode: "online", meetingUrl: "" },
        now,
      ),
    ).toEqual({ onlineText: "onlineRequired" });
    // An online place in words is enough (e.g. the club's Discord); a link is optional.
    expect(
      validateDetails(
        { ...valid, locationMode: "online", onlineText: " Club Discord " },
        now,
      ),
    ).toEqual({});
    expect(validateDetails({ ...valid, durationMinutes: 3 }, now)).toEqual({
      durationMinutes: "durationRange",
    });
  });
});

describe("detailsPatch", () => {
  it("stores the picked wall time as UTC and trims text", () => {
    expect(detailsPatch({ ...valid, title: " Kickoff " }, [])).toMatchObject({
      title: "Kickoff",
      startsAt: "2026-10-09T17:00:00.000Z",
      timezone: "Africa/Tunis",
    });
    expect(detailsPatch({ ...valid, date: null }, []).startsAt).toBeNull();
    expect(
      detailsPatch({ ...valid, onlineText: " Club Discord " }, []).onlineText,
    ).toBe("Club Discord");
  });
});

describe("the late choices and the meeting's length (#400)", () => {
  const short = { ...valid, durationMinutes: 30 };

  it("a draft made shorter saves only the late choices that still fit, in the same save", () => {
    expect(detailsPatch(short, [5, 10, 15, 30, 45])).toMatchObject({
      durationMinutes: 30,
      delayOptions: [5, 10, 15],
    });
  });

  it("leaves the late choices out of the save when they all fit", () => {
    expect(detailsPatch(valid, [5, 10, 15, 30])).not.toHaveProperty(
      "delayOptions",
    );
  });

  it("names the late choices a shorter length would remove", () => {
    expect(delaysRemoved(short, [5, 10, 15, 30, 45])).toEqual([30, 45]);
    expect(delaysRemoved(valid, [5, 10, 15, 30])).toEqual([]);
    expect(delaysRemoved({ ...valid, durationMinutes: 0 }, [5])).toEqual([]);
  });

  it("refuses a sent meeting's length its fixed late choices don't fit", () => {
    expect(validateDetails(short, now, [5, 10, 30])).toEqual({
      durationMinutes: "lateLongerThanMeeting",
    });
    expect(
      validateDetails({ ...valid, durationMinutes: 31 }, now, [5, 10, 30]),
    ).toEqual({});
    expect(validateDetails(short, now)).toEqual({});
  });

  it("asks for a valid length before anything about late choices", () => {
    expect(validateDetails({ ...valid, durationMinutes: 0 }, now, [5])).toEqual(
      { durationMinutes: "durationRange" },
    );
  });
});
