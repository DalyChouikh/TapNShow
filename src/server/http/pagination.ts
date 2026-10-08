import "server-only";
import type { NextResponse } from "next/server";
import type { z } from "zod";
import { pageQuerySchema, type Page } from "@/shared/api/pagination";
import { type PeriodRange, periodQuerySchema } from "@/shared/api/responses";
import { apiError } from "./errors";

/** Opaque cursor: base64url of the keyset values of the last row shown. */
export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Reads `?cursor=&limit=` and decodes the cursor with this endpoint's keyset schema. A malformed
 * or foreign cursor is `400 invalid_input`, never a silent restart from page one.
 */
export function readPageParams<T>(
  request: Request,
  cursorSchema: z.ZodType<T>,
):
  | { ok: true; limit: number; after: T | null }
  | { ok: false; response: NextResponse } {
  const search = new URL(request.url).searchParams;
  const query = pageQuerySchema.safeParse({
    cursor: search.get("cursor") ?? undefined,
    limit: search.get("limit") ?? undefined,
  });
  if (!query.success) {
    return { ok: false, response: apiError("invalid_input") };
  }
  if (!query.data.cursor) {
    return { ok: true, limit: query.data.limit, after: null };
  }
  const after = decodeCursor(query.data.cursor, cursorSchema);
  return after === null
    ? { ok: false, response: apiError("invalid_input") }
    : { ok: true, limit: query.data.limit, after };
}

/**
 * Turns `limit + 1` fetched rows into one page: at most `limit` items, and a cursor from the last
 * kept row when more exist.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => readonly (string | number)[],
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null,
  };
}

/** Reads `?from=&to=` (ISO instants; a missing bound is open). Malformed or inverted → 400. */
export function readPeriod(
  request: Request,
): { ok: true; range: PeriodRange } | { ok: false; response: NextResponse } {
  const search = new URL(request.url).searchParams;
  const period = periodQuerySchema.safeParse({
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  return period.success
    ? {
        ok: true,
        range: { from: period.data.from ?? null, to: period.data.to ?? null },
      }
    : { ok: false, response: apiError("invalid_input") };
}
