import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ createList: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces/[slug]/lists", () => {
  it("creates a list with a trimmed name", async () => {
    mocks.createList.mockResolvedValueOnce({
      data: { id: IDS.dev, name: "Dev" },
      error: null,
    });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", { name: "  Dev " }), ctx);
    expect(await response.json()).toEqual({ id: IDS.dev, name: "Dev" });
    expect(mocks.createList).toHaveBeenCalledWith({}, "w1", "Dev");
  });

  it("names the duplicate and the cap", async () => {
    mocks.createList.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    const { POST } = await import("./route");
    expect(
      await (await POST(jsonRequest("POST", { name: "dev" }), ctx)).json(),
    ).toEqual({ error: { code: "list_name_taken" } });
    mocks.createList.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:lists_limit_reached" },
    });
    expect(
      await (await POST(jsonRequest("POST", { name: "New" }), ctx)).json(),
    ).toEqual({ error: { code: "lists_limit_reached" } });
  });
});
