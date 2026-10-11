import { createServer, type Server } from "node:http";
import { z } from "zod";

/** Port of the fake Google (token, Gmail, Drive, Sheets) used by e2e (never a real Google endpoint). */
export const FAKE_GOOGLE_PORT = 44399;
/** Base URL the e2e app build uses for every Google API. */
export const FAKE_GOOGLE_URL = `http://127.0.0.1:${FAKE_GOOGLE_PORT}`;

/** One message the app "sent": `threadId` as requested, `assignedThread` as answered. */
export type FakeGmailMessage = {
  raw: string;
  threadId: string | null;
  assignedThread: string;
};

/** One tab of a fake spreadsheet, as the sheet worker left it. */
export type FakeTab = {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  /** Cell values from A1, one array per row (an empty cell is null). */
  values: (string | number | null)[][];
  /** How many conditional format rules the tab has. */
  rules: number;
  slicerIds: number[];
};

/** One spreadsheet the app created in the fake Drive. */
export type FakeSheetFile = {
  id: string;
  name: string;
  /** The `tapnshow_create_key` app property. */
  createKey: string;
  trashed: boolean;
  tabs: FakeTab[];
};

const createSchema = z.object({
  name: z.string(),
  appProperties: z.object({ tapnshow_create_key: z.string() }),
});
const cellSchema = z.object({
  userEnteredValue: z
    .object({
      stringValue: z.string().optional(),
      numberValue: z.number().optional(),
    })
    .optional(),
});
const sheetRef = z.object({ sheetId: z.number().int() });
/** The request kinds the fake applies; any other kind (formats, merges, widths) is accepted and ignored. */
const requestSchema = z.object({
  addSheet: z
    .object({
      properties: sheetRef.extend({ title: z.string(), index: z.number() }),
    })
    .optional(),
  deleteSheet: sheetRef.optional(),
  updateSheetProperties: z
    .object({
      properties: sheetRef.extend({
        title: z.string().optional(),
        gridProperties: z
          .object({ rowCount: z.number().optional() })
          .optional(),
      }),
    })
    .optional(),
  updateCells: z
    .object({
      start: sheetRef,
      rows: z.array(z.object({ values: z.array(cellSchema).default([]) })),
    })
    .optional(),
  addConditionalFormatRule: z
    .object({ rule: z.object({ ranges: z.array(sheetRef).min(1) }) })
    .optional(),
  deleteConditionalFormatRule: sheetRef.optional(),
  addSlicer: z
    .object({
      slicer: z.object({
        slicerId: z.number().int(),
        spec: z.object({ dataRange: sheetRef }),
      }),
    })
    .optional(),
  deleteEmbeddedObject: z.object({ objectId: z.number().int() }).optional(),
});
const batchSchema = z.object({ requests: z.array(requestSchema) });

/** A new file's only tab, as Google creates it. */
const firstTab = (): FakeTab => ({
  sheetId: 0,
  title: "Sheet1",
  index: 0,
  rowCount: 1000,
  values: [],
  rules: 0,
  slicerIds: [],
});

/** Applies one `batchUpdate` request to `file` (the kinds a redraw and a tab change use). */
function apply(
  file: FakeSheetFile,
  request: z.infer<typeof requestSchema>,
): void {
  const tab = (sheetId: number) =>
    file.tabs.find((each) => each.sheetId === sheetId);
  if (request.addSheet) {
    file.tabs.push({ ...firstTab(), ...request.addSheet.properties });
  }
  if (request.deleteSheet) {
    const { sheetId } = request.deleteSheet;
    file.tabs = file.tabs.filter((each) => each.sheetId !== sheetId);
  }
  if (request.updateSheetProperties) {
    const { sheetId, title, gridProperties } =
      request.updateSheetProperties.properties;
    const target = tab(sheetId);
    if (target) {
      target.title = title ?? target.title;
      target.rowCount = gridProperties?.rowCount ?? target.rowCount;
    }
  }
  if (request.updateCells) {
    const target = tab(request.updateCells.start.sheetId);
    if (target) {
      target.values = request.updateCells.rows.map((row) =>
        row.values.map(
          (cell) =>
            cell.userEnteredValue?.stringValue ??
            cell.userEnteredValue?.numberValue ??
            null,
        ),
      );
    }
  }
  if (request.addConditionalFormatRule) {
    const target = tab(request.addConditionalFormatRule.rule.ranges[0].sheetId);
    if (target) {
      target.rules += 1;
    }
  }
  if (request.deleteConditionalFormatRule) {
    const target = tab(request.deleteConditionalFormatRule.sheetId);
    if (target) {
      target.rules = Math.max(0, target.rules - 1);
    }
  }
  if (request.addSlicer) {
    tab(request.addSlicer.slicer.spec.dataRange.sheetId)?.slicerIds.push(
      request.addSlicer.slicer.slicerId,
    );
  }
  if (request.deleteEmbeddedObject) {
    const { objectId } = request.deleteEmbeddedObject;
    for (const each of file.tabs) {
      each.slicerIds = each.slicerIds.filter((id) => id !== objectId);
    }
  }
}

