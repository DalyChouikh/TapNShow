import { describe, expect, it } from "vitest";
import { encodeCursor, readPageParams } from "@/server/http/pagination";
import { detailsCursorSchema, peopleCursorSchema } from "./results";

const ID = "4b7f8c2e-2f3a-4c55-9a1e-0d6f6b1c2a10";
const STARTS = "2026-10-09T17:00:00.000Z";
// Contact names allow 120 characters: one outside the basic plane is two UTF-16 units, a CJK one
// three UTF-8 bytes.
const LONG_NAMES = {
  astral: "\u{1D4EA}".repeat(120),
  cjk: "漢".repeat(120),
};

const read = <T>(
  values: (string | number)[],
  schema: Parameters<typeof readPageParams<T>>[1],
) =>
  readPageParams(
    new Request(`https://x.test/a?cursor=${encodeCursor(values)}`),
    schema,
  );

describe("people and details cursors", () => {
  for (const [kind, name] of Object.entries(LONG_NAMES)) {
    it(`carry a 120-character ${kind} name (#207)`, () => {
      expect(read([name, ID], peopleCursorSchema)).toMatchObject({
        ok: true,
        after: [name, ID],
      });
      expect(read([STARTS, ID, name, ID], detailsCursorSchema)).toMatchObject({
        ok: true,
        after: [STARTS, ID, name, ID],
      });
    });
  }
});
