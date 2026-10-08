import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsubscribe: vi.fn() }));
vi.mock("@/server/http/token-context", () => ({
  loadTokenContext: async () => ({
    ok: true,
    client: {},
    tokenHash: "h".repeat(64),
  }),
}));
vi.mock("@/server/queries/tokens", () => ({
  unsubscribeToken: mocks.unsubscribe,
}));

const TOKEN = "a".repeat(43);
const ctx = { params: Promise.resolve({ token: TOKEN }) };
beforeEach(() => vi.clearAllMocks());

describe("/api/r/[token]/unsubscribe", () => {
  it("accepts RFC 8058 one-click from a mail provider (no Origin, form body)", async () => {
    mocks.unsubscribe.mockResolvedValueOnce({ data: true, error: null });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/r/x/unsubscribe", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://mail.google.com",
        },
        body: "List-Unsubscribe=One-Click",
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(mocks.unsubscribe).toHaveBeenCalledWith({}, "h".repeat(64), "link");
  });

  it("404s for an unknown token and sends browsers to the page on GET", async () => {
    mocks.unsubscribe.mockResolvedValueOnce({ data: false, error: null });
    const { GET, POST } = await import("./route");
    expect(
      (
        await POST(
          new Request("http://localhost:3000/x", { method: "POST" }),
          ctx,
        )
      ).status,
    ).toBe(404);
    const redirect = await GET(
      new Request("http://localhost:3000/api/r/x/unsubscribe"),
      ctx,
    );
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe(
      `http://localhost:3000/u/${TOKEN}`,
    );
  });
});
