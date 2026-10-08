import { describe, expect, it } from "vitest";
import {
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
    ).toEqual({ meetingUrl: "linkRequired" });
    expect(validateDetails({ ...valid, durationMinutes: 3 }, now)).toEqual({
      durationMinutes: "durationRange",
    });
  });
});

describe("detailsPatch", () => {
  it("stores the picked wall time as UTC and trims text", () => {
    expect(detailsPatch({ ...valid, title: " Kickoff " })).toMatchObject({
      title: "Kickoff",
      startsAt: "2026-10-09T17:00:00.000Z",
      timezone: "Africa/Tunis",
    });
    expect(detailsPatch({ ...valid, date: null }).startsAt).toBeNull();
  });
});
