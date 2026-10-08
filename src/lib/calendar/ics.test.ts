import { describe, expect, it } from "vitest";
import {
  buildMeetingIcs,
  icsDescription,
  icsLocation,
  type MeetingIcsInput,
} from "./ics";

const BASE: MeetingIcsInput = {
  method: "REQUEST",
  uid: "abc@tapnshow.vercel.app",
  sequence: 0,
  stamp: new Date("2026-10-08T12:00:00Z"),
  start: new Date("2026-10-09T17:00:00Z"),
  durationMinutes: 90,
  title: "Weekly sync",
  description: "Agenda",
  location: "Room B12",
  url: "https://meet.google.com/abc-defg-hij",
  organizer: { name: "GDG ISSAT", email: "club@gmail.com" },
  attendee: { name: "Amira B.", email: "amira@uni.tn" },
};

/** Logical lines: folded continuation lines (CRLF + space) joined back first. */
const lines = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

describe("buildMeetingIcs", () => {
  it("writes a pre-accepted REQUEST with UTC times and CRLF endings", () => {
    const ics = buildMeetingIcs(BASE);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(lines(ics)).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        "UID:abc@tapnshow.vercel.app",
        "SEQUENCE:0",
        "DTSTAMP:20261008T120000Z",
        "DTSTART:20261009T170000Z",
        "DTEND:20261009T183000Z",
        "SUMMARY:Weekly sync",
        "STATUS:CONFIRMED",
        'ORGANIZER;CN="GDG ISSAT":mailto:club@gmail.com',
        'ATTENDEE;CN="Amira B.";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:amira@uni.tn',
        "END:VEVENT",
        "END:VCALENDAR",
      ]),
    );
  });

  it("cancels with the same UID and a higher sequence", () => {
    const ics = buildMeetingIcs({ ...BASE, method: "CANCEL", sequence: 1 });
    expect(lines(ics)).toEqual(
      expect.arrayContaining([
        "METHOD:CANCEL",
        "SEQUENCE:1",
        "STATUS:CANCELLED",
      ]),
    );
  });

  it("escapes TEXT values and strips quotes and line breaks from names (Review Focus 4)", () => {
    const ics = buildMeetingIcs({
      ...BASE,
      title: "Sync; plan, review\\notes",
      description: "Line 1\nLine 2\r\nLine 3",
      attendee: {
        name: 'Amira "the boss"\r\nX-INJECT:1',
        email: "amira@uni.tn",
      },
    });
    expect(ics).toContain("SUMMARY:Sync\\; plan\\, review\\\\notes");
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2\\nLine 3");
    expect(ics).toContain('ATTENDEE;CN="Amira the boss X-INJECT:1";');
    expect(lines(ics).some((line) => line.startsWith("X-INJECT"))).toBe(false);
  });

  it("folds lines longer than 75 octets without splitting a character", () => {
    const ics = buildMeetingIcs({ ...BASE, description: "é".repeat(120) });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`DESCRIPTION:${"é".repeat(120)}`);
  });

  it("omits URL when there is no link", () => {
    expect(buildMeetingIcs({ ...BASE, url: null })).not.toContain("URL:");
  });
});

describe("icsLocation", () => {
  it("joins the place and the online words for hybrid meetings", () => {
    expect(
      icsLocation({
        locationMode: "hybrid",
        locationText: "Room B12",
        onlineText: "Club Discord",
      }),
    ).toBe("Room B12 · Club Discord");
    expect(
      icsLocation({
        locationMode: "online",
        locationText: "",
        onlineText: "Club Discord",
      }),
    ).toBe("Club Discord");
  });
});

describe("icsDescription", () => {
  it("keeps the agenda as plain text", () => {
    expect(icsDescription({ agendaMd: "  - **Recap**\n- Teams  " })).toBe(
      "- **Recap**\n- Teams",
    );
  });
});
