import { describe, expect, it } from "vitest";
import type { MeetingSummary } from "@/shared/api/meetings";
import { partitionMeetings } from "./partition";

const at = (
  id: string,
  status: MeetingSummary["status"],
  startsAt: string | null,
  durationMinutes = 60,
): MeetingSummary => ({
  id,
  title: id,
  startsAt,
  timezone: "Africa/Tunis",
  durationMinutes,
  status,
  locationMode: "in_person",
  invitedCount: 0,
  sentCount: 0,
});

describe("partitionMeetings", () => {
  it("splits drafts, upcoming (soonest first) and past (latest first); a meeting in progress is upcoming", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const result = partitionMeetings(
      [
        at("d", "draft", null),
        { ...at("", "draft", null), id: "empty", title: "" },
        at("later", "scheduled", "2026-10-20T17:00:00Z"),
        at("soon", "scheduled", "2026-10-08T17:00:00Z"),
        at("running", "scheduled", "2026-10-07T11:30:00Z", 60),
        at("old", "scheduled", "2026-10-01T17:00:00Z"),
        at("older", "scheduled", "2026-09-01T17:00:00Z"),
        at("cancelled", "cancelled", "2026-10-10T17:00:00Z"),
      ],
      now,
    );
    expect(result.drafts.map((m) => m.id)).toEqual(["d"]);
    expect(result.upcoming.map((m) => m.id)).toEqual([
      "running",
      "soon",
      "later",
    ]);
    expect(result.past.map((m) => m.id)).toEqual(["cancelled", "old", "older"]);
  });
});
