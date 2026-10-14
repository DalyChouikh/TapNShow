import { describe, expect, it } from "vitest";
import { palette } from "@/design/tokens";
import { appIconSvg } from "./app-icon";

describe("appIconSvg (icon B, spec §10 PWA)", () => {
  it("draws the green tile with an ink check on the app background", () => {
    const svg = appIconSvg("full");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain(palette.light.success);
    expect(svg).toContain(palette.light.ink);
    expect(svg).toContain(palette.light.background);
  });

  it("keeps the maskable tile inside Android's central safe zone", () => {
    const svg = appIconSvg("maskable");
    expect(svg).toContain('<rect width="512" height="512"');
    expect(svg).toContain("translate(64 64) scale(0.75)");
  });

  it("draws the notification badge in one colour on transparent", () => {
    const svg = appIconSvg("badge");
    const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g));
    expect([...colours]).toEqual(["#FFFFFF"]);
    expect(svg).not.toContain("<rect width");
  });
});
