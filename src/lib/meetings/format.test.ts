import { describe, expect, it } from "vitest";
import {
  durationText,
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

  it("keeps the picked wall time when the browser's own zone skips that hour (#168)", () => {
    const original = process.env.TZ;
    process.env.TZ = "Europe/Paris";
    try {
      // 29 Mar 2026 02:30 does not exist in Paris (02:00 → 03:00) but does in Tunis (UTC+1).
      expect(
        zonedWallTimeToUtc({
          date: "2026-03-29",
          time: "02:30",
          timezone: "Africa/Tunis",
        }),
      ).toBe("2026-03-29T01:30:00.000Z");
    } finally {
      process.env.TZ = original;
    }
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

describe("durationText", () => {
  const words = {
    minutes: (count: number) => `${count} min`,
    hours: (hours: number) => `${hours} h`,
    hoursMinutes: (hours: number, minutes: number) => `${hours} h ${minutes}`,
  };
  it("reads like the wizard's chips", () => {
    expect(durationText(45, words)).toBe("45 min");
    expect(durationText(60, words)).toBe("1 h");
    expect(durationText(90, words)).toBe("1 h 30");
    expect(durationText(120, words)).toBe("2 h");
  });
});
