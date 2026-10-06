import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string;
  } | null,
  getWorkspaceBySlug: vi.fn(async (): Promise<object | null> => null),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/workspaces", () => ({
  getWorkspaceBySlug: mocks.getWorkspaceBySlug,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const get = () =>
  new NextRequest("http://localhost:3000/api/workspaces/club-ab12");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("GET /api/workspaces/[slug]", () => {
  it("answers 401 without a session", async () => {
    mocks.user = null;
    const { GET } = await import("./route");
    expect((await GET(get(), ctx)).status).toBe(401);
  });

  it("answers 404 for unknown or foreign workspaces", async () => {
    const { GET } = await import("./route");
    expect((await GET(get(), ctx)).status).toBe(404);
    expect(mocks.getWorkspaceBySlug).toHaveBeenCalledWith(
      {},
      "u1",
      "club-ab12",
    );
  });

  it("returns the workspace with the caller's role", async () => {
    mocks.getWorkspaceBySlug.mockResolvedValueOnce({
      id: "w1",
      slug: "club-ab12",
      myRole: "viewer",
    });
    const { GET } = await import("./route");
    expect(await (await GET(get(), ctx)).json()).toEqual({
      id: "w1",
      slug: "club-ab12",
      myRole: "viewer",
    });
  });
});
