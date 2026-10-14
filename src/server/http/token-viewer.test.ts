import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  rpc: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));

const signedIn = new Request("http://localhost:3000/api/r/x", {
  headers: { cookie: "sb-abc-auth-token=x" },
});
const admin = { rpc: mocks.rpc } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("tokenViewer", () => {
  it("skips the session check without an auth cookie", async () => {
    const { tokenViewer } = await import("./token-viewer");
    expect(
      await tokenViewer(
        new Request("http://localhost:3000/api/r/x"),
        admin,
        "h",
      ),
    ).toBe("signed_out");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("asks the database whose invite it is", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "owner", error: null });
    const { tokenViewer } = await import("./token-viewer");
    expect(await tokenViewer(signedIn, admin, "h")).toBe("owner");
    expect(mocks.rpc).toHaveBeenCalledWith("token_viewer", {
      p_token_hash: "h",
      p_user: "u1",
    });
  });

  it("treats an expired session as signed out and a failed lookup as someone else", async () => {
    const { tokenViewer } = await import("./token-viewer");
    mocks.user = null;
    expect(await tokenViewer(signedIn, admin, "h")).toBe("signed_out");
    mocks.user = { id: "u1", email: null };
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "boom" },
    });
    expect(await tokenViewer(signedIn, admin, "h")).toBe("other");
  });
});
