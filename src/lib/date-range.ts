import { addDays, format, parseISO } from "date-fns";

/** A range of calendar days (`yyyy-MM-dd`), both ends included. */
export type DayRange = { from: string; to: string };

/** What a picked range may be: its last day at the latest, and its longest length in days. */
export type DayRangeBounds = { latest?: string; maxDays?: number };

/** The last day the range's end may be, from its first day (undefined: no limit). */
export function lastDayAllowed(
  from: string,
  { latest, maxDays }: DayRangeBounds,
): string | undefined {
  const longest =
    maxDays === undefined
      ? undefined
      : format(addDays(parseISO(from), maxDays - 1), "yyyy-MM-dd");
  if (longest === undefined || latest === undefined) {
    return longest ?? latest;
  }
  return longest < latest ? longest : latest;
}

/**
 * The range once its first day is `from`: the last day stays where it is when it still can, and
 * otherwise moves the least it must (to `from`, or in to the longest range).
 */
export function rangeFrom(
  range: DayRange,
  from: string,
  bounds: DayRangeBounds,
): DayRange {
  const last = lastDayAllowed(from, bounds);
  const to =
    range.to < from
      ? from
      : last !== undefined && range.to > last
        ? last
        : range.to;
  return { from, to };
}