/**
 * Starts the fake Google:
 * - `POST /token` (refresh grant), `POST /revoke`, and `POST /gmail/v1/users/me/messages/send`
 *   (stores the message, threads like Gmail);
 * - Drive `files` create / find by `tapnshow_create_key` / `?fields=trashed`, and Sheets
 *   `spreadsheets.get` (tabs, rule counts, slicers) / `batchUpdate` (applied to the stored file);
 * - for assertions: `GET /__messages`, `GET /__sheets`, and `POST /__sheets/trash/<id>` (flips the
 *   file between the trash and Drive).
 */
export function startFakeGoogle(): Promise<Server> {
  const messages: FakeGmailMessage[] = [];
  const files: FakeSheetFile[] = [];
  let threads = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const reply = (status: number, payload: object) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      const notFound = () =>
        reply(404, { error: { code: 404, status: "NOT_FOUND" } });
      const url = new URL(request.url ?? "/", FAKE_GOOGLE_URL);
      const route = `${request.method} ${url.pathname}`;
      const fileId =
        /^\/(?:drive\/v3\/files|v4\/spreadsheets|__sheets\/trash)\/([^/:]+)/.exec(
          url.pathname,
        )?.[1];
      const file = files.find((each) => each.id === fileId);

      if (route === "POST /token") {
        return reply(200, { access_token: "fake", expires_in: 3600 });
      }
      if (route === "POST /revoke") {
        return reply(200, {});
      }
      if (route === "POST /gmail/v1/users/me/messages/send") {
        const sent = z
          .object({ raw: z.string(), threadId: z.string().optional() })
          .parse(JSON.parse(body));
        const threadId = sent.threadId ?? `t-${(threads += 1)}`;
        messages.push({
          raw: sent.raw,
          threadId: sent.threadId ?? null,
          assignedThread: threadId,
        });
        return reply(200, { id: `m-${messages.length}`, threadId });
      }
      if (route === "GET /__messages") {
        return reply(200, messages);
      }
      if (route === "POST /drive/v3/files") {
        const created = createSchema.parse(JSON.parse(body));
        // Shaped like a Drive id (the database checks 10+ of [A-Za-z0-9_-]).
        const id = `fake-file-${String(files.length + 1).padStart(6, "0")}`;
        files.push({
          id,
          name: created.name,
          createKey: created.appProperties.tapnshow_create_key,
          trashed: false,
          tabs: [firstTab()],
        });
        return reply(200, { id });
      }
      if (route === "GET /drive/v3/files") {
        const key = /value='([^']+)'/.exec(
          url.searchParams.get("q") ?? "",
        )?.[1];
        const found = files.filter(
          (each) => each.createKey === key && !each.trashed,
        );
        return reply(200, { files: found.map((each) => ({ id: each.id })) });
      }
      if (!file) {
        return route === "GET /__sheets" ? reply(200, files) : notFound();
      }
      if (route === `GET /drive/v3/files/${file.id}`) {
        return reply(200, { trashed: file.trashed });
      }
      if (route === `GET /v4/spreadsheets/${file.id}`) {
        return reply(200, {
          sheets: file.tabs.map((tab) => ({
            properties: {
              sheetId: tab.sheetId,
              title: tab.title,
              index: tab.index,
            },
            conditionalFormats: Array.from({ length: tab.rules }, () => ({
              ranges: [{ sheetId: tab.sheetId }],
            })),
            slicers: tab.slicerIds.map((slicerId) => ({ slicerId })),
          })),
        });
      }
      if (route === `POST /v4/spreadsheets/${file.id}:batchUpdate`) {
        for (const each of batchSchema.parse(JSON.parse(body)).requests) {
          apply(file, each);
        }
        return reply(200, {});
      }
      if (route === `POST /__sheets/trash/${file.id}`) {
        file.trashed = !file.trashed;
        return reply(200, file);
      }
      return notFound();
    });
  });
  return new Promise((resolve) =>
    server.listen(FAKE_GOOGLE_PORT, "127.0.0.1", () => resolve(server)),
  );
}

/** The messages sent so far. */
export async function sentMessages(): Promise<FakeGmailMessage[]> {
  const response = await fetch(`${FAKE_GOOGLE_URL}/__messages`);
  return (await response.json()) as FakeGmailMessage[];
}

/** Every spreadsheet in the fake Drive. */
export async function sheetFiles(): Promise<FakeSheetFile[]> {
  const response = await fetch(`${FAKE_GOOGLE_URL}/__sheets`);
  return (await response.json()) as FakeSheetFile[];
}

/** Moves a file to the fake Drive's trash, or back out of it. */
export async function toggleTrash(fileId: string): Promise<void> {
  const response = await fetch(`${FAKE_GOOGLE_URL}/__sheets/trash/${fileId}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`no fake file ${fileId}`);
  }
}
