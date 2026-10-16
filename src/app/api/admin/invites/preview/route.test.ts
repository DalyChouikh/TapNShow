import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";
import { adminRequest, crossSiteRequest } from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string;
  } | null,
  adminInvitePreview: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/admin", () => ({
  adminInvitePreview: mocks.adminInvitePreview,
}));

const { POST } = await import("./route");
const token = "t".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("POST /api/admin/invites/preview", () => {
  it("needs a signed-in person (not an admin) and a token-shaped body, from this site", async () => {
    expect((await POST(crossSiteRequest("POST", { token }))).status).toBe(403);
    mocks.user = null;
    expect(
      (await POST(adminRequest("POST", undefined, { token }))).status,
    ).toBe(401);
    mocks.user = { id: "u1", email: "a@example.test" };
    expect(
      (await POST(adminRequest("POST", undefined, { token: "x" }))).status,
    ).toBe(400);
  });

  it("looks the invite up by the token's hash and says what it shows", async () => {
    mocks.adminInvitePreview.mockResolvedValueOnce({
      data: { status: "wrong_account", maskedEmail: "n•••@example.test" },
      error: null,
    });
    expect(
      await (await POST(adminRequest("POST", undefined, { token }))).json(),
    ).toEqual({
      status: "wrong_account",
      maskedEmail: "n•••@example.test",
    });
    expect(mocks.adminInvitePreview).toHaveBeenCalledWith({}, sha256Hex(token));
  });
});
