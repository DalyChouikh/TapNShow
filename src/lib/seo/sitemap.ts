import type { MetadataRoute } from "next";
import { LEGAL_LINKS } from "@/config/legal";
import { privacyPolicy } from "@/content/legal/privacy";
import { terms } from "@/content/legal/terms";

/**
 * The pages search engines may list (spec §7.18), at `baseUrl`: the sitemap's entries and what
 * IndexNow is told about. The legal pages carry their real last change; the landing has no honest
 * date to give, so it gives none.
 */
export function publicPages(baseUrl: string): MetadataRoute.Sitemap {
  return [
    { url: baseUrl },
    {
      url: `${baseUrl}${LEGAL_LINKS.privacy}`,
      lastModified: privacyPolicy.updated,
    },
    { url: `${baseUrl}${LEGAL_LINKS.terms}`, lastModified: terms.updated },
  ];
}
