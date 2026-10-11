import "server-only";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import { resolveLocale } from "@/config/i18n";
import { logger } from "@/lib/logger";
import {
  addSheetRequest,
  deleteSheetRequest,
  formatRequests,
  redrawRequests,
  SHEET_COLUMNS,
  SHEET_RULE_COUNT,
} from "@/lib/sheets/requests";
import { contentFingerprint, tabContent } from "@/lib/sheets/content";
import { planYearTabs, resolveTitle } from "@/lib/sheets/tabs";
import type { PlannedTab } from "@/lib/sheets/types";
import { sheetWords } from "@/lib/sheets/words";
import { sheetYear } from "@/lib/sheets/year";
import { EXPORT_HEADER_ROWS } from "@/lib/export/theme";
import type {
  GoogleFailure,
  GoogleResult,
  GoogleSheetsClient,
  SheetTabMeta,
} from "@/server/google/sheets-client";
import type { RefreshResult } from "@/server/google/google-oauth";
import type {
  SheetClaim,
  SheetPausedAlert,
  SheetStore,
  StoredTab,
} from "@/server/queries/sheets";
import type { SheetPauseReason } from "@/shared/api/sheets";
import messages from "../../../messages/en.json";

/** What the sheet worker needs from the outside world (injected, so tests use fakes). */
export type SheetsDeps = {
  store: SheetStore;
  google: GoogleSheetsClient;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  openToken: (sealed: string, userId: string, googleSub: string) => string;
  alertPaused: (alert: SheetPausedAlert) => Promise<void>;
  reportBug: (context: {
    where: string;
    status: number;
    reason: string;
  }) => void;
  hash: (text: string) => string;
  now: () => number;
  newRunId: () => string;
  /** A random positive 31-bit id for a new tab or Meeting filter box (Google accepts ids we choose, S6). */
  newObjectId: () => number;
};

/** One run's limits (`WORKER_OPTIONS.sheets` in production). */
export type SheetSyncOptions = {
  budgetMs: number;
  minLeftMs: number;
  batchSize: number;
  leaseSeconds: number;
  tabRowsMax: number;
  cellsMax: number;
  formatVersion: number;
};

/** What a run did (logged as counts only). */
export type SheetSyncSummary = {
  sheets: number;
  tabs: number;
  rows: number;
  skipped: number;
  paused: number;
  retried: number;
};

/** A Google call not made because the run's budget is spent: the sheet waits for the next run. */
type Late = { kind: "late" };
const LATE: Late = { kind: "late" };

const cellsOf = (rows: number) =>
  (EXPORT_HEADER_ROWS + Math.max(rows, 1)) * SHEET_COLUMNS;

/** A tab key's part of a split year: 0 for a whole year ("2026"), 1, 2 … for "2026-1", "2026-2" … */
const chunkOf = (key: string) => Number(key.split("-")[1] ?? 0);

/** Tabs newest first: a later year first, then chunk 1 before chunk 2. */
function newer(
  a: { year: number; tabKey: string },
  b: { year: number; tabKey: string },
): boolean {
  return (
    a.year > b.year ||
    (a.year === b.year && chunkOf(a.tabKey) < chunkOf(b.tabKey))
  );
}

/**
 * The stored tab a planned tab rewrites, so our tabs keep their ids (spec §7.17): the one with the
 * same key, or, when the year splits or stops splitting, the year's first stored tab for the year's
 * first planned tab ("2026" ↔ "2026-1").
 */
function previousTab(
  tab: PlannedTab,
  planned: PlannedTab[],
  stored: StoredTab[],
): StoredTab | undefined {
  const same = stored.find((candidate) => candidate.tabKey === tab.key);
  if (same || tab !== planned[0]) {
    return same;
  }
  const keys = new Set(planned.map((each) => each.key));
  return stored
    .filter(
      (candidate) => candidate.year === tab.year && !keys.has(candidate.tabKey),
    )
    .sort((a, b) => chunkOf(a.tabKey) - chunkOf(b.tabKey))[0];
}

