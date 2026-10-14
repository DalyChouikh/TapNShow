import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string | null;
  } | null,
  getMyInviteId: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/my-invites", () => ({
  getMyInviteId: mocks.getMyInviteId,
}));
vi.mock("@/config/secrets", () => ({ requireSecret: () => "s".repeat(43) }));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = new Request(`http://localhost:3000/api/me/invites/${ID}/link`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("GET /api/me/invites/[id]/link", () => {
  it("returns the derived answer page, never cached", async () => {
    mocks.getMyInviteId.mockResolvedValueOnce({ data: ID, error: null });
    const { GET } = await import("./route");
    const response = await GET(get, ctx(ID));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { deriveInviteeToken } =
      await import("@/server/crypto/invitee-token");
    expect(await response.json()).toEqual({
      path: `/r/${deriveInviteeToken(ID, "s".repeat(43))}`,
    });
  });

  it("is 404 for a malformed id or someone else's invite, 429 when rate limited", async () => {
    const { GET } = await import("./route");
    expect((await GET(get, ctx("nope"))).status).toBe(404);
    mocks.getMyInviteId.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:not_found" },
    });
    expect((await GET(get, ctx(ID))).status).toBe(404);
    mocks.getMyInviteId.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:rate_limited" },
    });
    expect((await GET(get, ctx(ID))).status).toBe(429);
  });
});
