import { describe, expect, it } from "vitest";
import { buildWarnings } from "./check-build-log";

describe("buildWarnings", () => {
  it("finds Turbopack and Next warnings", () => {
    const log = [
      "▲ Next.js 16.3.8 (Turbopack)",
      "- Experiments (use with caution):",
      "Turbopack build encountered 1 warning:",
      "Warning: Failed to find font override values for font `Google Sans`",
      "⚠ Compiled with warnings",
      "✓ Compiled successfully in 3.3s",
    ].join("\n");
    expect(buildWarnings(log)).toEqual([
      "Turbopack build encountered 1 warning:",
      "Warning: Failed to find font override values for font `Google Sans`",
      "⚠ Compiled with warnings",
    ]);
  });

  it("ignores a cold build cache: it is about the runner, not the build", () => {
    const log = [
      "\u001b[33m\u001b[1m⚠\u001b[22m\u001b[39m No build cache found. Please configure build caching for faster rebuilds. Read more: https://nextjs.org/docs/messages/no-cache",
      "✓ Compiled successfully",
    ].join("\n");
    expect(buildWarnings(log)).toEqual([]);
  });

  it("passes a clean log", () => {
    expect(
      buildWarnings("✓ Compiled successfully\n✓ Generating static pages"),
    ).toEqual([]);
  });
});
