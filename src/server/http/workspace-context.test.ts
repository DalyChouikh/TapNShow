import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string;
  } | null,
  workspace: null as object | null,
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/workspaces", () => ({
  getWorkspaceBySlug: async () => mocks.workspace,
}));

describe("loadWorkspaceContext", () => {
  it("answers 401 without a session and 404 for unknown or foreign workspaces", async () => {
    const { loadWorkspaceContext } = await import("./workspace-context");
    mocks.user = null;
    const noUser = await loadWorkspaceContext("x-ab12");
    expect(noUser.ok ? 200 : noUser.response.status).toBe(401);
    mocks.user = { id: "u1", email: "a@example.test" };
    const missing = await loadWorkspaceContext("x-ab12");
    expect(missing.ok ? 200 : missing.response.status).toBe(404);
  });

  it("returns client, user and workspace", async () => {
    mocks.workspace = { id: "w1", slug: "x-ab12", myRole: "admin" };
    const { loadWorkspaceContext } = await import("./workspace-context");
    const result = await loadWorkspaceContext("x-ab12");
    expect(result.ok && result.workspace).toMatchObject({
      id: "w1",
      myRole: "admin",
    });
  });
});
