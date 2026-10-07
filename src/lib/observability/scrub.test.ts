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

  it("scrubs OAuth code and state on the Google callback", () => {
    expect(scrubUrl("/api/auth/google/callback?code=4/0Ab&state=xyz")).toBe(
      "/api/auth/google/callback?code=[REDACTED]&state=[REDACTED]",
    );
    expect(scrubUrl("/w/club?state=open")).toBe("/w/club?state=open");
  });

  it("scrubs OAuth code and state on the Gmail connect callback", () => {
    const scrubbed = scrubUrl(
      "/api/integrations/google/callback?code=4/0Ab&state=xyz",
    );
    expect(scrubbed).not.toContain("4/0Ab");
    expect(scrubbed).not.toContain("xyz");
  });

  it("scrubs invite tokens like personal links", () => {
    expect(
      scrubUrl("https://tapnshow.vercel.app/invite/Abc_123-xyz?next=1"),
    ).toBe("https://tapnshow.vercel.app/invite/[REDACTED]?next=1");
    expect(scrubUrl("/invite/[token]")).toBe("/invite/[token]");
  });
});
