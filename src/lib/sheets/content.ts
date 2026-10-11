import type { FillTone } from "@/design/tokens";
import { DETAIL_COLUMNS } from "@/lib/export/columns";
import { attendanceDetailRows, type ExportCell } from "@/lib/export/rows";
import { fittedWidth } from "@/lib/export/theme";
import { formatDate, formatDeadline } from "@/lib/meetings/format";
import type { Band, PlannedTab, SheetSourceRow, TabContent } from "./types";
import type { SheetWords } from "./words";

const ANSWER = DETAIL_COLUMNS.findIndex((column) => column.key === "answer");
const CHECKED_IN = DETAIL_COLUMNS.findIndex(
  (column) => column.key === "checkedIn",
);

const plain = (cell: ExportCell): string | number | null =>
  cell !== null && typeof cell === "object"
    ? cell.text
    : cell === ""
      ? null
      : cell;
const tone = (cell: ExportCell): FillTone | "" =>
  cell !== null && typeof cell === "object" ? cell.tone : "";

/** One band per meeting, alternating; a cancelled meeting is always grey. */
function bands(rows: SheetSourceRow[]): Band[] {
  let index = -1;
  let last = "";
  return rows.map((row) => {
    if (row.meetingId !== last) {
      index += 1;
      last = row.meetingId;
    }
    if (row.meetingStatus === "cancelled") {
      return "cancelled";
    }
    return index % 2 === 0 ? "even" : "odd";
  });
}

/**
 * What one tab shows (spec §7.17): the band, the subtitle, the Details columns, one row per invited
 * person (the Excel row builder, so both stay equal), and the hidden helper values that colour it.
 */
export function tabContent(
  tab: PlannedTab,
  context: {
    workspaceName: string;
    updatedAt: Date;
    timezone: string;
    words: SheetWords;
  },
): TabContent {
  const { words } = context;
  const listNames = new Map(tab.rows.map((row) => [row.contactId, row.lists]));
  const statusOf = new Map(
    tab.rows.map((row) => [row.meetingId, row.meetingStatus]),
  );
  const cells = attendanceDetailRows(
    tab.rows,
    listNames,
    words.labels,
    words.text,
    {
      meetingCell: (row) => {
        const named = words.sheet("meetingCell", {
          title: row.title,
          date: formatDate(row.startsAt, row.timezone),
        });
        return statusOf.get(row.meetingId) === "cancelled"
          ? words.sheet("cancelled", { meeting: named })
          : named;
      },
    },
  );
  const band = bands(tab.rows);
  const values = cells.map((row) => row.map(plain));
  const header = DETAIL_COLUMNS.map((column) => words.column(column.key));
  return {
    band: words.sheet("band", {
      workspace: context.workspaceName,
      tab: tab.title,
    }),
    subtitle: words.sheet("subtitle", {
      at: formatDeadline(context.updatedAt.toISOString(), context.timezone),
    }),
    header,
    values,
    helpers: cells.map((row, index) => [
      band[index],
      tone(row[ANSWER]),
      tone(row[CHECKED_IN]),
    ]),
    widths: DETAIL_COLUMNS.map((column, index) =>
      fittedWidth(
        header[index],
        values.map((row) => row[index]),
        column.width,
      ),
    ),
  };
}

/** What a redraw compares: everything shown except the update time. */
export function contentFingerprint(
  tab: PlannedTab,
  content: TabContent,
): string {
  return JSON.stringify([
    tab.title,
    content.band,
    content.header,
    content.values,
    content.helpers,
  ]);
}
