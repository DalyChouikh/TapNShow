# TapNShow — Design Spec

- **Date:** 2026-10-04
- **Author:** DalyChouikh (with Claude)
- **Status:** Draft — awaiting review
- **Product name:** TapNShow (`tapnshow.vercel.app`; name lives in a single `APP_NAME` config constant)
- **Origin:** GDG on Campus ISSAT Sousse; built as a general-purpose, public, free, brand-neutral tool

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
| **Owner** (one per workspace) | Required | Everything an Admin can do, plus: delete the workspace, transfer ownership (to an existing Admin), invite/promote/demote/remove Admins. Exactly one Owner always exists; the Owner must transfer before leaving |
| **Admin** (e.g. club lead) | Required | Everything in a workspace: meetings, lists, settings, integrations, inviting/removing Viewers and their `can_check_in` |
| **Viewer** (e.g. Team Management committee) | Required | Read-only: meetings, responses, per-member history, exports, Sheet link |
| **Member (no account)** | None | Responds through a personal link from the email |
| **Member (with account)** | Optional | Sees upcoming invites across all workspaces, changes answers, enables push notifications, exports/deletes their data |
| **Platform** | — | Sends system emails only (sign-in codes, Viewer invites) through Supabase custom SMTP: a dedicated platform Gmail now, Resend once a domain is owned. Never sends meeting invites |

A user can be Admin/Viewer in several workspaces and a member of others with the same account.

---

## 4. Product Decisions (summary)

| Topic | Decision |
|---|---|
| Calendar delivery | **Layer A (v1, decided after S2):** the invite email has only TapNShow's buttons (no `.ics`); when a member answers Attend or Late, a **calendar confirmation email** with a pre-accepted `METHOD:REQUEST` (`RSVP=FALSE`, `PARTSTAT=ACCEPTED`) puts the event in their calendar; edits update it in place and Absent/cancel removes it — no OAuth. `PUBLISH` rejected (cannot update or cancel). **Layer B (later):** members with accounts connect Google Calendar → auto-insert on Attend. **Layer C (backlog, not committed):** native Google Calendar event created by the organizer |
| Sign-in | "Continue with Google" (basic scopes, **own OAuth callback on `tapnshow.vercel.app`** + `signInWithIdToken`, so Google shows our domain, not `<ref>.supabase.co`) + **email code only** (no magic link: link scanners consume one-time links; 8 digits, 15-minute expiry) delivered via Supabase custom SMTP (platform Gmail → Resend later). Same verified email = same account (Supabase automatic linking); manual linking stays off. Supabase's built-in mailer is not usable: 2 emails/hour and team-members-only delivery (decided 2026-10-05) |
| Tenancy | Workspaces with roles Owner / Admin / Viewer; open sign-up, **no approval step**; a user can own at most 10 workspaces (config) and create at most 5 per hour; address `/w/<name-slug>-<random suffix>`, fixed at creation |
| Audience | **Multiple named lists** per workspace; one contact per normalized email; recipients deduplicated across lists and extra emails |
| Member list editing | Roster of contacts with columns Full name, Email, Lists: cards + edit sheet on phones, inline-editable grid from `md` up; one-field edits autosave. Import `.csv`/`.xlsx` or paste from Sheets/Excel through a 3-step dialog (source → match columns → preview of new/updated/unchanged/merged-duplicate/invalid rows) before saving. Re-import merges: names update, lists are added, nothing is removed or deleted by an import (turnover is handled with bulk actions). Team-column values are split on `,` `;` `\|`, matched to lists case-insensitively, and unknown names create lists (decided 2026-10-06, see §7.14) |
| Response modes (per meeting, workspace default) | `announcement` (no responses) · `rsvp` (Going / Not going, optional reason) · `attendance` (Going / Late / Absent — configurable delay options, reason required toggle, comment toggle, footer note) |
| Response edits | Allowed until meeting start; full history kept; read-only after start |
| Meeting fields | Title, date/time, duration, timezone, location text and/or meeting URL (in-person/online/hybrid), Markdown agenda, optional response deadline |
| Edits after sending | Smart updates: date/time change → update email + "needs reconfirmation"; text/location change → update email, answers kept; cancel → cancellation email + `.ics` cancel |
| Reminders | Configurable: non-responders X h before deadline; attending/late X h before meeting. Email to all; Web Push for account holders with the PWA |
| Responses storage | Supabase is the source of truth; in-app dashboard + CSV/Excel export always; Google Sheets sync optional per workspace (later milestone) |
| Sheet layout | One spreadsheet per workspace, one `Responses` tab, one row per response, updated in place |
| Sending | Meeting invites, updates and reminders are sent **only from the organizer's connected Gmail** (`gmail.send`). **No shared fallback sender**: drafting works without Gmail, but sending requires connecting it (decided 2026-10-05). Viewer invites: emailed by the platform sender **or** copied as a single-use link; either way the invite names an email and only that verified email can accept it (7-day expiry; Resend/Copy issues a new token). |
| Language | English at launch; all strings and email templates through next-intl from day one |
| Privacy | Admins + Viewers of the workspace see reasons; members never see each other; account deletion rule in §11 |
| Visual style | **Soft Neobrutalism** — thick outlines, rounded corners, "pressable" drop shadows, pastels; light + dark following system |
| Motion | **Expressive** — springy, staggered entrances, tilt-on-hover, drop-in chips, CONFIRMED stamp + shake + confetti; reduced-motion users get a snappy fallback |
| Icons | **Phosphor Bold** inside outlined pastel "sticker" tiles |
| Branding | Brand-neutral platform; no Google/GDG theming or logo uploads. The only Google-styled element is the "Continue with Google" button, which must follow Google's sign-in branding guidelines (standard-color G on white `#FFFFFF` with `#747775` stroke, or the dark/neutral variants) |
| Navigation | **Hub + center "+"** — Home (next meeting live counts, "needs attention"), Meetings, [+ New], Lists, Settings. Built complete in M2; destinations of later milestones show styled "coming soon" states, "+" disabled. Viewers see no "+" |
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
 Dispatcher ──► EmailSender (GmailApiSender)
            ──► Google Sheets API (drive.file)
            ──► Web Push (VAPID)
