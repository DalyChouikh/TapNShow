import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};

describe("parseServerEnv", () => {
  it("applies defaults", () => {
    const env = parseServerEnv({ ...supabase });
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("rejects an unknown log level and names it", () => {
    expect(() => parseServerEnv({ ...supabase, LOG_LEVEL: "loud" })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it("requires the Supabase keys and names the missing one", () => {
    expect(() =>
      parseServerEnv({ ...supabase, SUPABASE_SECRET_KEY: undefined }),
    ).toThrow(/SUPABASE_SECRET_KEY/);
    expect(parseServerEnv(supabase).NEXT_PUBLIC_SUPABASE_URL).toBe(
      "https://abc.supabase.co",
    );
  });
});
