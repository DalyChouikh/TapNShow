import { describe, expect, it } from "vitest";
import { isLive } from "./live-window";

const NOW = new Date("2026-10-09T20:00:00.000Z");
const meeting = (startsAt: string | null) => ({
  startsAt,
  durationMinutes: 60,
});

describe("isLive", () => {
  it("is live before the start and up to 3 h after the end", () => {
    expect(isLive(meeting("2026-10-09T20:01:00.000Z"), NOW)).toBe(true);
    // Ended 19:00 + 2 h 59 min ago → still live.
    expect(isLive(meeting("2026-10-09T16:01:00.000Z"), NOW)).toBe(true);
  });

  it("stops 3 h after the end, and for a meeting without a start", () => {
    expect(isLive(meeting("2026-10-09T15:59:00.000Z"), NOW)).toBe(false);
    expect(isLive(meeting(null), NOW)).toBe(false);
  });
});
