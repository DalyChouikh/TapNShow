import { TZDate } from "@date-fns/tz";
import { addDays, isMatch, startOfDay, subDays, subMonths } from "date-fns";
import { HISTORY_PERIODS } from "@/config/responses";
import type { PeriodRange } from "@/shared/api/responses";

/** A history period chip. */
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

/**
 * A chosen period: the chip, and for "From…" its days (`yyyy-MM-dd`, workspace zone). Without
 * days, a screen keeps its own default From… range.
 */
export type PeriodChoice = {
  period: HistoryPeriod;
  custom?: { from: string; to: string };
};

const DAY_FORMAT = "yyyy-MM-dd";

/** A chosen period as a link's search params, so the next screen opens on it (#417). */
export function periodSearchParams(choice: PeriodChoice): URLSearchParams {
  const params = new URLSearchParams({ period: choice.period });
  if (choice.period === "custom" && choice.custom) {
    params.set("from", choice.custom.from);
    params.set("to", choice.custom.to);
  }
  return params;
}

/**
 * The period a link carries (`periodSearchParams`), or null without a usable one: an unknown chip,
 * or a From… range without two real days in order.
 */
export function periodFromSearchParams(
  params: URLSearchParams,
): PeriodChoice | null {
  const period = HISTORY_PERIODS.find((each) => each === params.get("period"));
  if (period === undefined) {
    return null;
  }
  if (period !== "custom") {
    return { period };
  }
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return isMatch(from, DAY_FORMAT) && isMatch(to, DAY_FORMAT) && from <= to
    ? { period, custom: { from, to } }
    : null;
}

const utc = (date: Date) => new Date(date.getTime()).toISOString();

function localMidnight(date: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new TZDate(year, month - 1, day, 0, 0, timezone);
}

/**
 * The instants a period covers (spec §7.7). Calendar boundaries ("this year", custom days, and the
 * day "the last 30 days" and "the last 3 months" start on) are midnights in the workspace's zone,
 * never the browser's, so a range is the same all day long and a second visit asks the same
 * question (#417); the server counts only meetings that have started.
 */
export function periodRange(
  period: HistoryPeriod,
  now: Date,
  timezone: string,
  custom?: { from: string; to: string },
): PeriodRange {
  switch (period) {
    case "30d":
      return {
        from: utc(startOfDay(subDays(new TZDate(now, timezone), 30))),
        to: null,
      };
    case "3m":
      return {
        from: utc(startOfDay(subMonths(new TZDate(now, timezone), 3))),
        to: null,
      };
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
