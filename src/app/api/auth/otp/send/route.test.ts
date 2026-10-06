import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowOtpRequest: vi.fn(async (): Promise<boolean> => true),
  signInWithOtp: vi.fn(async () => ({
    error: null as { status?: number; message: string } | null,
  })),
}));
vi.mock("@/server/rate-limit/ip-rate-limit", () => ({
  allowOtpRequest: mocks.allowOtpRequest,
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithOtp: mocks.signInWithOtp },
  }),
}));

const url = "http://localhost:3000/api/auth/otp/send";
const post = (body: object, origin = "http://localhost:3000") =>
  new Request(url, {
    method: "POST",
    headers: { origin, "x-real-ip": "203.0.113.5" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/otp/send", () => {
  it("sends a code to the normalized email and creates new users", async () => {
    const { POST } = await import("./route");
    const response = await POST(post({ email: " Ali@Example.TEST " }));
    expect(response.status).toBe(200);
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "ali@example.test",
      options: { shouldCreateUser: true },
    });
  });

  it("refuses cross-origin requests before doing anything", async () => {
    const { POST } = await import("./route");
    expect(
      (await POST(post({ email: "a@example.test" }, "https://evil.example")))
        .status,
    ).toBe(403);
    expect(mocks.allowOtpRequest).not.toHaveBeenCalled();
  });

  it("answers 429 when the IP is over its limit or Supabase rate-limits", async () => {
    const { POST } = await import("./route");
    mocks.allowOtpRequest.mockResolvedValueOnce(false);
    expect((await POST(post({ email: "a@example.test" }))).status).toBe(429);
    mocks.signInWithOtp.mockResolvedValueOnce({
      error: { status: 429, message: "over_email_send_rate_limit" },
    });
    expect((await POST(post({ email: "a@example.test" }))).status).toBe(429);
  });

  it("answers 502 send_failed for other provider errors", async () => {
    const { POST } = await import("./route");
    mocks.signInWithOtp.mockResolvedValueOnce({
      error: { status: 500, message: "smtp down" },
    });
    const response = await POST(post({ email: "a@example.test" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "send_failed" } });
  });
});
