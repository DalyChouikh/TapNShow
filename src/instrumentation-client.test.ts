import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

describe("instrumentation-client", () => {
  it("makes Zod jitless before anything else parses (its first import)", async () => {
    const source = readFileSync("src/instrumentation-client.ts", "utf8");
    const firstImport = /^import .*$/m.exec(source)?.[0];
    expect(firstImport).toBe('import "@/lib/zod-jitless";');
    await import("./instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });
});
