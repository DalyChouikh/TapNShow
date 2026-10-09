import { describe, expect, it } from "vitest";
import {
  type CardMeeting,
  type CardText,
  hasMemberChanges,
  markedCard,
  meetingBefore,
} from "./changes";

const meeting: CardMeeting = {
  title: "Weekly sync",
  startsAt: "2026-10-11T17:00:00.000Z",
  durationMinutes: 60,
  timezone: "Africa/Tunis",
  locationMode: "in_person",
  locationText: "Hall A",
  onlineText: "",
  meetingUrl: "",
  agendaMd: "New agenda",
  responseDeadline: null,
  footerNote: "",
};
const text: CardText = {
  none: "None",
  joinLink: (url) => `Link: ${url}`,
};

describe("markedCard", () => {
  it("marks the changed time and place, old struck and new highlighted", () => {
    const changes = {
      starts_at: ["2026-10-10T17:00:00+00:00", "2026-10-11T17:00:00+00:00"],
      location_text: ["Room B12", "Hall A"],
      reason_required: [true, false],
    } satisfies Record<string, [string | boolean, string | boolean]>;
    expect(markedCard(meeting, changes, text)).toEqual([
      { key: "title", now: "Weekly sync", before: null, updated: false },
      {
        key: "when",
        now: "Sun 11 Oct, 18:00–19:00 (Africa/Tunis)",
        before: "Sat 10 Oct, 18:00–19:00 (Africa/Tunis)",
        updated: false,
      },
      { key: "where", now: "Hall A", before: "Room B12", updated: false },
    ]);
  });

  it("marks long text as updated and shows a removed deadline as None", () => {
    expect(
      markedCard(
        meeting,
        {
          agenda_md: ["Old agenda", "New agenda"],
          response_deadline: ["2026-10-10T11:00:00+00:00", null],
        },
        text,
      ),
    ).toEqual([
      { key: "title", now: "Weekly sync", before: null, updated: false },
      {
        key: "when",
        now: "Sun 11 Oct, 18:00–19:00 (Africa/Tunis)",
        before: null,
        updated: false,
      },
      { key: "where", now: "Hall A", before: null, updated: false },
      {
        key: "deadline",
        now: "None",
        before: "Sat 10 Oct, 12:00",
        updated: false,
      },
      { key: "agenda", now: "", before: null, updated: true },
    ]);
  });

  it("marks a changed join link", () => {
    expect(
      markedCard(
        { ...meeting, locationMode: "online", meetingUrl: "https://b.test" },
        {
          location_mode: ["in_person", "online"],
          meeting_url: ["", "https://b.test"],
        },
        text,
      ),
    ).toContainEqual({
      key: "link",
      now: "Link: https://b.test",
      before: "None",
      updated: false,
    });
  });

  it("rebuilds the meeting as it was before the changes", () => {
    expect(
      meetingBefore(meeting, {
        duration_minutes: [90, 60],
        title: ["Sync", "Weekly sync"],
      }),
    ).toMatchObject({ durationMinutes: 90, title: "Sync" });
  });
});

describe("hasMemberChanges", () => {
  it("ignores hidden settings", () => {
    expect(hasMemberChanges({ reason_required: [true, false] })).toBe(false);
    expect(hasMemberChanges({ footer_note: ["", "Bring a laptop"] })).toBe(
      true,
    );
  });
});
