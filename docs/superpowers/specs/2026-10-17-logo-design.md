# TapNShow logo: design

Date: 2026-10-17. Owner-approved visuals; this document is the builder's brief.
Parent spec: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§7.18 search and share card,
§10 PWA icons, §15 open items).

## 1. Why now

The icon shipped in M8 ("icon B", the tilted green tile with a check) was a stand-in. The logo has
to be final before the Google verification submission: Google shows an external production app's
logo only after verification, and uploading a new logo sends the app through verification again
(Google Cloud Help, "Manage OAuth App Branding", answer 15549049, read 2026-10-17).

## 2. What the Owner chose

The Owner's brief: simple and easy to understand at a glance; nothing people have to decode.

| Round | Shown | Owner's answer |
|---|---|---|
| 1 | Three directions: a raised hand, a "tn" monogram, the current tile refined | "complex and unclear" |
| 2 | Six "one shape, one symbol" icons: pin, bubble, round button, T, calendar, ticket (each with a check) | **5, calendar with a check** |
| 3 | Six variations of the calendar | **C (lilac top) with a tilt** |
| 4 | The final icon in every place it lives (home screen, Android masks, tab, notification, header, link preview, Google Cloud) | "yes" |

The mockups live in `.superpowers/brainstorm/` (git-ignored).

### The mark (512 × 512 grid, before any variant's scale)

