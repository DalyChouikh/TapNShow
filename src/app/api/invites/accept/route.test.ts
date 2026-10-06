import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "v@example.test" } as {
    id: string;
    email: string;
  } | null,
  acceptInvite: vi.fn(async () => ({
    data: "club-ab12" as string | null,
    error: null as { message: string } | null,
  })),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/invites", () => ({
  acceptInvite: mocks.acceptInvite,
}));

const token = "T".repeat(43);
const post = (body: object) =>
  new Request("http://localhost:3000/api/invites/accept", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "v@example.test" };
});

describe("POST /api/invites/accept", () => {
  it("accepts by token hash and returns the slug", async () => {
    const { POST } = await import("./route");
    const response = await POST(post({ token }));
    expect(await response.json()).toEqual({ slug: "club-ab12" });
    expect(mocks.acceptInvite).toHaveBeenCalledWith({}, sha256Hex(token));
  });

  it("needs a session and a well-formed token", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ token: "bad" }))).status).toBe(400);
    mocks.user = null;
    expect((await POST(post({ token }))).status).toBe(401);
    expect(mocks.acceptInvite).not.toHaveBeenCalled();
  });

  it("maps tn:invite_wrong_account to 403", async () => {
    mocks.acceptInvite.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:invite_wrong_account" },
    });
    const { POST } = await import("./route");
    expect((await POST(post({ token }))).status).toBe(403);
  });
});
