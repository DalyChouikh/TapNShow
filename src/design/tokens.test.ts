import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { FILL_TONES, THEMES, palette } from "./tokens";

const AA = 4.5;

describe.each(THEMES)("%s theme contrast (WCAG AA)", (theme) => {
  const colors = palette[theme];

  it.each(["background", "surface"] as const)("ink on %s", (bg) => {
    expect(contrastRatio(colors.ink, colors[bg])).toBeGreaterThanOrEqual(AA);
  });

  it.each(["background", "surface"] as const)("muted ink on %s", (bg) => {
    expect(contrastRatio(colors.muted, colors[bg])).toBeGreaterThanOrEqual(AA);
  });

  it.each(FILL_TONES)("on-fill text on %s fill", (tone) => {
    expect(contrastRatio(colors.onFill, colors[tone])).toBeGreaterThanOrEqual(
      AA,
    );
  });

  it("outline is visible against the background (non-text, 3:1)", () => {
    expect(
      contrastRatio(colors.outline, colors.background),
    ).toBeGreaterThanOrEqual(3);
  });
});
