import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const CONNECTION = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const mocks = vi.hoisted(() => ({
  getWorkspaceSender: vi.fn(),
  setWorkspaceSender: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/sender", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
beforeEach(() => vi.clearAllMocks());

describe("/api/workspaces/[slug]/sender", () => {
  it("returns the sender", async () => {
    const sender = { sender: null, ownerName: "Daly", myConnections: [] };
    mocks.getWorkspaceSender.mockResolvedValueOnce({
      data: sender,
      error: null,
    });
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(sender);
  });

  it("answers database errors with a code", async () => {
    mocks.getWorkspaceSender.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:forbidden" },
    });
    const { GET } = await import("./route");
    const response = await GET(jsonRequest("GET"), ctx);
    expect(response.status).toBe(403);
  });

  it("sets my connection and names owner_only", async () => {
    mocks.setWorkspaceSender.mockResolvedValueOnce({ error: null });
    const { PUT } = await import("./route");
    expect(
      await (
        await PUT(jsonRequest("PUT", { connectionId: CONNECTION }), ctx)
      ).json(),
    ).toEqual({ ok: true });
    expect(mocks.setWorkspaceSender).toHaveBeenCalledWith({}, "w1", CONNECTION);
    mocks.setWorkspaceSender.mockResolvedValueOnce({
      error: { code: "P0001", message: "tn:owner_only" },
    });
    expect(
      await (
        await PUT(jsonRequest("PUT", { connectionId: CONNECTION }), ctx)
      ).json(),
    ).toEqual({
      error: { code: "owner_only" },
    });
  });

  it("refuses cross-origin writes", async () => {
    const { PUT } = await import("./route");
    const request = new Request("http://localhost:3000/api/x", {
      method: "PUT",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ connectionId: CONNECTION }),
    });
    expect((await PUT(request, ctx)).status).toBe(403);
  });
});
