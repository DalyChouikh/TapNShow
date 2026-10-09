import { describe, expect, it } from "vitest";
import { escapeCell } from "./escape-cell";

describe("escapeCell (Review Focus 4)", () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', `'=HYPERLINK("http://evil","x")`],
    ["+1 555", "'+1 555"],
    ["-2", "'-2"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tTab", "'\tTab"],
    ["\rCR", "'\rCR"],
  ])("prefixes %j", (input, output) => {
    expect(escapeCell(input)).toBe(output);
  });

  it("leaves ordinary text alone", () => {
    expect(escapeCell("Bus from campus, 20 min")).toBe("Bus from campus, 20 min");
    expect(escapeCell("Amira Ben Salah")).toBe("Amira Ben Salah");
  });
});
