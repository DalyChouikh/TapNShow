import { TZDate } from "@date-fns/tz";

/** The year tab a meeting belongs to: its start's year in its own zone. Twin: `private.sheet_year`. */
export function sheetYear(startsAt: string, timezone: string): number {
  return new TZDate(startsAt, timezone).getFullYear();
}
