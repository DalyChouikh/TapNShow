import { describe, expect, it } from "vitest";
import { cleanCell } from "./clean-cell";

describe("cleanCell (Review Focus 4)", () => {
  it("removes invisible characters and collapses every kind of space", () => {
    expect(cleanCell(" Ines​  Ben Salah \t")).toBe("Ines Ben Salah");
    expect(cleanCell("﻿Email")).toBe("Email");
  });

  it("composes accents so 'Inès' typed two ways compares equal", () => {
    expect(cleanCell("Inès")).toBe("Inès");
  });

  it("turns spreadsheet values into text", () => {
    expect(cleanCell(2)).toBe("2");
    expect(cleanCell(true)).toBe("true");
    expect(cleanCell(new Date(2026, 9, 6))).toBe("2026-10-06");
    expect(cleanCell(null)).toBe("");
    expect(cleanCell(undefined)).toBe("");
  });
});
