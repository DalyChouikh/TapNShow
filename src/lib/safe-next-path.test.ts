import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("keeps same-site paths with query and hash", () => {
    expect(safeNextPath("/w/club-ab12/settings?tab=people#invites")).toBe(
      "/w/club-ab12/settings?tab=people#invites",
    );
    expect(safeNextPath("/invite/abcDEF_123")).toBe("/invite/abcDEF_123");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example/w",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/..//evil.example",
    "/.//evil.example",
    "/x/../..//evil.example/w",
    "/%2e%2e//evil.example",
    "w/club",
    "",
    null,
    undefined,
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("never returns something that leaves the site", () => {
    const result = safeNextPath("/%2F%2Fevil.example");
    expect(result?.startsWith("/")).toBe(true);
    expect(result?.startsWith("//")).toBe(false);
  });
});
