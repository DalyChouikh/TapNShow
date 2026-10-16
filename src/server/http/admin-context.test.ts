import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string;
  } | null,
  role: null as "owner" | "admin" | null,
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/admin", () => ({
  myPlatformRole: async () => mocks.role,
}));

describe("loadAdminContext", () => {
  it("answers 401 signed out, and 404 to everyone who isn't a platform admin (it never shows it exists)", async () => {
    const { loadAdminContext } = await import("./admin-context");
    mocks.user = null;
    const signedOut = await loadAdminContext();
    expect(signedOut.ok ? 200 : signedOut.response.status).toBe(401);
    mocks.user = { id: "u1", email: "a@example.test" };
    mocks.role = null;
    const member = await loadAdminContext();
    expect(member.ok ? 200 : member.response.status).toBe(404);
  });

  it("returns the client, the user and the platform role", async () => {
    mocks.role = "admin";
    const { loadAdminContext } = await import("./admin-context");
    const context = await loadAdminContext();
    expect(context.ok && context.role).toBe("admin");
    expect(context.ok && context.user.id).toBe("u1");
  });
});
