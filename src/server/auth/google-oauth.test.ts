import { describe, expect, it, vi } from "vitest";
import { sha256Base64Url, sha256Hex } from "@/server/crypto/tokens";
import {
  createGoogleAuthorization,
  decodeOAuthCookie,
  encodeOAuthCookie,
  exchangeGoogleCode,
} from "./google-oauth";

describe("createGoogleAuthorization", () => {
  it("builds a PKCE + nonce authorization URL", () => {
    const { url, state } = createGoogleAuthorization({
      clientId: "cid",
      redirectUri: "http://localhost:3000/api/auth/google/callback",
      next: "/w/a-ab12",
    });
    const params = new URL(url).searchParams;
    expect(
      url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"),
    ).toBe(true);
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid email profile");
    expect(params.get("state")).toBe(state.state);
    expect(params.get("code_challenge")).toBe(sha256Base64Url(state.verifier));
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("nonce")).toBe(sha256Hex(state.nonce));
    expect(state.next).toBe("/w/a-ab12");
  });
});

describe("OAuth cookie", () => {
  it("round-trips and rejects tampering", () => {
    const { state } = createGoogleAuthorization({
      clientId: "c",
      redirectUri: "http://x/cb",
      next: null,
    });
    expect(decodeOAuthCookie(encodeOAuthCookie(state))).toEqual(state);
    expect(decodeOAuthCookie("not-base64-json")).toBeNull();
    expect(decodeOAuthCookie(undefined)).toBeNull();
  });
});

describe("exchangeGoogleCode", () => {
  it("posts the code with PKCE and returns the ID token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ id_token: "eyJ.a.b", access_token: "ya29.x" }),
          { status: 200 },
        ),
    );
    const token = await exchangeGoogleCode(
      {
        code: "c1",
        verifier: "v1",
        clientId: "cid",
        clientSecret: "sec",
        redirectUri: "http://x/cb",
      },
      fetchImpl,
    );
    expect(token).toBe("eyJ.a.b");
    const body = new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "c1",
      code_verifier: "v1",
      client_id: "cid",
      client_secret: "sec",
      redirect_uri: "http://x/cb",
    });
  });

  it("throws without leaking the response body", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        }),
    );
    await expect(
      exchangeGoogleCode(
        {
          code: "c",
          verifier: "v",
          clientId: "i",
          clientSecret: "s",
          redirectUri: "r",
        },
        fetchImpl,
      ),
    ).rejects.toThrow("Google token exchange failed with HTTP 400");
  });
});
