import { describe, expect, it } from "vitest";
import { localSupabaseEnv, parseLocalStatus } from "./local-supabase-env";

const status = JSON.stringify({
  API_URL: "http://127.0.0.1:44321",
  PUBLISHABLE_KEY: "sb_publishable_local",
  SECRET_KEY: "sb_secret_local",
  MAILPIT_URL: "http://127.0.0.1:44324",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:44322/postgres",
});

describe("localSupabaseEnv", () => {
  it("maps `supabase status` output to the app's env names", () => {
    expect(localSupabaseEnv(parseLocalStatus(status))).toMatchObject({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:44321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
      SUPABASE_SECRET_KEY: "sb_secret_local",
      MAILPIT_URL: "http://127.0.0.1:44324",
    });
  });

  it("rejects output without the API URL", () => {
    expect(() =>
      parseLocalStatus(JSON.stringify({ PUBLISHABLE_KEY: "x" })),
    ).toThrow(/API_URL/);
  });
});
