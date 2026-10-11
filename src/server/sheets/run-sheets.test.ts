import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import { SHEET_RULE_COUNT } from "@/lib/sheets/requests";
import type { SheetSourceRow, SheetsRequest } from "@/lib/sheets/types";
import type {
  GoogleFailure,
  GoogleResult,
  GoogleSheetsClient,
  SheetTabMeta,
} from "@/server/google/sheets-client";
import type {
  SheetClaim,
  SheetPausedAlert,
  SheetStore,
  StoredTab,
} from "@/server/queries/sheets";
import { sheetRow } from "@/test/fixtures/sheet-rows";
import {
  runSheetSync,
  type SheetsDeps,
  type SheetSyncOptions,
} from "./run-sheets";

const OPTIONS: SheetSyncOptions = {
  budgetMs: 50_000,
  minLeftMs: 20_000,
  batchSize: 5,
  leaseSeconds: 120,
  tabRowsMax: 2_000,
  cellsMax: 19_000_000,
  formatVersion: 1,
};
const NOW = Date.parse("2026-10-12T10:00:00.000Z");

const claimOf = (over: Partial<SheetClaim> = {}): SheetClaim => ({
  workspaceId: "w1",
  workspaceName: "GDG ISSAT",
  workspaceSlug: "gdg",
  timezone: "Africa/Tunis",
  locale: "en",
  spreadsheetId: "file-1",
  createKey: "key-1",
  connection: {
    id: "c1",
    userId: "u1",
    googleSub: "g1",
    tokenEncrypted: "sealed",
    scopes: ["openid", "email", DRIVE_FILE_SCOPE],
  },
  years: [{ year: 2026, version: 1 }],
  tabs: [],
  ...over,
});

const people = (names: string[], meeting = "m1"): SheetSourceRow[] =>
  names.map((fullName) =>
    sheetRow(
      { id: meeting, startsAt: "2026-10-15T17:00:00.000Z" },
      { fullName },
    ),
  );

/** An in-memory store: the claims once, then none. Records every write. */
function fakeStore(
  claims: SheetClaim[],
  rowsByYear: Record<number, SheetSourceRow[]>,
) {
  let claimed = false;
  const alert = (reason: SheetPausedAlert["reason"]): SheetPausedAlert => ({
    email: "owner@example.test",
    workspaceName: "GDG ISSAT",
    workspaceSlug: "gdg",
    reason,
  });
  const store = {
    claim: vi.fn<SheetStore["claim"]>(async () => {
      if (claimed) {
        return [];
      }
      claimed = true;
      return claims;
    }),
    rows: vi.fn<SheetStore["rows"]>(async (_, year) => rowsByYear[year] ?? []),
    saveFile: vi.fn<SheetStore["saveFile"]>(async () => true),
    saveTab: vi.fn<SheetStore["saveTab"]>(async () => true),
    dropTabs: vi.fn<SheetStore["dropTabs"]>(async () => undefined),
    finishYear: vi.fn<SheetStore["finishYear"]>(async () => true),
    release: vi.fn<SheetStore["release"]>(async () => undefined),
    retry: vi.fn<SheetStore["retry"]>(async () => undefined),
    pause: vi.fn<SheetStore["pause"]>(async (_, __, reason) => alert(reason)),
  };
  return store;
}

const ok = <T>(value: T): GoogleResult<T> => ({ kind: "ok", value });