/** Where a new tab goes so ours stay newest first: before the first older TapNShow tab. */
function insertIndex(
  tab: { year: number; tabKey: string },
  ours: StoredTab[],
  live: SheetTabMeta[],
): number {
  const placed = ours
    .map((stored) => ({
      stored,
      meta: live.find((meta) => meta.sheetId === stored.googleSheetId),
    }))
    .filter(
      (entry): entry is { stored: StoredTab; meta: SheetTabMeta } =>
        entry.meta !== undefined,
    );
  const older = placed
    .filter((entry) => newer(tab, entry.stored))
    .map((entry) => entry.meta.index);
  if (older.length > 0) {
    return Math.min(...older);
  }
  const all = placed.map((entry) => entry.meta.index);
  return all.length > 0 ? Math.max(...all) + 1 : 0;
}

/**
 * Redraws every due sheet within the time budget (spec §8): access, file, then each changed year
 * newest first; a year is cleared only if nothing changed meanwhile. Never throws for one sheet:
 * a database error on one sheet is logged and the run continues with the next.
 */
export async function runSheetSync(
  deps: SheetsDeps,
  options: SheetSyncOptions,
): Promise<SheetSyncSummary> {
  const run = deps.newRunId();
  const started = deps.now();
  const summary: SheetSyncSummary = {
    sheets: 0,
    tabs: 0,
    rows: 0,
    skipped: 0,
    paused: 0,
    retried: 0,
  };
  const canCall = () =>
    options.budgetMs - (deps.now() - started) >= options.minLeftMs;
  while (canCall()) {
    const claims = await deps.store.claim(
      run,
      options.batchSize,
      options.leaseSeconds,
    );
    if (claims.length === 0) {
      break;
    }
    for (const claim of claims) {
      summary.sheets += 1;
      try {
        await syncSheet(deps, options, run, claim, canCall, summary);
      } catch (error) {
        logger.error({ err: error }, "sheet sync failed");
        await deps.store
          .retry(claim.workspaceId, run, "internal")
          .catch(() => undefined);
        summary.retried += 1;
      }
    }
  }
  logger.info({ summary }, "sheet run finished");
  return summary;
}

