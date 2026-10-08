import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

const TOKEN = "a".repeat(43);
const request = new Request("http://localhost:3000/api/r/x", {
  headers: { "x-real-ip": "198.51.100.7" },
});

beforeEach(() => vi.clearAllMocks());

describe("loadTokenContext", () => {
  it("hashes a well-formed token and checks the rate limit by IP and token", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    const { loadTokenContext } = await import("./token-context");
    const context = await loadTokenContext(request, TOKEN);
    expect(context.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("check_token_rate_limit", {
      p_ip: "198.51.100.7",
      p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("answers 404 for a malformed token without touching the database, and 429 when limited", async () => {
    const { loadTokenContext } = await import("./token-context");
    const bad = await loadTokenContext(request, "short");
    expect(bad.ok ? 200 : bad.response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    const limited = await loadTokenContext(request, TOKEN);
    expect(limited.ok ? 200 : limited.response.status).toBe(429);
  });
});
