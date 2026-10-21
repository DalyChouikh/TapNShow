import "server-only";
import { z } from "zod";
import { SPREADSHEET_MIME_TYPE } from "@/config/sheets";
import type { SheetsRequest } from "@/lib/sheets/types";
import {
  classifyGoogleResponse,
  type FetchLike,
  type GoogleResult,
  googleCall,
} from "./google-call";

/** One tab as Google describes it (what a redraw must check). */
export type SheetTabMeta = {
  sheetId: number;
  title: string;
  index: number;
  conditionalFormats: number;
  slicerIds: number[];
};

const idSchema = z.object({ id: z.string().min(1) });
const filesSchema = z.object({ files: z.array(idSchema) });
const trashedSchema = z.object({ trashed: z.boolean().default(false) });
const tabsSchema = z.object({
  sheets: z
    .array(
      z.object({
        properties: z.object({
          sheetId: z.number().int(),
          title: z.string(),
          index: z.number().int(),
        }),
        conditionalFormats: z.array(z.object({})).default([]),
        slicers: z.array(z.object({ slicerId: z.number().int() })).default([]),
      }),
    )
    .default([]),
});

/** The Sheets and Drive calls the worker makes (plain `fetch`, like Gmail; no `googleapis`). */
export type GoogleSheetsClient = {
  /** The file tagged with `createKey` (a database uuid, so it never holds a quote), if any. */
  findFile(
    token: string,
    createKey: string,
  ): Promise<GoogleResult<string | null>>;
  createFile(
    token: string,
    input: { name: string; workspaceId: string; createKey: string },
  ): Promise<GoogleResult<string>>;
  fileTrashed(token: string, fileId: string): Promise<GoogleResult<boolean>>;
  readTabs(
    token: string,
    spreadsheetId: string,
  ): Promise<GoogleResult<SheetTabMeta[]>>;
  batchUpdate(
    token: string,
    spreadsheetId: string,
    requests: SheetsRequest[],
  ): Promise<GoogleResult<null>>;
};

/** A client for one run; never throws (a network failure or a timeout is a retry). */
export function createGoogleSheetsClient(input: {
  sheetsBaseUrl: string;
  driveBaseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): GoogleSheetsClient {
  const fetchImpl: FetchLike =
    input.fetchImpl ?? ((url, init) => fetch(url, init));
  const call = <T>(
    token: string,
    url: string,
    init: { method: "GET" | "POST"; body?: object },
    schema: z.ZodType<T>,
  ): Promise<GoogleResult<T>> =>
    googleCall({
      fetchImpl,
      timeoutMs: input.timeoutMs,
      token,
      url,
      method: init.method,
      body: init.body,
      schema,
      classify: classifyGoogleResponse,
    });
  const map = <A, B>(
    result: GoogleResult<A>,
    f: (value: A) => B,
  ): GoogleResult<B> =>
    result.kind === "ok" ? { kind: "ok", value: f(result.value) } : result;
  return {
    findFile: async (token, createKey) => {
      const q = `appProperties has { key='tapnshow_create_key' and value='${createKey}' } and trashed = false`;
      const url = `${input.driveBaseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`;
      return map(
        await call(token, url, { method: "GET" }, filesSchema),
        (body) => body.files[0]?.id ?? null,
      );
    },
    createFile: async (token, { name, workspaceId, createKey }) =>
      map(
        await call(
          token,
          `${input.driveBaseUrl}/drive/v3/files?fields=id`,
          {
            method: "POST",
            body: {
              name,
              mimeType: SPREADSHEET_MIME_TYPE,
              appProperties: {
                tapnshow_workspace: workspaceId,
                tapnshow_create_key: createKey,
              },
            },
          },
          idSchema,
        ),
        (body) => body.id,
      ),
    fileTrashed: async (token, fileId) =>
      map(
        await call(
          token,
          `${input.driveBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}?fields=trashed`,
          { method: "GET" },
          trashedSchema,
        ),
        (body) => body.trashed,
      ),
    readTabs: async (token, spreadsheetId) =>
      map(
        await call(
          token,
          `${input.sheetsBaseUrl}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("sheets(properties(sheetId,title,index),conditionalFormats(ranges(sheetId)),slicers(slicerId))")}`,
          { method: "GET" },
          tabsSchema,
        ),
        (body) =>
          body.sheets.map((sheet) => ({
            ...sheet.properties,
            conditionalFormats: sheet.conditionalFormats.length,
            slicerIds: sheet.slicers.map((slicer) => slicer.slicerId),
          })),
      ),
    batchUpdate: async (token, spreadsheetId, requests) =>
      map(
        await call(
          token,
          `${input.sheetsBaseUrl}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
          { method: "POST", body: { requests } },
          z.object({}),
        ),
        () => null,
      ),
  };
}
