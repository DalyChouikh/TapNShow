import { sheetYear } from "./year";

/** One tab as the Export menus see it (`sheet_tabs`, newest first). */
type TabRange = {
  googleSheetId: number;
  year: number;
  startsFrom: string | null;
  startsTo: string | null;
};

/** The Google Sheets address of a spreadsheet, opened on one tab when `gid` is given. */
export function sheetUrl(spreadsheetId: string, gid?: number): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
  return gid === undefined ? base : `${base}#gid=${gid}`;
}

/** Whether `at` falls inside the tab's meeting range (instants, so offsets never matter). */
function holds(tab: TabRange, at: number): boolean {
  return (
    tab.startsFrom !== null &&
    tab.startsTo !== null &&
    new Date(tab.startsFrom).getTime() <= at &&
    at <= new Date(tab.startsTo).getTime()
  );
}

/**
 * The tab a meeting's rows are on (Export menus): its year's tab whose range holds the start, else
 * that year's first tab, else the newest tab. `tabs` come newest first.
 */
export function tabForMeeting(
  tabs: ReadonlyArray<TabRange>,
  startsAt: string | null,
  timezone: string,
): number | undefined {
  if (startsAt) {
    const year = sheetYear(startsAt, timezone);
    const at = new Date(startsAt).getTime();
    const ofYear = tabs.filter((tab) => tab.year === year);
    const found = ofYear.find((tab) => holds(tab, at)) ?? ofYear[0];
    if (found) {
      return found.googleSheetId;
    }
  }
  return tabs[0]?.googleSheetId;
}
