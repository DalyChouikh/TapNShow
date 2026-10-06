import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeOAuthCookie } from "@/server/auth/google-oauth";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(async (): Promise<string> => "id-token"),
  signInWithIdToken: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: true,
  },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "sec",
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/auth/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/google-oauth")>()),
  exchangeGoogleCode: mocks.exchange,
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithIdToken: mocks.signInWithIdToken },
  }),
}));

const stored = { state: "s1", verifier: "v1", nonce: "n1", next: "/w/a-ab12" };
const callback = (query: string, cookie = encodeOAuthCookie(stored)) =>
  new NextRequest(`http://localhost:3000/api/auth/google/callback?${query}`, {
    headers: { cookie: `tn_google_oauth=${cookie}` },
  });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/auth/google/callback", () => {
  it("signs in with the raw nonce and continues to /welcome with next", async () => {
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1"));
    expect(mocks.exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "c1",
        verifier: "v1",
        redirectUri: "http://localhost:3000/api/auth/google/callback",
      }),
    );
    expect(mocks.signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "id-token",
      nonce: "n1",
    });
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/welcome?next=%2Fw%2Fa-ab12",
    );
    expect(response.headers.get("set-cookie")).toMatch(/tn_google_oauth=;/);
  });

  it.each([
    ["code=c1&state=wrong"],
    ["error=access_denied&state=s1"],
    ["state=s1"],
  ])("fails closed for %s", async (query) => {
    const { GET } = await import("./route");
    const response = await GET(callback(query));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=google_failed&next=%2Fw%2Fa-ab12",
    );
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("fails closed without the cookie and when Supabase rejects the token", async () => {
    const { GET } = await import("./route");
    expect(
      (await GET(callback("code=c1&state=s1", "garbage"))).headers.get(
        "location",
      ),
    ).toBe("http://localhost:3000/login?error=google_failed");
    mocks.signInWithIdToken.mockResolvedValueOnce({
      error: { message: "nonce mismatch" },
    });
    expect(
      (await GET(callback("code=c1&state=s1"))).headers.get("location"),
    ).toMatch(/\/login\?error=google_failed/);
  });
});
