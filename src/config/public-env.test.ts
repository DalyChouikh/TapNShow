import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./public-env";

describe("parsePublicEnv", () => {
  it("parses a valid environment", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_APP_URL: "https://tapnshow.vercel.app",
    });
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://tapnshow.vercel.app");
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it("treats empty strings as missing", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SENTRY_DSN: "",
    });
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it("names the missing variable in the error", () => {
    expect(() => parsePublicEnv({})).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("rejects a malformed URL", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_URL: "not a url" })).toThrow(
      /NEXT_PUBLIC_APP_URL/,
    );
  });

  it("reads the Google sign-in flag as a boolean, off by default", () => {
    expect(
      parsePublicEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })
        .NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED,
    ).toBe(false);
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: "true",
      }).NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED,
    ).toBe(true);
  });
});
