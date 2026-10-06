import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changeRole: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
  removeMember: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
  leaveWorkspace: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => ({
    ok: true,
    supabase: {},
    user: { id: "me", email: null },
    workspace: { id: "w1", slug: "club-ab12", myRole: "owner" },
  }),
}));
vi.mock("@/server/queries/members", () => mocks);

const ctx = (userId: string) => ({
  params: Promise.resolve({ slug: "club-ab12", userId }),
});
const request = (method: string, body?: object) =>
  new Request("http://localhost:3000/api/workspaces/club-ab12/members/x", {
    method,
    headers: { origin: "http://localhost:3000" },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => vi.clearAllMocks());

describe("/api/workspaces/[slug]/members/[userId]", () => {
  it("PATCH changes a role", async () => {
    const { PATCH } = await import("./route");
    const target = crypto.randomUUID();
    expect(
      (
        await PATCH(
          request("PATCH", { role: "admin", canCheckIn: false }),
          ctx(target),
        )
      ).status,
    ).toBe(200);
    expect(mocks.changeRole).toHaveBeenCalledWith(
      {},
      { workspaceId: "w1", userId: target, role: "admin", canCheckIn: false },
    );
  });

  it("PATCH maps database refusals", async () => {
    mocks.changeRole.mockResolvedValueOnce({
      error: { message: "tn:use_transfer" },
    });
    const { PATCH } = await import("./route");
    const response = await PATCH(
      request("PATCH", { role: "viewer", canCheckIn: false }),
      ctx(crypto.randomUUID()),
    );
    expect(response.status).toBe(409);
  });

  it("DELETE of yourself means leaving", async () => {
    const { DELETE } = await import("./route");
    await DELETE(request("DELETE"), ctx("me"));
    expect(mocks.leaveWorkspace).toHaveBeenCalledWith({}, "w1");
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it("DELETE of someone else removes them", async () => {
    const { DELETE } = await import("./route");
    const target = crypto.randomUUID();
    await DELETE(request("DELETE"), ctx(target));
    expect(mocks.removeMember).toHaveBeenCalledWith({}, "w1", target);
  });
});
