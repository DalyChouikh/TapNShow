import { describe, expect, it } from "vitest";
import { palette } from "@/design/tokens";
import { ICON_FILES } from "@/lib/brand/icon-files";
import { webManifest as manifest } from "./web-manifest";

describe("web app manifest (spec §10 PWA)", () => {
  it("opens My invites as a standalone app in the app's colours", () => {
    const value = manifest();
    expect(value.start_url).toBe("/invites");
    expect(value.display).toBe("standalone");
    expect(value.theme_color).toBe(palette.light.background);
  });

  it("lists 192 and 512 icons and a maskable 512, each one the icon route serves", () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((icon) => `${icon.sizes}:${icon.purpose}`)).toEqual([
      "192x192:any",
      "512x512:any",
      "512x512:maskable",
    ]);
    for (const icon of icons) {
      expect(Object.keys(ICON_FILES)).toContain(
        icon.src.replace("/icons/", ""),
      );
    }
  });
});
