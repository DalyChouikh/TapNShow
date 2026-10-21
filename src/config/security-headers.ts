/** One `headers()` rule of next.config. */
type HeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

/**
 * Pages and routes whose URL carries a secret token (invites, personal links, unsubscribe, report),
 * and the member route that hands out a personal link, send no `Referer` at all, so the token never
 * leaks to other sites or into third-party logs (spec §11).
 * Spec §11 M9.
 */
export const tokenPageHeaders: HeaderRule[] = [
  "/invite/:token*",
  "/r/:token*",
  "/u/:token*",
  "/report/:token*",
  "/api/r/:token*",
  "/api/me/invites/:id/link",
  "/admin/join/:token*",
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

/**
 * The CSP header the app sends. Enforced since 2026-10-20 (spec §11 M9). To go back to report-only,
 * set this back to `"Content-Security-Policy-Report-Only"` (runbook `docs/runbooks/monitoring.md`).
 */
export const CSP_HEADER = "Content-Security-Policy" as const;

/** The Reporting API group `report-to` names (Sentry's documented name). */
export const CSP_REPORT_GROUP = "csp-endpoint";

/**
 * The `Reporting-Endpoints` header value for a report address. `report-to` must name a group this
 * header defines: Chromium honours `report-to` over `report-uri`, so a `report-to` without it drops
 * every report (checked in Chromium 2026-10-15). Firefox and Safari still use `report-uri`.
 */
export function reportingEndpoints(reportUri: string): string {
  return `${CSP_REPORT_GROUP}="${reportUri}"`;
}

/**
 * The page CSP for one request (Next 16 CSP guide): scripts only by this request's nonce, plus what
 * they load (`'strict-dynamic'`: Next's chunks, Vercel Analytics). Inline style attributes stay
 * allowed (components and motion set them). `'unsafe-eval'` only in development (React's dev error
 * stacks use eval). Reports go to Sentry when a DSN is configured.
 */
export function contentSecurityPolicy(input: {
  nonce: string;
  development: boolean;
  reportUri?: string;
}): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${input.nonce}'`,
        "'strict-dynamic'",
        ...(input.development ? ["'unsafe-eval'"] : []),
      ],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  if (input.reportUri) {
    directives.push(
      ["report-uri", [input.reportUri]],
      ["report-to", [CSP_REPORT_GROUP]],
    );
  }
  return directives
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/**
 * HTTPS only, remembered for two years (Vercel's own `max-age`) and for every subdomain (#422):
 * Vercel's default covers only the name that sends it ("Encryption and TLS", which also says a
 * project's own header replaces it). Every subdomain resolves to Vercel, which serves HTTPS only.
 * Never `preload`: hstspreload.org says inclusion can't easily be undone (Owner, 2026-10-21).
 */
export const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains";

/** Headers for every response (spec §11 M9). */
export const staticSecurityHeaders: HeaderRule[] = [
  {
    source: "/:path*",
    headers: [
      { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ],
  },
];

/** Private and token addresses never appear in search results (spec §7.18). */
export const noIndexHeaders: HeaderRule[] = [
  "/w/:path*",
  "/r/:path*",
  "/u/:path*",
  "/report/:path*",
  "/invite/:path*",
  "/admin/:path*",
  "/admin",
  "/api/:path*",
].map((source) => ({
  source,
  headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
}));

/** The service worker is outside the proxy matcher: its own policy, same origin only. */
export const serviceWorkerCsp: HeaderRule = {
  source: "/serwist/:path*",
  headers: [
    {
      key: CSP_HEADER,
      value: "default-src 'self'; script-src 'self'; connect-src 'self'",
    },
  ],
};
