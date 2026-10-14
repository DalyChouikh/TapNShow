import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pageSchema } from "@/shared/api/pagination";
import { json, routeFetch } from "@/test/fetch";
import { fetchAllPages } from "./fetch-all-pages";

describe("fetchAllPages", () => {
  it("follows nextCursor at the largest page size and keeps the order", async () => {
    const fetchMock = routeFetch({
      "GET /api/x?a=1&limit=100": json({
        items: [{ id: "1" }, { id: "2" }],
        nextCursor: "c1",
      }),
      "GET /api/x?a=1&limit=100&cursor=c1": json({
        items: [{ id: "3" }],
        nextCursor: null,
      }),
    });
    const rows = await fetchAllPages(
      "/api/x",
      { a: "1" },
      pageSchema(z.object({ id: z.string() })),
    );
    expect(rows.map((row) => row.id)).toEqual(["1", "2", "3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
