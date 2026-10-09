import { TZDate } from "@date-fns/tz";
import { addMinutes, format } from "date-fns";

/** A meeting's time as shown everywhere (always in the meeting's own zone, spec §7.10). */
export type MeetingWhen = {
  date: string;
  start: string;
  end: string;
  zone: string;
};

const DATE_FORMAT = "EEE d MMM";
const TIME_FORMAT = "HH:mm";

/** Date, start, end and zone of a meeting in its own time zone. */
export function formatMeetingWhen(input: {
  startsAt: string;
  durationMinutes: number;
  timezone: string;
}): MeetingWhen {
  const start = new TZDate(input.startsAt, input.timezone);
  return {
    date: format(start, DATE_FORMAT),
    start: format(start, TIME_FORMAT),
    end: format(addMinutes(start, input.durationMinutes), TIME_FORMAT),
    zone: input.timezone,
  };
}

/** Invite subject: "<Title> · <Thu 9 Oct>, <18:00>" (spec §9). */
export function meetingSubject(title: string, when: MeetingWhen): string {
  return `${title} · ${when.date}, ${when.start}`;
}

/** "Fri 9 Oct, 12:00" in the meeting's zone. */
export function formatDeadline(iso: string, timezone: string): string {
  const deadline = new TZDate(iso, timezone);
  return `${format(deadline, DATE_FORMAT)}, ${format(deadline, TIME_FORMAT)}`;
}

/** The UTC instant of a wall-clock date + time in `timezone` (what the pickers store). */
export function zonedWallTimeToUtc(input: {
  date: string;
  time: string;
  timezone: string;
}): string {
  // Numbers straight into TZDate: parsing first would go through the browser's own zone, which
  // can shift a time that does not exist there (spring forward, #168).
  const [year, month, day] = input.date.split("-").map(Number);
  const [hours, minutes] = input.time.split(":").map(Number);
  const zoned = new TZDate(
    year,
    month - 1,
    day,
    hours,
    minutes,
    input.timezone,
  );
  // TZDate#toISOString() keeps the zone's offset ("…+01:00"); the API stores UTC ("…Z").
  return new Date(zoned.getTime()).toISOString();
}

/** Splits a UTC instant into the date and time shown in `timezone` (what the pickers display). */
export function utcToZonedParts(
  iso: string,
  timezone: string,
): { date: string; time: string } {
  const zoned = new TZDate(iso, timezone);
  return {
    date: format(zoned, "yyyy-MM-dd"),
    time: format(zoned, TIME_FORMAT),
  };
}
