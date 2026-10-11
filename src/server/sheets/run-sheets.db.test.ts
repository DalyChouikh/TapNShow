import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TZDate } from "@date-fns/tz";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import * as sheetsConfig from "@/config/sheets";
import { createGoogleSheetsClient } from "@/server/google/sheets-client";
import { createSheetStore } from "@/server/queries/sheets";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { seedConnection } from "@/test/db/sender";
import {
  dirtyYears,
  makeDue,
  parkAllSheets,
  seedSheet,
} from "@/test/db/sheets";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";
import { runSheetSync, type SheetsDeps } from "./run-sheets";

const FILE = "fakefile0000000001";
const cellSchema = z.object({
  userEnteredValue: z.object({ stringValue: z.string().optional() }).optional(),
});
const batchSchema = z.object({
  requests: z.array(
    z.object({
      updateCells: z
        .object({ rows: z.array(z.object({ values: z.array(cellSchema) })) })
        .optional(),
    }),
  ),
});

/** Sheets + Drive over HTTP, answering what the worker asks and keeping the batches it sent. */
const fake = { creates: 0, batches: [] as z.infer<typeof batchSchema>[] };
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://fake");
      const reply = (json: object) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(json));
      };
      if (url.pathname === "/drive/v3/files" && request.method === "GET") {
        return reply({ files: [] });
      }
      if (url.pathname === "/drive/v3/files" && request.method === "POST") {
        fake.creates += 1;
        return reply({ id: FILE });
      }
      if (url.pathname === `/drive/v3/files/${FILE}`) {
        return reply({ trashed: false });
      }
      if (url.pathname === `/v4/spreadsheets/${FILE}:batchUpdate`) {
        fake.batches.push(batchSchema.parse(JSON.parse(body)));
        return reply({});
      }
      if (url.pathname === `/v4/spreadsheets/${FILE}`) {
        return reply({
          sheets: [{ properties: { sheetId: 0, title: "Sheet1", index: 0 } }],
        });
      }
      response.statusCode = 404;
      return reply({ error: { code: 404, status: "NOT_FOUND" } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let year: number;

async function invite(name: string) {
  const { data, error } = await adminClient()
    .from("contacts")
    .insert({
      workspace_id: workspace.id,
      full_name: name,
      email: `${crypto.randomUUID().slice(0, 8)}@example.test`,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return seedInvitee(workspace.id, meeting, data.id);
}

async function answer(hash: string, status: "attending" | "absent") {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: hash,
    p_status: status,
    p_delay_minutes: null,
    p_reason: status === "absent" ? "Exam" : null,
    p_comment: null,
  } as never);
  if (error) {
    throw error;
  }
}

function deps(): SheetsDeps {
  let id = 500;
  return {
    store: createSheetStore(adminClient()),
    google: createGoogleSheetsClient({
      sheetsBaseUrl: baseUrl,
      driveBaseUrl: baseUrl,
      timeoutMs: 5_000,
    }),
    refresh: async () => ({ kind: "ok", accessToken: "token" }),
    openToken: (sealed) => sealed,
    alertPaused: async () => undefined,
    reportBug: () => undefined,
    hash: (text) => createHash("sha256").update(text).digest("hex"),
    now: () => Date.now(),
    newRunId: () => crypto.randomUUID(),
    newObjectId: () => (id += 1),
  };
}

const options = {
  budgetMs: sheetsConfig.SHEET_BUDGET_MS,
  minLeftMs: sheetsConfig.SHEET_MIN_LEFT_MS,
  batchSize: sheetsConfig.SHEET_CLAIM_BATCH,
  leaseSeconds: sheetsConfig.SHEET_LEASE_SECONDS,
  tabRowsMax: sheetsConfig.SHEET_TAB_ROWS_MAX,
  cellsMax: sheetsConfig.SHEET_CELLS_MAX,
  formatVersion: sheetsConfig.SHEET_FORMAT_VERSION,
};

/** Names and Answer cells of the data rows the last batch wrote (row 5 on). */
const written = () =>
  (fake.batches.at(-1)?.requests ?? [])
    .flatMap((request) => request.updateCells?.rows ?? [])
    .slice(4)
    .map((row) => [
      row.values[2]?.userEnteredValue?.stringValue,
      row.values[5]?.userEnteredValue?.stringValue,
    ]);

beforeEach(async () => {
  parkAllSheets();
  fake.creates = 0;
  fake.batches = [];
  owner = await createTestUser({ fullName: "Sync Owner" });
  workspace = await createWorkspaceAs(owner, "Sync Club");
  const connection = await seedConnection(owner.id, {
    scopes: [sheetsConfig.DRIVE_FILE_SCOPE],
  });
  await seedSheet(workspace.id, connection.id, { googleSub: connection.sub });
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  const { data } = await adminClient()
    .from("meetings")
    .select("starts_at")
    .eq("id", meeting)
    .single();
  year = new TZDate(data?.starts_at ?? "", "Africa/Tunis").getFullYear();
});

describe("runSheetSync with the real store", () => {
  it("creates the sheet, writes this year's tab, clears the mark, then redraws a change", async () => {
    const zed = await invite("Zed");
    const amira = await invite("Amira");
    const badr = await invite("Badr");
    await answer(amira.hash, "attending");
    await adminClient().from("attendance_marks").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      invitee_id: zed.inviteeId,
      actual: "present",
      marked_by: owner.id,
    });

    await runSheetSync(deps(), options);
    expect(fake.creates).toBe(1);
    expect(fake.batches).toHaveLength(1);
    expect(written()).toEqual([
      ["Amira", "Going"],
      ["Badr", "No reply"],
      ["Zed", "No reply"],
    ]);
    const tabs = await adminClient()
      .from("sheet_tabs")
      .select("tab_key")
      .eq("workspace_id", workspace.id);
    expect(tabs.data).toEqual([{ tab_key: String(year) }]);
    expect(await dirtyYears(workspace.id)).toEqual([]);
    const sheet = await adminClient()
      .from("sheet_syncs")
      .select("spreadsheet_id, synced_at")
      .eq("workspace_id", workspace.id)
      .single();
    expect(sheet.data?.spreadsheet_id).toBe(FILE);
    expect(sheet.data?.synced_at).not.toBeNull();

    await answer(badr.hash, "absent");
    makeDue(workspace.id);
    await runSheetSync(deps(), options);
    expect(fake.batches).toHaveLength(2);
    expect(written()[1]).toEqual(["Badr", "Can't come"]);
    expect(fake.creates).toBe(1);
  });
});
