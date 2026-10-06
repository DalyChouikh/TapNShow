import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string;
  } | null,
  getMe: vi.fn(),
  updateProfile: vi.fn(async () => ({
    error: null as { code?: string; message: string } | null,
  })),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/profile", () => ({
  getMe: mocks.getMe,
  updateProfile: mocks.updateProfile,
}));

const patch = (body: object) =>
  new Request("http://localhost:3000/api/me", {
    method: "PATCH",
    headers: { origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("/api/me", () => {
  it("GET returns 401 without a session", async () => {
    mocks.user = null;
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(401);
  });

  it("GET returns the profile", async () => {
    mocks.getMe.mockResolvedValueOnce({
      userId: "u1",
      profile: { displayName: "A", avatarUrl: null, email: "a@example.test" },
      workspaces: [],
      lastWorkspaceSlug: null,
    });
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toMatchObject({
      profile: { displayName: "A" },
    });
  });

  it("PATCH trims the name and maps RLS refusals to 403", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(patch({ displayName: "  Lina  " }))).status).toBe(200);
    expect(mocks.updateProfile).toHaveBeenCalledWith({}, "u1", {
      displayName: "Lina",
    });
    mocks.updateProfile.mockResolvedValueOnce({
      error: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });
    expect(
      (await PATCH(patch({ lastWorkspaceId: crypto.randomUUID() }))).status,
    ).toBe(403);
  });

  it("PATCH rejects empty bodies", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(patch({}))).status).toBe(400);
  });
});
