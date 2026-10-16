import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/public-env";

/** Only the landing and the legal pages are for search engines (spec §7.18). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/privacy", "/terms"],
      disallow: "/",
    },
    sitemap: `${publicEnv.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
  };
}
