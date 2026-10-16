import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ VERCEL_ENV: undefined as string | undefined }));
vi.mock("@/config/env", () => ({ getServerEnv: () => env }));
vi.mock("./design-showcase", () => ({ DesignShowcase: () => null }));

describe("DesignPage", () => {
  it("is not found on production", async () => {
    env.VERCEL_ENV = "production";
    const { default: DesignPage } = await import("./page");
    expect(() => DesignPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("renders on previews and locally", async () => {
    env.VERCEL_ENV = "preview";
    const { default: DesignPage } = await import("./page");
    expect(() => DesignPage()).not.toThrow();
  });
});
