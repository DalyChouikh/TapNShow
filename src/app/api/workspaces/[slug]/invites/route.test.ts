import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";
import type { DeliveryOutcome } from "@/server/invites/deliver-invite";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

type CreateResult = { data: string | null; error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  createInvite:
    vi.fn<
      (
        client: object,
        input: { email: string; tokenHash: string },
      ) => Promise<CreateResult>
    >(),
  listOpenInvitesPage: vi.fn(async () => ({
    data: { items: [], nextCursor: null },
    error: null,
  })),
  deliverInviteOutcome:
    vi.fn<
      (input: {
        email?: string;
        inviteId: string;
        token: string;
        origin: string;
        inviterName: string;
      }) => Promise<DeliveryOutcome>
    >(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/invites")>()),
  createInvite: mocks.createInvite,
  listOpenInvitesPage: mocks.listOpenInvitesPage,
}));
vi.mock("@/server/invites/deliver-invite", () => ({
  deliverInviteOutcome: mocks.deliverInviteOutcome,
}));
vi.mock("@/server/queries/profile", () => ({
  getDisplayName: async () => "Amira",
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const post = (
  body: object,
  url = "http://localhost:3000/api/workspaces/club-ab12/invites",
  origin = "http://localhost:3000",
) =>
  new NextRequest(url, {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(body),
  });
const id = (n: number) => `7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5${n}`;

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  mocks.createInvite.mockImplementation(async () => ({
    data: id(n++),
    error: null,
  }));
  mocks.deliverInviteOutcome.mockImplementation(async (input) => ({
    status: "link",
    link: `http://localhost:3000/invite/${input.token}`,
  }));
});

describe("POST /api/workspaces/[slug]/invites", () => {
  it("gives every address its own invite and token, storing only the hash", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      post({
        emails: ["A@x.test", "b@y.test"],
        role: "viewer",
        delivery: "link",
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as {
      results: Array<{
        email: string;
        status: string;
        inviteId: string;
        link: string;
      }>;
    };
    expect(results.map((result) => [result.email, result.status])).toEqual([
      ["a@x.test", "link"],
      ["b@y.test", "link"],
    ]);
    const hashes = mocks.createInvite.mock.calls.map(
      ([, input]) => input.tokenHash,
    );
    const tokens = mocks.deliverInviteOutcome.mock.calls.map(
      ([input]) => input.token,
    );
    expect(new Set(tokens).size).toBe(2);
    expect(hashes).toEqual(tokens.map((token) => sha256Hex(token)));
    expect(results[0].link).toBe(`http://localhost:3000/invite/${tokens[0]}`);
  });

  it("continues past addresses that are already members", async () => {
    mocks.createInvite.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:already_member" },
    });
    const { POST } = await import("./route");
    const { results } = await (
      await POST(
        post({
          emails: ["in@x.test", "new@x.test"],
          role: "viewer",
          delivery: "email",
        }),
        ctx,
      )
    ).json();
    expect(results.map((result: { status: string }) => result.status)).toEqual([
      "already_member",
      "link",
    ]);
  });

  it("reports the email limit per address and keeps the invite for copying", async () => {
    mocks.deliverInviteOutcome
      .mockResolvedValueOnce({ status: "sent" })
      .mockResolvedValueOnce({ status: "email_limit" });
    const { POST } = await import("./route");
    const { results } = await (
      await POST(
        post({
          emails: ["a@x.test", "b@x.test"],
          role: "viewer",
          delivery: "email",
        }),
        ctx,
      )
    ).json();
    expect(results).toEqual([
      { email: "a@x.test", status: "sent", inviteId: id(0) },
      { email: "b@x.test", status: "email_limit", inviteId: id(1) },
    ]);
  });

  it("refuses the whole batch when the caller may not invite", async () => {
    mocks.createInvite.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:forbidden" },
    });
    const { POST } = await import("./route");
    expect(
      (
        await POST(
          post({
            emails: ["a@x.test", "b@x.test"],
            role: "admin",
            delivery: "link",
          }),
          ctx,
        )
      ).status,
    ).toBe(403);
    expect(mocks.createInvite).toHaveBeenCalledTimes(1);
  });

  it("refuses cross-origin calls and builds links from the configured app URL, not a spoofed host", async () => {
    const { POST } = await import("./route");
    expect(
      (
        await POST(
          post(
            { emails: ["a@x.test"], role: "viewer", delivery: "link" },
            undefined,
            "https://evil.example",
          ),
          ctx,
        )
      ).status,
    ).toBe(403);
    await POST(
      post(
        { emails: ["a@x.test"], role: "viewer", delivery: "email" },
        "https://evil.example/api/workspaces/club-ab12/invites",
        "https://evil.example",
      ),
      ctx,
    );
    expect(mocks.deliverInviteOutcome.mock.calls[0][0].origin).toBe(
      "http://localhost:3000",
    );
  });
});

describe("GET /api/workspaces/[slug]/invites", () => {
  it("lists open invites", async () => {
    const { GET } = await import("./route");
    expect((await GET(new NextRequest(jsonRequest("GET")), ctx)).status).toBe(
      200,
    );
    expect(mocks.listOpenInvitesPage).toHaveBeenCalledWith(
      {},
      "w1",
      50,
      null,
      expect.any(Date),
    );
  });
});
