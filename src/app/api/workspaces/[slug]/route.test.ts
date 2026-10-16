import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string;
  } | null,
  getWorkspaceBySlug: vi.fn(async (): Promise<object | null> => null),
  getSendingSuspension: vi.fn<() => Promise<{ since: string } | null>>(
    async () => null,
  ),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/workspaces", () => ({
  getWorkspaceBySlug: mocks.getWorkspaceBySlug,
  getSendingSuspension: mocks.getSendingSuspension,
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    SMTP_FROM: "platform@example.test",
    LOG_LEVEL: "silent",
  }),
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
      sendingSuspension: null,
    });
  });

  it("says since when sending is paused and where to write, while it is", async () => {
    mocks.getWorkspaceBySlug.mockResolvedValueOnce({
      id: "w1",
      slug: "club-ab12",
      myRole: "admin",
    });
    mocks.getSendingSuspension.mockResolvedValueOnce({
      since: "2026-10-16T09:00:00.000Z",
    });
    const { GET } = await import("./route");
    const body = await (await GET(get(), ctx)).json();
    expect(body.sendingSuspension).toEqual({
      since: "2026-10-16T09:00:00.000Z",
      contact: "mailto:platform@example.test",
    });
    expect(mocks.getSendingSuspension).toHaveBeenCalledWith({}, "w1");
  });
});
