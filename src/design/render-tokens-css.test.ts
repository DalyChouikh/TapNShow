import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "./render-tokens-css";
import { FILL_TONES, palette } from "./tokens";

describe("renderTokensCss", () => {
  const css = renderTokensCss();

  it("declares every light and dark color", () => {
    for (const tone of FILL_TONES) {
      expect(css).toContain(`--tn-fill-${tone}: ${palette.light[tone]};`);
      expect(css).toContain(`--tn-fill-${tone}: ${palette.dark[tone]};`);
    }
  });

  it("has a dark block for data-theme and a no-JS system fallback", () => {
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("matches the committed src/app/tokens.css (run `bun run tokens` after editing tokens.ts)", () => {
    expect(readFileSync("src/app/tokens.css", "utf8")).toBe(css);
  });
});
