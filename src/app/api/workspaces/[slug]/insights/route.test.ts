import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError } from "@/server/http/errors";
import type { getWorkspaceInsights } from "@/server/queries/results";
import { insightsFixture } from "@/test/fixtures/insights";
import { okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ context: { value: null as object | null } }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => mocks.context.value ?? okContext,
}));
const queries = vi.hoisted(() => ({
  getWorkspaceInsights: vi.fn<typeof getWorkspaceInsights>(),
}));
vi.mock("@/server/queries/results", () => queries);
const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const get = (query = "") =>
  new Request(
    `http://localhost:3000/api/workspaces/club-ab12/insights${query}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("GET …/insights", () => {
  it("returns the insights for the period", async () => {
    queries.getWorkspaceInsights.mockResolvedValueOnce({
      data: insightsFixture,
      error: null,
    });
    const from = "2026-07-17T10:00:00.000Z";
    const { GET } = await import("./route");
    const response = await GET(get(`?from=${from}`), ctx);
    expect(await response.json()).toEqual(insightsFixture);
    expect(queries.getWorkspaceInsights).toHaveBeenCalledWith({}, "w1", {
      from,
      to: null,
    });
  });

  it("400s on an invalid period", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?to=tomorrow"), ctx)).status).toBe(400);
    expect(
      (
        await GET(
          get("?from=2026-10-17T00:00:00.000Z&to=2026-10-01T00:00:00.000Z"),
          ctx,
        )
      ).status,
    ).toBe(400);
    expect(queries.getWorkspaceInsights).not.toHaveBeenCalled();
  });

  it("passes a refused workspace through", async () => {
    mocks.context.value = { ok: false, response: apiError("not_found") };
    const { GET } = await import("./route");
    expect((await GET(get(), ctx)).status).toBe(404);
    expect(queries.getWorkspaceInsights).not.toHaveBeenCalled();
  });

  it("maps a database error", async () => {
    queries.getWorkspaceInsights.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:forbidden" },
    });
    const { GET } = await import("./route");
    const response = await GET(get(), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
  });
});
