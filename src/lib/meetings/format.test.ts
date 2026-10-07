import { describe, expect, it } from "vitest";
import {
  formatDeadline,
  formatMeetingWhen,
  meetingSubject,
  utcToZonedParts,
  zonedWallTimeToUtc,
} from "./format";

describe("meeting times (spec §7.10)", () => {
  it("formats in the meeting's zone, not the machine's", () => {
    const when = formatMeetingWhen({
      startsAt: "2026-10-09T17:00:00.000Z",
      durationMinutes: 90,
      timezone: "Africa/Tunis",
    });
    expect(when).toEqual({
      date: "Fri 9 Oct",
      start: "18:00",
      end: "19:30",
      zone: "Africa/Tunis",
    });
    expect(meetingSubject("Weekly sync", when)).toBe(
      "Weekly sync · Fri 9 Oct, 18:00",
    );
    expect(formatDeadline("2026-10-09T11:00:00.000Z", "Africa/Tunis")).toBe(
      "Fri 9 Oct, 12:00",
    );
  });

  it("turns a picked wall time into UTC across a DST change", () => {
    expect(
      zonedWallTimeToUtc({
        date: "2026-10-09",
        time: "18:00",
        timezone: "Africa/Tunis",
      }),
    ).toBe("2026-10-09T17:00:00.000Z");
    expect(
      zonedWallTimeToUtc({
        date: "2026-10-24",
        time: "18:00",
        timezone: "Europe/Paris",
      }),
    ).toBe("2026-10-24T16:00:00.000Z");
    expect(
      zonedWallTimeToUtc({
        date: "2026-10-25",
        time: "18:00",
        timezone: "Europe/Paris",
      }),
    ).toBe("2026-10-25T17:00:00.000Z");
    expect(utcToZonedParts("2026-10-25T17:00:00.000Z", "Europe/Paris")).toEqual(
      { date: "2026-10-25", time: "18:00" },
    );
  });

  it("crosses midnight cleanly", () => {
    expect(
      formatMeetingWhen({
        startsAt: "2026-10-09T22:30:00.000Z",
        durationMinutes: 60,
        timezone: "Africa/Tunis",
      }),
    ).toEqual({
      date: "Fri 9 Oct",
      start: "23:30",
      end: "00:30",
      zone: "Africa/Tunis",
    });
  });
});