const cellSchema = z.object({
  userEnteredValue: z
    .object({
      stringValue: z.string().optional(),
      numberValue: z.number().optional(),
    })
    .optional(),
});
const writeSchema = z.object({
  updateCells: z.object({
    start: z.object({ sheetId: z.number() }),
    rows: z.array(z.object({ values: z.array(cellSchema) })),
  }),
});
const addSheetSchema = z.object({
  addSheet: z.object({
    properties: z.object({
      sheetId: z.number(),
      title: z.string(),
      index: z.number(),
    }),
  }),
});
const titleSchema = z.object({
  updateSheetProperties: z.object({
    properties: z.object({ sheetId: z.number(), title: z.string() }),
  }),
});
const ruleSchema = z.object({
  addConditionalFormatRule: z.object({
    rule: z.object({ ranges: z.array(z.object({ sheetId: z.number() })) }),
  }),
});
const deleteRuleSchema = z.object({
  deleteConditionalFormatRule: z.object({ sheetId: z.number() }),
});
const slicerSchema = z.object({
  addSlicer: z.object({
    slicer: z.object({
      slicerId: z.number(),
      spec: z.object({ dataRange: z.object({ sheetId: z.number() }) }),
    }),
  }),
});
const deleteObjectSchema = z.object({
  deleteEmbeddedObject: z.object({ objectId: z.number() }),
});
const deleteSheetSchema = z.object({
  deleteSheet: z.object({ sheetId: z.number() }),
});

/**
 * A spreadsheet in memory: tabs with their rule and filter box counts, and the cell text each
 * `updateCells` wrote. `force` queues a failure for the next call of one method.
 */
function fakeGoogle(initial: SheetTabMeta[] = []) {
  let tabs = initial.map((tab) => ({ ...tab }));
  const cells = new Map<number, string[][]>();
  const batches: SheetsRequest[][] = [];
  const forced: Partial<Record<keyof GoogleSheetsClient, GoogleFailure[]>> = {};
  const next = (method: keyof GoogleSheetsClient) => forced[method]?.shift();
  const tab = (sheetId: number) =>
    tabs.find((item) => item.sheetId === sheetId);
  const apply = (request: SheetsRequest) => {
    const added = addSheetSchema.safeParse(request);
    if (added.success) {
      tabs.push({
        ...added.data.addSheet.properties,
        conditionalFormats: 0,
        slicerIds: [],
      });
    }
    const titled = titleSchema.safeParse(request);
    const named = titled.success
      ? tab(titled.data.updateSheetProperties.properties.sheetId)
      : undefined;
    if (titled.success && named) {
      named.title = titled.data.updateSheetProperties.properties.title;
    }
    const rule = ruleSchema.safeParse(request);
    const ruled = rule.success
      ? tab(rule.data.addConditionalFormatRule.rule.ranges[0].sheetId)
      : undefined;
    if (ruled) {
      ruled.conditionalFormats += 1;
    }
    const unruled = deleteRuleSchema.safeParse(request);
    const lost = unruled.success
      ? tab(unruled.data.deleteConditionalFormatRule.sheetId)
      : undefined;
    if (lost) {
      lost.conditionalFormats -= 1;
    }
    const slicer = slicerSchema.safeParse(request);
    const sliced = slicer.success
      ? tab(slicer.data.addSlicer.slicer.spec.dataRange.sheetId)
      : undefined;
    if (slicer.success && sliced) {
      sliced.slicerIds.push(slicer.data.addSlicer.slicer.slicerId);
    }
    const removedObject = deleteObjectSchema.safeParse(request);
    if (removedObject.success) {
      const id = removedObject.data.deleteEmbeddedObject.objectId;
      tabs = tabs.map((item) => ({
        ...item,
        slicerIds: item.slicerIds.filter((s) => s !== id),
      }));
    }
    const removedSheet = deleteSheetSchema.safeParse(request);
    if (removedSheet.success) {
      tabs = tabs.filter(
        (item) => item.sheetId !== removedSheet.data.deleteSheet.sheetId,
      );
    }
    const write = writeSchema.safeParse(request);
    if (write.success) {
      cells.set(
        write.data.updateCells.start.sheetId,
        write.data.updateCells.rows.map((row) =>
          row.values.map((cell) =>
            String(
              cell.userEnteredValue?.stringValue ??
                cell.userEnteredValue?.numberValue ??
                "",
            ),
          ),
        ),
      );
    }
  };
  const google = {
    findFile: vi.fn<GoogleSheetsClient["findFile"]>(
      async () => next("findFile") ?? ok(null),
    ),
    createFile: vi.fn<GoogleSheetsClient["createFile"]>(
      async () => next("createFile") ?? ok("file-new"),
    ),
    fileTrashed: vi.fn<GoogleSheetsClient["fileTrashed"]>(
      async () => next("fileTrashed") ?? ok(false),
    ),
    readTabs: vi.fn<GoogleSheetsClient["readTabs"]>(
      async () =>
        next("readTabs") ??
        ok(tabs.map((item) => ({ ...item, slicerIds: [...item.slicerIds] }))),
    ),
    batchUpdate: vi.fn<GoogleSheetsClient["batchUpdate"]>(
      async (_, __, requests) => {
        const failure = next("batchUpdate");
        if (failure) {
          return failure;
        }
        batches.push(requests);
        requests.forEach(apply);
        return ok(null);
      },
    ),
  };
  return {
    google,
    cells,
    batches,
    tabs: () => tabs,
    force: (method: keyof GoogleSheetsClient, failure: GoogleFailure) => {
      forced[method] = [...(forced[method] ?? []), failure];
    },
  };
}

