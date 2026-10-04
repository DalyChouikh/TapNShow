# Meetings Confirmation Platform — Design Spec

- **Date:** 2026-10-04
- **Author:** DalyChouikh (with Claude)
- **Status:** Draft — awaiting review
- **Origin:** GDG on Campus ISSAT Sousse; built as a general-purpose, public, free tool

---

## 1. Problem & Goals

### Problem
Groups (university clubs first, but any team or person) agree on meeting times in busy chat threads (e.g. Messenger). Members who don't check the thread miss the confirmed time and arrive late or not at all. Absence/lateness justifications are collected through a separate Google Form and land in a sheet the management committee reviews later.

### Goals
1. A member who never opens the chat thread still receives the meeting by email and can put it in their calendar in one tap.
2. Members answer **Attending / Late / Absent** (or simpler modes) from a personal link, with reasons where the group requires them.
3. Organizers and their committee see who is coming, who is late and why, without chasing anyone — in an in-app dashboard and optionally a synced Google Sheet.
4. Usable by any group or individual, not only GDG ISSAT Sousse.
5. Everything is free to run.

### Success criteria
- An organizer can go from "time confirmed in chat" to "invites sent" in under 2 minutes on a phone.
- A member can respond in one tap (Attending) or under 30 seconds (Late/Absent with reason).
- Responses appear in the dashboard immediately and in the Google Sheet within a few minutes.
- No member is ever emailed twice for the same invite/update.