async function syncSheet(
  deps: SheetsDeps,
  options: SheetSyncOptions,
  run: string,
  claim: SheetClaim,
  canCall: () => boolean,
  summary: SheetSyncSummary,
): Promise<void> {
  const workspace = claim.workspaceId;
  const words = sheetWords(resolveLocale(claim.locale), messages);
  const pause = async (reason: SheetPauseReason) => {
    summary.paused += 1;
    const alert = await deps.store.pause(workspace, run, reason);
    if (alert) {
      await deps
        .alertPaused(alert)
        .catch((error: Error) =>
          logger.error({ err: error }, "sheet-paused alert failed"),
        );
    }
  };
  // Not a failure: the sheet is handed back unfinished and the next run carries on.
  const late = () => deps.store.release(workspace, run, false);
  const fail = async (failure: GoogleFailure | Late, where: string) => {
    if (failure.kind === "late") {
      return late();
    }
    if (failure.kind === "access_lost" || failure.kind === "unauthorized") {
      return pause("access_lost");
    }
    if (failure.kind === "not_found") {
      return pause("deleted");
    }
    if (failure.kind === "bug") {
      deps.reportBug({ where, status: failure.status, reason: failure.reason });
    }
    summary.retried += 1;
    return deps.store.retry(
      workspace,
      run,
      `${where}:${failure.kind === "bug" ? failure.reason : failure.status}`,
    );
  };
  if (
    !claim.connection ||
    !claim.connection.scopes.includes(DRIVE_FILE_SCOPE)
  ) {
    return pause("access_lost");
  }
  const connection = claim.connection;
  const refreshToken = deps.openToken(
    connection.tokenEncrypted,
    connection.userId,
    connection.googleSub,
  );
  let token: string | null = null;
  const refresh = async (): Promise<"ok" | "stop"> => {
    const refreshed = await deps.refresh(refreshToken);
    if (refreshed.kind === "ok") {
      token = refreshed.accessToken;
      return "ok";
    }
    if (refreshed.kind === "invalid_grant") {
      await pause("access_lost");
    } else {
      summary.retried += 1;
      await deps.store.retry(workspace, run, `refresh:${refreshed.status}`);
    }
    return "stop";
  };
  if (!canCall()) {
    return late();
  }
  if ((await refresh()) === "stop") {
    return;
  }
  /**
   * One Google call, only with `minLeftMs` of the budget left (spec §8); a 401 gets one fresh token
   * and one more try.
   */
  const google = async <T>(
    call: (token: string) => Promise<GoogleResult<T>>,
  ): Promise<GoogleResult<T> | Late> => {
    if (!canCall()) {
      return LATE;
    }
    const first = await call(token ?? "");
    if (first.kind !== "unauthorized") {
      return first;
    }
    if (!canCall()) {
      return LATE;
    }
    if ((await refresh()) === "stop") {
      return first;
    }
    return canCall() ? call(token ?? "") : LATE;
  };

  let spreadsheetId = claim.spreadsheetId;
  let created = false;
  if (!spreadsheetId) {
    const found = await google((t) => deps.google.findFile(t, claim.createKey));
    if (found.kind !== "ok") {
      return fail(found, "find");
    }
    spreadsheetId = found.value;
    if (!spreadsheetId) {
      const made = await google((t) =>
        deps.google.createFile(t, {
          name: words.sheet("fileName", { workspace: claim.workspaceName }),
          workspaceId: workspace,
          createKey: claim.createKey,
        }),
      );
      if (made.kind !== "ok") {
        return fail(made, "create");
      }
      spreadsheetId = made.value;
    }
    created = true;
    if (!(await deps.store.saveFile(workspace, run, spreadsheetId))) {
      return;
    }
  } else {
    const trashed = await google((t) =>
      deps.google.fileTrashed(t, spreadsheetId ?? ""),
    );
    if (trashed.kind !== "ok") {
      return fail(trashed, "file");
    }
    if (trashed.value) {
      return pause("trashed");
    }
  }
  const file = spreadsheetId;
  const meta = await google((t) => deps.google.readTabs(t, file));
  if (meta.kind !== "ok") {
    return fail(meta, "tabs");
  }
  let live = meta.value;
  const stored = [...claim.tabs];
  const ourIds = () => new Set(stored.map((tab) => tab.googleSheetId));
  // A file made in this run has Google's default tab, which becomes the newest year's tab.
  let adoptable: SheetTabMeta | undefined =
    created && stored.length === 0 && live.length === 1 ? live[0] : undefined;
  const currentYear = sheetYear(
    new Date(deps.now()).toISOString(),
    claim.timezone,
  );
  let complete = true;

  for (const { year, version } of claim.years) {
    if (!canCall()) {
      complete = false;
      break;
    }
    const rows = await deps.store.rows(workspace, year);
    const planned: PlannedTab[] = planYearTabs(year, rows, {
      maxRows: options.tabRowsMax,
      currentYear,
      words,
    });
    const otherCells = stored
      .filter((tab) => tab.year !== year)
      .reduce((sum, tab) => sum + cellsOf(tab.rowCount), 0);
    const plannedCells = planned.reduce(
      (sum, tab) => sum + cellsOf(tab.rows.length),
      0,
    );
    if (otherCells + plannedCells > options.cellsMax) {
      return pause("full");
    }
    for (const tab of planned) {
      if (!canCall()) {
        complete = false;
        break;
      }
      const previous = previousTab(tab, planned, stored);
      const existing = previous
        ? live.find((item) => item.sheetId === previous.googleSheetId)
        : undefined;
      const reuse = existing ?? adoptable;
      const taken = new Set(
        live
          .filter(
            (item) =>
              !ourIds().has(item.sheetId) && item.sheetId !== reuse?.sheetId,
          )
          .map((item) => item.title),
      );
      const title = resolveTitle(tab.title, taken, words);
      const content = tabContent(tab, {
        workspaceName: claim.workspaceName,
        updatedAt: new Date(deps.now()),
        timezone: claim.timezone,
        words,
      });
      const hash = deps.hash(contentFingerprint(tab, content));
      const formatted =
        reuse !== undefined &&
        reuse === existing &&
        (previous?.formatVersion ?? 0) >= options.formatVersion &&
        reuse.conditionalFormats >= SHEET_RULE_COUNT &&
        reuse.slicerIds.length === 1;
      if (
        previous?.tabKey === tab.key &&
        existing &&
        formatted &&
        previous.contentHash === hash &&
        existing.title === title
      ) {
        summary.skipped += 1;
        continue;
      }
      const sheetId = reuse?.sheetId ?? deps.newObjectId();
      // A formatted tab keeps its one filter box; otherwise formatRequests adds one with a new id.
      const slicerId =
        (formatted ? reuse?.slicerIds[0] : undefined) ?? deps.newObjectId();
      const index = insertIndex({ year, tabKey: tab.key }, stored, live);
      const requests = [
        ...(reuse ? [] : [addSheetRequest(sheetId, title, index)]),
        ...(formatted
          ? []
          : formatRequests(
              sheetId,
              {
                conditionalFormats: reuse?.conditionalFormats ?? 0,
                slicerIds: reuse?.slicerIds ?? [],
              },
              words,
              slicerId,
            )),
        ...redrawRequests(sheetId, title, content, slicerId),
      ];
      const written = await google((t) =>
        deps.google.batchUpdate(t, file, requests),
      );
      if (written.kind !== "ok") {
        return fail(written, "write");
      }
      const saved: StoredTab = {
        tabKey: tab.key,
        year,
        googleSheetId: sheetId,
        title,
        contentHash: hash,
        rowCount: tab.rows.length,
        formatVersion: options.formatVersion,
        startsFrom: tab.startsFrom,
        startsTo: tab.startsTo,
      };
      if (!(await deps.store.saveTab(workspace, run, saved))) {
        return;
      }
      if (!reuse) {
        live = [
          ...live.map((item) =>
            item.index >= index ? { ...item, index: item.index + 1 } : item,
          ),
          {
            sheetId,
            title,
            index,
            conditionalFormats: SHEET_RULE_COUNT,
            slicerIds: [slicerId],
          },
        ];
      }
      if (reuse === adoptable) {
        adoptable = undefined;
      }
      const at = stored.findIndex((candidate) => candidate.tabKey === tab.key);
      if (at >= 0) {
        stored[at] = saved;
      } else {
        stored.push(saved);
      }
      summary.tabs += 1;
      summary.rows += tab.rows.length;
    }
    if (!complete) {
      break;
    }
    const keep = new Set(planned.map((tab) => tab.key));
    const leftovers = stored.filter(
      (tab) => tab.year === year && !keep.has(tab.tabKey),
    );
    if (leftovers.length > 0) {
      // A leftover key whose tab now serves a kept key (a split or un-split year) stays in Google.
      const keptIds = new Set(
        stored
          .filter((tab) => tab.year === year && keep.has(tab.tabKey))
          .map((tab) => tab.googleSheetId),
      );
      const present = leftovers.filter(
        (tab) =>
          !keptIds.has(tab.googleSheetId) &&
          live.some((item) => item.sheetId === tab.googleSheetId),
      );
      if (present.length > 0) {
        const dropped = await google((t) =>
          deps.google.batchUpdate(
            t,
            file,
            present.map((tab) => deleteSheetRequest(tab.googleSheetId)),
          ),
        );
        if (dropped.kind !== "ok") {
          return fail(dropped, "drop");
        }
      }
      await deps.store.dropTabs(
        workspace,
        run,
        leftovers.map((tab) => tab.tabKey),
      );
    }
    await deps.store.finishYear(workspace, run, year, version);
  }
  await deps.store.release(workspace, run, complete);
}
