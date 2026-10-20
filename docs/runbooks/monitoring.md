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

- URL `https://www.tapnshow.tn/api/health`, method GET, interval 1 minute, expect 200.
- Notify: email (the Owner) and Discord `#uptime`.
- It also keeps production active (one database read a minute through `healthcheck()`).
- Created 2026-10-15 as "TapNShow /api/health" (3 failed checks open an uptime issue, 1 success
  resolves it), with the alert "TapNShow: uptime (production)" for opened, reopened and resolved.

### Reading a `dns_error`

Sentry's checker asks for the IPv4 address first, then for IPv6 when that fails, and reports only
the last error (its resolver's default order). Vercel gives the site no IPv6 address, so the
message says "no record found … AAAA" even when the IPv4 lookup is what failed. Look at the
nameservers before the app: a lookup for a made-up name can't come from a cache, so it tests them.

```bash
curl -s "https://dns.google/resolve?name=probe$RANDOM.tapnshow.tn&type=A"   # "Status": 2 = they failed
```

On 2026-10-20 this showed tunet's nameservers failing (domain runbook, DNS); the zone moved to
Vercel DNS the same day.

## Vercel storage (Hobby)

Every retained deployment keeps its function bundles: about 49 MB in Frankfurt, plus the
middleware in 8 regions. The Hobby team includes 10 GB of Functions Storage, counted in GB-months.
On 2026-10-20 it reached 100% after 505 deployments in 16 days (Vercel emailed "Your site is
growing!"); 4 deployments were left that day.

- Retention: 1 day for canceled, errored, pre-production and production (team policy applied to
  every project, 2026-10-20). Vercel still keeps the live deployment and the last 3 production
  ones, so there is always something to roll back to.
- A documentation-only change (`scripts/docs-only.sh`) skips the Vercel build; it shows as
  Canceled and builds no function bundles.
- Check: Vercel → the team → Usage → Deployment Storage → Functions Storage → Projects.

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

## Discord webhooks (one per channel)

Discord → Server Settings → Integrations → Webhooks → New Webhook → pick the channel → Copy
Webhook URL. The URL is a secret: paste it only into the commands below, never into chat or issues.

| Channel | Where the URL goes |
|---|---|
| `#deploys` | `gh secret set DISCORD_DEPLOYS_WEBHOOK` (paste when asked) |
| `#uptime` | `gh secret set DISCORD_UPTIME_WEBHOOK` |
| `#platform` | Vercel `DISCORD_PLATFORM_WEBHOOK`, Production only, sensitive (`vercel env add DISCORD_PLATFORM_WEBHOOK production --sensitive`; set 2026-10-16). Previews and local have none, so test events never post. |
| `#errors` | none: Sentry's own Discord integration |

Back each one up in `.env.local` (commented OTHER SECRETS block; Vercel values also in VERCEL BACKUP).

### `#platform` (the app's platform-events lane, spec §8)

Every platform event (reports, suspensions and lifts, admin changes, the platform email cap, a
failing worker) posts one embed: workspace names, counts and roles, never a person's name or
address. Suspensions and lifts also email the workspace's Owner once, within the platform's daily
email budget. The dispatcher wakes for waiting events every minute; a report also starts the lane
at once. A failed post is retried with a growing delay and given up after
`platform_notify_attempts_max` (5) tries; the action itself is already saved and the admin area's
Log shows it either way. Without the variable, events are marked handled without posting.

## GitHub variables for the keep-alive (public values)

`gh variable set SUPABASE_PROD_URL`, `SUPABASE_PROD_PUBLISHABLE_KEY`, `SUPABASE_PREVIEW_URL`,
`SUPABASE_PREVIEW_PUBLISHABLE_KEY` (the URLs and publishable keys from `.env.local`; both keys are
already in every browser that opens the app).

## Workflows

- `notify.yml`: production deploys (Vercel's GitHub deployments) and CI failures on main → `#deploys`.
- `keep-alive.yml`: 05:17 and 17:17 UTC; `#uptime` on failure and on Monday mornings.
  Run by hand: `gh workflow run keep-alive.yml`.
- `backup.yml`: 03:10 UTC; `#uptime` only on failure. Run by hand: `gh workflow run backup.yml`.
  Restoring: `docs/runbooks/restore.md`.

## Content Security Policy (CSP)

- Every page gets a fresh nonce from `src/proxy.ts`; the policy is built in
  `src/config/security-headers.ts` (`contentSecurityPolicy`).
- Mode: `CSP_HEADER` in `src/config/security-headers.ts`, **enforced since 2026-10-20**.
  - `Content-Security-Policy`: violations are blocked (and reported). This is the mode now.
  - `Content-Security-Policy-Report-Only`: violations are reported, nothing is blocked.
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

### If a page breaks because of the CSP

1. Set `CSP_HEADER` back to `"Content-Security-Policy-Report-Only"` (and its pin in
   `src/config/security-headers.test.ts`), then merge: production stops blocking at the next
   deploy.
2. Read the reports in Sentry (Issues, `event.type:csp`) and fix the cause.
3. Enforce again with the same bar as the first time (below).

### The bar for enforcing

- e2e is clean on every page (the e2e console guard fails on any violation).
- Preview and production have run report-only for at least 3 days with zero reports in Sentry
  (count them per source first, and check Sentry's dropped events for CSP reports).
- A report found restarts the 3 days after its fix is live.

How it went the first time (M9): report-only from 2026-10-15 22:50 UTC. One report on 2026-10-16:
the manifest on a deployment's own URL (behind Vercel's login) was refused; fixed by linking it
with credentials (`src/app/layout.tsx`), live at 19:46 UTC. Checked 2026-10-20 ~10:35 UTC: zero
CSP reports since then on production and preview, and none dropped. Enforced 2026-10-20.

## Firewall rate limit (Vercel WAF, the outer guard)

The database limits (route registry, `private.app_limits`) guard each action; this rule guards the
whole API per IP, before a function runs. Vercel Hobby allows one rate-limit rule (and 3 custom
rules); it can't be written in `vercel.json` (`mitigate` there is challenge or deny only), so it
lives in the Firewall and is managed with the CLI:

| | |
|---|---|
| Name | `API rate limit` |
| Matches | path starts with `/api/`, is not `/api/health`, doesn't start with `/api/internal/`; or path is `/monitoring` |
| Counts | per IP, fixed window of 60 s (counters are per region) |
| Limit | 900 requests, then 429 ("Too many attempts" in the app; Vercel's 429 has no Retry-After) |

Why 900 (measured 2026-10-16 on a local production build): a member opening an invite link and
answering makes 3 requests; an organizer on a meeting page makes 18 a minute (it polls every
10 s). A lecture hall of 100 members on one Wi-Fi, with reloads and changed answers (~5 each),
plus 3 organizers, is about 554 in a minute.

Commands (`vercel firewall …`, project linked):

    vercel firewall rules list --expand        # what is live
    vercel firewall rules disable "API rate limit" --yes && vercel firewall publish --yes   # emergency off
    vercel firewall rules enable "API rate limit" --yes && vercel firewall publish --yes

Checking it: never against production. On a preview deployment (behind Vercel's login, so the
requests need the project's development OIDC token as `x-vercel-trusted-oidc-idp-token`), run
`VERCEL_OIDC_TOKEN=<fresh development token> bun scripts/probe-rate-limit.ts <preview>/api/me 1000`
(the token from `vercel env pull <temporary file> --environment=development`, never `.env.local`,
deleted right after); 429s must appear, and
`/api/health` must never get one. 2026-10-16: `/api/me` × 1000 → 896 answered, 104 × 429;
`/api/health` × 300 → 300 × 200.