```

- **Single TypeScript codebase**, run with bun locally, deployed to Vercel on Node.js.
- **All data access via API routes.** Pages are client components; TanStack Query handles caching, optimistic updates, and refetch after mutations.
- **Outbox pattern** for every side effect (emails, reminders, Sheets rows, push).
- **Fallback scheduler** if Supabase Cron can't run every minute on Free: a scheduled GitHub Actions workflow calling the dispatcher (to be verified in S1). The repo is public, so Actions minutes are free.
- **Data access:** supabase-js with generated database types, used only inside `src/server/queries/*`; multi-step/transactional operations (send meeting, claim jobs, rate-limit check) are Postgres functions called via RPC. No ORM, so RLS applies through the user's session.
- **Environments (two free Supabase projects):**
  | Env | Database | Used by |
  |---|---|---|
  | Local | Local Supabase via Docker (`supabase start`) | Development, integration and RLS tests |
  | Preview | Supabase project #2 | Vercel preview deployments |
  | Production | Supabase project #1 | `tapnshow.vercel.app` |

  Migrations live in `supabase/migrations/` and are applied to Preview then Production. Docker Desktop's WSL integration must be enabled before the first task that needs a local database.
- **Monitoring:** Sentry free tier (5k errors/month, 30-day retention, 1 user) for API routes and the dispatcher; structured logs via the logger utility; `outbox_jobs.last_error` for per-job failures.

---

## 6. Data Model

All tables have RLS enabled. Timestamps are `timestamptz`. Emails are stored normalized (trimmed, lower-cased).

### Organizers & workspaces
- **`profiles`** — `user_id` (PK, → `auth.users` on delete cascade), `display_name` (nullable; asked once after sign-in when empty), `avatar_url`, `locale`, `last_workspace_id` (nullable → `workspaces`, on delete set null), timestamps. Created by a trigger on `auth.users` whose function lives in a private (non-exposed) schema; name/picture copied from the Google identity for display only (never used for authorization).
- **`workspaces`** — `id`, `name`, `slug` (unique; name slug + random suffix, never changes), `timezone`, `locale`, timestamps (M2); added when first used (M4/M5): default meeting settings (`default_response_mode`, `default_delay_options`, `default_reason_required`, `default_comments_enabled`, `default_footer_note`, `default_reminder_*`), `sender_connection_id` (nullable → `google_connections`), timestamps.
- **`workspace_roles`** — (`workspace_id`, `user_id`) PK, `role` (`owner` | `admin` | `viewer`), `can_check_in` (boolean; Viewers only — the single write a Viewer may perform). Exactly one `owner` per workspace (unique partial index + functions that never leave zero).
- **`platform_admins`** — `user_id` — platform operators (initially only the project owner). Created in M9 with the admin page.
- **`workspace_invites`** — `id`, `workspace_id`, `email` (normalized), `role` (`admin` | `viewer`), `token_hash` (SHA-256 of a 256-bit token, shown once), `invited_by`, `expires_at` (+7 days), `accepted_at`, `accepted_by`, `revoked_at`, timestamps. At most one open invite per (`workspace_id`, `email`).
- **Access pattern (M2):** reads through RLS (`is_member(workspace, roles[])` helper in a private schema). Single-row edits (rename, timezone) through RLS UPDATE policies with `WITH CHECK`. Membership and ownership changes only through Postgres functions — `create_workspace`, `transfer_ownership`, `change_role`, `remove_member`, `leave_workspace`, `create_invite`, `revoke_invite`, `accept_invite`, `delete_workspace` — no direct table writes (see §11 for the `SECURITY DEFINER` exception).

### People & lists
- **`contacts`** — `id`, `workspace_id`, `email` (unique per workspace), `full_name` (required, 1–120 chars, trimmed), `user_id` (nullable link once the person has an account with this verified email; filled in M8), `unsubscribed_at` (set from M4), `is_adhoc` (true for one-off emails typed at send time and not saved to the roster: hidden from lists, kept for history, flipped to false if later added to the roster; set from M4), timestamps.
- **`lists`** — `id`, `workspace_id`, `name` (1–60 chars; unique per workspace **case-insensitively**), timestamps.
- **`list_contacts`** — (`list_id`, `contact_id`) PK, both `on delete cascade`: deleting a list never deletes people; deleting a contact (a hard delete, §11) removes its memberships.
- **Access pattern (M3):** RLS + explicit `GRANT`s on all three tables: SELECT for Owner/Admin/Viewer, INSERT/UPDATE/DELETE for Owner/Admin (`private.is_member`). Single edits (rename, change email, create/rename/delete a list, delete a contact) are plain RLS writes. Multi-row operations are `SECURITY INVOKER` functions (RLS still applies): `import_contacts(workspace, rows jsonb, dry_run)` and `set_contact_lists(contact, list_ids)`. Caps are enforced by statement-level `AFTER INSERT` triggers that take a per-workspace advisory lock and compare against `app_limits` (`contacts_per_workspace_max` 2000, `lists_per_workspace_max` 50), so every write path is covered.
- **`import_contacts`:** normalizes and validates each row; merges rows with the same email inside the input (lists united, last non-empty name wins); classifies each row as `new` / `updated` (different non-empty name or added lists) / `unchanged` / `invalid` (with a reason: missing or malformed email, name over 120 chars, list name over 60 chars, or no name for an email not yet in the roster — an empty name for an existing contact keeps the stored one); a merged row also reports the input row numbers it absorbed, which the preview counts as "merged duplicates"; resolves list names case-insensitively and creates unknown ones. `dry_run = true` returns per-row outcomes, totals and new list names and writes no contacts or lists (it only counts against `import_previews_per_user_per_hour`, 120, so previews cannot be used to load the database); `dry_run = false` applies the same logic in one transaction and counts against `imports_per_user_per_hour` (30), except a one-row commit ("+ Add"), which counts against `contact_adds_per_user_per_hour` (300) so adding people by hand is not capped by the import budget (decided 2026-10-07). At most `import_rows_max` (2000) rows per call. "+ Add" in the roster calls it with one row, so adding an existing email merges.

### Meetings
- **`meetings`** — `id`, `workspace_id`, `title`, `agenda_md`, `starts_at`, `duration_minutes`, `timezone`, `location_text`, `meeting_url`, `response_mode` (`announcement` | `rsvp` | `attendance`), `response_deadline`, `delay_options` (array), `reason_required`, `comments_enabled`, `footer_note`, reminder settings, `status` (`draft` | `scheduled` | `cancelled`), `ics_uid`, `ics_sequence`, `created_by`, timestamps.
- **`meeting_audience`** — (`meeting_id`, `list_id`) — which lists were targeted (for display).
- **`meeting_invitees`** — `id`, `meeting_id`, `contact_id` (unique per meeting), `token_hash`, `invited_at`. Snapshot taken at send time; later additions invite only the new contacts.
- **`responses`** — `id`, `invitee_id` (unique), `status` (`attending` | `late` | `absent` | `not_attending`), `delay_option`, `reason`, `comment`, `needs_reconfirmation`, `responded_at`, `updated_at`.
- **`response_history`** — append-only copy of every response change.
- **`meeting_changes`** — audit log of edits and cancellations (who, when, which fields).
- **`attendance_marks`** — (`meeting_id`, `contact_id`) PK, `actual` (`present` | `late` | `absent`), `marked_by`, `marked_at` — post-meeting check-in (actual vs declared).

### Integrations & pipeline
- **`google_connections`** — `id`, `user_id`, `google_email`, `granted_scopes`, `refresh_token_encrypted` (AES-256-GCM), `status` (`active` | `broken`), timestamps.
- **`sheet_syncs`** — `workspace_id` (PK), `connection_id`, `spreadsheet_id`; plus `response_sheet_rows` (`response_id` → row number) for in-place updates.
- **`push_subscriptions`** — `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, timestamps.
- **`outbox_jobs`** — `id`, `kind` (`invite` | `calendar_confirm` | `update` | `cancel` | `reminder` | `sheet_sync` | `push` | `system_email`), `workspace_id`, `payload` (JSON validated by a per-kind Zod schema), `idempotency_key` (unique), `run_after`, `status` (`pending` | `processing` | `done` | `failed` | `paused`), `attempts`, `locked_until`, `last_error`, timestamps.
- **`send_log`** — one row per sent email (`sender_key`, `workspace_id`, `job_id`, `sent_at`) used for rolling-24h quota checks.
- **`rate_limits`** — key + window counters for Postgres-backed rate limiting.
- **`abuse_reports`** — `id`, `workspace_id`, `invitee_id`, `reported_at` — "Not my group" clicks; surfaced to platform admins (M9).
- **`workspace_sending_suspensions`** — `workspace_id`, `reason` (`auto_reports` | `platform_admin`), `created_at`, `lifted_at`.

### Identity rules
- Personal link tokens: 256-bit random; only the SHA-256 hash is stored.
- A signed-in user sees invites whose contact email equals their **verified** auth email, across all workspaces.
- Personal links are bearer links (forwarding lets the recipient answer). Accepted risk; the page shows "Answering as <Full name>. Not you?" with an explanation.
- Workspaces are private: no directory or public join page; access only via organizer invite or a member's email link.

---

## 7. Core Flows

### 7.1 Organizer onboarding
Sign in → `/welcome` asks "What should we call you?" once if the profile has no name → 0 workspaces: create workspace (name, timezone pre-filled from the browser); otherwise the last opened workspace (`profiles.last_workspace_id`), with a switcher in the header. An invite link carries a same-site return path through sign-in. Home shows a checklist: import members, connect Gmail sending (required before the first send), connect Google Sheets (optional), invite committee as Viewers.

### 7.2 Create & send a meeting (center "+")
1. **Details** — title, date/time, duration, location and/or URL, agenda.
2. **Audience** — pick lists, tick/untick contacts, add extra emails (optionally saved to the roster). Live count shows deduplicated total.
3. **Responses** — mode and its settings, deadline, reminders (defaults from workspace).
4. **Review** — email preview, sender line, projected email count (invites + reminders) vs quota → **Send now** or **Save draft**.

Send snapshots invitees, enqueues one `invite` job per invitee plus scheduled `reminder` jobs, then triggers an immediate dispatch via `after()`.

### 7.3 Member responds (no account)
Email shows meeting card and three buttons (deep links to `/r/{token}?choice=…`) — **no `.ics`**, so Gmail shows no competing RSVP buttons. On the page: Attending → one tap → CONFIRMED stamp + "Added to your calendar" note (a `calendar_confirm` job emails the pre-accepted invite; Late does the same); Absent after an earlier Attend/Late enqueues a `METHOD:CANCEL` for that member; Late/Absent → form (reason, delay chips, comment, footer note) → submit. Re-opening the link shows the answer with **Change** until the meeting starts; read-only afterwards. Each response enqueues `sheet_sync` (if enabled).

### 7.4 Member with an account
`/invites` lists upcoming invites across workspaces with their status and one-tap change. Can enable push notifications, later calendar auto-add (layer B), export or delete data.

### 7.5 Edit / cancel
- Date/time change → `ics_sequence++`, `update` jobs (members with a calendar copy get an updated pre-accepted `REQUEST`), all responses flagged `needs_reconfirmation`.
- Text/location change → `ics_sequence++`, `update` jobs, responses kept.
- Cancel → `status = cancelled`, `cancel` jobs (members with a calendar copy get `METHOD:CANCEL`); pending reminders cancelled.
- Every change written to `meeting_changes`.

### 7.6 Reminders
Enqueued at send time with `run_after`. On execution, eligibility is re-evaluated (non-responders, or attending/late), so people who answered meanwhile are skipped. Reminder emails count against the same quotas.

### 7.7 Viewer (committee)
Read-only Home, meetings, responses, per-member history ("Late 3×, Absent 1×, No reply 4× this semester" + reasons; declared vs actual where check-in exists), CSV/Excel export, link to synced Sheet. Viewers with `can_check_in` can mark actual attendance.

### 7.8 Post-meeting check-in
From the meeting page after start, an Admin (or Viewer with `can_check_in`) marks each invitee Present / Late / Absent, pre-filled from their declared answer. History shows both declared and actual.

### 7.9 Duplicate meeting
Copies details, audience and response settings into a new draft with an empty date/time.

### 7.10 Timezones
Times are always shown in the meeting's timezone, plus "(your time: …)" when the viewer's timezone differs.

### 7.11 Workspace lifecycle
Exactly one Owner always exists. The Owner transfers ownership to an existing Admin (instant and atomic, confirmed by typing the workspace name; the old Owner becomes Admin) and must do so before leaving. Only the Owner deletes a workspace: typing its name confirms, and all its data is hard-deleted (synced Sheets remain in Drive).


### 7.12 Abuse controls
- Meeting emails come from each organizer's own Gmail, so abuse affects that organizer's own quota and reputation, not the platform. "Not my group" reports also unsubscribe the reporter from that workspace and are visible to platform admins.
- Platform admins can suspend or lift a workspace's sending from an internal admin page (M9).

### 7.13 Viewer and Admin invites
Admins invite Viewers; only the Owner invites Admins. Several addresses can be entered at once (chips: comma, space, Enter or a pasted list; up to 20 per request): each address still gets its own email-bound invite and token, and the dialog lists the result per person with "Copy link" per row and "Copy all links". Delivery: email from the platform sender or "Copy link" (the token is shown once; copying an existing invite renews it). `/invite/[token]` requires sign-in first (no signed-out invite lookup), then shows workspace, role and masked email; accepting requires the signed-in **verified** email to equal the invite email. States: ready, wrong account (with "Switch account"), expired, revoked, used, already a member. The preview shows the workspace name in the expired, revoked and used states too: accepted (decided 2026-10-06, #87), because only the holder of the 256-bit token can ask and the invite was addressed to them.

### 7.14 Roster and lists (M3)
- **Roster page** (`/w/[slug]/lists`): search ("Search N people", name and email, accent-insensitive), a scrolling row of list chips ("All N", one per list with its count, "Manage" to create/rename/delete lists), then the people. Phones: virtualized cards (name, email, list chips); tapping one opens a bottom-sheet editor whose fields save on blur, with a list picker (create a list by typing a new name) and Delete. From `md` up: an inline-editable grid (select, Full name, Email, Lists) with keyboard navigation. Owner/Admin only: Import, "+ Add", Select mode (sticky action bar: add to list, remove from list, delete N). Viewers see the same data with no edit controls.
- **Edits:** optimistic, rolled back with an inline error on failure (e.g. "Already in your roster: <name>" for a taken email). Deletes show an Undo toast and are sent only after it expires (about 5 s); closing the tab before then cancels the delete.
- **Import dialog** (full screen on phones), three steps with footer buttons of one fixed height and single-line labels: (1) **Source** — File (`.csv`/`.xlsx`, ≤ 5 MB, parsed on the device; sheet picker for multi-sheet workbooks) or Paste (tab-separated text from Sheets/Excel); (2) **Match columns** — each header auto-matched to Full name / Email / Lists / Ignore from English and French synonyms, with sample values, a "First row is headers" switch and an optional "Also add everyone to…" list; (3) **Preview** — the server's dry run: count tiles (new, updated, unchanged, merged duplicates, invalid — tapping filters the rows), new lists, and each row with its outcome and reason; invalid rows are skipped; over a limit, Import is disabled with an explanation. Nothing is saved before "Import N people". The file never leaves the device; only `{full_name, email, lists[]}` rows are sent.
- **Empty roster:** "Import your roster", "Paste from Sheets", "Add one person". The Home checklist item "Import members" links here.

---

## 8. Background Pipeline

- **Dispatcher:** `POST /api/internal/dispatch`, authorized by a secret header. Called every minute by Supabase Cron via `pg_net` (S1), and immediately after enqueues via `after()`.
- **Claiming:** Postgres function claims a batch with `FOR UPDATE SKIP LOCKED`, sets `status = processing` and `locked_until` (lease). Expired leases are reclaimable. Each run stops at a ~60 s time budget.
- **Senders** — `EmailSender` interface:
  - `GmailApiSender` — organizer's connected Gmail via Gmail API.
  - No fallback sender for meeting emails. A workspace without a connected sender cannot dispatch; jobs wait in `paused` with a "Connect Gmail to send" prompt.
  - System emails (sign-in codes, Viewer invites) do not go through this pipeline: Supabase Auth sends codes via its custom SMTP setting; Viewer invite emails use a small `SystemMailer` (nodemailer, same SMTP credentials), sent directly from the route. Switching to Resend later is a configuration change.
  - **Platform Gmail budget** (Gmail blocks the account for 1–24 h above 500 emails/day): Supabase auth email rate limit **15/hour** (≤ 360/day) + Viewer invite emails capped at **100/day platform-wide and 20/day per workspace** (Postgres rate limits, values in config) → worst case 460/day. Over a cap, the UI offers "Copy link instead".
- **Quotas (rolling 24 h, all values in config):**
  - Organizer Gmail: **500 emails/day** and ≤ 500 recipients per message (Gmail Help; still applies to the Gmail API). Throughput: `messages.send` = 100 of 6,000 quota units/min/user → **≤ 60 sends/min per organizer** (S4).
  - Over cap → job rescheduled to when the oldest send in the window expires; meeting page shows "N queued, resumes ~HH:MM".
- **Errors:**

  | Failure | Handling |
  |---|---|
  | Network, 5xx, 429 | Exponential backoff, max 5 attempts |
  | Invalid / bouncing address | `failed` for that invitee; surfaced on meeting page |
  | Google `invalid_grant` | Connection → `broken`; admin alerted (Home + email); workspace jobs `paused` until reconnect |

- **Idempotency:** unique `idempotency_key` (e.g. `invite:{invitee}:{seq}`); duplicate enqueue is a no-op; job completion and `send_log` insert happen together.
- **Other job kinds:** `calendar_confirm` (pre-accepted `REQUEST` to one member after Attend/Late; `CANCEL` when they switch to Absent), `sheet_sync` (append new row / update stored row, coalesced per workspace), `push` (Web Push; delete subscriptions on 404/410), `reminder` (eligibility at run time).

---

## 9. Integrations & Auth

- **Sign-in:** Supabase Auth — Google provider (`openid email profile`) and email OTP. Supabase custom SMTP points to the dedicated platform Gmail (`smtp.gmail.com:587`, app password, ~500 recipients/day) until a domain is bought, then Resend (free 3,000/month). The built-in mailer is unusable (2/hour, team-members only). Rate limited per address (Supabase: one code request per 60 s) and per IP (our Postgres limit).
  - **Email code:** `POST /api/auth/otp/send` → `signInWithOtp`; `POST /api/auth/otp/verify` → `verifyOtp`. Codes: 8 digits, 15-minute expiry. The code is in both the "Magic Link" and "Confirm signup" templates.
  - **Google:** own flow on our domain because Supabase's built-in flow shows `<ref>.supabase.co` on Google's consent screen and only a paid custom domain changes that. `GET /api/auth/google/start` (state + PKCE + nonce in a short-lived httpOnly cookie) → Google → `GET /api/auth/google/callback` (verify state, exchange code with the client secret, `signInWithIdToken`). OAuth client `tapnshow-web` (GCP project `tapnshow`); redirect URIs for production and `localhost:3000` only, so Google sign-in is unavailable on preview deployments (email codes work there). Supabase's Google provider holds the client ID. Brand verification (app name + logo on Google's screen) needs the public homepage and privacy policy (M9).
  - **Verified during M2 (2026-10-06):** Google gets the SHA-256 hex of the nonce and `signInWithIdToken` the raw nonce (Supabase Google guide); `signInWithIdToken` works with **only the client ID** in Supabase (owner signed in on localhost against the preview project; Google identity recorded, email verified) — no client secret stored in Supabase; a brand-new email-code user receives the "Magic Link" template (local probe), and both templates carry the code anyway; `src/proxy.ts` exports `proxy` (Next 16 docs); nodemailer 10 (maintained, ships its own types); email design uses thick right/bottom borders as the hard shadow because Gmail's mobile apps drop `box-shadow` for Google accounts (caniemail).
  - **Profiles trust only verified identity data:** the user trigger creates an empty profile; name and a Google-hosted avatar are copied from a Google row in `auth.identities` (`identity_data` comes from Google's verified ID token). `raw_user_meta_data` is client-controlled at email sign-up and is never used.
  - **Links the platform sends** (invite emails, copied invite links) use `NEXT_PUBLIC_APP_URL` or this deployment's own `VERCEL_URL` / `VERCEL_BRANCH_URL`, never a request header.
  - **Sessions:** `@supabase/ssr` cookies; `proxy.ts` refreshes the session with `getClaims()`; every protected route re-checks with `getClaims()` (proxy is only an optimistic check); `next=` accepts same-site relative paths only.
  - **Auth emails as code:** subjects and HTML for the auth templates live in the repo (rendered from React Email, same Soft Neobrutalism design as the app within email-client CSS limits) and a versioned script pushes them, plus OTP settings, rate limit, `site_url` and redirect URLs, to both projects via the Management API.
- **Google connection for sending/Sheets:** separate, self-managed OAuth flow (`/api/integrations/google/connect` → `/callback`) with PKCE, `state`, offline access, **incremental consent**: "Connect Gmail sending" → `gmail.send` (sensitive); "Connect Google Sheets" → `drive.file` (non-sensitive). Refresh tokens encrypted at rest.
- **Google verification:** until verified, organizers see the "unverified app" screen and the app is capped at 100 new users total. Verification requires a public homepage, privacy policy on the same domain, demo video, and Search Console ownership of the domain (S3).
- **Sheets:** spreadsheet created in the admin's Drive by the app; admin shares it with the committee via Google Sheets.
- **Calendar files (S2):** stable `ics_uid` per meeting, `SEQUENCE` = `ics_sequence`, `METHOD:REQUEST` with the member as attendee (`CN` = full name, `RSVP=FALSE`, `PARTSTAT=ACCEPTED`), sent only after Attend/Late; `METHOD:CANCEL` + `STATUS:CANCELLED` to remove. Whether it lands in the calendar automatically depends on the member's "Add invitations to my calendar" setting (default-like "Only if the sender is known" adds only after prior contact). To verify in M4: first-contact behavior and Outlook/Apple clients. See `docs/spikes/S2.md`.
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
  /login           email code + "Continue with Google"
  /welcome         name step, then redirect to last workspace or /w/new
  /invite/[token]  accept a workspace invite (sign-in first)
  /r/[token]       public response page
  /invites         member home
  /w/new           create workspace
  /w/[slug]        organizer shell (Home · Meetings · [+] · Lists · Settings)
    /meetings/new  4-step wizard
    /meetings/[id] live responses, send progress, edit/cancel
    /lists         list editor + CSV/Excel import
    /settings      general, people & invites, danger zone (M2); defaults, sender, Sheets (later)
  /api/**          all reads and writes
  ```
- **PWA:** web manifest; service worker for push and app-shell caching; last-loaded "My invites" readable offline; responding requires network; Android install prompt, iOS "Add to Home Screen" guide. Service-worker tooling chosen in the M1/M8 plan after checking current Next.js guidance.
- **Roster API (M3):** `GET /api/workspaces/[slug]/contacts` returns the whole roster (contacts with `listIds`, lists with counts, import limits) in one response — at most 2,000 contacts, so search and list filters run on the client; `POST …/contacts/import` (`{rows, dryRun, alsoAddToListId?}`); `PATCH`/`DELETE …/contacts/[id]` (`listIds` replaces that contact's lists atomically); `POST …/contacts/bulk` (`delete` | `addToList` | `removeFromList`); `POST …/lists`, `PATCH`/`DELETE …/lists/[id]`. New error codes: `contact_email_taken`, `contacts_limit_reached`, `lists_limit_reached`, `list_name_taken`, `import_too_many_rows`.
- **Libraries per repo rules:** date-fns + `@date-fns/tz`; logger utility; next-intl (locale from workspace/user setting, no URL prefix); React Email templates using the same messages; PapaParse for CSV. **M3 choices (npm checked 2026-10-06):** `read-excel-file` for `.xlsx` (MIT, 35 releases in the past year, browser-capable) — rejected: `xlsx`/SheetJS on npm (last release 2022, two unpatched HIGH advisories there; fixes ship only from SheetJS's own CDN) and `exceljs` (no release since 2024); `@tanstack/react-table` v9 (headless, so rendering uses our tokens) + `@tanstack/react-virtual` for the grid and card list — rejected: `react-data-grid` (still beta), Glide Data Grid (canvas: hard to theme, weaker accessibility), Handsontable (non-commercial license). Parsers are loaded with `import()` only when the import dialog opens.

---

## 11. Security & Privacy

- **Authorization:** RLS on every table, with explicit `GRANT`s to `authenticated` only (new tables are not exposed to the Data API by default); API routes use the user's Supabase session so RLS applies; route-level `requireUser()` (`getClaims()`) and `requireRole(workspace, roles)`.
- **`SECURITY DEFINER` exception (M2):** membership/ownership functions (§6) are `SECURITY DEFINER` because their multi-row invariants (one Owner, Owner-only Admin management, invite email match) are fragile under RLS alone. Each checks `auth.uid()` and the caller's role itself, sets `search_path = ''`, has `EXECUTE` revoked from `PUBLIC`/`anon` and granted to `authenticated` only, and is covered by RLS-matrix tests; `supabase db advisors` runs after every migration. **From M3**, `SECURITY DEFINER` bodies live in the non-exposed `private` schema and the Data API sees only thin `public` `SECURITY INVOKER` wrappers with the same signatures (advisor lint 0029 no longer fires; effective security unchanged); new functions are `SECURITY INVOKER` unless an invariant needs more, in which case they follow the same wrapper pattern. The service-role key is used only by the dispatcher, the public token route, `GET /api/health` (its `healthcheck()` function is deliberately not executable by `anon`/`authenticated`), and the pre-auth rate limiter (`check_ip_rate_limit` for sign-in code requests, executable by `service_role` only), each in an isolated server-only module.
- **Public token route:** lookup by hash; rate limited per IP and per token; exposes only that invitee's meeting and response; validates choice against response mode; read-only after start.
- **Requests:** `Origin` check on all mutating routes; SameSite=Lax cookies; Zod validation of every body; agenda stored as Markdown and sanitized on render (web and email).
- **Rate limiting:** Postgres-backed (`rate_limits` + function) for OTP requests (per IP), workspace creation (5/hour/user), invite emails (100/day platform, 20/day/workspace), token routes, meeting creation, imports (M3: 30 imports, 120 previews and 300 single adds per user per hour).
- **Logs and error reports:** the logger and Sentry share one scrubbing module (`src/lib/observability/scrub.ts`): values under sensitive field names are redacted at any depth, personal-link tokens and credential-shaped strings (Bearer, JWT, Google OAuth, Supabase secret keys) are scrubbed from every string, errors keep type/message/stack with tokens removed, and scrubbing failures drop the payload (fail closed).
- **Secrets:** Vercel env vars only (Supabase service role, token-encryption key, cron secret, Google client ID/secret, SMTP credentials, VAPID keys); validated at startup by a typed config module; never sent to the client. Every secret is also backed up in the commented blocks of the git-ignored `.env.local`.
- **Emails** (auth codes, invites, later meeting emails) follow the app's Soft Neobrutalism design (outlines, rounded cards, pastel tokens, sticker header) with fallbacks where email clients lack CSS support; never emojis.
- **Headers:** strict CSP, HSTS, `frame-ancestors 'none'`, `Referrer-Policy` that prevents token leakage.
- **Visibility:** every member of a workspace (including Viewers) sees the email addresses of its Owner/Admins/Viewers in Settings > People and of every contact in the roster — stated in the privacy policy (M9). Reasons visible to the workspace's Admins and Viewers only; members never see each other's answers; response form shows "Your answer is visible to <Workspace> organizers".
- **Account deletion:** removes profile, push subscriptions, Google connections, and contact↔account links; erases `reason` and `comment` from that person's responses (and history); statuses remain for workspace statistics, no longer linked to an account. Organizers can delete a contact entirely. Rows already synced to a Google Sheet remain there — stated in the privacy policy.
- **Google user data:** privacy policy includes the Limited Use disclosure; only `gmail.send` and app-created files via `drive.file` are used; no mail or Drive reading.

---

## 12. Testing

- **Unit (Vitest):** import parsing with real fixtures (multi-sheet `.xlsx`, CSV with BOM and `;` delimiter as French-locale Excel writes it, pasted TSV, quoted commas), header guessing (English/French), list-cell splitting, quota windows, `.ics` generation and sequencing, reminder eligibility, sender selection, token hashing, Zod schemas.
- **Integration:** API routes and Postgres functions against local Supabase (`supabase start`, ports 443xx — #52), including an RLS matrix (Owner / Admin / Viewer / non-member / anon: Viewer cannot write; no cross-workspace reads; Admin cannot manage Admins; exactly one Owner; invite email must match) and the profile trigger. M3 adds the roster tables to the matrix and `import_contacts` cases: a dry run writes no contacts or lists, a commit matches its dry run, re-importing the same rows yields 0 new, in-file duplicates merge, caps hold under two concurrent imports. CI runs them in a `db` job.
- **Email:** fake `EmailSender` in tests; local mail catcher for manual checks.
- **E2E (Playwright, phone viewport):** M2: email-code sign-in (code read from the local mail catcher) → create workspace → invite Viewer → accept. M3: import a CSV → preview counts → roster and list chips → re-import shows 0 new → edit in the sheet survives reload → bulk delete with Undo → Viewer sees no edit controls. Later: create meeting → send → respond via link → dashboard updates. Google sign-in is checked manually on localhost and production. UI changes verified with Playwright MCP per repo rules.
- **Runner:** `bun run test` runs **Vitest** (jsdom + React Testing Library); Playwright for E2E.
- **CI (GitHub Actions):** lint, format check, typecheck, tests on every PR.
- **Accessibility:** WCAG 2.2 AA — text on every token color pair ≥ 4.5:1 (asserted in design-token unit tests), visible focus rings, ≥ 44 px tap targets, full keyboard support.
- **Browser support:** latest 2 versions of Chrome, Edge, Firefox, Safari; iOS Safari 16.4+ (Web Push for installed web apps); Android Chrome.

### Workflow
One branch per agent-task issue (`feat/<issue#>-<slug>`), PR using the repo template, CI must pass, code review, **squash merge** into a protected `main`.

---

## 13. Spikes (M0)

| ID | Question | Pass condition | Fallback |
|---|---|---|---|
| S1 | Can Supabase Cron on the Free plan call a Vercel route every minute via `pg_net`? | Calls observed every minute for an hour | Scheduled GitHub Actions workflow (verify its minimum interval and reliability) |
| S2 | `.ics` `REQUEST` vs `PUBLISH`: behavior of invite, update (`SEQUENCE`) and cancel in Gmail, Outlook, Apple Calendar | Chosen method adds, updates in place and removes the event in all three | Calendar link only + downloadable `.ics` |
| S3 | Can `<app>.vercel.app` be verified in Google Search Console and accepted as an OAuth authorized domain? | Ownership verified; domain accepted in consent screen config | Gmail sending stays in unverified mode (100-user cap) until a free domain option exists |
| S4 | Gmail API send from an unverified app: consent flow, warning screen, refresh-token lifetime | Organizer connects and sends; refresh token still works after 7+ days (checks Testing vs In-production token lifetime); consumer Gmail API daily send limit documented | Stop and decide with the owner: without organizer-Gmail sending there is no meeting-email path (no shared fallback by decision) |

**Results (2026-10-05):**
- **S1 — PASS.** 629/629 runs over 10 h 28 min, max gap 61 s, all retained responses HTTP 200. Supabase Cron schedules the dispatcher. `docs/spikes/S1.md`
- **S2 — decided.** `PUBLISH` duplicates on update and is not removed by cancel; `REQUEST` updates/cancels in place. Calendar invites are sent pre-accepted after the member responds (see §4, §9). Outlook/Apple untested. `docs/spikes/S2.md`
- **S3 — PASS.** Search Console verified `https://tapnshow.vercel.app/`; Google accepted `tapnshow.vercel.app` as an authorized domain. `docs/spikes/S3.md`
- **S4 — day 0 PASS, final 2026-10-13.** Consent + send via Gmail API work; `gmail.send` is sensitive; Testing-status refresh tokens expire after 7 days (Google docs), so production uses "In production" (unverified until M9). `docs/spikes/S4.md`

**S5 (deferred, before calendar layer B):** classify `calendar.app.created` / `calendar.events` in the Google Cloud console and determine verification requirements.

Each spike ends with a **Decision** issue recording evidence and the outcome; affected spec sections are updated.

---

## 14. Delivery Plan

| # | Milestone | Done when |
|---|---|---|
| M0 | Spikes S1–S4 | Decision issues closed with evidence |
| M1 | Foundation — scaffold, tooling (lint/format/test), CI, branch protection, Sentry, typed config, logger, i18n, design tokens (light/dark), core components (Button, Card, Sticker, Chip, Input), motion tokens, Supabase baseline | Style-B component showcase deployed |
| M2 | Auth & workspaces — platform Gmail as Supabase custom SMTP (done 2026-10-05), Google (own callback) + email-code sign-in, profiles, workspaces, Owner/Admin/Viewer roles, ownership transfer, deletion, invites (emailed or copied link, email-bound), rate limits, app shell, branded auth emails | **Done 2026-10-06:** sign in (code or Google), create workspace, invite a Viewer who accepts; RLS tests prove isolation |
| M3 | Contacts & lists — roster (cards + sheet on phones, grid on wider screens), lists, CSV/Excel/paste import with column matching and dry-run preview, merge on re-import, bulk actions; plus #87 (lint-0029 wrappers, Settings skeleton, Google "G" check in Safari/Firefox, preview `VERCEL_URL` check; rate-limit cleanup moved to M4) | The club roster is imported into production with lists from its Team column, and a second import of the same file reports 0 new |
| M4 | Meetings & sending — Google OAuth connection + GmailApiSender (moved from M7), wizard, outbox, dispatcher, quotas, invite email + `.ics`, unsubscribe + "Not my group", send progress, daily cleanup of `private.rate_limit_events` (from #87) | Invites land in inboxes from the organizer's Gmail |
| M5 | Responses — `/r/[token]`, three modes, edits until start, live dashboard, per-member history, export | **MVP usable by the club** |
| M6 | Lifecycle & reminders — edit/cancel updates, reconfirmation, reminders, nudge non-responders, post-meeting check-in, duplicate meeting | |
| M7 | Google Sheets sync | |
| M8 | Member accounts & PWA — `/invites`, push, install flow, offline shell, account deletion | |
| M9 | Public launch — landing, privacy/terms, security header audit, platform admin page, Google verification submission; switch system email to Resend if a domain is owned | |
| Backlog | Calendar layer B, layer C, French/Arabic, organizer digest email, auto-delete of old reasons | |

### Process
- This spec is the single product/architecture reference.
- An implementation plan is written **per milestone** when that milestone starts; the first plan covers **M0 + M1**.
- GitHub: one GitHub Milestone per M#, one **Epic** issue per milestone, **agent-task** sub-issues from each plan, **Decision** issues for spike outcomes; labels `type:epic`, `type:task`, `type:spike`, `type:decision`, `area:*`.

---

## 15. Open Items

- **Claim `tapnshow.vercel.app`** early (first Vercel deploy in M1) — subdomains are first-come, first-served; availability was checked on 2026-10-04 only.
- Spike outcomes S1–S4 may change §5 (scheduler), §9 (`.ics` method, verification path) and the default sender.
