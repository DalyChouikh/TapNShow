import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  getWorkspaceSheet: vi.fn(),
  turnOffSheet: vi.fn(),
  revokeReleased: vi.fn(async () => undefined),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/sheets", () => ({
  getWorkspaceSheet: mocks.getWorkspaceSheet,
  turnOffSheet: mocks.turnOffSheet,
}));
vi.mock("@/server/google/release", () => ({
  revokeReleased: mocks.revokeReleased,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const released = {
  tokenEncrypted: "v1.a.b.c",
  googleSub: "g-1",
  userId: "00000000-0000-4000-8000-000000000001",
};
beforeEach(() => vi.clearAllMocks());

describe("/api/workspaces/[slug]/sheet", () => {
  it("GET returns the sheet status", async () => {
    const status = { state: "off", tabs: [] };
    mocks.getWorkspaceSheet.mockResolvedValueOnce({
      data: status,
      error: null,
    });
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(status);
    expect(mocks.getWorkspaceSheet).toHaveBeenCalledWith({}, "w1");
  });

  it("DELETE refuses a request from another site", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new Request("http://localhost:3000/api/x", { method: "DELETE" }),
      ctx,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("invalid_origin");
    expect(mocks.turnOffSheet).not.toHaveBeenCalled();
  });

  it("DELETE turns the sheet off and revokes the account it released", async () => {
    mocks.turnOffSheet.mockResolvedValueOnce({ data: released, error: null });
    const { DELETE } = await import("./route");
    expect(await (await DELETE(jsonRequest("DELETE"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.turnOffSheet).toHaveBeenCalledWith({}, "w1");
    expect(mocks.revokeReleased).toHaveBeenCalledWith([released]);
  });

  it("DELETE by a Viewer is owner_only", async () => {
    mocks.turnOffSheet.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:owner_only" },
    });
    const { DELETE } = await import("./route");
    const response = await DELETE(jsonRequest("DELETE"), ctx);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("owner_only");
    expect(mocks.revokeReleased).not.toHaveBeenCalled();
  });
});
