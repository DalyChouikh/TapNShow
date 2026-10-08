import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { QueryProvider } from "@/components/providers/query-provider";
import { pageSchema } from "@/shared/api/pagination";
import { json, routeFetch } from "@/test/fetch";
import { usePagedList } from "./use-paged-list";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
const schema = pageSchema(z.object({ id: z.string() }));

describe("usePagedList", () => {
  it("loads the next page with the cursor and joins the pages", async () => {
    const fetchMock = routeFetch({
      "GET /api/things?tab=a&limit=2": json({
        items: [{ id: "1" }, { id: "2" }],
        nextCursor: "c1",
      }),
      "GET /api/things?tab=a&limit=2&cursor=c1": json({
        items: [{ id: "3" }],
        nextCursor: null,
      }),
    });
    const { result } = renderHook(
      () =>
        usePagedList({
          queryKey: ["things"],
          path: "/api/things",
          params: { tab: "a" },
          schema,
          limit: 2,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() =>
      expect(result.current.items.map((item) => item.id)).toEqual([
        "1",
        "2",
        "3",
      ]),
    );
    expect(result.current.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
