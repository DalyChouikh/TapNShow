import { describe, expect, it } from "vitest";
import { scrubUrl } from "./scrub";

describe("scrubUrl", () => {
  it("redacts personal-link tokens but keeps the query", () => {
    expect(
      scrubUrl("https://tapnshow.vercel.app/r/abc123XYZ?choice=late"),
    ).toBe("https://tapnshow.vercel.app/r/[REDACTED]?choice=late");
  });

  it("redacts relative token paths", () => {
    expect(scrubUrl("/r/abc123/")).toBe("/r/[REDACTED]/");
  });

  it("leaves other URLs untouched", () => {
    expect(scrubUrl("https://tapnshow.vercel.app/w/gdg/meetings")).toBe(
      "https://tapnshow.vercel.app/w/gdg/meetings",
    );
  });
});
