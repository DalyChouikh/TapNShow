import { describe, expect, it } from "vitest";
import { isThemeMode, THEME_ICONS, THEME_MODES } from "./theme-modes";

describe("theme modes", () => {
  it("lists System, Light, Dark in that order, each with an icon", () => {
    expect(THEME_MODES).toEqual(["system", "light", "dark"]);
    expect(Object.keys(THEME_ICONS)).toEqual(["system", "light", "dark"]);
  });

  it("recognises only the three modes", () => {
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("sepia")).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});
