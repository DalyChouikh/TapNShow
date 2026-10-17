# Domain and search engines runbook

The main address is **https://www.tapnshow.tn** (Owner, 2026-10-17; spec §7.18). `tapnshow.tn`
redirects to it in Vercel; `tapnshow.vercel.app`'s pages redirect to it from the app
(`legacyHostRedirects`, `src/config/site.ts`), while its `/api/` and `/serwist/` keep answering.

## DNS (registrar: tunet.tn; Vercel doesn't host the zone)

| Name | Type | Value | Why |
|---|---|---|---|
| `tapnshow.tn` | A | `216.198.79.1` | Vercel's address for the apex (the value Vercel's domain card gave) |
| `www.tapnshow.tn` | CNAME | the `*.vercel-dns-017.com` target Vercel's domain card gave | the main address |
| `tapnshow.tn` | TXT | `google-site-verification=…` (Search Console gives it) | the Search Console Domain property, which covers `www` and the apex |

Vercel issues and renews the certificates (Let's Encrypt) by itself. Check with
`vercel domains inspect tapnshow.tn` and `curl -sI https://tapnshow.tn/` (expect 308 to `www`).

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
