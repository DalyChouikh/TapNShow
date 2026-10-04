import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, resolveLocale } from "./i18n";

describe("resolveLocale", () => {
  it("returns a supported locale unchanged", () => {
    expect(resolveLocale("en")).toBe("en");
  });

  it("falls back to the default for unsupported or missing values", () => {
    expect(resolveLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });
});
