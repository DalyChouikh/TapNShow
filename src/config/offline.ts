/**
 * What the service worker keeps on the device (spec §10 PWA). Every name starts with `tn-`
 * (`CACHE_PREFIX`, `src/lib/device/clear.ts`), so sign-out and account deletion wipe them all.
 */
export const SW_CACHES = {
  pages: "tn-pages",
  invites: "tn-invites",
  static: "tn-static",
} as const;
/** The last-loaded invites stay readable offline this long. */
export const OFFLINE_INVITES_MAX_AGE_SECONDS = 86_400;
/** A cached page or invites list is shown when the network hasn't answered after this long. */
export const SW_NETWORK_TIMEOUT_SECONDS = 4;
/** Member pages served from the cache when offline (spec §7.4). */
export const OFFLINE_PAGES = ["/invites", "/account"] as const;
