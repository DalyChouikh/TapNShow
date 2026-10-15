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

  it("passes a clean log", () => {
    expect(
      buildWarnings("✓ Compiled successfully\n✓ Generating static pages"),
    ).toEqual([]);
  });
});