/** A pause case: name, reason, Google setup, deps and claim overrides. */
type PauseCase = [
  string,
  SheetPausedAlert["reason"],
  (fake: ReturnType<typeof fakeGoogle>) => void,
  Partial<SheetsDeps>,
  Partial<SheetClaim>,
];

function depsOf(
  store: ReturnType<typeof fakeStore>,
  fake: ReturnType<typeof fakeGoogle>,
  over: Partial<SheetsDeps> = {},
) {
  let id = 1000;
  const deps = {
    store,
    google: fake.google,
    refresh: vi.fn<SheetsDeps["refresh"]>(async () => ({
      kind: "ok",
      accessToken: "token",
    })),
    openToken: vi.fn<SheetsDeps["openToken"]>((sealed) => sealed),
    alertPaused: vi.fn<SheetsDeps["alertPaused"]>(async () => undefined),
    reportBug: vi.fn<SheetsDeps["reportBug"]>(),
    hash: (text: string) => text,
    now: () => NOW,
    newRunId: () => "run-1",
    newObjectId: () => (id += 1),
    ...over,
  };
  return deps;
}

const kinds = (requests: SheetsRequest[]) =>
  requests.map((request) => Object.keys(request)[0]);

/** A first run's saved tab, to start a later run from. */
async function firstRun(rows: SheetSourceRow[]) {
  const store = fakeStore([claimOf({ spreadsheetId: null })], { 2026: rows });
  const fake = fakeGoogle([
    {
      sheetId: 0,
      title: "Sheet1",
      index: 0,
      conditionalFormats: 0,
      slicerIds: [],
    },
  ]);
  await runSheetSync(depsOf(store, fake), OPTIONS);
  const saved = store.saveTab.mock.calls[0]?.[2];
  if (!saved) {
    throw new Error("the first run saved no tab");
  }
  return { saved, fake };
}

