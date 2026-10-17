import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/public-env";
import { publicPages } from "@/lib/seo/sitemap";

/** The public pages at this deployment's address (spec §7.18). */
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPages(publicEnv.NEXT_PUBLIC_APP_URL);
}
