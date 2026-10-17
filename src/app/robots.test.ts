import { describe, expect, it } from "vitest";
import { metadata as appMetadata } from "./(app)/layout";
import robots from "./robots";
import sitemap from "./sitemap";
import { privacyPolicy } from "@/content/legal/privacy";
import { terms } from "@/content/legal/terms";

describe("robots and sitemap (spec §7.18)", () => {
  it("lists only the public pages, the legal ones with their last change", () => {
    expect(
      sitemap().map((entry) => [
        new URL(entry.url).pathname,
        entry.lastModified,
      ]),
    ).toEqual([
      ["/", undefined],
      ["/privacy", privacyPolicy.updated],
      ["/terms", terms.updated],
    ]);
    expect(robots().sitemap).toBe("http://localhost:3000/sitemap.xml");
  });

  it("lets crawlers fetch every page and asset, the API and the error tunnel aside", () => {
    // A page blocked in robots.txt can still be listed as a bare address, and blocked CSS, JS
    // and icons stop Google from rendering pages and showing the favicon: app pages say
    // noindex instead (below).
    expect(robots().rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/monitoring"],
    });
  });

  it("keeps every app page out of search results", () => {
    expect(appMetadata.robots).toEqual({ index: false, follow: false });
  });
});
