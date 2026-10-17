import { describe, expect, it } from "vitest";
import { ICON_FILES } from "./icon-files";

describe("ICON_FILES", () => {
  it("gives Apple and Google the full-bleed square icon at their sizes", () => {
    expect(ICON_FILES["apple-touch-icon.png"]).toEqual({
      size: 180,
      variant: "square",
    });
    // Google Cloud Help 15549049: square, 120 × 120 px for the best display.
    expect(ICON_FILES["logo-120.png"]).toEqual({
      size: 120,
      variant: "square",
    });
  });
});
