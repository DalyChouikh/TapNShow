import { describe, expect, it } from "vitest";
import { legacyHostRedirects, PRODUCTION_URL } from "./site";

describe("the site's address (Owner, 2026-10-17)", () => {
  it("is www.tapnshow.tn in production", () => {
    expect(PRODUCTION_URL).toBe("https://www.tapnshow.tn");
  });

  it("sends the old address's pages to the app address for good, path and query kept", () => {
    expect(legacyHostRedirects("https://www.tapnshow.tn")).toEqual([
      {
        source: "/:path((?!api/|serwist/).*)",
        has: [{ type: "host", value: "^tapnshow\\.vercel\\.app$" }],
        destination: "https://www.tapnshow.tn/:path",
        permanent: true,
      },
    ]);
  });

  it("adds no rule while the app address is still the old host (it would loop)", () => {
    expect(legacyHostRedirects("https://tapnshow.vercel.app")).toEqual([]);
  });

  it("matches the old host only, never a host that merely contains it", () => {
    const [rule] = legacyHostRedirects("https://www.tapnshow.tn");
    const host = new RegExp(rule.has?.[0]?.value ?? "");
    expect(host.test("tapnshow.vercel.app")).toBe(true);
    expect(host.test("tapnshowxvercelxapp")).toBe(false);
    expect(host.test("tapnshow.vercel.app.example.com")).toBe(false);
    expect(host.test("preview-tapnshow.vercel.app")).toBe(false);
  });
});
