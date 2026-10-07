import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";
import { requireSecret } from "./secrets";

const base = parseServerEnv({
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_FROM: "platform@example.test",
  INVITE_TOKEN_SECRET: "x".repeat(43),
});

describe("requireSecret", () => {
  it("returns a configured secret", () => {
    expect(requireSecret("INVITE_TOKEN_SECRET", base)).toBe("x".repeat(43));
  });

  it("names a missing secret without printing values", () => {
    expect(() => requireSecret("DISPATCH_SECRET", base)).toThrow(
      "DISPATCH_SECRET is not configured",
    );
  });
});
