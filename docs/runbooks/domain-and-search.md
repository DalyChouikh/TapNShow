# Domain and search engines runbook

The main address is **https://www.tapnshow.tn** (Owner, 2026-10-17; spec §7.18). `tapnshow.tn`
redirects to it in Vercel; `tapnshow.vercel.app`'s pages redirect to it from the app
(`legacyHostRedirects`, `src/config/site.ts`), while its `/api/` and `/serwist/` keep answering.

## DNS (registrar: tunet.tn, the Ooredoo business panel; zone: Vercel DNS)

The .tn registry delegates `tapnshow.tn` to `ns1.vercel-dns.com` and `ns2.vercel-dns.com` since
2026-10-20, 16:14 UTC. Before that the zone was on tunet's nameservers (`dns1/dns2.tunet.tn`).
From 12:08 UTC that day they failed most lookups from outside Tunisia, for tunet.tn's own domain
too, and the uptime monitor reported `dns_error` (monitoring runbook, "Reading a `dns_error`").

| Name | Type | Value | Why |
|---|---|---|---|
| `tapnshow.tn` | ALIAS | Vercel's default, created by itself | the apex (redirects to `www`) |
| `*` | ALIAS | Vercel's default, created by itself | `www` and any other subdomain |
| `tapnshow.tn` | CAA | Vercel's defaults (Let's Encrypt, Sectigo, Google Trust Services) | who may issue certificates |
| `tapnshow.tn` | TXT | `google-site-verification=…` (Search Console gives it), added by hand | the Search Console Domain property, which covers `www` and the apex |

No MX: the domain has no email. Vercel issues and renews the certificates (Let's Encrypt) by itself.

- **Records:** Vercel → the team → Domains → `tapnshow.tn`, or `vercel dns ls tapnshow.tn` and
  `vercel dns add tapnshow.tn <name> <type> <value>`.
- **Nameservers:** Ooredoo business panel → Mes domaines → `tapnshow.tn` → **Serveurs DNS** (the
  registry's entry; it took effect within minutes). "Gestion DNS" there edits the records on
  tunet's servers, which nothing reads any more. Never pick "Utiliser les serveurs de nom par
  défaut": it hands the domain back to tunet.
- tunet's old records stay until 2026-10-22: resolvers may remember the old nameservers for a day
  (the registry's TTL). Deleting them after that is optional.

```bash
dig @ns1.ati.tn tapnshow.tn NS +norec | grep NS   # the registry: ns1/ns2.vercel-dns.com
dig @ns1.vercel-dns.com www.tapnshow.tn A +short   # Vercel's answer
vercel domains inspect tapnshow.tn                 # Intended and Current nameservers match
curl -sI https://tapnshow.tn/                      # 308 to www
```

## Moving the app address (done once, in this order)

1. **Google** (in this order; Google: "all domains used in your project … must be pre-registered"
   as authorized domains):
   - Search Console → Add property → **Domain** `tapnshow.tn` → add the TXT record it gives at the
     registrar → Verify.
   - Google Auth Platform → Branding → Authorized domains → add `tapnshow.tn`.
   - APIs & Services → Credentials → `tapnshow-web` → add the redirect URIs
     `https://www.tapnshow.tn/api/auth/google/callback` and
     `https://www.tapnshow.tn/api/integrations/google/callback`. Keep the `tapnshow.vercel.app`
     ones for a year. Without them, "Continue with Google" and "Connect Gmail" fail once step 3 is
     live.
2. Merge the code (redirect rules, robots, favicon, metadata). The old-address redirect is off
   while the app address is still `tapnshow.vercel.app` (it would loop), so the merge moves nobody;
   only the emails' privacy link already points at `www.tapnshow.tn`, which serves the app.
3. Vercel → Production and Preview: `NEXT_PUBLIC_APP_URL=https://www.tapnshow.tn`, then redeploy
   production. Mirror the value in `.env.local`'s VERCEL BACKUP block.
4. `bun run auth:config prod` from a clean main checkout (Supabase `site_url` and the sign-in email
   template's privacy link).
5. Sentry uptime monitor: `https://www.tapnshow.tn/api/health`. Sentry project → Settings →
   Security & Privacy → **Allowed Domains**: `*`, or add `www.tapnshow.tn`.
6. Check: `curl -sI https://tapnshow.vercel.app/privacy` (308 to `https://www.tapnshow.tn/privacy`),
   `curl -s https://tapnshow.vercel.app/api/health` (200), sign in with Google and with a code,
   Connect Gmail on a test workspace, a test meeting's links.
7. People sign in again once (cookies belong to an address). A phone that had reminders on at the
   old address gets them from that subscription until it is removed; remove the old address's
   subscriptions once (asked first), and the phone offers reminders again at the new address.

## Search engines

- **Google:** Search Console → Domain property `tapnshow.tn` → Sitemaps → submit
  `https://www.tapnshow.tn/sitemap.xml`. The old `https://tapnshow.vercel.app/` property stays; its
  redirects tell Google where everything went. Google's Change of Address tool needs a
  domain-level property for the old site, which needs DNS on `tapnshow.vercel.app` (Vercel's), so
  it isn't available; the permanent redirects are the move.
- **Bing:** Bing Webmaster Tools → My Sites → **Import** from Search Console (Bing rechecks
  ownership through it). DuckDuckGo's links come largely from Bing.
- **IndexNow** (Bing, Yandex, Seznam, Naver, Yep, Internet Archive, Amazon): after a deploy that
  changes the landing or a legal page, run `bun scripts/indexnow.ts` (prints how many URLs were
  accepted). Don't run it for deploys that leave those pages unchanged: IndexNow asks for changed
  URLs only. The key is public by design (`/<INDEXNOW_KEY>.txt`).
- **Keep the redirects** for at least a year (Google's site-move guide; longer is better), and
  keep `tapnshow.tn` registered.

## After a logo or link-preview change

- **Google:** Search Console → URL Inspection → `https://www.tapnshow.tn/` → **Request indexing**.
  Google shows a new favicon after it recrawls the home page, which takes "several days to several
  weeks" (Google Search Central, favicon guide). `/favicon.ico` keeps its address on purpose: the
  guide asks for a stable favicon URL.
- **Link previews:** the image's address changes by itself (`?v=`, `src/lib/seo/share-image-url.ts`).
  Warm the caches by re-scraping `https://www.tapnshow.tn/` in Meta's Sharing Debugger
  (developers.facebook.com/tools/debug) and LinkedIn's Post Inspector (linkedin.com/post-inspector).
  Links shared before show the new picture once Meta refreshes them (it re-scrapes link data about
  every 30 days), because the old bare address now serves the new picture too.
- **IndexNow:** only if a page's content changed too (see above).

## Checks (any time)

```bash
curl -s https://www.tapnshow.tn/robots.txt
curl -s https://www.tapnshow.tn/sitemap.xml
curl -sI https://www.tapnshow.tn/favicon.ico      # 200 image/x-icon
curl -sI https://tapnshow.vercel.app/terms        # 308 to www.tapnshow.tn/terms
```

Rich Results Test (`https://search.google.com/test/rich-results`) on the home page shows the
`WebSite` item.
