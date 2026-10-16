import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/public-env";
import { LEGAL_LINKS } from "@/config/legal";

/** The three public pages (spec §7.18). */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", LEGAL_LINKS.privacy, LEGAL_LINKS.terms].map((path) => ({
    url: `${publicEnv.NEXT_PUBLIC_APP_URL}${path === "/" ? "" : path}`,
  }));
}
