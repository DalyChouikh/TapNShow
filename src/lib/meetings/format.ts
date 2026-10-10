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

/** The translated words a duration is built from. */
export type DurationWords = {
  minutes: (count: number) => string;
  hours: (hours: number) => string;
  hoursMinutes: (hours: number, minutes: number) => string;
};

/** "45 min", "1 h", "1 h 30": how the wizard, Meeting defaults and the emails say a length. */
export function durationText(total: number, words: DurationWords): string {
  if (total < 60) {
    return words.minutes(total);
  }
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0
    ? words.hours(hours)
    : words.hoursMinutes(hours, minutes);
}

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

/** "14:20" in the meeting's zone. */
export function formatTime(iso: string, timezone: string): string {
  return format(new TZDate(iso, timezone), TIME_FORMAT);
}

/** "Fri 9 Oct" in the meeting's zone. */
export function formatDate(iso: string, timezone: string): string {
  return format(new TZDate(iso, timezone), DATE_FORMAT);
}

/** "Fri 9 Oct, 12:00" in the meeting's zone. */
export function formatDeadline(iso: string, timezone: string): string {
  return `${formatDate(iso, timezone)}, ${formatTime(iso, timezone)}`;
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
