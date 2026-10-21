import type { NextConfig } from "next";

/**
 * Production's public address (Owner, 2026-10-17: `www.tapnshow.tn` is the main address; the apex
 * redirects to it, from the app since #422: `apexRedirects`). Links that must outlive a preview use it (the emails' privacy link,
 * Supabase Auth's site URL). A deployment's own address is `NEXT_PUBLIC_APP_URL`.
 */
export const PRODUCTION_URL = "https://www.tapnshow.tn";

/**
 * The IndexNow key (indexnow.org): public by design, served as `/<key>.txt` from `public/` so the
 * engines can check that this site sent the URLs (pinned by a test).
 */
export const INDEXNOW_KEY = "a0c6a3a93a664b059e6d58a115b5d204";

/** Hosts production answered on before; their pages move permanently to the app address. */
const LEGACY_HOSTS = ["tapnshow.vercel.app"] as const;

/**
 * Paths a legacy host keeps answering itself: `/api/` (links and one-click unsubscribe POSTs in
 * emails already sent must not depend on a mail client following a redirect) and `/serwist/` (a
 * phone's service worker checks its script there, and a script behind a redirect is refused).
 */
const LEGACY_HOST_KEEPS = ["api/", "serwist/"] as const;

type Redirect = Awaited<
  ReturnType<NonNullable<NextConfig["redirects"]>>
>[number];

/** `value` as a regular expression that matches exactly that text. */
function exactly(value: string): string {
  return `^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

/**
 * Permanent (308) redirects from each legacy host's pages to `appUrl`, path and query kept
 * (Google's site-move guide: permanent server-side redirects, kept at least a year). None for a
 * host that is still the app address: it would redirect to itself.
 */
export function legacyHostRedirects(appUrl: string): Redirect[] {
  const target = new URL(appUrl);
  return LEGACY_HOSTS.filter((host) => host !== target.host).map((host) => ({
    source: `/:path((?!${LEGACY_HOST_KEEPS.join("|")}).*)`,
    has: [{ type: "host", value: exactly(host) }],
    destination: `${target.origin}/:path`,
    permanent: true,
  }));
}

const WWW = "www.";

/**
 * A permanent (308) redirect from the apex to a `www.` app address, every path and the query kept
 * (#422). Made by the app rather than Vercel's domain settings, so it carries the app's headers:
 * HSTS with `includeSubDomains` only covers the subdomains when the apex sends it, and Vercel's
 * domain redirect sends its own default (measured 2026-10-21: the app's redirects carry the app's
 * headers, the domain redirect doesn't). None when the app address isn't a `www.` address.
 */
export function apexRedirects(appUrl: string): Redirect[] {
  const target = new URL(appUrl);
  if (!target.host.startsWith(WWW)) {
    return [];
  }
  return [
    {
      source: "/:path*",
      has: [{ type: "host", value: exactly(target.host.slice(WWW.length)) }],
      destination: `${target.origin}/:path*`,
      permanent: true,
    },
  ];
}
