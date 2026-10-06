import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn<
    (
      client: object,
      input: { email: string; tokenHash: string },
    ) => Promise<{ data: string | null; error: { message: string } | null }>
  >(async () => ({
    data: "7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5e" as string | null,
    error: null as { message: string } | null,
  })),
  listOpenInvites: vi.fn(async () => []),
  deliverInvite: vi.fn<
    (input: {
      token: string;
      origin: string;
      inviterName: string;
    }) => Promise<Response>
  >(async () => new Response(null, { status: 201 })),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/invites", () => ({
  createInvite: mocks.createInvite,
  listOpenInvites: mocks.listOpenInvites,
}));
vi.mock("@/server/invites/deliver-invite", () => ({
  deliverInvite: mocks.deliverInvite,
}));
vi.mock("@/server/queries/profile", () => ({
  getDisplayName: async () => "Amira",
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const post = (body: object, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/workspaces/club-ab12/invites", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("/api/workspaces/[slug]/invites", () => {
  it("POST stores only the hash of the token it delivers, with the request origin", async () => {
    const { POST } = await import("./route");
    await POST(
      post({ email: "V@Example.test", role: "viewer", delivery: "email" }),
      ctx,
    );
    const created = mocks.createInvite.mock.calls[0][1];
    const delivered = mocks.deliverInvite.mock.calls[0][0];
    expect(created.email).toBe("v@example.test");
    expect(delivered.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.tokenHash).toBe(sha256Hex(delivered.token));
    expect(delivered).toMatchObject({
      origin: "http://localhost:3000",
      inviterName: "Amira",
    });
  });

  it("POST refuses cross-origin calls and maps tn:already_member to 409", async () => {
    const { POST } = await import("./route");
    expect(
      (
        await POST(
          post(
            { email: "v@example.test", role: "viewer", delivery: "link" },
            "https://evil.example",
          ),
          ctx,
        )
      ).status,
    ).toBe(403);
    mocks.createInvite.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:already_member" },
    });
    expect(
      (
        await POST(
          post({ email: "v@example.test", role: "viewer", delivery: "link" }),
          ctx,
        )
      ).status,
    ).toBe(409);
    expect(mocks.deliverInvite).not.toHaveBeenCalled();
  });

  it("GET lists open invites", async () => {
    const { GET } = await import("./route");
    expect((await GET(new NextRequest(jsonRequest("GET")), ctx)).status).toBe(
      200,
    );
    expect(mocks.listOpenInvites).toHaveBeenCalledWith({}, "w1");
  });
});
