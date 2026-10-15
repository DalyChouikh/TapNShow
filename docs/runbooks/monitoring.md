# Monitoring runbook (spec §5 Operations)

Sentry org `dev-daly`, region `https://de.sentry.io`. Discord server: the Owner's, with channels
`#errors`, `#uptime`, `#platform`, `#deploys`. Every Sentry alert notifies **email and Discord**.

## Sentry alert rules (Alerts → Create Alert → Issues)

| Rule | When | Then |
|---|---|---|
| New issue | A new issue is created | Email: the Owner; Discord: `#errors` |
| Regression | The issue changes state from resolved to unresolved | Email: the Owner; Discord: `#errors` |
| Error spike | Number of events in an issue is more than 50 in 1 hour | Email: the Owner; Discord: `#errors` |

Environment: `production` for all three (a second copy with `preview` is optional). Created
2026-10-15 with the Sentry tools as "TapNShow: new issue / regression / error spike (production)";
Sentry's two default rules ("high priority issues", "pull requests are ready") were left as they are.

## Uptime monitor (Alerts → Create Alert → Uptime)

- URL `https://tapnshow.vercel.app/api/health`, method GET, interval 1 minute, expect 200.
- Notify: email (the Owner) and Discord `#uptime`.
- It also keeps production active (one database read a minute through `healthcheck()`).
- Created 2026-10-15 as "TapNShow /api/health" (3 failed checks open an uptime issue, 1 success
  resolves it), with the alert "TapNShow: uptime (production)" for opened, reopened and resolved.

## After 2026-10-17 (end of the Business trial)

The free Developer plan lists "alerts via email"; third-party integrations are a Team feature.
On 2026-10-18, open each rule (Alerts → the rule → Edit) and press **Send Test Notification**, then
check the email and `#errors` / `#uptime`. If nothing arrives in Discord, email keeps working;
record it in spec §15.

## Logs

Sentry → Explore → Logs, environment `production`. Server lines at `info` and above are sent
(`src/lib/observability/sentry-log-sink.ts`) only after the logger's scrubbing stream, and
`beforeSendLog` scrubs them again (spec §11).

## Source maps

Readable production stack traces need `SENTRY_AUTH_TOKEN` in Vercel (Production and Preview); the
build uploads source maps with it. Without it the build skips the upload and says nothing.

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
