import { addWeeks, startOfWeek } from "date-fns";

/** Upcoming's section headings (spec §7.4). */
export type WeekGroup = "thisWeek" | "nextWeek" | "later";

/** Which Upcoming section an invite falls in, by the viewer's own calendar weeks (Monday first). */
export function weekGroup(startsAt: string, now: Date): WeekGroup {
  const nextWeek = addWeeks(startOfWeek(now, { weekStartsOn: 1 }), 1);
  const start = new Date(startsAt);
  if (start < nextWeek) {
    return "thisWeek";
  }
  return start < addWeeks(nextWeek, 1) ? "nextWeek" : "later";
}
