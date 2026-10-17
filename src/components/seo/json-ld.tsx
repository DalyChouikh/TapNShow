import { APP_NAME } from "@/config/app";
import type { Json } from "@/lib/json";

/**
 * Structured data for search engines (Next's JSON-LD guide): a data block, never run, so the
 * nonce CSP doesn't apply to it. Every "<" is written as "<", so no value can close the
 * script element.
 */
export function JsonLd({ data }: { data: { [key: string]: Json } }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/**
 * The site's name for search results: `WebSite` structured data on the home page (Google's site
 * names guide). No `WebApplication`: Google's app results require ratings or reviews, which
 * TapNShow doesn't have and won't invent.
 */
export function websiteJsonLd(appUrl: string): { [key: string]: Json } {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: APP_NAME,
    url: new URL("/", appUrl).href,
  };
}
