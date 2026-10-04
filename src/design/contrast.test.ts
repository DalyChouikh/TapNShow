import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("is 1 for identical colors", () => {
    expect(contrastRatio("#C4B5FD", "#C4B5FD")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1E1B2E", "#FDE68A")).toBeCloseTo(
      contrastRatio("#FDE68A", "#1E1B2E"),
      5,
    );
  });
});
