import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("robots and sitemap (spec §7.18)", () => {
  it("lists only the public pages", () => {
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).toEqual([
      "/",
      "/privacy",
      "/terms",
    ]);
    const rules = robots().rules;
    expect(rules).toEqual({
      userAgent: "*",
      allow: ["/$", "/privacy", "/terms"],
      disallow: "/",
    });
    expect(robots().sitemap).toBe("http://localhost:3000/sitemap.xml");
  });
});
