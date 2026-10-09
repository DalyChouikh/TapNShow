import { addMinutes } from "date-fns";

/** Google Calendar's "create event" page (the documented template link). */
const GOOGLE_CALENDAR_RENDER = "https://calendar.google.com/calendar/render";

/** `20261009T170000Z`. */
const utc = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/**
 * "Add to Google Calendar" (spec §9 fallback): opens Google Calendar with the event filled in, in
 * UTC so it shows in the member's own zone. Never carries the personal link.
 */
export function googleCalendarLink(event: {
  title: string;
  start: Date;
  durationMinutes: number;
  details: string;
  location: string;
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${utc(event.start)}/${utc(addMinutes(event.start, event.durationMinutes))}`,
  });
  if (event.details) {
    params.set("details", event.details);
  }
  if (event.location) {
    params.set("location", event.location);
  }
  return `${GOOGLE_CALENDAR_RENDER}?${params.toString()}`;
}
