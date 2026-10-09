import { TZDate } from "@date-fns/tz";
import { addDays, subDays, subMonths } from "date-fns";
import type { HISTORY_PERIODS } from "@/config/responses";
import type { PeriodRange } from "@/shared/api/responses";

/** A history period chip. */
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

const utc = (date: Date) => new Date(date.getTime()).toISOString();

function localMidnight(date: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new TZDate(year, month - 1, day, 0, 0, timezone);
}

/**
 * The instants a period covers (spec §7.7). Calendar boundaries ("this year", custom days) are
 * midnights in the workspace's zone, never the browser's.
 */
export function periodRange(
  period: HistoryPeriod,
  now: Date,
  timezone: string,
  custom?: { from: string; to: string },
): PeriodRange {
  switch (period) {
    case "30d":
      return { from: utc(subDays(now, 30)), to: null };
    case "3m":
      return { from: utc(subMonths(now, 3)), to: null };
    case "year":
      return {
        from: utc(
          new TZDate(
            new TZDate(now, timezone).getFullYear(),
            0,
            1,
            0,
            0,
            timezone,
          ),
        ),
        to: null,
      };
    case "all":
      return { from: null, to: null };
    case "custom":
      return custom
        ? {
            from: utc(localMidnight(custom.from, timezone)),
            to: utc(addDays(localMidnight(custom.to, timezone), 1)),
          }
        : { from: null, to: null };
  }
}
