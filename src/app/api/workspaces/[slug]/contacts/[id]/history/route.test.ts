import { beforeEach, describe, expect, it, vi } from "vitest";
import { okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
const queries = vi.hoisted(() => ({ getContactHistory: vi.fn() }));
vi.mock("@/server/queries/results", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/results")>()),
  getContactHistory: queries.getContactHistory,
}));
const CONTACT = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const ctx = { params: Promise.resolve({ slug: "club-ab12", id: CONTACT }) };
const get = (query = "") =>
  new Request(
    `http://localhost:3000/api/workspaces/club-ab12/contacts/${CONTACT}/history${query}`,
  );

beforeEach(() => vi.clearAllMocks());

describe("GET …/contacts/[id]/history", () => {
  it("returns the period's counts and one page", async () => {
    const page = {
      counts: { attending: 1, late: 0, absent: 0, noReply: 0 },
      items: [],
      nextCursor: null,
    };
    queries.getContactHistory.mockResolvedValueOnce({
      data: page,
      error: null,
    });
    const { GET } = await import("./route");
    const response = await GET(get("?from=2026-07-08T10:00:00.000Z"), ctx);
    expect(await response.json()).toEqual(page);
    expect(queries.getContactHistory).toHaveBeenCalledWith(
      {},
      CONTACT,
      { from: "2026-07-08T10:00:00.000Z", to: null },
      50,
      null,
    );
  });

  it("refuses an inverted period and maps not found", async () => {
    const { GET } = await import("./route");
    expect(
      (
        await GET(
          get("?from=2026-10-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z"),
          ctx,
        )
      ).status,
    ).toBe(400);
    queries.getContactHistory.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:not_found" },
    });
    expect((await GET(get(), ctx)).status).toBe(404);
  });
});