- **Page:** rounded rectangle `x 104, y 120, w 304, h 284, rx 56`, filled white (`palette.light.surface`).
- **Lilac top:** the page's top part, from its top edge down to `y 200`, filled `palette.light.primary`.
- **Top line:** `M104 200H408`, ink, width 22.
- **Rings:** two ink pills `x 170` and `x 302`, `y 84, w 40, h 84, rx 20`, drawn over the page edge.
- **Check:** `M196 300l40 40 80-84`, ink, width 40, round caps and joins.
- **Outline:** ink, 22 wide, outside the page (the union look of the app's stickers: no inner lines).
- **Hard shadow:** the outlined page again in ink, 20 lower, behind everything.
- **Tilt:** the whole drawing turns −8° around the centre `(256, 256)`, like the app's stickers.
- **Tile:** `palette.light.success` (mint).
- **Colours:** only `palette.light` tokens (ink, surface, primary, success). No new tokens.

The wordmark doesn't change: "TapNShow" in Archivo Black next to the mark.

## 3. Variants

Everything is drawn from one function, `appIconSvg(variant)` in `src/lib/brand/app-icon.ts`, as
today. Every PNG, the favicon, the header mark and the link preview come from it.

| Variant | Canvas | Drawing scale | Used by |
|---|---|---|---|
| `full` | mint, rounded corners `rx 112`, transparent outside | 0.86 | `/favicon.ico` (16, 32, 48), `icon-192.png`, `icon-512.png` (manifest `any`), `BrandMark`, the link preview |
| `square` (new) | mint, full bleed | 0.86 | `apple-touch-icon.png` (180; iOS rounds it), `logo-120.png` (new, the Google Cloud upload) |
| `maskable` | mint, full bleed | 0.72 | `maskable-512.png` (manifest `maskable`) |
| `badge` | transparent, one colour `#FFFFFF` | 1 | `badge-96.png` (notification badge) |

- **`square` for Apple:** iOS rounds the icon itself and has no Android-style safe zone, so the
  iPhone icon matches the approved home-screen look. Today's Apple icon uses `maskable`.
- **`badge`** is a line drawing: the page outline (34), the top line (30), the rings (48 wide,
  92 tall) and the check (46), all white, tilted −8°. The W3C manifest spec keeps only the alpha of a
  monochrome icon ("Image Resource", purpose `monochrome`, read 2026-10-17).
- **`logo-120.png`** is a 120 × 120 PNG. Google asks for a square image, 120 × 120 px for the best
  display, at most 1 MB, in JPG, PNG or BMP (Google Cloud Help 15549049). The Owner downloads it from
  `https://www.tapnshow.tn/icons/logo-120.png`. It is a static file like the others: nothing to
  protect, and the runbook can point at it.

## 4. The link preview

`src/app/opengraph-image.tsx`, 1200 × 630, laid out as in the approved mockup:

- the app background (`palette.light.background`);
- the `full` icon (drawn from `appIconSvg`, so it can't drift) next to "TapNShow";
- below it, `SHARE_IMAGE_LINE` ("Know who's coming before the meeting starts.");
- both texts in **Archivo Black**, the app's display face. ImageResponse can't use `next/font` and
  doesn't read woff2, so the font comes in as a TTF from `src/assets/fonts/` with its OFL licence
  next to it, like `google-sans-500-latin.woff2` today.

**A new address when the picture changes.** Meta caches a shared link's image by its URL and advises a
different image URL when the image changes. It also says not to delete the old image, or older shares
show a blank (Meta for Developers, "Images in Link Shares", "Change link" and "Link Sharing FAQ",
read 2026-10-17). So `SHARE_IMAGE.url` becomes `/opengraph-image?v=<hash>`. The hash is a short
digest of what the picture shows: the `full` icon SVG, `APP_NAME` and `SHARE_IMAGE_LINE`. The route
ignores the query, so `/opengraph-image` keeps working for links shared before the change.

## 5. Edge cases, each with its check

| # | Case | How it's handled | Pinned by |
|---|---|---|---|
| 1 | Android cuts the maskable icon to a circle or squircle | The drawing's farthest point from the centre, times 0.72, stays inside the safe circle of radius 40% of the icon (W3C manifest, "icon masks"). Turning around the centre doesn't change distances, so the tilt is safe. | unit test on the geometry constants |
| 2 | A variant spills past its canvas | Same farthest-point check for `full` and `square` at 0.86. | unit test |
| 3 | The badge must be one colour, alpha only | Only `#FFFFFF`, no background rectangle. | unit test (kept) |
| 4 | Colours drift from the theme | Every colour in `full`, `square` and `maskable` is a `palette.light` value. | unit test |
| 5 | 16 px tab icon | Looked at 16, 32 and 48 px in light and dark tab bars (round 4). Re-checked on the real build. | screenshots |
| 6 | Browsers or the CDN keep the old files | `/icons/*`, `/favicon.ico` and `/opengraph-image` are served `public, max-age=0, must-revalidate` with an ETag (curl on production, 2026-10-17), so the new deploy is picked up. The service worker precaches only `/~offline` and caches only `/_next/static/` (`src/app/serwist/[path]/route.ts`, `src/app/sw.ts`), so it holds no icon. | read of the code; curl after deploy |
| 7 | Already-installed apps | Android Chrome rechecks the manifest at launch if 24 hours have passed. It updates the installed app when all its windows are closed, the phone is charging and on Wi-Fi, usually within minutes. Desktop Chrome doesn't update an installed app's icons yet: reinstall. (web.dev, "How Chrome handles updates to the web app manifest", updated 2024-09-19.) iPhone: no Apple statement found, so the Owner checks their own iPhone after the deploy and re-adds it if needed. | Owner's check, recorded |
| 8 | Push notifications | Same URLs (`/icons/icon-192.png`, `/icons/badge-96.png`); the next notification shows the new images. | unchanged test |
| 9 | Google Search shows the old favicon | Google recrawls the home page in "several days to several weeks". The URL Inspection tool can request indexing of the home page, and the favicon URL must stay stable (Google Search Central, "Define a favicon to show in search results", updated 2026-08-28). `/favicon.ico` keeps its URL. | Owner requests indexing after deploy |
| 10 | Old link previews | New `?v=` URL for new shares. The old URL still answers. A re-scrape in Meta's Sharing Debugger and LinkedIn's Post Inspector warms the cache. | e2e on the `og:image` value; manual re-scrape |
| 11 | Logo upload and Google verification | Upload `logo-120.png` on the Branding page as the first step of the verification milestone, not before. A new logo starts verification again (Google Cloud Help 15549049). | runbook step |
| 12 | Dark mode | The mark carries its own mint tile, so it stands out on dark surfaces. | screenshots at 320 dark |
| 13 | Narrow header (below 360 px) | The wordmark already yields to the buttons; the mark stays. | existing behaviour, screenshots at 320 |
| 14 | Emails | They show a text sticker, not the logo image (`src/emails/email-layout.tsx`). Nothing changes. | — |

## 6. Goals, non-goals, anti-goals

- **Goals:** the approved mark everywhere the app shows its icon, from one source; the link preview
  with the mark; the Google Cloud file ready to upload.
- **Non-goals:** no wordmark redesign, no theme or token change, no logo in emails, no animated logo
  (the promo video handles motion).
- **Anti-goals:** a second drawing of the icon anywhere (a PNG or SVG committed by hand); a colour
  outside the tokens; a favicon URL that changes.

## 7. Docs to update with the change

- Parent spec §10 PWA: "icon B (owner 2026-10-14)" becomes the calendar mark (this document).
  §7.18: the share card carries the mark and a versioned URL. §15: the logo is done; the upload goes
  with the verification milestone.
- `docs/runbooks/google-verification.md`: the Branding step names `https://www.tapnshow.tn/icons/logo-120.png`.
- `docs/runbooks/domain-and-search.md`: after a logo change, request indexing of the home page in
  URL Inspection and re-scrape the link preview (Meta Sharing Debugger, LinkedIn Post Inspector).

## 8. Left to the builder

- The exact layout numbers of the link preview, within the approved mockup.
- How the geometry constants are shared between the drawing and its tests.
- How the font file is read at build time (the Next 16 `ImageResponse` docs in
  `node_modules/next/dist/docs/`).
