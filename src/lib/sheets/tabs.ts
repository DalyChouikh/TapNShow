import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { PlannedTab, SheetSourceRow } from "./types";
import type { SheetWords } from "./words";

type MeetingBlock = { meetingId: string; rows: SheetSourceRow[] };

/** Consecutive rows of one meeting (the query orders by start, then meeting, then name). */
function blocks(rows: SheetSourceRow[]): MeetingBlock[] {
  const out: MeetingBlock[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last && last.meetingId === row.meetingId) {
      last.rows.push(row);
    } else {
      out.push({ meetingId: row.meetingId, rows: [row] });
    }
  }
  return out;
}

const day = (row: SheetSourceRow) =>
  format(new TZDate(row.startsAt, row.timezone), "d MMM");

/**
 * The tabs of one year (spec §7.17): one tab named by the year, or, above `maxRows`, chunks split at
 * meeting boundaries (never inside a meeting), newest first, named by their first and last days.
 * An empty year keeps a header-only tab only when it is the current year.
 */
export function planYearTabs(
  year: number,
  rows: SheetSourceRow[],
  options: { maxRows: number; currentYear: number; words: SheetWords },
): PlannedTab[] {
  if (rows.length === 0) {
    return year === options.currentYear
      ? [
          {
            key: String(year),
            year,
            title: String(year),
            rows: [],
            startsFrom: null,
            startsTo: null,
          },
        ]
      : [];
  }
  const chunks: SheetSourceRow[][] = [];
  for (const block of blocks(rows)) {
    const current = chunks.at(-1);
    if (current && current.length + block.rows.length <= options.maxRows) {
      current.push(...block.rows);
    } else {
      chunks.push([...block.rows]);
    }
  }
  const single = chunks.length === 1;
  return chunks.map((chunk, index) => {
    const newest = chunk[0];
    const oldest = chunk[chunk.length - 1];
    return {
      key: single ? String(year) : `${year}-${index + 1}`,
      year,
      title: single
        ? String(year)
        : options.words.sheet("tabRange", {
            year,
            from: day(oldest),
            to: day(newest),
          }),
      rows: chunk,
      startsFrom: oldest.startsAt,
      startsTo: newest.startsAt,
    };
  });
}

/** Our title, unless a tab TapNShow didn't make already has it ("2026 (TapNShow)"). */
export function resolveTitle(
  desired: string,
  takenByOthers: ReadonlySet<string>,
  words: SheetWords,
): string {
  return takenByOthers.has(desired)
    ? words.sheet("tabTaken", { title: desired })
    : desired;
}
