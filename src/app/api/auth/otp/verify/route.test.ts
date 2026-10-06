import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(async () => ({
    error: null as { status?: number; message: string } | null,
  })),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: { verifyOtp: mocks.verifyOtp },
  }),
}));

const post = (body: object) =>
  new Request("http://localhost:3000/api/auth/otp/verify", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/otp/verify", () => {
  it("verifies the normalized code as an email OTP", async () => {
    const { POST } = await import("./route");
    expect(
      (await POST(post({ email: "A@example.test", code: "1234 5678" }))).status,
    ).toBe(200);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: "a@example.test",
      token: "12345678",
      type: "email",
    });
  });

  it("answers invalid_code for wrong or expired codes, rate_limited for 429", async () => {
    const { POST } = await import("./route");
    mocks.verifyOtp.mockResolvedValueOnce({
      error: { status: 403, message: "Token has expired or is invalid" },
    });
    expect(
      await (
        await POST(post({ email: "a@example.test", code: "12345678" }))
      ).json(),
    ).toEqual({ error: { code: "invalid_code" } });
    mocks.verifyOtp.mockResolvedValueOnce({
      error: { status: 429, message: "too many" },
    });
    expect(
      (await POST(post({ email: "a@example.test", code: "12345678" }))).status,
    ).toBe(429);
  });
});
