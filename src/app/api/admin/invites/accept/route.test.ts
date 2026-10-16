import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";
import { adminRequest, crossSiteRequest } from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string;
  } | null,
  acceptAdminInvite: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/admin", () => ({
  acceptAdminInvite: mocks.acceptAdminInvite,
}));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const { POST } = await import("./route");
const token = "t".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("POST /api/admin/invites/accept", () => {
  it("needs a signed-in person and a token-shaped body, from this site", async () => {
    expect((await POST(crossSiteRequest("POST", { token }))).status).toBe(403);
    mocks.user = null;
    expect(
      (await POST(adminRequest("POST", undefined, { token }))).status,
    ).toBe(401);
    mocks.user = { id: "u1", email: "a@example.test" };
    expect((await POST(adminRequest("POST", undefined, {}))).status).toBe(400);
  });

  it("accepts by the token's hash and starts the platform lane; a wrong account is refused by name", async () => {
    mocks.acceptAdminInvite.mockResolvedValueOnce({ data: true, error: null });
    expect(
      await (await POST(adminRequest("POST", undefined, { token }))).json(),
    ).toEqual({ ok: true });
    expect(mocks.acceptAdminInvite).toHaveBeenCalledWith({}, sha256Hex(token));
    expect(mocks.schedule).toHaveBeenCalledWith(["platform"]);
    mocks.acceptAdminInvite.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:invite_wrong_account" },
    });
    const refused = await POST(adminRequest("POST", undefined, { token }));
    expect((await refused.json()).error.code).toBe("invite_wrong_account");
  });
});
