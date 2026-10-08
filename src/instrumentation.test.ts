import { afterEach, describe, expect, it, vi } from "vitest";

const { getServerEnv } = vi.hoisted(() => ({ getServerEnv: vi.fn() }));
vi.mock("@/config/env", () => ({ getServerEnv }));
vi.mock("./sentry.server.config", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  getServerEnv.mockReset();
});

describe("register", () => {
  it("validates the server env when the Node.js server starts", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("./instrumentation");
    await register();
    expect(getServerEnv).toHaveBeenCalledOnce();
  });

  it("fails startup with the env error", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    getServerEnv.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY: Required");
    });
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow("SUPABASE_SECRET_KEY");
  });
});
