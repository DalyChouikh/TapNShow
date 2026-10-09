import { describe, expect, it } from "vitest";
import { z } from "zod";
import { encodeCursor, readPageParams, readPeriod, toPage } from "./pagination";

const key = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);
const ID = "4b7f8c2e-2f3a-4c55-9a1e-0d6f6b1c2a10";

describe("cursor helpers", () => {
  it("round-trips a keyset through the query string", () => {
    const cursor = encodeCursor(["2026-10-09T17:00:00.000Z", ID]);
    const parsed = readPageParams(
      new Request(`https://x.test/a?cursor=${cursor}&limit=10`),
      key,
    );
    expect(parsed).toEqual({
      ok: true,
      limit: 10,
      after: ["2026-10-09T17:00:00.000Z", ID],
    });
  });

  it("starts at the beginning without a cursor", () => {
    expect(readPageParams(new Request("https://x.test/a"), key)).toEqual({
      ok: true,
      limit: 50,
      after: null,
    });
  });

  it("rejects a tampered cursor or limit with 400", async () => {
    for (const query of [
      "cursor=bm90LWpzb24",
      `cursor=${encodeCursor(["x", "y"])}`,
      "limit=0",
      "limit=500",
    ]) {
      const parsed = readPageParams(
        new Request(`https://x.test/a?${query}`),
        key,
      );
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.response.status).toBe(400);
      }
    }
  });

  it("keeps limit rows and points the cursor at the last kept one", () => {
    const rows = [1, 2, 3].map((n) => ({ n, id: `id-${n}` }));
    const page = toPage(rows, 2, (r) => [r.n, r.id]);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(encodeCursor([2, "id-2"]));
    expect(
      toPage(rows.slice(0, 2), 2, (r) => [r.n, r.id]).nextCursor,
    ).toBeNull();
  });
});

describe("readPeriod", () => {
  it("reads an open or bounded period", () => {
    expect(readPeriod(new Request("https://x.test/a"))).toEqual({
      ok: true,
      range: { from: null, to: null },
    });
    expect(
      readPeriod(new Request("https://x.test/a?from=2026-09-01T00:00:00.000Z")),
    ).toEqual({
      ok: true,
      range: { from: "2026-09-01T00:00:00.000Z", to: null },
    });
  });

  it("refuses an inverted or malformed period with 400", () => {
    for (const query of [
      "from=2026-10-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z",
      "from=soon",
    ]) {
      const read = readPeriod(new Request(`https://x.test/a?${query}`));
      expect(read.ok).toBe(false);
      if (!read.ok) {
        expect(read.response.status).toBe(400);
      }
    }
  });
});
