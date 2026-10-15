import type { FillTone } from "@/design/tokens";
import type { Json } from "@/lib/json";
import type { AttendanceDetailRow } from "@/shared/api/responses";

export type { Json } from "@/lib/json";

/** One request of a Sheets `batchUpdate` (`{ updateCells: … }`, `{ addSheet: … }`, …). */
export type SheetsRequest = { [kind: string]: Json };

/** One sheet row as `sheet_rows` returns it: an attendance detail plus what only the sheet shows. */
export type SheetSourceRow = AttendanceDetailRow & {
  meetingStatus: "scheduled" | "cancelled";
  lists: string[];
};

/** A meeting's band: alternating per meeting, grey when cancelled (a hidden helper column). */
export type Band = "even" | "odd" | "cancelled";

/** One tab TapNShow writes for a year (spec §7.17). */
export type PlannedTab = {
  /** "2026", or "2026-1", "2026-2" … for a split year (newest chunk = 1). */
  key: string;
  year: number;
  /** "2026", or "2026 · 3 Jan – 28 Apr" for a split year. */
  title: string;
  /** Newest meeting first, then name. */
  rows: SheetSourceRow[];
  /** The oldest meeting start in the tab (null for an empty tab). */
  startsFrom: string | null;
  /** The newest meeting start in the tab (null for an empty tab). */
  startsTo: string | null;
};

/** What one tab shows, ready for the request builder. */
export type TabContent = {
  /** The title band text. */
  band: string;
  subtitle: string;
  /** `DETAIL_COLUMNS` headers (15). */
  header: string[];
  /** One per row, 15 cells, tints as their text. */
  values: (string | number | null)[][];
  /** Per row: band, Answer tone, Checked in tone (the hidden helper columns). */
  helpers: [Band, FillTone | "", FillTone | ""][];
  /** Characters, per `DETAIL_COLUMNS` column. */
  widths: number[];
};
