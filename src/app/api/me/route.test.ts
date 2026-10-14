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
  deleteAccountData: vi.fn(),
  removeAuthUser: vi.fn<(userId: string) => Promise<boolean>>(),
  afterAccountDeleted: vi.fn(async () => undefined),
  signOut: vi.fn(async () => ({ error: null })),
  steps: [] as string[],
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => {
    void task();
  },
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signOut: mocks.signOut },
  }),
}));
vi.mock("@/server/queries/account", () => ({
  deleteAccountData: mocks.deleteAccountData,
}));
vi.mock("@/server/account/delete-account", () => ({
  removeAuthUser: mocks.removeAuthUser,
  afterAccountDeleted: mocks.afterAccountDeleted,
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
    expect(mocks.updateProfile).toHaveBeenCalledWith(expect.anything(), "u1", {
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

const del = (body: object, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/me", {
    method: "DELETE",
    headers: { origin },
    body: JSON.stringify(body),
  });
const deletion = {
  released: [{ tokenEncrypted: "v1.x", googleSub: "s", userId: "u1" }],
  alerts: [],
};

describe("DELETE /api/me", () => {
  it("needs a session, the same origin and the exact word", async () => {
    const { DELETE } = await import("./route");
    expect(
      (await DELETE(del({ confirm: "confirm" }, "https://evil.example")))
        .status,
    ).toBe(403);
    expect((await DELETE(del({ confirm: "yes" }))).status).toBe(400);
    mocks.user = null;
    expect((await DELETE(del({ confirm: "confirm" }))).status).toBe(401);
    expect(mocks.deleteAccountData).not.toHaveBeenCalled();
  });

  it("refuses an Owner and touches nothing else", async () => {
    mocks.deleteAccountData.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:owns_workspaces" },
    });
    const { DELETE } = await import("./route");
    expect((await DELETE(del({ confirm: "confirm" }))).status).toBe(409);
    expect(mocks.removeAuthUser).not.toHaveBeenCalled();
    expect(mocks.afterAccountDeleted).not.toHaveBeenCalled();
  });

  it("deletes the account, ends the session, then revokes and tells Owners", async () => {
    mocks.deleteAccountData.mockResolvedValueOnce({
      data: deletion,
      error: null,
    });
    mocks.removeAuthUser.mockResolvedValueOnce(true);
    const { DELETE } = await import("./route");
    const response = await DELETE(del({ confirm: "confirm" }));
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.deleteAccountData).toHaveBeenCalledWith(
      expect.anything(),
      "confirm",
    );
    expect(mocks.removeAuthUser).toHaveBeenCalledWith("u1");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.afterAccountDeleted).toHaveBeenCalledWith(deletion);
  });

  it("still revokes what the database released when removing the user fails, and keeps the session", async () => {
    mocks.deleteAccountData.mockResolvedValueOnce({
      data: deletion,
      error: null,
    });
    mocks.removeAuthUser.mockResolvedValueOnce(false);
    const { DELETE } = await import("./route");
    expect((await DELETE(del({ confirm: "confirm" }))).status).toBe(500);
    // The released tokens are gone from the database: a retry would find nothing to revoke.
    expect(mocks.afterAccountDeleted).toHaveBeenCalledWith(deletion);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
