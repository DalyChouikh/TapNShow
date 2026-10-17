import { describe, expect, it } from "vitest";
import { palette } from "@/design/tokens";
import { appIconSvg, markRadius, VARIANT_SCALE } from "./app-icon";

describe("appIconSvg (the calendar mark, docs/superpowers/specs/2026-10-17-logo-design.md)", () => {
  it("keeps every variant's drawing inside the centre circle of radius 40% (W3C safe zone)", () => {
    // The shadowed page's bottom corners are the farthest points.
    expect(markRadius()).toBeCloseTo(225.51, 1);
    for (const scale of Object.values(VARIANT_SCALE)) {
      expect(markRadius() * scale).toBeLessThanOrEqual(0.4 * 512);
    }
  });

  it("tilts the calendar -8° around the centre in every variant", () => {
    for (const variant of ["full", "square", "maskable", "badge"] as const) {
      expect(appIconSvg(variant)).toContain("rotate(-8 256 256)");
    }
  });

  it("draws only theme colours: mint tile, white page, lilac top, ink", () => {
    const { success, surface, primary, ink } = palette.light;
    for (const variant of ["full", "square", "maskable"] as const) {
      const colours = new Set(appIconSvg(variant).match(/#[0-9A-Fa-f]{6}/g));
      expect([...colours].sort()).toEqual(
        [success, surface, primary, ink].sort(),
      );
    }
  });

  it("rounds only the full icon's canvas; square and maskable are full bleed", () => {
    expect(appIconSvg("full")).toContain(
      '<rect width="512" height="512" rx="112"',
    );
    for (const variant of ["square", "maskable"] as const) {
      expect(appIconSvg(variant)).toMatch(
        /<rect width="512" height="512" fill=/,
      );
    }
  });

  it("draws the notification badge in one colour on transparent", () => {
    const svg = appIconSvg("badge");
    const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g));
    expect([...colours]).toEqual(["#FFFFFF"]);
    expect(svg).not.toContain("<rect width");
  });
});
