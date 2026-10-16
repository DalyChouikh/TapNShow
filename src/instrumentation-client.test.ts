import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/** Every source file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe("instrumentation-client", () => {
  it("makes Zod jitless before anything else parses (its first import)", async () => {
    const source = readFileSync("src/instrumentation-client.ts", "utf8");
    const firstImport = /^import .*$/m.exec(source)?.[0];
    expect(firstImport).toBe('import "@/lib/zod-jitless";');
    await import("./instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });

  it("keeps the Sentry SDK out of every page's first scripts (only the lazy chunk imports it)", () => {
    const browserFiles = sourceFiles("src").filter((path) => {
      const source = readFileSync(path, "utf8");
      return (
        source.startsWith('"use client";') ||
        path.endsWith("instrumentation-client.ts") ||
        path.endsWith(join("observability", "browser-sentry.ts"))
      );
    });
    expect(browserFiles.length).toBeGreaterThan(50);
    const staticSdkImports = browserFiles.filter((path) =>
      /^import (?!type )[^;]*from "@sentry\/nextjs";/m.test(
        readFileSync(path, "utf8"),
      ),
    );
    expect(staticSdkImports).toEqual([]);
  });
});