### Non-goals (v1)
- Recurring meetings (a "Duplicate meeting" action covers the need).
- File attachments (links in the agenda instead).
- A general form builder.
- Voting on the meeting time (stays in the group's chat).
- Paid plans, ads, or any paid infrastructure.

---

## 2. Hard Constraints

| Constraint | Consequence |
|---|---|
| **Free only** — nothing paid, ever (incl. domain renewals) | Vercel Hobby, Supabase Free, Gmail-based sending, no custom domain |
| **Vercel Hobby is non-commercial only** | No payments or ads; donations allowed |
| **Vercel Hobby cron: once/day, ±59 min** | Minute-level scheduling must come from Supabase Cron (spike S1) or an alternative |
| **Supabase Free pauses after 1 week of inactivity**; 500 MB DB; 50k MAU; 2 projects | Acceptable; note pause risk during idle development |
| **No Server Actions; all reads & writes via API route handlers** | Client shells + TanStack Query; Zod schemas shared; explicit CSRF checks |
| **No emojis** in UI, mockups, emails, or notifications | Phosphor icons in "sticker" tiles |
| **Repo rules** (`.agents/01-core-rules.md`) | bun, strict types (no `any`/`unknown`), date-fns, JSDoc on public APIs, unit tests for all new code, Playwright verification of UI, SQL only in dedicated query files, no hardcoded values, logger instead of `console.log` |

---

## 3. Users & Roles

| Actor | Account | Capabilities |
|---|---|---|
| **Admin** (e.g. club lead) | Required | Everything in a workspace: meetings, lists, settings, integrations, roles |
| **Viewer** (e.g. Team Management committee) | Required | Read-only: meetings, responses, per-member history, exports, Sheet link |
| **Member (no account)** | None | Responds through a personal link from the email |
| **Member (with account)** | Optional | Sees upcoming invites across all workspaces, changes answers, enables push notifications, exports/deletes their data |
| **Platform** | — | Sends system emails (sign-in codes, workspace invites) from a platform Gmail |

A user can be Admin/Viewer in several workspaces and a member of others with the same account.

---

## 4. Product Decisions (summary)

| Topic | Decision |
|---|---|
| Calendar delivery | **Layer A (v1):** email with `.ics` + "Add to Google Calendar" link — no OAuth. **Layer B (later):** members with accounts connect Google Calendar → auto-insert on Attend. **Layer C (backlog, not committed):** native Google Calendar event created by the organizer |
| Sign-in | "Continue with Google" (basic scopes) + email one-time code |
| Tenancy | Workspaces with roles Admin / Viewer; open sign-up, **no approval step** |
| Audience | **Multiple named lists** per workspace; one contact per normalized email; recipients deduplicated across lists and extra emails |
| Member list editing | Spreadsheet-like grid; import `.csv`/`.xlsx`, paste from Sheets/Excel, or type; columns Full name, Email, Lists; header mapping; preview of new/updated/duplicate/invalid rows before saving |
| Response modes (per meeting, workspace default) | `announcement` (no responses) · `rsvp` (Going / Not going, optional reason) · `attendance` (Going / Late / Absent — configurable delay options, reason required toggle, comment toggle, footer note) |
| Response edits | Allowed until meeting start; full history kept; read-only after start |
| Meeting fields | Title, date/time, duration, timezone, location text and/or meeting URL (in-person/online/hybrid), Markdown agenda, optional response deadline |
| Edits after sending | Smart updates: date/time change → update email + "needs reconfirmation"; text/location change → update email, answers kept; cancel → cancellation email + `.ics` cancel |
| Reminders | Configurable: non-responders X h before deadline; attending/late X h before meeting. Email to all; Web Push for account holders with the PWA |
| Responses storage | Supabase is the source of truth; in-app dashboard + CSV/Excel export always; Google Sheets sync optional per workspace (later milestone) |
| Sheet layout | One spreadsheet per workspace, one `Responses` tab, one row per response, updated in place |
| Sending | Invites sent **from the organizer's connected Gmail** (`gmail.send`); **platform Gmail SMTP fallback** for organizers who don't connect, with strict caps; platform Gmail also sends system emails |
| Language | English at launch; all strings and email templates through next-intl from day one |
| Privacy | Admins + Viewers of the workspace see reasons; members never see each other; account deletion rule in §11 |
| Visual style | **Soft Neobrutalism** — thick outlines, rounded corners, "pressable" drop shadows, pastels; light + dark following system |
| Motion | **Expressive** — springy, staggered entrances, tilt-on-hover, drop-in chips, CONFIRMED stamp + shake + confetti; reduced-motion users get a snappy fallback |
| Icons | **Phosphor Bold** inside outlined pastel "sticker" tiles |
| Navigation | **Hub + center "+"** — Home (next meeting live counts, "needs attention"), Meetings, [+ New], Lists, Settings |
| Architecture | Next.js monolith + Postgres outbox queue drained by a per-minute dispatcher |

---

## 5. Architecture

```
            ┌──────────────── Vercel (Hobby) ─────────────────┐
 Browser ──►│ Next.js App Router                              │
 (PWA)      │  ├─ client pages (TanStack Query)               │
            │  ├─ /api/**  route handlers (all reads/writes)  │
            │  │    └─ query modules (SQL lives here only)     │
            │  └─ /api/internal/dispatch  (secret-protected)  │
            └───────────────┬─────────────────▲───────────────┘
                            │                 │ HTTP every minute
                            ▼                 │ (Supabase Cron + pg_net)
            ┌──────────── Supabase (Free) ────┴───────────────┐
            │ Postgres + RLS · Auth · Cron                    │
            │ outbox_jobs ← enqueued by API routes            │
            └─────────────────────────────────────────────────┘
 Dispatcher ──► EmailSender (GmailApiSender | FallbackSmtpSender)
            ──► Google Sheets API (drive.file)
            ──► Web Push (VAPID)
```

- **Single TypeScript codebase**, run with bun locally, deployed to Vercel on Node.js.
- **All data access via API routes.** Pages are client components; TanStack Query handles caching, optimistic updates, and refetch after mutations.
- **Outbox pattern** for every side effect (emails, reminders, Sheets rows, push).
- **Fallback scheduler** if Supabase Cron can't run every minute on Free: a scheduled GitHub Actions workflow calling the dispatcher (to be verified in S1).

---

## 6. Data Model

All tables have RLS enabled. Timestamps are `timestamptz`. Emails are stored normalized (trimmed, lower-cased).

### Organizers & workspaces
- **`profiles`** — `user_id` (PK, → `auth.users`), `display_name`, `avatar_url`, `locale`, timestamps.
- **`workspaces`** — `id`, `name`, `slug` (unique), `timezone`, `locale`, default meeting settings (`default_response_mode`, `default_delay_options`, `default_reason_required`, `default_comments_enabled`, `default_footer_note`, `default_reminder_*`), `fallback_daily_cap`, `sender_connection_id` (nullable → `google_connections`), timestamps.
- **`workspace_roles`** — (`workspace_id`, `user_id`) PK, `role` (`admin` | `viewer`).
- **`workspace_invites`** — `id`, `workspace_id`, `email`, `role`, `token_hash`, `expires_at`, `accepted_at`.

### People & lists
- **`contacts`** — `id`, `workspace_id`, `email` (unique per workspace), `full_name`, `user_id` (nullable link once the person has an account with this verified email), `unsubscribed_at`, timestamps.
- **`lists`** — `id`, `workspace_id`, `name` (unique per workspace).
- **`list_contacts`** — (`list_id`, `contact_id`) PK.

### Meetings
- **`meetings`** — `id`, `workspace_id`, `title`, `agenda_md`, `starts_at`, `duration_minutes`, `timezone`, `location_text`, `meeting_url`, `response_mode` (`announcement` | `rsvp` | `attendance`), `response_deadline`, `delay_options` (array), `reason_required`, `comments_enabled`, `footer_note`, reminder settings, `status` (`draft` | `scheduled` | `cancelled`), `ics_uid`, `ics_sequence`, `created_by`, timestamps.
- **`meeting_audience`** — (`meeting_id`, `list_id`) — which lists were targeted (for display).
- **`meeting_invitees`** — `id`, `meeting_id`, `contact_id` (unique per meeting), `token_hash`, `invited_at`. Snapshot taken at send time; later additions invite only the new contacts.
- **`responses`** — `id`, `invitee_id` (unique), `status` (`attending` | `late` | `absent` | `not_attending`), `delay_option`, `reason`, `comment`, `needs_reconfirmation`, `responded_at`, `updated_at`.
- **`response_history`** — append-only copy of every response change.
- **`meeting_changes`** — audit log of edits and cancellations (who, when, which fields).

### Integrations & pipeline
- **`google_connections`** — `id`, `user_id`, `google_email`, `granted_scopes`, `refresh_token_encrypted` (AES-256-GCM), `status` (`active` | `broken`), timestamps.
- **`sheet_syncs`** — `workspace_id` (PK), `connection_id`, `spreadsheet_id`; plus `response_sheet_rows` (`response_id` → row number) for in-place updates.
- **`push_subscriptions`** — `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, timestamps.
- **`outbox_jobs`** — `id`, `kind` (`invite` | `update` | `cancel` | `reminder` | `sheet_sync` | `push` | `system_email`), `workspace_id`, `payload` (JSON validated by a per-kind Zod schema), `idempotency_key` (unique), `run_after`, `status` (`pending` | `processing` | `done` | `failed` | `paused`), `attempts`, `locked_until`, `last_error`, timestamps.
- **`send_log`** — one row per sent email (`sender_key`, `workspace_id`, `job_id`, `sent_at`) used for rolling-24h quota checks.
- **`rate_limits`** — key + window counters for Postgres-backed rate limiting.

### Identity rules
- Personal link tokens: 256-bit random; only the SHA-256 hash is stored.
- A signed-in user sees invites whose contact email equals their **verified** auth email, across all workspaces.

---

## 7. Core Flows

### 7.1 Organizer onboarding
Sign in → create workspace (name, timezone pre-filled) → Home shows a checklist: import members, connect Gmail sending (optional), connect Google Sheets (optional), invite committee as Viewers.

### 7.2 Create & send a meeting (center "+")
1. **Details** — title, date/time, duration, location and/or URL, agenda.
2. **Audience** — pick lists, tick/untick contacts, add extra emails (optionally saved to the roster). Live count shows deduplicated total.
3. **Responses** — mode and its settings, deadline, reminders (defaults from workspace).
4. **Review** — email preview, sender line, projected email count (invites + reminders) vs quota → **Send now** or **Save draft**.

Send snapshots invitees, enqueues one `invite` job per invitee plus scheduled `reminder` jobs, then triggers an immediate dispatch via `after()`.

### 7.3 Member responds (no account)
Email shows meeting card, three buttons (deep links to `/r/{token}?choice=…`), Add-to-Calendar link, `.ics` attachment. On the page: Attending → one tap → CONFIRMED stamp + calendar buttons; Late/Absent → form (reason, delay chips, comment, footer note) → submit. Re-opening the link shows the answer with **Change** until the meeting starts; read-only afterwards. Each response enqueues `sheet_sync` (if enabled).

### 7.4 Member with an account
`/invites` lists upcoming invites across workspaces with their status and one-tap change. Can enable push notifications, later calendar auto-add (layer B), export or delete data.

### 7.5 Edit / cancel
- Date/time change → `ics_sequence++`, `update` jobs, all responses flagged `needs_reconfirmation`.
- Text/location change → `ics_sequence++`, `update` jobs, responses kept.
- Cancel → `status = cancelled`, `cancel` jobs with `.ics` cancellation; pending reminders cancelled.
- Every change written to `meeting_changes`.

### 7.6 Reminders
Enqueued at send time with `run_after`. On execution, eligibility is re-evaluated (non-responders, or attending/late), so people who answered meanwhile are skipped. Reminder emails count against the same quotas.

### 7.7 Viewer (committee)
Read-only Home, meetings, responses, per-member history ("Late 3×, Absent 1× this semester" + reasons), CSV/Excel export, link to synced Sheet.

---

## 8. Background Pipeline

- **Dispatcher:** `POST /api/internal/dispatch`, authorized by a secret header. Called every minute by Supabase Cron via `pg_net` (S1), and immediately after enqueues via `after()`.
- **Claiming:** Postgres function claims a batch with `FOR UPDATE SKIP LOCKED`, sets `status = processing` and `locked_until` (lease). Expired leases are reclaimable. Each run stops at a ~60 s time budget.
- **Senders** — `EmailSender` interface:
  - `GmailApiSender` — organizer's connected Gmail via Gmail API.
  - `FallbackSmtpSender` — nodemailer + platform Gmail app password; From shows "via <App> on behalf of <Organizer>", Reply-To = organizer.
  - Future adapters (e.g. Resend + domain) implement the same interface.
- **Quotas (rolling 24 h, all values in config):**
  - Organizer Gmail: ~500 recipients (figure documented for consumer Gmail SMTP; the Gmail API limit for consumer accounts is confirmed in S4).
  - Fallback: 50 recipients per workspace, ~400 platform-wide (keeps ~100 for system emails).
  - Over cap → job rescheduled to when the oldest send in the window expires; meeting page shows "N queued, resumes ~HH:MM".
- **Errors:**

  | Failure | Handling |
  |---|---|
  | Network, 5xx, 429 | Exponential backoff, max 5 attempts |
  | Invalid / bouncing address | `failed` for that invitee; surfaced on meeting page |
  | Google `invalid_grant` | Connection → `broken`; admin alerted (Home + email); workspace jobs `paused` until reconnect or "send via fallback" |

- **Idempotency:** unique `idempotency_key` (e.g. `invite:{invitee}:{seq}`); duplicate enqueue is a no-op; job completion and `send_log` insert happen together.
- **Other job kinds:** `sheet_sync` (append new row / update stored row, coalesced per workspace), `push` (Web Push; delete subscriptions on 404/410), `reminder` (eligibility at run time).

---

## 9. Integrations & Auth

- **Sign-in:** Supabase Auth — Google provider (`openid email profile`) and email OTP. Supabase custom SMTP points to the platform Gmail. Rate limited per address and IP.
- **Google connection for sending/Sheets:** separate, self-managed OAuth flow (`/api/integrations/google/connect` → `/callback`) with PKCE, `state`, offline access, **incremental consent**: "Connect Gmail sending" → `gmail.send` (sensitive); "Connect Google Sheets" → `drive.file` (non-sensitive). Refresh tokens encrypted at rest.
- **Google verification:** until verified, organizers see the "unverified app" screen and the app is capped at 100 new users total. Verification requires a public homepage, privacy policy on the same domain, demo video, and Search Console ownership of the domain (S3).
- **Sheets:** spreadsheet created in the admin's Drive by the app; admin shares it with the committee via Google Sheets.
- **Calendar files:** stable `ics_uid` per meeting, `SEQUENCE` = `ics_sequence`. `METHOD:REQUEST` vs `METHOD:PUBLISH` decided by S2 (hypothesis: `PUBLISH`, so Gmail's own RSVP buttons don't compete with ours). Google Calendar template link for one-tap add.
- **Member calendar auto-add (layer B):** later milestone; scope (`calendar.app.created` vs `calendar.events`) and its verification needs confirmed in the Google Cloud console first (spike S5, run when layer B starts — not part of M0).
- **Email compliance:** per-workspace one-click unsubscribe (`List-Unsubscribe` + `List-Unsubscribe-Post`) and visible "Not my group" link; unsubscribed contacts are skipped at snapshot time.

---

## 10. Frontend

- **Framework:** latest stable Next.js App Router, TypeScript strict, bun (versions pinned at scaffold time).
- **Design system — Soft Neobrutalism:**
  - Tailwind CSS v4; colors, radii, border widths, shadows as CSS-variable tokens with light and dark sets (system-following + manual toggle).
  - shadcn/ui components (Radix primitives) copied in and restyled.
  - Fonts: Archivo Black (display) + Space Grotesk (body) via `next/font`.
  - Icons: `@phosphor-icons/react` Bold inside a `<Sticker>` tile component. No emojis.
- **Motion — Expressive:** `motion` library; spring/duration tokens in one module; patterns: staggered entrance, press-down buttons, drop-in chips, CONFIRMED stamp + shake + confetti. `prefers-reduced-motion` → snappy fallback.
- **Data & forms:** TanStack Query; react-hook-form + shared Zod schemas; style-B skeletons for loading states.
- **Routes:**
  ```
  /                landing · /privacy · /terms
  /login
  /r/[token]       public response page
  /invites         member home
  /w/[slug]        organizer shell (Home · Meetings · [+] · Lists · Settings)
    /meetings/new  4-step wizard
    /meetings/[id] live responses, send progress, edit/cancel
    /lists         list editor + CSV/Excel import
    /settings      defaults, sender, Sheets, roles
  /api/**          all reads and writes
  ```
- **PWA:** web manifest; service worker for push and app-shell caching; last-loaded "My invites" readable offline; responding requires network; Android install prompt, iOS "Add to Home Screen" guide. Service-worker tooling chosen in the M1/M8 plan after checking current Next.js guidance.
- **Libraries per repo rules:** date-fns + `@date-fns/tz`; logger utility; next-intl (locale from workspace/user setting, no URL prefix); React Email templates using the same messages; PapaParse for CSV. Excel parser and grid component chosen in the M3 plan after checking maintenance status.

---

## 11. Security & Privacy

- **Authorization:** RLS on every table; API routes use the user's Supabase session so RLS applies; route-level `requireRole(workspace, role)`. The service-role key is used only by the dispatcher and the public token route, each in an isolated server-only module.
- **Public token route:** lookup by hash; rate limited per IP and per token; exposes only that invitee's meeting and response; validates choice against response mode; read-only after start.
- **Requests:** `Origin` check on all mutating routes; SameSite=Lax cookies; Zod validation of every body; agenda stored as Markdown and sanitized on render (web and email).
- **Rate limiting:** Postgres-backed (`rate_limits` + function) for OTP requests, token routes, meeting creation, imports.
- **Secrets:** Vercel env vars only (Supabase service role, token-encryption key, cron secret, Google client ID/secret, SMTP credentials, VAPID keys); validated at startup by a typed config module; never sent to the client.
- **Headers:** strict CSP, HSTS, `frame-ancestors 'none'`, `Referrer-Policy` that prevents token leakage.
- **Visibility:** reasons visible to the workspace's Admins and Viewers only; members never see each other's answers; response form shows "Your answer is visible to <Workspace> organizers".
- **Account deletion:** removes profile, push subscriptions, Google connections, and contact↔account links; erases `reason` and `comment` from that person's responses (and history); statuses remain for workspace statistics, no longer linked to an account. Organizers can delete a contact entirely. Rows already synced to a Google Sheet remain there — stated in the privacy policy.
- **Google user data:** privacy policy includes the Limited Use disclosure; only `gmail.send` and app-created files via `drive.file` are used; no mail or Drive reading.

---

## 12. Testing

- **Unit (Vitest):** dedup/CSV merge, quota windows, `.ics` generation and sequencing, reminder eligibility, sender selection, token hashing, Zod schemas.
- **Integration:** API routes against local Supabase (`supabase start`), including RLS tests (Viewer cannot write; no cross-workspace reads).
- **Email:** fake `EmailSender` in tests; local mail catcher for manual checks.
- **E2E (Playwright, phone viewport):** create meeting → send → respond via link → dashboard updates. UI changes verified with Playwright MCP per repo rules.
- **CI (GitHub Actions):** lint, format check, typecheck, tests on every PR.

---

## 13. Spikes (M0)

| ID | Question | Pass condition | Fallback |
|---|---|---|---|
| S1 | Can Supabase Cron on the Free plan call a Vercel route every minute via `pg_net`? | Calls observed every minute for an hour | Scheduled GitHub Actions workflow (verify its minimum interval and reliability) |
| S2 | `.ics` `REQUEST` vs `PUBLISH`: behavior of invite, update (`SEQUENCE`) and cancel in Gmail, Outlook, Apple Calendar | Chosen method adds, updates in place and removes the event in all three | Calendar link only + downloadable `.ics` |
| S3 | Can `<app>.vercel.app` be verified in Google Search Console and accepted as an OAuth authorized domain? | Ownership verified; domain accepted in consent screen config | Gmail sending stays in unverified mode (100-user cap) until a free domain option exists |
| S4 | Gmail API send from an unverified app: consent flow, warning screen, refresh-token lifetime | Organizer connects and sends; refresh token still works after 7+ days (checks Testing vs In-production token lifetime); consumer Gmail API daily send limit documented | Fallback SMTP becomes the default sender |

**S5 (deferred, before calendar layer B):** classify `calendar.app.created` / `calendar.events` in the Google Cloud console and determine verification requirements.

Each spike ends with a **Decision** issue recording evidence and the outcome; affected spec sections are updated.

---

## 14. Delivery Plan

| # | Milestone | Done when |
|---|---|---|
| M0 | Spikes S1–S4 | Decision issues closed with evidence |
| M1 | Foundation — scaffold, tooling (lint/format/test), CI, typed config, logger, i18n, design tokens (light/dark), core components (Button, Card, Sticker, Chip, Input), motion tokens, Supabase baseline | Style-B component showcase deployed |
| M2 | Auth & workspaces — Google + email-code sign-in, workspaces, roles, Viewer invites, app shell | Sign in, create workspace, invite a Viewer |
| M3 | Contacts & lists — list editor, CSV/Excel import, mapping, preview, dedup | Club roster imported |
| M4 | Meetings & sending — wizard, outbox, dispatcher, fallback SMTP sender, quotas, invite email + `.ics`, unsubscribe, send progress | Invites land in inboxes |
| M5 | Responses — `/r/[token]`, three modes, edits until start, live dashboard, per-member history, export | **MVP usable by the club** |
| M6 | Lifecycle & reminders — edit/cancel updates, reconfirmation, reminders, nudge non-responders | |
| M7 | Google integrations — Gmail sending connection, Sheets sync | |
| M8 | Member accounts & PWA — `/invites`, push, install flow, offline shell, account deletion | |
| M9 | Public launch — landing, privacy/terms, security header audit, Google verification submission | |
| Backlog | Calendar layer B, layer C, French/Arabic, organizer digest email, auto-delete of old reasons | |

### Process
- This spec is the single product/architecture reference.
- An implementation plan is written **per milestone** when that milestone starts; the first plan covers **M0 + M1**.
- GitHub: one GitHub Milestone per M#, one **Epic** issue per milestone, **agent-task** sub-issues from each plan, **Decision** issues for spike outcomes; labels `type:epic`, `type:task`, `type:spike`, `type:decision`, `area:*`.

---

## 15. Open Items

- **Product name** — not chosen yet; needed before M9 (landing page, Google consent screen, email "via <App>" line). Until then the codebase uses a single configurable `APP_NAME` constant.
- Spike outcomes S1–S4 may change §5 (scheduler), §9 (`.ics` method, verification path) and the default sender.
