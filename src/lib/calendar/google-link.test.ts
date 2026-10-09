import { describe, expect, it } from "vitest";
import { googleCalendarLink } from "./google-link";

describe("googleCalendarLink", () => {
  it("fills a Google Calendar event: title, UTC times, details and place", () => {
    const url = new URL(
      googleCalendarLink({
        title: "Weekly sync, été",
        start: new Date("2026-10-09T17:00:00Z"),
        durationMinutes: 90,
        details: "Agenda\nhttps://meet.google.com/abc-defg-hij",
        location: "Room B12 · Discord",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "TEMPLATE",
      text: "Weekly sync, été",
      dates: "20261009T170000Z/20261009T183000Z",
      details: "Agenda\nhttps://meet.google.com/abc-defg-hij",
      location: "Room B12 · Discord",
    });
  });

  it("leaves out empty details and place", () => {
    const url = new URL(
      googleCalendarLink({
        title: "Sync",
        start: new Date("2026-10-09T17:00:00Z"),
        durationMinutes: 60,
        details: "",
        location: "",
      }),
    );
    expect(url.searchParams.has("details")).toBe(false);
    expect(url.searchParams.has("location")).toBe(false);
  });
});
