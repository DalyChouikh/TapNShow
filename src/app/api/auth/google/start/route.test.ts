import { describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ enabled: true }));
const limits = vi.hoisted(() => ({
  checkIpLimit: vi.fn(
    async (): Promise<"allowed" | "limited" | "failed"> => "allowed",
  ),
}));
vi.mock("@/server/rate-limit/ip-rate-limit", () => limits);
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    get NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED() {
      return flags.enabled;
    },
  },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "sec",
    LOG_LEVEL: "silent",
  }),
}));

describe("GET /api/auth/google/start", () => {
  it("redirects to Google and sets a short-lived httpOnly cookie scoped to the callback", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost:3000/api/auth/google/start?next=%2Fw%2Fa-ab12",
      ),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
    expect(
      new URL(response.headers.get("location")!).searchParams.get(
        "redirect_uri",
      ),
    ).toBe("http://localhost:3000/api/auth/google/callback");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/tn_google_oauth=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it("drops an unsafe next and sends people back to /login when Google is disabled", async () => {
    const { GET } = await import("./route");
    flags.enabled = false;
    const response = await GET(
      new Request(
        "http://localhost:3000/api/auth/google/start?next=%2F%2Fevil.example",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=google_unavailable",
    );
    flags.enabled = true;
  });

  it("sends people back to /login with rate_limited when the IP is over its limit", async () => {
    const { GET } = await import("./route");
    limits.checkIpLimit.mockResolvedValueOnce("limited");
    const response = await GET(
      new Request("http://localhost:3000/api/auth/google/start"),
    );
    expect(limits.checkIpLimit).toHaveBeenCalledWith(
      "google_signin",
      expect.any(Request),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=rate_limited",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