describe("runSheetSync", () => {
  it("creates the file once, reusing a file tagged with the same key after a crash", async () => {
    const store = fakeStore([claimOf({ spreadsheetId: null })], {
      2026: people(["Amira"]),
    });
    const fake = fakeGoogle([
      {
        sheetId: 0,
        title: "Sheet1",
        index: 0,
        conditionalFormats: 0,
        slicerIds: [],
      },
    ]);
    fake.google.findFile.mockResolvedValueOnce(ok("f1"));
    await runSheetSync(depsOf(store, fake), OPTIONS);
    expect(fake.google.createFile).not.toHaveBeenCalled();
    expect(store.saveFile).toHaveBeenCalledWith("w1", "run-1", "f1");
  });

  it("adopts the new file's only tab for the newest year and formats it", async () => {
    const store = fakeStore([claimOf({ spreadsheetId: null })], {
      2026: people(["Amira"]),
    });
    const fake = fakeGoogle([
      {
        sheetId: 0,
        title: "Sheet1",
        index: 0,
        conditionalFormats: 0,
        slicerIds: [],
      },
    ]);
    await runSheetSync(depsOf(store, fake), OPTIONS);
    expect(fake.google.createFile).toHaveBeenCalledTimes(1);
    expect(store.saveFile).toHaveBeenCalledWith("w1", "run-1", "file-new");
    const [batch] = fake.batches;
    expect(kinds(batch)).not.toContain("addSheet");
    expect(kinds(batch)).toContain("addConditionalFormatRule");
    expect(fake.tabs()[0]).toMatchObject({
      sheetId: 0,
      title: "2026",
      conditionalFormats: SHEET_RULE_COUNT,
    });
    expect(store.saveTab.mock.calls[0][2]).toMatchObject({
      tabKey: "2026",
      googleSheetId: 0,
      title: "2026",
    });
    expect(store.finishYear).toHaveBeenCalledWith("w1", "run-1", 2026, 1);
    expect(store.release).toHaveBeenCalledWith("w1", "run-1", true);
  });

  it("skips a tab whose content and title didn't change", async () => {
    const rows = people(["Amira"]);
    const { saved, fake } = await firstRun(rows);
    const store = fakeStore([claimOf({ tabs: [saved] })], { 2026: rows });
    const before = fake.batches.length;
    const summary = await runSheetSync(depsOf(store, fake), OPTIONS);
    expect(fake.batches.length).toBe(before);
    expect(summary.skipped).toBe(1);
    expect(store.finishYear).toHaveBeenCalledWith("w1", "run-1", 2026, 1);
  });

  it("re-applies formatting that someone removed", async () => {
    const rows = people(["Amira"]);
    const { saved, fake } = await firstRun(rows);
    const live = fake.tabs()[0];
    const store = fakeStore([claimOf({ tabs: [saved] })], { 2026: rows });
    fake.google.readTabs.mockResolvedValueOnce(
      ok([{ ...live, conditionalFormats: 3 }]),
    );
    await runSheetSync(depsOf(store, fake), OPTIONS);
    const batch = fake.batches.at(-1) ?? [];
    expect(kinds(batch).slice(0, 4)).toEqual([
      "deleteConditionalFormatRule",
      "deleteConditionalFormatRule",
      "deleteConditionalFormatRule",
      "deleteEmbeddedObject",
    ]);
    expect(
      kinds(batch).filter((kind) => kind === "addConditionalFormatRule"),
    ).toHaveLength(SHEET_RULE_COUNT);
  });

  it("recreates a tab someone deleted, with a new id", async () => {
    const stored: StoredTab = {
      tabKey: "2026",
      year: 2026,
      googleSheetId: 77,
      title: "2026",
      contentHash: "old",
      rowCount: 1,
      formatVersion: 1,
    };
    const store = fakeStore([claimOf({ tabs: [stored] })], {
      2026: people(["Amira"]),
    });
    const fake = fakeGoogle([]);
    await runSheetSync(depsOf(store, fake), OPTIONS);
    const [batch] = fake.batches;
    expect(batch[0]).toEqual({
      addSheet: { properties: { sheetId: 1001, title: "2026", index: 0 } },
    });
    expect(store.saveTab.mock.calls[0][2]).toMatchObject({
      tabKey: "2026",
      googleSheetId: 1001,
    });
  });

  it('names our tab "2026 (TapNShow)" when someone else\'s tab is called 2026', async () => {
    const store = fakeStore([claimOf()], { 2026: people(["Amira"]) });
    const fake = fakeGoogle([
      {
        sheetId: 9,
        title: "2026",
        index: 0,
        conditionalFormats: 0,
        slicerIds: [],
      },
    ]);
    await runSheetSync(depsOf(store, fake), OPTIONS);
    expect(fake.batches[0][0]).toMatchObject({
      addSheet: { properties: { title: "2026 (TapNShow)" } },
    });
    expect(fake.tabs().find((tab) => tab.sheetId === 9)?.title).toBe("2026");
  });

  it("drops tabs a year no longer needs, in Google and in the store", async () => {
    const chunk = (tabKey: string, googleSheetId: number): StoredTab => ({
      tabKey,
      year: 2026,
      googleSheetId,
      title: tabKey,
      contentHash: "old",
      rowCount: 1,
      formatVersion: 1,
    });
    const store = fakeStore(
      [claimOf({ tabs: [chunk("2026-1", 31), chunk("2026-2", 32)] })],
      {
        2026: people(["Amira"]),
      },
    );
    const fake = fakeGoogle([
      {
        sheetId: 31,
        title: "2026-1",
        index: 0,
        conditionalFormats: 10,
        slicerIds: [5],
      },
      {
        sheetId: 32,
        title: "2026-2",
        index: 1,
        conditionalFormats: 10,
        slicerIds: [6],
      },
    ]);
    await runSheetSync(depsOf(store, fake), OPTIONS);
    expect(fake.batches.at(-1)).toEqual([
      { deleteSheet: { sheetId: 31 } },
      { deleteSheet: { sheetId: 32 } },
    ]);
    expect(store.dropTabs).toHaveBeenCalledWith("w1", "run-1", [
      "2026-1",
      "2026-2",
    ]);
    expect(fake.tabs().map((tab) => tab.title)).toEqual(["2026"]);
  });

  it("leaves a year marked when its version moved during the write, and a second run writes the same cells", async () => {
    const rows = people(["Amira", "Badr"]);
    const store = fakeStore([claimOf({ spreadsheetId: null })], { 2026: rows });
    store.finishYear.mockResolvedValueOnce(false);
    const fake = fakeGoogle([
      {
        sheetId: 0,
        title: "Sheet1",
        index: 0,
        conditionalFormats: 0,
        slicerIds: [],
      },
    ]);
    await runSheetSync(depsOf(store, fake), OPTIONS);
    expect(store.release).toHaveBeenCalledWith("w1", "run-1", true);
    const first = structuredClone(fake.cells.get(0));
    const saved = store.saveTab.mock.calls[0][2];
    const again = fakeStore(
      [
        claimOf({
          tabs: [{ ...saved, contentHash: "stale" }],
          years: [{ year: 2026, version: 2 }],
        }),
      ],
      {
        2026: rows,
      },
    );
    await runSheetSync(depsOf(again, fake), OPTIONS);
    expect(again.saveTab).toHaveBeenCalledTimes(1);
    expect(fake.cells.get(0)).toEqual(first);
    expect(fake.cells.get(0)).toHaveLength(4 + rows.length);
  });

  it.each<PauseCase>([
    [
      "a trashed file",
      "trashed",
      (fake) => {
        fake.google.fileTrashed.mockResolvedValueOnce(ok(true));
      },
      {},
      {},
    ],
    [
      "a deleted file",
      "deleted",
      (fake) => fake.force("fileTrashed", { kind: "not_found" }),
      {},
      {},
    ],
    [
      "a refused token",
      "access_lost",
      () => undefined,
      {
        refresh: vi.fn<SheetsDeps["refresh"]>(async () => ({
          kind: "invalid_grant",
        })),
      },
      {},
    ],
    [
      "no Sheets permission",
      "access_lost",
      () => undefined,
      {},
      {
        connection: {
          id: "c1",
          userId: "u1",
          googleSub: "g1",
          tokenEncrypted: "sealed",
          scopes: ["openid"],
        },
      },
    ],
    ["a full sheet", "full", () => undefined, {}, {}],
  ])(
    "pauses on %s, alerting once",
    async (_, reason, arrange, over, claimOver) => {
      const store = fakeStore([claimOf(claimOver)], {
        2026: people(["Amira"]),
      });
      const fake = fakeGoogle();
      arrange(fake);
      const deps = depsOf(store, fake, over);
      await runSheetSync(
        deps,
        reason === "full" ? { ...OPTIONS, cellsMax: 10 } : OPTIONS,
      );
      expect(store.pause).toHaveBeenCalledWith("w1", "run-1", reason);
      expect(deps.alertPaused).toHaveBeenCalledWith(
        expect.objectContaining({ reason }),
      );
      expect(fake.batches).toEqual([]);
    },
  );

  it("retries without pausing on 429 and on a rate-limit 403, and reports a disabled API", async () => {
    for (const failure of [
      { kind: "retry", status: 429 },
      { kind: "retry", status: 403 },
    ] as const) {
      const store = fakeStore([claimOf()], { 2026: people(["Amira"]) });
      const fake = fakeGoogle();
      fake.force("batchUpdate", failure);
      await runSheetSync(depsOf(store, fake), OPTIONS);
      expect(store.retry).toHaveBeenCalledWith(
        "w1",
        "run-1",
        `write:${failure.status}`,
      );
      expect(store.pause).not.toHaveBeenCalled();
    }
    const store = fakeStore([claimOf()], { 2026: people(["Amira"]) });
    const fake = fakeGoogle();
    fake.force("batchUpdate", {
      kind: "bug",
      status: 403,
      reason: "accessNotConfigured",
    });
    const deps = depsOf(store, fake);
    await runSheetSync(deps, OPTIONS);
    expect(deps.reportBug).toHaveBeenCalledWith({
      where: "write",
      status: 403,
      reason: "accessNotConfigured",
    });
    expect(store.retry).toHaveBeenCalledWith(
      "w1",
      "run-1",
      "write:accessNotConfigured",
    );
    expect(store.pause).not.toHaveBeenCalled();
  });

  it("refreshes once on 401, then gives up as access lost", async () => {
    const store = fakeStore([claimOf()], { 2026: people(["Amira"]) });
    const fake = fakeGoogle();
    fake.force("readTabs", { kind: "unauthorized" });
    fake.force("readTabs", { kind: "unauthorized" });
    const deps = depsOf(store, fake);
    await runSheetSync(deps, OPTIONS);
    expect(deps.refresh).toHaveBeenCalledTimes(2);
    expect(store.pause).toHaveBeenCalledWith("w1", "run-1", "access_lost");
  });

  it("stops before a Google call when less than minLeftMs is left, leaving the year marked", async () => {
    let clock = NOW;
    const store = fakeStore(
      [
        claimOf({
          years: [
            { year: 2026, version: 1 },
            { year: 2025, version: 1 },
          ],
        }),
      ],
      {
        2026: people(["Amira"]),
        2025: [sheetRow({ id: "m0", startsAt: "2025-10-15T17:00:00.000Z" })],
      },
    );
    const fake = fakeGoogle();
    const write = fake.google.batchUpdate.getMockImplementation();
    fake.google.batchUpdate.mockImplementation(
      async (token, file, requests) => {
        clock += 35_000;
        return write ? write(token, file, requests) : ok(null);
      },
    );
    await runSheetSync(depsOf(store, fake, { now: () => clock }), OPTIONS);
    expect(store.finishYear).toHaveBeenCalledTimes(1);
    expect(store.finishYear).toHaveBeenCalledWith("w1", "run-1", 2026, 1);
    expect(store.release).toHaveBeenCalledWith("w1", "run-1", false);
  });

  it("never writes a formula", async () => {
    const tricky = '=HYPERLINK("https://evil.example")';
    const store = fakeStore([claimOf()], {
      2026: [
        sheetRow(
          { id: "m1", startsAt: "2026-10-15T17:00:00.000Z" },
          { fullName: tricky },
        ),
      ],
    });
    const fake = fakeGoogle();
    await runSheetSync(depsOf(store, fake), OPTIONS);
    const text = JSON.stringify(fake.batches);
    expect(text).not.toContain("formulaValue");
    expect(text).toContain(
      JSON.stringify({ userEnteredValue: { stringValue: tricky } }),
    );
  });
});
