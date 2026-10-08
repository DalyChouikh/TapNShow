import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

describe("pagination contract", () => {
  it("parses a page of items with a nullable cursor", () => {
    const schema = pageSchema(z.object({ id: z.string() }));
    expect(schema.parse({ items: [{ id: "a" }], nextCursor: null })).toEqual({
      items: [{ id: "a" }],
      nextCursor: null,
    });
  });

  it("defaults the limit and caps it", () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(pageQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(pageQuerySchema.parse({ limit: "20", cursor: "abc" })).toEqual({
      limit: 20,
      cursor: "abc",
    });
  });
});
