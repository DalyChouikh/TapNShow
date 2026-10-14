import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string | null;
  } | null,
  getMyAccount: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/account", () => ({
  getMyAccount: mocks.getMyAccount,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("GET /api/me/account", () => {
  it("is 401 without a session", async () => {
    mocks.user = null;
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(401);
    expect(mocks.getMyAccount).not.toHaveBeenCalled();
  });

  it("returns the summary read with the person's own client", async () => {
    const summary = {
      owned: [{ name: "Club", slug: "club-ab12" }],
      workspaces: 2,
      answersWithText: 14,
    };
    mocks.getMyAccount.mockResolvedValueOnce({ data: summary, error: null });
    const { GET } = await import("./route");
    const response = await GET();
    expect(await response.json()).toEqual(summary);
    expect(mocks.getMyAccount).toHaveBeenCalledWith({});
  });
});
