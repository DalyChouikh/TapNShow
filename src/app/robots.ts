import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/public-env";

/**
 * Crawlers may fetch everything but the API and the error tunnel (spec §7.18). Which pages appear
 * in search is decided by `noindex` (every app page, `(app)/layout.tsx`), not here: a page blocked
 * in robots.txt can still be listed as a bare address, and blocked CSS, JS and icons stop Google
 * from rendering pages and showing the favicon.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/monitoring"] },
    sitemap: `${publicEnv.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
  };
}
