import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ renameList: vi.fn(), deleteList: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12", id: IDS.dev }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renameList.mockResolvedValue({ data: [{ id: IDS.dev }], error: null });
  mocks.deleteList.mockResolvedValue({ data: [{ id: IDS.dev }], error: null });
});

describe("/api/workspaces/[slug]/lists/[id]", () => {
  it("PATCH renames, DELETE removes, both 404 for unknown lists", async () => {
    const { PATCH, DELETE } = await import("./route");
    expect(
      (await PATCH(jsonRequest("PATCH", { name: "Developers" }), ctx)).status,
    ).toBe(200);
    expect(mocks.renameList).toHaveBeenCalledWith(
      {},
      "w1",
      IDS.dev,
      "Developers",
    );
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    mocks.renameList.mockResolvedValueOnce({ data: [], error: null });
    expect((await PATCH(jsonRequest("PATCH", { name: "X" }), ctx)).status).toBe(
      404,
    );
    mocks.deleteList.mockResolvedValueOnce({ data: [], error: null });
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(404);
  });

  it("PATCH names a duplicate", async () => {
    mocks.renameList.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    const { PATCH } = await import("./route");
    expect(
      await (await PATCH(jsonRequest("PATCH", { name: "design" }), ctx)).json(),
    ).toEqual({ error: { code: "list_name_taken" } });
  });
});
