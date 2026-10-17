import {
  endOfMonth,
  format,
  isFirstDayOfMonth,
  isSameDay,
  parseISO,
} from "date-fns";
import type { AdminOverview } from "@/shared/api/admin";

/** A bar's size in the Overview's chart. */
export type ChartUnit = AdminOverview["series"]["unit"];

/** How many bars apart the date labels go: 1 when all fit (or the width is unknown). */
export function labelStride(
  count: number,
  width: number | null,
  labelPx: number,
): number {
  return width && count > 0
    ? Math.max(1, Math.ceil(labelPx / (width / count)))
    : 1;
}

/**
 * Which bars carry their date: every `stride`-th, the chosen bar always, its close neighbours
 * not (they would touch it).
 */
export function labelledBars(
  count: number,
  chosen: number,
  stride: number,
): Set<number> {
  const labelled = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const clearOfChosen = Math.abs(index - chosen) >= stride;
    if ((index % stride === 0 && clearOfChosen) || index === chosen) {
      labelled.add(index);
    }
  }
  return labelled;
}

/**
 * The month or year row under the bars: each group's name on its first bar, left out when the
 * group's bars are narrower than `labelPx` together (a period that starts on a month's last day
 * would write "Oct" and "Nov" over each other, or a last short group past the chart's edge). All
 * names show when the width is unknown.
 */
export function groupLabels(
  groups: readonly string[],
  width: number | null,
  labelPx: number,
): Array<string | null> {
  const barPx = width && groups.length > 0 ? width / groups.length : null;
  return groups.map((group, index) => {
    if (index > 0 && groups[index - 1] === group) {
      return null;
    }
    let span = 1;
    while (groups[index + span] === group) {
      span += 1;
    }
    return barPx === null || span * barPx >= labelPx ? group : null;
  });
}

/** A bar's name: one date, or the first and last of its days (the message joins them). */
export type PointName = { date: string } | { start: string; end: string };

/**
 * How a bar is named in the readout and the table: a day by its date, a whole month by its name,
 * and a week or a month the period cuts by its first and last day (so a bar that counts 12 days is
 * never called "October"). Months carry the year; days and weeks name it only across a new year.
 */
export function pointName(
  point: { start: string; end: string },
  unit: ChartUnit,
): PointName {
  const start = parseISO(point.start);
  const end = parseISO(point.end);
  const year = unit === "month" ? " yyyy" : "";
  if (unit === "day" || isSameDay(start, end)) {
    return { date: format(start, `d MMM${year}`) };
  }
  if (
    unit === "month" &&
    isFirstDayOfMonth(start) &&
    isSameDay(end, endOfMonth(start))
  ) {
    return { date: format(start, "MMMM yyyy") };
  }
  if (start.getFullYear() !== end.getFullYear()) {
    return {
      start: format(start, "d MMM yyyy"),
      end: format(end, "d MMM yyyy"),
    };
  }
  return {
    start: format(start, start.getMonth() === end.getMonth() ? "d" : "d MMM"),
    end: format(end, `d MMM${year}`),
  };
}
