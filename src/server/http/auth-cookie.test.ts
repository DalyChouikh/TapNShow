import { describe, expect, it } from "vitest";
import { hasAuthCookie, isSessionCookieName } from "./auth-cookie";

const withCookie = (cookie?: string) =>
  new Request(
    "http://localhost:3000/api/r/x",
    cookie ? { headers: { cookie } } : undefined,
  );

describe("hasAuthCookie", () => {
  it("sees a Supabase session cookie, chunked or not", () => {
    expect(hasAuthCookie(withCookie("sb-abc-auth-token=x"))).toBe(true);
    expect(hasAuthCookie(withCookie("theme=dark; sb-abc-auth-token.0=x"))).toBe(
      true,
    );
  });

  it("ignores requests without one", () => {
    expect(hasAuthCookie(withCookie())).toBe(false);
    expect(
      hasAuthCookie(withCookie("theme=dark; sb-abc-code-verifier=x")),
    ).toBe(false);
  });
});

describe("isSessionCookieName", () => {
  it.each([
    ["sb-abc-auth-token", true],
    ["sb-abc-auth-token.0", true],
    ["sb-abc-auth-token-code-verifier", false],
    ["tn_theme", false],
  ])("%s → %s", (name, expected) => {
    expect(isSessionCookieName(name)).toBe(expected);
  });
});
