import { addMinutes } from "date-fns";
import { APP_NAME } from "@/config/app";
import type { LocationMode } from "@/shared/api/meeting-settings";

/**
 * One calendar invitation for one member (spec §9 Calendar files), or a plain `PUBLISH` event for
 * the answer page's "Download calendar file" (no organizer, no attendee).
 */
export type MeetingIcsInput = {
  uid: string;
  sequence: number;
  stamp: Date;
  start: Date;
  durationMinutes: number;
  title: string;
  description: string;
  location: string;
  url: string | null;
} & (
  | {
      method: "REQUEST" | "CANCEL";
      organizer: { name: string; email: string };
      attendee: { name: string; email: string };
    }
  | { method: "PUBLISH" }
);

const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** RFC 5545 §3.3.11 TEXT: escape backslash, semicolon, comma; line breaks become `\n`. */
function text(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** A quoted parameter value (RFC 5545 §3.1): no DQUOTE and no control characters allowed. */
function param(value: string): string {
  return `"${value
    .replace(/["\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()}"`;
}

/** `20261009T170000Z`. */
function utc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** RFC 5545 §3.1 folding: at most 75 octets per line, continuation lines start with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    const limit = out.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** Where the meeting happens, in words (place and/or online place; never a personal link). */
export function icsLocation(meeting: {
  locationMode: LocationMode;
  locationText: string;
  onlineText: string;
}): string {
  const parts = [
    meeting.locationMode !== "online" ? meeting.locationText : "",
    meeting.locationMode !== "in_person" ? meeting.onlineText : "",
  ].filter((part) => part !== "");
  return parts.join(" · ");
}

/** The event description: the agenda as plain text (calendar apps show Markdown as text). */
export function icsDescription(meeting: { agendaMd: string }): string {
  return meeting.agendaMd.trim();
}

/** The ORGANIZER and ATTENDEE lines of an invitation (none for `PUBLISH`). */
function people(input: MeetingIcsInput): string[] {
  if (input.method === "PUBLISH") {
    return [];
  }
  const attendee = `ATTENDEE;CN=${param(input.attendee.name)};ROLE=REQ-PARTICIPANT`;
  return [
    `ORGANIZER;CN=${param(input.organizer.name)}:mailto:${input.organizer.email}`,
    input.method === "CANCEL"
      ? `${attendee}:mailto:${input.attendee.email}`
      : `${attendee};PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${input.attendee.email}`,
  ];
}

/**
 * A pre-accepted `REQUEST` (the member as attendee, `PARTSTAT=ACCEPTED`, `RSVP=FALSE`), a `CANCEL`
 * for the same UID (spec §9, S2), or a `PUBLISH` event to import. S2 (2026-10-09): Gmail, Outlook
 * and Microsoft 365 still show Yes/Maybe/No and add the event after Yes.
 */
export function buildMeetingIcs(input: MeetingIcsInput): string {
  const cancel = input.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    `PRODID:-//${APP_NAME}//Meetings//EN`,
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${utc(input.stamp)}`,
    `DTSTART:${utc(input.start)}`,
    `DTEND:${utc(addMinutes(input.start, input.durationMinutes))}`,
    `SUMMARY:${text(input.title)}`,
    ...(input.description ? [`DESCRIPTION:${text(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${text(input.location)}`] : []),
    ...(input.url ? [`URL:${input.url}`] : []),
    ...people(input),
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}
