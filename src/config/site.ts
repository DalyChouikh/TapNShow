import type { NextConfig } from "next";

/**
 * Production's public address (Owner, 2026-10-17: `www.tapnshow.tn` is the main address; the apex
 * redirects to it in Vercel). Links that must outlive a preview use it (the emails' privacy link,
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
