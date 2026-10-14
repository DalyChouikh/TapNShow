/** One `headers()` rule of next.config. */
type HeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

/**
 * Pages and routes whose URL carries a secret token (invites, personal links, unsubscribe, report),
 * and the member route that hands out a personal link, send no `Referer` at all, so the token never
 * leaks to other sites or into third-party logs (spec §11).
 * The full header audit is M9.
 */
export const tokenPageHeaders: HeaderRule[] = [
  "/invite/:token*",
  "/r/:token*",
  "/u/:token*",
  "/report/:token*",
  "/api/r/:token*",
  "/api/me/invites/:id/link",
].map((source) => ({
  source,
  headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
}));

/**
 * The service worker (spec §10 PWA): never cached, so an update reaches phones at once, and allowed
 * to control the whole app although it is served from `/serwist/`.
 */
export const serviceWorkerHeaders: HeaderRule[] = [
  {
    source: "/serwist/:path*",
    headers: [
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
    ],
  },
];
