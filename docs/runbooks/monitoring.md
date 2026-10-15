# Monitoring runbook

What watches TapNShow in production and what to do when it speaks (spec §5 Operations). Later M9
tasks add Sentry Logs and alert rules, the uptime monitor, Discord, keep-alive and backups.

## Content Security Policy (CSP)

- Every page gets a fresh nonce from `src/proxy.ts`; the policy is built in
  `src/config/security-headers.ts` (`contentSecurityPolicy`).
- Mode: `CSP_HEADER` in `src/config/security-headers.ts`.
  - `Content-Security-Policy-Report-Only`: violations are reported, nothing is blocked.
  - `Content-Security-Policy`: violations are blocked (and reported).
  - Going back to report-only is that one line, then a deploy.
- Reports go to Sentry's security endpoint for the project (built from `NEXT_PUBLIC_SENTRY_DSN` by
  `sentrySecurityEndpoint`). Chromium uses `report-to` + the `Reporting-Endpoints` header
  (batched, up to about a minute late); Firefox and Safari use `report-uri`.
- Browser events reach Sentry through `/monitoring` on our own origin (the Sentry tunnel), so the
  policy's `connect-src 'self'` holds.
- Zod runs `jitless` in the browser and the service worker (`src/lib/zod-jitless.ts`): its
  `new Function` probe would otherwise be reported on every page.

### Keep browser-extension noise out of the Sentry quota

Extensions inject scripts into pages, and each injection is a CSP report. On the free plan (5,000
events a month) they could crowd out real errors. In Sentry → the project → Settings:

1. **Security & Privacy → Security Headers → Additional ignored sources:**
   `chrome-extension://*`, `moz-extension://*`, `safari-web-extension://*`,
   `safari-extension://*`.
2. **Inbound Filters:** turn on "Filter out errors known to be caused by browser extensions".

Check: send a report whose `blocked-uri` is `chrome-extension://abc` to the security endpoint; it
must not appear in Sentry.

### Before enforcing (M9 launch task)

- e2e is clean on every page (the e2e console guard fails on any violation).
- Preview and production have run report-only for at least 3 days with zero reports in Sentry
  (count them per source first).
