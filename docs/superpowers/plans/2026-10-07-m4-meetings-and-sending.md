# TapNShow M4 (Meetings & Sending) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Owner connects the workspace's sender Gmail; an Owner or Admin creates a meeting in the four-step wizard, confirms "Send 30 invites from club@gmail.com now?", and every invitee receives a personal invite from `"<Workspace>" <club@gmail.com>`, threaded as one conversation in the sender's Sent folder, with working unsubscribe and "Not my group" pages; quotas and at-most-once delivery are proven by tests.

**Architecture:** Postgres holds meetings, their audience, the invitee snapshot and an outbox (`outbox_jobs`) behind RLS. Drafts are edited through RLS; anything that touches the queue goes through `private` `SECURITY DEFINER` functions behind `public` wrappers, and the dispatcher's queue functions are `public` `SECURITY INVOKER` functions executable by `service_role` only. `POST …/send` snapshots invitees and enqueues one `invite` job each, then starts a dispatch with `after()`; Supabase Cron calls `POST /api/internal/dispatch` every minute on production when jobs are due. One dispatcher run owns one sender (lease per Google account), reserves quota in `send_log` before each send (400 per rolling 24 h, 60 per minute), sends through the Gmail REST API with a refresh token decrypted from `google_connections` (AES-256-GCM), threads each meeting's emails with `threadId`, and never retries a send whose outcome is unknown. The UI is client components on TanStack Query, behind `NEXT_PUBLIC_MEETINGS_ENABLED` until the rollout task.

**Tech Stack:** Next.js 16.3.8 (`after()`, `maxDuration`), React 19.2.8, TypeScript 5, bun 1.3.11, `@supabase/supabase-js` 2.117.2 + `@supabase/ssr` 0.12.7, Supabase CLI 2.119.0 (local ports 44320–44329), Postgres 17 + `pg_cron` + `pg_net` + Vault, `zod` 4.6, `@tanstack/react-query` 5.104, `radix-ui` 1.6, `cmdk` 1.1, `date-fns` 4 + `@date-fns/tz` 1.5, `react-email` 6.11, `nodemailer` 10 (`nodemailer/lib/mail-composer` for MIME only), **new:** `markdown-it` 15.0.2 (ships its own types; agenda rendering, `html: false`), `react-day-picker` 10.0.2 (date grid; depends on `date-fns` 4 + `@date-fns/tz`, both already installed). Vitest 5, Playwright 1.63. Both new packages checked on npm 2026-10-07 (MIT, released within the last month).

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md` — read §4 (Sending, Meeting wizard, Confirmations rows), §5 (Scheduler), §6 (workspaces, contacts, Meetings, Integrations & pipeline, Identity rules), §7.2, §7.12, §7.15, §7.16, §8 (whole section), §9 (Google connection, Meeting invite email, Email compliance), §10 (routes, Meetings API), §11, §12 (M4 tests) and §14 (M4 row) before starting. Design approved 2026-10-07 (branch `docs/m4-spec`). Epic #6; #119 folded in (Tasks 18–19).

## Global Constraints

- Everything from the M0+M1, M2 and M3 plans' Global Constraints still applies: free only; bun; **no Server Actions** and no RSC data reads (every read and write through `src/app/api/**/route.ts` + TanStack Query); no emojis anywhere (UI, emails); no `any`/`unknown` (the ESLint rule bans the `unknown` keyword, including `as unknown as`); no `console.*`; JSDoc on every export; imports at the top of the file only; no hardcoded values; SQL only in `supabase/migrations/*` and `src/server/queries/*`; every UI and email string through next-intl (`messages/en.json`); Soft Neobrutalism; Expressive motion with a reduced-motion fallback; WCAG 2.2 AA; ≥ 44 px tap targets; one branch + PR per task with the repo template, CI green including `db`, squash merge, commit trailer from the session's attribution reminder.
- **No native form controls** (owner rule): no browser-styled checkbox, radio, select, date or time inputs. Dates and times use `DatePicker` / `TimePicker` (Task 12); lists of choices use `Chip`, `SegmentedControl`, `Switch`, `Checkbox`.
- **Confirm dialogs for important actions** (owner rule, spec §4): Send, Invite more, Disconnect Gmail, Replace sender and Delete draft each open `ConfirmDialog` (Task 12) whose title names the consequence, e.g. "Send 30 invites from club@gmail.com now?".
- Supabase: every new `public` table gets `enable row level security`, `revoke all … from anon, authenticated`, explicit column `GRANT`s to `authenticated` and `grant all … to service_role`. Policies are `to authenticated`, use `private.is_member(workspace_id[, roles])`, and UPDATE policies have `using` and `with check`.
- **Function security (spec §11):** no `SECURITY DEFINER` function in `public`. Definer bodies live in `private` with `set search_path = ''`, check `auth.uid()` and the role themselves, and get a `public` `SECURITY INVOKER` wrapper with the same signature. Dispatcher and token-page functions are `public` `SECURITY INVOKER`, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role`. Every private function granted to `authenticated` is added to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` in `src/server/db/function-security.db.test.ts` (sorted) in the same PR. Run `supabase db advisors --local </dev/null` after every migration; expected: no WARN or ERROR.
- Database errors meant for users: `raise exception 'tn:<code>' using errcode = 'P0001'`, no user data in messages. New codes (Task 4/11 add them to `API_ERROR_CODES` + `ApiErrors`): `owner_only` (403), `sender_not_connected` (409), `sender_broken` (409), `meeting_not_draft` (409), `meeting_in_past` (409), `meeting_incomplete` (400), `too_many_invitees` (409), `nothing_to_send` (409), `gmail_connect_unavailable` (404).
- **Limits live in `private.app_limits` only:** new rows `meetings_per_user_per_hour` 30, `meeting_people_adds_per_user_per_hour` 120, `gmail_sends_per_day` 400, `gmail_sends_per_minute` 60, `invitees_per_meeting_max` 500, `meeting_people_per_call_max` 50, `dispatch_job_max_attempts` 6 (the first try plus retries after 1, 2, 4, 8 and 16 min), `token_requests_per_ip_per_hour` 120, `token_requests_per_token_per_hour` 30. Client-only constants (time-step minutes, duration chips, delay chips, progress poll interval, pacing, run budget) live in `src/config/meetings.ts`.
- Every mutating workspace route: `rejectCrossOrigin` → `loadWorkspaceContext` → `forbidViewer` → `parseJsonBody` with a shared Zod schema → query module → `fromDatabaseError`. Public token routes (`/api/r/[token]/**`) skip the Origin check on purpose: they carry no cookies, the token is the credential, and RFC 8058 one-click unsubscribe POSTs come from mail providers; they are rate limited per IP and per token instead.
- **Secrets** (spec §11): `GOOGLE_TOKEN_ENCRYPTION_KEY` (base64 of 32 random bytes), `INVITE_TOKEN_SECRET` and `DISPATCH_SECRET` (base64url of 32 random bytes each). They are optional in `serverEnvSchema` (CI and previews without sending still boot) and read through `requireSecret()` (Task 3), which throws a clear error where one is needed. Never printed, never logged; `.env.local` backup blocks updated in the same step that creates them (Task 20). The dispatch URL and secret also go into Supabase Vault on production (Task 20).
- **Rollout flags** (as M3 did): `NEXT_PUBLIC_MEETINGS_ENABLED` (`z.stringbool().default(false)`) hides "+", the Meetings pages, the Sending/Meeting-defaults cards and the Home Gmail item until Task 20; it is `true` in `.env.local`, on Vercel Preview and in Vitest/Playwright. `NEXT_PUBLIC_GMAIL_CONNECT_ENABLED` (default false) is `true` only where `tapnshow-web` has the connect redirect URI: Production and `.env.local` (spec §5: previews draft but cannot send).
- Links in emails are built from `NEXT_PUBLIC_APP_URL` (the dispatcher has no request), never from a header.
- UI verification: Playwright screenshots at **390 px light, 320 px dark and 1024 px desktop** for every new screen, no horizontal page scroll at 320 px, dialogs centered at 1024 px (M3 lesson: tailwind-merge can drop positional classes), hidden scrollbars on horizontal chip rows, `p-1.5` inner padding in popovers and menus, matching footer button heights across wizard steps.
- Local stack: `supabase start` (API 44321, DB 44322, Studio 44323, Mailpit 44324/44325). Always run the CLI with `</dev/null`; `supabase db query` with `--agent no`. Stop any `next dev` before `bun run test:e2e` (`ss -ltnp`, kill by PID; never `pkill -f`). Regenerate types with `bun run db:types` after each migration.
- **Hosted migration procedure** (every DB task, right after its PR merges, because every merge deploys to production): the database passwords live in `~/.config/tapnshow/supabase-db-passwords.env` (list names with `cut -d= -f1`; never print values) and reach the CLI through `SUPABASE_DB_PASSWORD`. Preview first, then production; the repo stays linked to production:
  ```bash
  supabase link --project-ref wayabcidwnhgaazgsuns </dev/null
  supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
  supabase link --project-ref dysqhjvwabqahpctytnw </dev/null
  supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
  ```
  Expected: the new migration applied on both; no new WARN/ERROR (record the advisor output in the ledger).
- **No real sends during development** except Task 20's owner-run production check to the owner's own test addresses. Tests use a fake Gmail endpoint; local manual runs use the owner's test addresses only (never the club roster).

## Review Focus

1. **A crash or timeout right after Gmail accepted an email** — the member must not get the invite twice; the invitee shows "Delivery unknown, check Sent". Pinned in Task 6 (`dispatch_claim` turns an expired lease with `send_started_at` into `unknown`) and Task 10 (fetch that throws after the request → `unknown`, no retry).
2. **Two dispatcher runs at once** (cron tick + `after()` from a Send) — they must never both send for the same Gmail account or both pass the daily cap. Pinned in Task 6 (two concurrent `dispatch_claim` calls get different senders or nothing; concurrent `dispatch_reserve` at cap − 1 lets exactly one through).
3. **A person in two selected lists, unticked, or unsubscribed** — counted once, excluded when unticked, skipped (not emailed) when unsubscribed, including someone who unsubscribes between Send and their turn in the queue. Pinned in Task 5 (`meeting_audience` counts), Task 6 (`send_meeting` snapshot) and Task 10 (unsubscribe after snapshot → `skipped`).
4. **Meeting times across time zones and DST** — "Thu 9 Oct, 18:00" picked in Africa/Tunis by an organizer whose browser is in Europe/Paris must be stored as 17:00 UTC and shown/emailed as 18:00 with the zone named; a time picked on 25 Oct 2026 (the day Paris leaves summer time) still yields the chosen wall time. Pinned in Task 8 (`formatMeetingWhen`, `zonedWallTimeToUtc` and `utcToZonedParts` tests) and Task 13 (`validateDetails` / `detailsPatch` store the meeting-zone wall time as UTC regardless of the browser's zone).
5. **Hostile or messy text in titles, names and agendas** — `<script>`, `javascript:` links, raw HTML and 5,000-character agendas must render as text or safe links in the wizard preview and in the email, and a workspace name with quotes or non-ASCII ("Club d'Échecs") must survive the From header. Pinned in Task 8 (`renderAgendaHtml`) and Task 9 (`buildMeetingMime` with a quoted UTF-8 display name).

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge spec + plan (docs PR); create the agent-task issues (Tracking); From-name check | — |
| 1 | Task 1 — DB: `pg_cron`/`pg_net` declared, `pg_net` out of `public`, daily housekeeping | 0 |
| 2 | Task 2 — DB: Google connections, workspace sender, meeting defaults | 1 |
| 3 | Task 3 — Server: secrets, token encryption, personal-link tokens, Gmail OAuth helpers | 0 |
| 4 | Task 4 — API: sender + meeting defaults routes, Gmail connect/callback/disconnect, hooks | 2, 3 |
| 5 | Task 5 — DB: meetings, audience, invitees table, `create_meeting`, `add_meeting_people`, `meeting_audience`, import fix | 2 |
| 6 | Task 6 — DB: outbox, `send_log`, leases, `send_meeting`, `meeting_progress`, dispatcher functions, cron kick | 5 |
| 7 | Task 7 — DB: unsubscribe, abuse reports, token-page functions, roster flags | 6 |
| 8 | Task 8 — Meeting time formatting, agenda Markdown, invite email template | 0 |
| 9 | Task 9 — MIME builder and Gmail REST client | 3 |
| 10 | Task 10 — Dispatcher service, `/api/internal/dispatch`, broken-sender alert | 6, 7, 8, 9 |
| 11 | Task 11 — Meetings API, shared schemas, hooks, email preview | 6, 8, 10 |
| 12 | Task 12 — UI primitives: DatePicker, TimePicker, MarkdownEditor, ConfirmDialog | 8 |
| 13 | Task 13 — Wizard shell, Details + Responses steps, Meetings list (draft menu), "+" | 11, 12 |
| 14 | Task 14 — Audience step and "Add people" sheet | 13 |
| 15 | Task 15 — Review step, Send confirm, meeting page with progress, Invite more | 14 |
| 16 | Task 16 — Settings: Sending + Meeting defaults cards; Home checklist and needs-attention | 4, 12 |
| 17 | Task 17 — Public pages `/u`, `/report`, `/r` placeholder; token API; headers + scrubbing; roster marks | 7, 11 |
| 18 | Task 18 — #119 data/API minors | 0 |
| 19 | Task 19 — #119 roster UI minors | 0 |
| 20 | Task 20 — Rollout: e2e story, secrets, Vault, OAuth URIs, migrations, flag removal, production check | 1–19 |

Tasks 3, 8, 18 and 19 are independent of the DB chain; Tasks 1 → 2 → 5 → 6 → 7 are a chain; Tasks 13 → 14 → 15 are a chain.

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–20 with the agent-task template, labels `type:task` + the area labels named in each task, milestone `M4 Meetings & sending`, and add each as a sub-issue of epic #6:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/6/sub_issues -F sub_issue_id="$id"
```
- [ ] Tick "Plan written for M4" in epic #6's body.
- [ ] #119: comment that its items are Tasks 18 and 19 of this plan; close it when both merge.
- [ ] Ledger: `.superpowers/sdd/2026-10-07-m4-meetings-and-sending/progress.md` (git-ignored) with one line per task and every `Ruling:`.
- [ ] **From-name check** happens during Task 10's first real send (grilling 2026-10-07): record `Ruling: From display name kept = yes|no` in the ledger. If **no**, the Review step's sender line shows only the address (`FROM_NAME_KEPT = false` in `src/config/meetings.ts`, Task 15); the header is still set (harmless).
- [ ] **Grilling rulings (2026-10-07):** "+" creates the draft at once; untitled drafts with no date are hidden from Drafts and deleted after 24 h by housekeeping (Task 6, Task 13). Draft cards get a "…" menu with Delete (Task 13). First real Google connect right after Task 4 (Task 4 Step 17). First real send by dev script right after Task 10 (Task 10 Step 11). Limits unchanged.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `supabase/migrations/*_m4_extensions_housekeeping.sql` | `pg_cron`, `pg_net` in `extensions`, `private.housekeeping()`, daily cron job | 1 |
| `src/server/db/housekeeping.db.test.ts` | Cleanup deletes only old rows; cron job registered; `pg_net` not in `public` | 1 |
| `supabase/migrations/*_m4_sender.sql` | Enums, workspace defaults + `sender_connection_id`, `google_connections`, sender functions | 2 |
| `src/server/db/sender.db.test.ts` | Owner-only sender, token column unreadable, defaults RLS | 2 |
| `src/test/db/sender.ts` | `seedConnection` helper (service role) | 2 |
| `src/config/env.ts`, `src/config/public-env.ts`, `src/config/secrets.ts` | New secrets (optional), `requireSecret`, rollout flags | 3 |
| `src/config/gmail.ts` | Endpoints, scopes, cookie name, callback path | 3 |
| `src/server/crypto/secret-box.ts` | AES-256-GCM seal/open with versioned output and associated data | 3 |
| `src/server/crypto/invitee-token.ts` | HMAC-derived personal-link tokens + hash | 3 |
| `src/server/google/gmail-oauth.ts` | Connect authorization URL, cookie, code exchange, ID-token claims, refresh, revoke | 3 |
| `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors`) | New error codes | 4, 11 |
| `src/shared/api/sender.ts` | Sender status + defaults contracts | 4 |
| `src/server/queries/sender.ts` | Sender + defaults supabase-js calls | 4 |
| `src/app/api/workspaces/[slug]/sender/route.ts` | `GET` status, `PUT` choose connection | 4 |
| `src/app/api/workspaces/[slug]/meeting-defaults/route.ts` | `GET`/`PATCH` defaults | 4 |
| `src/app/api/integrations/google/{connect,callback}/route.ts`, `…/connections/[id]/route.ts` | Connect, callback, disconnect | 4 |
| `src/hooks/use-sender.ts`, `src/hooks/use-meeting-defaults.ts` | Queries + mutations | 4 |
| `supabase/migrations/*_m4_meetings.sql` | `meetings`, audience tables, `meeting_invitees`, contacts `unsubscribed_via`, draft functions, import fix | 5 |
| `src/server/db/meetings.db.test.ts` | Draft RLS, audience math, add people, import of an ad-hoc guest | 5 |
| `src/test/db/meetings.ts` | `seedMeeting` helper | 5 |
| `supabase/migrations/*_m4_outbox.sql` | `outbox_jobs`, `send_log`, `sender_leases`, `send_meeting`, `meeting_progress`, `dispatch_*`, resume triggers, `kick_dispatcher` + cron | 6 |
| `src/server/db/outbox.db.test.ts` | Snapshot, idempotency, claim/lease concurrency, reserve at cap, unknown on expired lease, pause/resume | 6 |
| `supabase/migrations/*_m4_tokens.sql` | `abuse_reports`, `token_*` functions, token rate limit, `roster()` flags | 7 |
| `src/server/db/tokens.db.test.ts` | Token lookup, unsubscribe/report/resubscribe, rate limits, roster flags | 7 |
| `src/config/meetings.ts` | Constants mirrored from the database and client tuning (chips, steps, poll interval, pacing, budget) | 4, 8–15 |
| `src/lib/meetings/format.ts` | `formatMeetingWhen`, `meetingSubject`, `formatDeadline`, `zonedWallTimeToUtc`, `utcToZonedParts` | 8 |
| `src/lib/markdown/agenda.ts` | `renderAgendaHtml` (markdown-it, safe subset) | 8 |
| `src/emails/meeting-invite-email.tsx` | Invite email (HTML + text) | 8 |
| `src/server/gmail/mime.ts` | `buildMeetingMime` (MailComposer → base64url) | 9 |
| `src/server/gmail/gmail-client.ts` | `sendGmailMessage`, `classifyGmailResponse` | 9 |
| `src/server/queries/dispatch.ts` | Typed wrappers over `dispatch_*` RPCs (admin client) | 10 |
| `src/server/dispatch/run-dispatch.ts` | The dispatcher loop | 10 |
| `src/server/dispatch/dispatch-deps.ts` | Production wiring (admin client, fetch, secrets, mailer) | 10 |
| `src/server/dispatch/schedule-dispatch.ts` | `scheduleDispatch()` for `after()` | 10 |
| `src/emails/sender-broken-email.tsx` | Platform alert to the Owner | 10 |
| `src/app/api/internal/dispatch/route.ts` | Secret-protected trigger | 10 |
| `src/server/dispatch/run-dispatch.db.test.ts` | Dispatcher against local DB + fake Gmail | 10 |
| `src/shared/api/meetings.ts` | Meeting, audience, progress, send contracts | 11 |
| `src/server/queries/meetings.ts` | Meetings supabase-js calls | 11 |
| `src/app/api/workspaces/[slug]/meetings/**` | List/create, get/patch/delete, audience, people, preview, send, progress | 11 |
| `src/hooks/use-meetings.ts` | Queries + mutations | 11 |
| `src/components/ui/{date-picker,time-picker,markdown-editor}.tsx`, `src/components/forms/confirm-dialog.tsx` | New primitives | 12 |
| `src/app/w/[slug]/meetings/page.tsx` + `meetings-list.tsx` | Upcoming · Drafts · Past | 13 |
| `src/app/w/[slug]/meetings/new/page.tsx` | "+" target: creates a draft, redirects to the editor | 13 |
| `src/app/w/[slug]/meetings/[id]/edit/*` | Wizard shell + steps | 13–15 |
| `src/app/w/[slug]/meetings/[id]/page.tsx` + `send-progress.tsx` + `invitee-list.tsx` | Meeting page | 15 |
| `src/app/w/[slug]/settings/{sending-section,meeting-defaults-section}.tsx` | Settings cards | 16 |
| `src/app/w/[slug]/{home-checklist,needs-attention}.tsx` | Home | 16 |
| `src/app/api/r/[token]/**`, `src/server/queries/tokens.ts`, `src/shared/api/tokens.ts` | Public token API | 17 |
| `src/app/{u,report,r}/[token]/page.tsx` | Public pages | 17 |
| `src/config/security-headers.ts`, `src/lib/observability/scrub.ts` | `/u`, `/report`, `/api/r` rules | 17 |
| `e2e/meetings.spec.ts`, `e2e/helpers/fake-gmail.ts` | M4 e2e story | 20 |

---

### Task 1: DB — `pg_cron` / `pg_net` declared, `pg_net` out of `public`, daily housekeeping

**Labels:** `area:db`

**Files:**
- Create: `supabase/migrations/<timestamp>_m4_extensions_housekeeping.sql` (`supabase migration new m4_extensions_housekeeping </dev/null`), `src/server/db/housekeeping.db.test.ts`
- Modify: `src/server/db/database.types.ts` (regenerated; expected unchanged)

**Interfaces:**
- Consumes: `private.rate_limit_events` (M2).
- Produces:
  - Extensions `pg_cron` and `pg_net` (schema `extensions`; pg_net's functions stay in schema `net`) on every environment.
  - `private.housekeeping() returns void` (`SECURITY DEFINER`, executable by nobody but its owner and cron). Task 6 replaces it with a version that also trims `outbox_jobs` and `send_log`.
  - Cron job `tn-housekeeping`, schedule `17 3 * * *` (03:17 UTC daily).

Why: S1 enabled both extensions by hand on production, so a fresh project (preview, local, CI) differs from production; the advisor flags `pg_net` in `public` on production (lint 0014). Supabase's troubleshooting guide documents the fix: with an empty `net.http_request_queue`, `drop extension pg_net; create extension pg_net schema extensions;`. S1's cron job was unscheduled on 2026-10-05, so the queue is empty. `hit_rate_limit` only trims the key it touches, so keys that are never hit again (old IPs, users) stay forever without this job.

- [ ] **Step 1: Write the failing DB test** — `src/server/db/housekeeping.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";

const one = <T extends z.ZodTypeAny>(row: T) => z.array(row).length(1);

describe("housekeeping (spec §8)", () => {
  it("installs pg_net outside public and pg_cron", () => {
    const rows = queryLocalSql(
      `select e.extname as name, n.nspname as schema from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
       where e.extname in ('pg_cron', 'pg_net') order by 1`,
      z.array(z.object({ name: z.string(), schema: z.string() })),
    );
    expect(rows.map((row) => row.name)).toEqual(["pg_cron", "pg_net"]);
    expect(rows.find((row) => row.name === "pg_net")?.schema).toBe("extensions");
  });

  it("schedules the daily job", () => {
    const [job] = queryLocalSql(
      "select schedule, command from cron.job where jobname = 'tn-housekeeping'",
      one(z.object({ schedule: z.string(), command: z.string() })),
    );
    expect(job.schedule).toBe("17 3 * * *");
    expect(job.command).toContain("private.housekeeping()");
  });

  it("deletes rate-limit events older than two days and keeps recent ones", () => {
    const key = `housekeeping-test:${crypto.randomUUID()}`;
    runLocalSql(
      `insert into private.rate_limit_events (key, occurred_at) values
         ('${key}', now() - interval '3 days'),
         ('${key}', now() - interval '47 hours'),
         ('${key}', now())`,
    );
    runLocalSql("select private.housekeeping()");
    const [left] = queryLocalSql(
      `select count(*)::int as n from private.rate_limit_events where key = '${key}'`,
      one(z.object({ n: z.number() })),
    );
    expect(left.n).toBe(2);
  });

  it("is not executable by API roles", () => {
    const [row] = queryLocalSql(
      `select has_function_privilege('authenticated', 'private.housekeeping()', 'EXECUTE') as a,
              has_function_privilege('anon', 'private.housekeeping()', 'EXECUTE') as b,
              has_function_privilege('service_role', 'private.housekeeping()', 'EXECUTE') as c`,
      one(z.object({ a: z.boolean(), b: z.boolean(), c: z.boolean() })),
    );
    expect(row).toEqual({ a: false, b: false, c: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:db -- src/server/db/housekeeping.db.test.ts`
Expected: FAIL — `pg_net` schema is not `extensions` (or `pg_cron` missing) and `private.housekeeping()` does not exist.

- [ ] **Step 3: Write the migration** — `supabase migration new m4_extensions_housekeeping </dev/null`, then fill it:
```sql
-- M4 (spec §8 Housekeeping): declare the extensions S1 enabled by hand, move pg_net out of public
-- (advisor lint 0014; Supabase troubleshooting guide: drop + create with an empty request queue),
-- and trim rate-limit events that hit_rate_limit never revisits.

create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net' and n.nspname <> 'extensions'
  ) then
    drop extension pg_net;
  end if;
end;
$$;
create extension if not exists pg_net with schema extensions;

create function private.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.rate_limit_events e where e.occurred_at < pg_catalog.now() - interval '2 days';
end;
$$;
revoke execute on function private.housekeeping() from public, anon, authenticated, service_role;

select cron.schedule('tn-housekeeping', '17 3 * * *', $$select private.housekeeping()$$);
```

- [ ] **Step 4: Apply and run the test**

Run: `supabase migration up --local </dev/null && bun run test:db -- src/server/db/housekeeping.db.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Advisors, types, full DB suite**

Run: `supabase db advisors --local </dev/null` — expected: no WARN/ERROR.
Run: `bun run db:types && git diff --stat src/server/db/database.types.ts` — expected: no change (nothing new in `public`).
Run: `bun run test:db` — expected: all green (the M3 `function-security` test is unaffected: nothing new is granted to `authenticated`).

- [ ] **Step 6: Commit and PR**
```bash
git checkout -b feat/<issue>-m4-extensions-housekeeping
git add supabase/migrations src/server/db/housekeeping.db.test.ts
git commit -m "feat(db): declare pg_cron and pg_net, move pg_net out of public, daily housekeeping"
```
Open the PR (template filled; "Closes #<issue>"), wait for `quality` and `db`, squash-merge.

- [ ] **Step 7: Hosted rollout** — run the **Hosted migration procedure** (Global Constraints). Expected: on production the advisor no longer reports `extension_in_public` for `pg_net`; `select jobname from cron.job` lists `tn-housekeeping` on both projects. **Stop condition:** if `drop extension pg_net` fails on a hosted project (insufficient privilege or dependent objects), stop and report the exact error to the owner; Supabase's guide says to contact support in that case.

---

### Task 2: DB — Google connections, workspace sender, meeting defaults

**Labels:** `area:db`

**Files:**
- Create: `supabase/migrations/<timestamp>_m4_sender.sql`, `src/server/db/sender.db.test.ts`, `src/test/db/sender.ts`
- Modify: `src/server/db/function-security.db.test.ts` (allow-list), `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: `private.is_member`, `private.role_of`, `private.is_valid_email`, `private.app_limit`, `private.set_updated_at` (M2/M3).
- Produces (later tasks rely on these exact names):
  - Enums `public.response_mode` (`announcement` | `rsvp` | `attendance`), `public.location_mode` (`in_person` | `online` | `hybrid`), `public.connection_status` (`active` | `broken`).
  - `private.valid_delay_options(smallint[]) returns boolean` (CHECK helper: ≤ 6 distinct values, each 1–240).
  - Table `public.google_connections` (spec §6) — `authenticated` may `SELECT` every column **except** `refresh_token_encrypted`, own rows only; no direct writes.
  - Columns on `public.workspaces`: `sender_connection_id` (only through `set_workspace_sender`), `default_response_mode`, `default_delay_options`, `default_reason_required`, `default_comments_enabled`, `default_footer_note` (`''` = none), `default_duration_minutes` (updatable by Owner/Admin through the existing RLS policy).
  - Table `public.send_log` (`id`, `google_sub`, `workspace_id`, `job_id`, `sent_at`; service role only). Task 6 adds the foreign key from `job_id` to `outbox_jobs`.
  - RPCs (public invoker wrappers over private definer bodies):
    - `save_google_connection(p_user uuid, p_google_sub text, p_google_email text, p_scopes text[], p_token_encrypted text) returns uuid` — **service role only** (security review fix, migration `*_m4_save_connection_service_role.sql`): upsert by (`p_user`, `google_sub`); resets `status` to `active`.
    - `set_workspace_sender(p_workspace uuid, p_connection uuid) returns void` — Owner only (`tn:owner_only` for Admin/Viewer, `tn:forbidden` for non-members); the connection must be the caller's and active (`tn:not_found`).
    - `disconnect_google_connection(p_connection uuid) returns jsonb` — the caller's own connection only; deletes it and returns `{ "refresh_token_encrypted": "…", "google_sub": "…" }` (the route opens the token with its associated data and revokes it); `tn:not_found` otherwise. Workspaces using it get `sender_connection_id = null` (FK `on delete set null`).
    - `workspace_sender(p_workspace uuid) returns jsonb` — any member:
      ```json
      { "sender": null | { "connection_id": "uuid", "email": "club@gmail.com", "status": "active",
                            "connected_by": "Daly", "connected_at": "…", "is_mine": true,
                            "sent_last_24h": 12, "daily_limit": 400 },
        "owner_name": "Daly",
        "my_connections": [{ "id": "uuid", "email": "…", "status": "active", "used_by": ["Club A"] }] }
      ```
  - Limit row `gmail_sends_per_day` = 400.

- [ ] **Step 1: Test helper** — `src/test/db/sender.ts`:
```ts
import { adminClient } from "./clients";

/**
 * Inserts a Google connection for `userId` (service role; the token is an opaque test string, not
 * a real ciphertext). Returns its id.
 */
export async function seedConnection(
  userId: string,
  options: { email?: string; sub?: string; status?: "active" | "broken" } = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("google_connections")
    .insert({
      user_id: userId,
      google_sub: options.sub ?? `sub-${crypto.randomUUID()}`,
      google_email: options.email ?? `sender-${crypto.randomUUID().slice(0, 8)}@example.test`,
      granted_scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
      refresh_token_encrypted: "v1.test.test.test",
      status: options.status ?? "active",
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/** Makes `connectionId` the workspace's sender (service role, bypasses the Owner check). */
export async function setSender(workspaceId: string, connectionId: string | null): Promise<void> {
  const { error } = await adminClient()
    .from("workspaces")
    .update({ sender_connection_id: connectionId })
    .eq("id", workspaceId);
  if (error) {
    throw error;
  }
}
```

- [ ] **Step 2: Write the failing DB tests** — `src/server/db/sender.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedConnection, setSender } from "@/test/db/sender";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const senderSchema = z.object({
  sender: z
    .object({
      connection_id: z.uuid(),
      email: z.string(),
      status: z.enum(["active", "broken"]),
      connected_by: z.string(),
      connected_at: z.string(),
      is_mine: z.boolean(),
      sent_last_24h: z.number(),
      daily_limit: z.number(),
    })
    .nullable(),
  owner_name: z.string(),
  my_connections: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      status: z.enum(["active", "broken"]),
      used_by: z.array(z.string()),
    }),
  ),
});

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  outsider = await createTestUser({ fullName: "Outsider" });
  workspace = await createWorkspaceAs(owner, "Sender Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("google_connections", () => {
  it("saves a connection once per Google account and reactivates it on reconnect", async () => {
    const first = await owner.client.rpc("save_google_connection", {
      p_google_sub: "sub-1",
      p_google_email: " Club@Gmail.com ",
      p_scopes: ["openid", "email", GMAIL_SEND],
      p_token_encrypted: "v1.a.b.c",
    });
    expect(first.error).toBeNull();
    await adminClient()
      .from("google_connections")
      .update({ status: "broken", broken_reason: "invalid_grant" })
      .eq("id", first.data ?? "");
    const second = await owner.client.rpc("save_google_connection", {
      p_google_sub: "sub-1",
      p_google_email: "club@gmail.com",
      p_scopes: ["openid", "email", GMAIL_SEND],
      p_token_encrypted: "v1.d.e.f",
    });
    expect(second.data).toBe(first.data);
    const row = await owner.client
      .from("google_connections")
      .select("google_email, status, broken_reason")
      .eq("id", first.data ?? "")
      .single();
    expect(row.data).toEqual({ google_email: "club@gmail.com", status: "active", broken_reason: null });
  });

  it("refuses a connection without gmail.send", async () => {
    await expectAppError(
      owner.client.rpc("save_google_connection", {
        p_google_sub: "sub-2",
        p_google_email: "club@gmail.com",
        p_scopes: ["openid", "email"],
        p_token_encrypted: "v1.a.b.c",
      }),
      "invalid_input",
    );
  });

  it("never exposes the token column and hides other users' rows", async () => {
    const id = await seedConnection(owner.id);
    const token = await owner.client
      .from("google_connections")
      .select("refresh_token_encrypted")
      .eq("id", id);
    expect(token.error?.code).toBe("42501");
    const mine = await owner.client.from("google_connections").select("id").eq("id", id);
    expect(mine.data).toEqual([{ id }]);
    const theirs = await outsider.client.from("google_connections").select("id").eq("id", id);
    expect(theirs.data).toEqual([]);
    const write = await owner.client
      .from("google_connections")
      .update({ status: "active" })
      .eq("id", id);
    expect(write.error?.code).toBe("42501");
  });
});

describe("set_workspace_sender", () => {
  it("lets only the Owner choose their own active connection", async () => {
    const mine = await seedConnection(owner.id);
    const adminsOwn = await seedConnection(admin.id);
    const broken = await seedConnection(owner.id, { status: "broken" });
    await expectAppError(
      admin.client.rpc("set_workspace_sender", { p_workspace: workspace.id, p_connection: adminsOwn }),
      "owner_only",
    );
    await expectAppError(
      viewer.client.rpc("set_workspace_sender", { p_workspace: workspace.id, p_connection: mine }),
      "owner_only",
    );
    await expectAppError(
      outsider.client.rpc("set_workspace_sender", { p_workspace: workspace.id, p_connection: mine }),
      "forbidden",
    );
    await expectAppError(
      owner.client.rpc("set_workspace_sender", { p_workspace: workspace.id, p_connection: adminsOwn }),
      "not_found",
    );
    await expectAppError(
      owner.client.rpc("set_workspace_sender", { p_workspace: workspace.id, p_connection: broken }),
      "not_found",
    );
    const ok = await owner.client.rpc("set_workspace_sender", {
      p_workspace: workspace.id,
      p_connection: mine,
    });
    expect(ok.error).toBeNull();
    const direct = await admin.client
      .from("workspaces")
      .update({ sender_connection_id: null })
      .eq("id", workspace.id);
    expect(direct.error?.code).toBe("42501");
  });
});

describe("disconnect_google_connection", () => {
  it("returns the token, deletes the row and clears every workspace using it", async () => {
    const id = await seedConnection(owner.id, { sub: "sub-disc" });
    await setSender(workspace.id, id);
    await expectAppError(
      admin.client.rpc("disconnect_google_connection", { p_connection: id }),
      "not_found",
    );
    const result = await owner.client.rpc("disconnect_google_connection", { p_connection: id });
    expect(result.data).toEqual({ refresh_token_encrypted: "v1.test.test.test", google_sub: "sub-disc" });
    const row = await adminClient().from("workspaces").select("sender_connection_id").eq("id", workspace.id).single();
    expect(row.data?.sender_connection_id).toBeNull();
  });
});

describe("workspace_sender", () => {
  it("shows the sender to every member, with usage, and lists only my connections", async () => {
    const id = await seedConnection(owner.id, { email: "club@gmail.com", sub: "sub-club" });
    await setSender(workspace.id, id);
    await adminClient().from("send_log").insert([
      { google_sub: "sub-club", workspace_id: workspace.id },
      { google_sub: "sub-club", workspace_id: workspace.id, sent_at: new Date(Date.now() - 25 * 3600_000).toISOString() },
    ]);
    const asViewer = senderSchema.parse(
      (await viewer.client.rpc("workspace_sender", { p_workspace: workspace.id })).data,
    );
    expect(asViewer.sender).toMatchObject({
      email: "club@gmail.com",
      connected_by: "Owner",
      is_mine: false,
      sent_last_24h: 1,
      daily_limit: 400,
    });
    expect(asViewer.owner_name).toBe("Owner");
    expect(asViewer.my_connections).toEqual([]);
    const asOwner = senderSchema.parse(
      (await owner.client.rpc("workspace_sender", { p_workspace: workspace.id })).data,
    );
    expect(asOwner.sender?.is_mine).toBe(true);
    expect(asOwner.my_connections).toEqual([
      { id, email: "club@gmail.com", status: "active", used_by: ["Sender Club"] },
    ]);
    await expectAppError(
      outsider.client.rpc("workspace_sender", { p_workspace: workspace.id }),
      "forbidden",
    );
  });
});

describe("meeting defaults", () => {
  it("lets Owner/Admin edit the defaults within limits, not Viewers", async () => {
    const ok = await admin.client
      .from("workspaces")
      .update({
        default_response_mode: "rsvp",
        default_delay_options: [10, 20],
        default_reason_required: false,
        default_comments_enabled: true,
        default_footer_note: "Bring your laptop",
        default_duration_minutes: 90,
      })
      .eq("id", workspace.id)
      .select("default_response_mode, default_delay_options")
      .single();
    expect(ok.data).toEqual({ default_response_mode: "rsvp", default_delay_options: [10, 20] });
    for (const bad of [[0], [5, 5], [1, 2, 3, 4, 5, 6, 7], [241]]) {
      const rejected = await admin.client
        .from("workspaces")
        .update({ default_delay_options: bad })
        .eq("id", workspace.id);
      expect(rejected.error?.code).toBe("23514");
    }
    await viewer.client.from("workspaces").update({ default_duration_minutes: 30 }).eq("id", workspace.id);
    const after = await adminClient().from("workspaces").select("default_duration_minutes").eq("id", workspace.id).single();
    expect(after.data?.default_duration_minutes).toBe(90);
  });

  it("starts new workspaces with the documented defaults", async () => {
    const row = await adminClient()
      .from("workspaces")
      .select("default_response_mode, default_delay_options, default_reason_required, default_comments_enabled, default_footer_note, default_duration_minutes, sender_connection_id")
      .eq("id", workspace.id)
      .single();
    expect(row.data).toEqual({
      default_response_mode: "attendance",
      default_delay_options: [5, 10, 15, 30],
      default_reason_required: true,
      default_comments_enabled: false,
      default_footer_note: "",
      default_duration_minutes: 60,
      sender_connection_id: null,
    });
  });
});
```

- [ ] **Step 3: Run to verify failure** — `bun run test:db -- src/server/db/sender.db.test.ts`. Expected: FAIL (`relation "public.google_connections" does not exist`). Typecheck errors on the new tables are expected until Step 5 regenerates types.

- [ ] **Step 4: Migration** — `supabase migration new m4_sender </dev/null`:
```sql
-- M4 sender (spec §6 workspaces + Integrations, §7.15, §9 Google connection).

insert into private.app_limits (name, value) values ('gmail_sends_per_day', 400);

create type public.response_mode as enum ('announcement', 'rsvp', 'attendance');
create type public.location_mode as enum ('in_person', 'online', 'hybrid');
create type public.connection_status as enum ('active', 'broken');

-- CHECK constraints cannot hold subqueries, so the array rule lives in a function.
create function private.valid_delay_options(p_options smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_options is not null
    and pg_catalog.cardinality(p_options) <= 6
    and not exists (select 1 from pg_catalog.unnest(p_options) as x(v) where x.v is null or x.v < 1 or x.v > 240)
    and pg_catalog.cardinality(p_options) = (select count(distinct x.v) from pg_catalog.unnest(p_options) as x(v));
$$;

create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_sub text not null check (char_length(google_sub) between 1 and 255),
  google_email text not null check (google_email = lower(btrim(google_email)) and private.is_valid_email(google_email)),
  granted_scopes text[] not null,
  refresh_token_encrypted text not null,
  status public.connection_status not null default 'active',
  broken_reason text check (broken_reason is null or char_length(broken_reason) <= 200),
  broken_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_sub)
);
create index google_connections_sub_idx on public.google_connections (google_sub);
create trigger google_connections_set_updated_at
  before update on public.google_connections
  for each row execute function private.set_updated_at();

alter table public.workspaces
  add column sender_connection_id uuid references public.google_connections (id) on delete set null,
  add column default_response_mode public.response_mode not null default 'attendance',
  add column default_delay_options smallint[] not null default '{5,10,15,30}'
    check (private.valid_delay_options(default_delay_options)),
  add column default_reason_required boolean not null default true,
  add column default_comments_enabled boolean not null default false,
  add column default_footer_note text not null default ''
    check (default_footer_note = btrim(default_footer_note) and char_length(default_footer_note) <= 280),
  add column default_duration_minutes smallint not null default 60
    check (default_duration_minutes between 5 and 720);
create index workspaces_sender_idx on public.workspaces (sender_connection_id);

-- One row per email reserved or sent (spec §8 quotas), counted per Google account.
create table public.send_log (
  id bigint generated always as identity primary key,
  google_sub text not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  job_id uuid,
  sent_at timestamptz not null default now()
);
create index send_log_sub_time_idx on public.send_log (google_sub, sent_at);
create unique index send_log_job_idx on public.send_log (job_id) where job_id is not null;

alter table public.google_connections enable row level security;
alter table public.send_log enable row level security;
revoke all on table public.google_connections, public.send_log from anon, authenticated;
grant select (id, user_id, google_sub, google_email, granted_scopes, status, broken_reason, broken_at, created_at, updated_at)
  on table public.google_connections to authenticated;
grant all on table public.google_connections, public.send_log to service_role;
grant update (default_response_mode, default_delay_options, default_reason_required, default_comments_enabled,
              default_footer_note, default_duration_minutes)
  on table public.workspaces to authenticated;

create policy google_connections_select_own on public.google_connections
  for select to authenticated using (user_id = (select auth.uid()));

create function private.save_google_connection(
  p_google_sub text,
  p_google_email text,
  p_scopes text[],
  p_token_encrypted text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if not ('https://www.googleapis.com/auth/gmail.send' = any (coalesce(p_scopes, '{}'))) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  insert into public.google_connections (user_id, google_sub, google_email, granted_scopes, refresh_token_encrypted)
  values (v_user, p_google_sub, lower(btrim(p_google_email)), p_scopes, p_token_encrypted)
  on conflict (user_id, google_sub) do update set
    google_email = excluded.google_email,
    granted_scopes = excluded.granted_scopes,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    status = 'active',
    broken_reason = null,
    broken_at = null
  returning id into v_id;
  return v_id;
end;
$$;

create function private.set_workspace_sender(p_workspace uuid, p_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    if private.is_member(p_workspace) then
      raise exception 'tn:owner_only' using errcode = 'P0001';
    end if;
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.google_connections c
    where c.id = p_connection and c.user_id = auth.uid() and c.status = 'active'
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  update public.workspaces set sender_connection_id = p_connection where id = p_workspace;
end;
$$;

create function private.disconnect_google_connection(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_sub text;
begin
  delete from public.google_connections c
  where c.id = p_connection and c.user_id = auth.uid()
  returning c.refresh_token_encrypted, c.google_sub into v_token, v_sub;
  if v_token is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('refresh_token_encrypted', v_token, 'google_sub', v_sub);
end;
$$;

create function private.workspace_sender(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'sender', (
      select pg_catalog.jsonb_build_object(
        'connection_id', c.id,
        'email', c.google_email,
        'status', c.status,
        'connected_by', coalesce(p.display_name, ''),
        'connected_at', c.updated_at,
        'is_mine', c.user_id = v_user,
        'sent_last_24h', (
          select count(*) from public.send_log s
          where s.google_sub = c.google_sub and s.sent_at > pg_catalog.now() - interval '24 hours'
        ),
        'daily_limit', private.app_limit('gmail_sends_per_day')
      )
      from public.workspaces w
      join public.google_connections c on c.id = w.sender_connection_id
      left join public.profiles p on p.user_id = c.user_id
      where w.id = p_workspace
    ),
    'owner_name', coalesce((
      select p.display_name from public.workspace_roles r
      left join public.profiles p on p.user_id = r.user_id
      where r.workspace_id = p_workspace and r.role = 'owner'
    ), ''),
    'my_connections', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', c.id,
          'email', c.google_email,
          'status', c.status,
          'used_by', coalesce((
            select pg_catalog.jsonb_agg(w.name order by w.name)
            from public.workspaces w where w.sender_connection_id = c.id
          ), '[]'::jsonb)
        )
        order by c.google_email
      )
      from public.google_connections c
      where c.user_id = v_user
    ), '[]'::jsonb)
  );
end;
$$;

create function public.save_google_connection(p_google_sub text, p_google_email text, p_scopes text[], p_token_encrypted text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_google_connection(p_google_sub, p_google_email, p_scopes, p_token_encrypted) $$;

create function public.set_workspace_sender(p_workspace uuid, p_connection uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.set_workspace_sender(p_workspace, p_connection) $$;

create function public.disconnect_google_connection(p_connection uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.disconnect_google_connection(p_connection) $$;

create function public.workspace_sender(p_workspace uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.workspace_sender(p_workspace) $$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.valid_delay_options(smallint[]),
  private.save_google_connection(text, text, text[], text),
  private.set_workspace_sender(uuid, uuid),
  private.disconnect_google_connection(uuid),
  private.workspace_sender(uuid)
to authenticated;
-- CHECK constraints run as the writing role (service role for test setup and the dispatcher).
grant execute on function private.valid_delay_options(smallint[]) to service_role;

revoke execute on function
  public.save_google_connection(text, text, text[], text),
  public.set_workspace_sender(uuid, uuid),
  public.disconnect_google_connection(uuid),
  public.workspace_sender(uuid)
from public, anon;
grant execute on function
  public.save_google_connection(text, text, text[], text),
  public.set_workspace_sender(uuid, uuid),
  public.disconnect_google_connection(uuid),
  public.workspace_sender(uuid)
to authenticated;
```

- [ ] **Step 5: Apply, regenerate, allow-list** — `supabase migration up --local </dev/null && bun run db:types`. In `src/server/db/function-security.db.test.ts`, add to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (keep it sorted): `"disconnect_google_connection"`, `"save_google_connection"`, `"set_workspace_sender"`, `"valid_delay_options"`, `"workspace_sender"`.

- [ ] **Step 6: Run** — `bun run test:db -- src/server/db/sender.db.test.ts src/server/db/function-security.db.test.ts` → PASS. `bun run test:db` → all green. `supabase db advisors --local </dev/null` → no WARN/ERROR. `bun run typecheck` → PASS.

- [ ] **Step 7: Commit, PR, merge** — `feat(db): Google connections, workspace sender and meeting defaults`. Then run the **Hosted migration procedure**.

---

### Task 3: Server — secrets, token encryption, personal-link tokens, Gmail OAuth helpers

**Labels:** `area:auth`, `area:api`

**Files:**
- Create: `src/config/secrets.ts`, `src/config/secrets.test.ts`, `src/config/gmail.ts`, `src/server/crypto/secret-box.ts`, `src/server/crypto/secret-box.test.ts`, `src/server/crypto/invitee-token.ts`, `src/server/crypto/invitee-token.test.ts`, `src/server/google/gmail-oauth.ts`, `src/server/google/gmail-oauth.test.ts`
- Modify: `src/config/env.ts`, `src/config/env.test.ts`, `src/config/public-env.ts`, `src/config/public-env.test.ts`, `vitest.config.mts` (test env), `.env.example` if present (names only)

**Interfaces:**
- Consumes: `generateToken`, `sha256Hex`, `sha256Base64Url` (`src/server/crypto/tokens.ts`), `GOOGLE_AUTHORIZATION_ENDPOINT`, `GOOGLE_TOKEN_ENDPOINT` (`src/config/auth.ts`).
- Produces:
  - `ServerEnv` gains optional `GOOGLE_TOKEN_ENCRYPTION_KEY`, `INVITE_TOKEN_SECRET`, `DISPATCH_SECRET` (min 32 chars each when set except the key, which is validated by `parseEncryptionKey`), and `GMAIL_API_BASE_URL` (default `https://gmail.googleapis.com`), `GOOGLE_OAUTH_TOKEN_URL` (default `GOOGLE_TOKEN_ENDPOINT`) — the two URLs exist so e2e can point the dispatcher at a fake Gmail; production never sets them.
  - `PublicEnv` gains `NEXT_PUBLIC_MEETINGS_ENABLED` and `NEXT_PUBLIC_GMAIL_CONNECT_ENABLED` (`z.stringbool().default(false)`).
  - `requireSecret(name: SecretName, env?: ServerEnv): string` with `SecretName = "GOOGLE_TOKEN_ENCRYPTION_KEY" | "INVITE_TOKEN_SECRET" | "DISPATCH_SECRET" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"`; throws `Error("<NAME> is not configured")`.
  - `src/config/gmail.ts`: `GMAIL_SEND_SCOPE`, `GMAIL_CONNECT_SCOPES`, `GMAIL_CONNECT_CALLBACK_PATH = "/api/integrations/google/callback"`, `GMAIL_CONNECT_COOKIE = "tn_gmail_connect"`, `GMAIL_CONNECT_COOKIE_PATH = "/api/integrations/google"`, `GMAIL_CONNECT_COOKIE_MAX_AGE_SECONDS = 600`, `GOOGLE_REVOKE_ENDPOINT`, `GMAIL_SEND_PATH = "/gmail/v1/users/me/messages/send"`.
  - `secret-box.ts`: `parseEncryptionKey(base64: string): Buffer`, `sealSecret(plaintext: string, key: Buffer, associatedData: string): string` (`"v1.<iv>.<ciphertext>.<tag>"`, base64url parts), `openSecret(sealed: string, key: Buffer, associatedData: string): string` (throws on any tampering), `connectionAssociatedData(userId: string, googleSub: string): string`.
  - `invitee-token.ts`: `deriveInviteeToken(inviteeId: string, secret: string): string` (43-char base64url HMAC-SHA256 of `invitee:<id>`), `inviteeTokenHash(token: string): string` (SHA-256 hex).
  - `gmail-oauth.ts`: `GmailConnectState`, `createGmailConnectAuthorization`, `encodeConnectCookie`, `decodeConnectCookie`, `exchangeGmailCode`, `decodeIdTokenClaims`, `refreshGoogleAccessToken`, `revokeGoogleToken` (signatures in Step 9).

The associated data is `google_connection:<user_id>:<google_sub>` rather than the row id because the token is sealed before the row exists (the upsert returns the id); the pair is unique per row, so a ciphertext copied into another user's row fails to open.

- [ ] **Step 1: Failing env tests** — append to `src/config/env.test.ts` inside `describe("parseServerEnv")`:
```ts
  it("keeps the M4 secrets optional and defaults the Google API URLs", () => {
    const env = parseServerEnv({ ...supabase, ...smtp });
    expect(env.INVITE_TOKEN_SECRET).toBeUndefined();
    expect(env.GMAIL_API_BASE_URL).toBe("https://gmail.googleapis.com");
    expect(env.GOOGLE_OAUTH_TOKEN_URL).toBe("https://oauth2.googleapis.com/token");
  });

  it("rejects short M4 secrets and names them", () => {
    expect(() =>
      parseServerEnv({ ...supabase, ...smtp, DISPATCH_SECRET: "short" }),
    ).toThrow(/DISPATCH_SECRET/);
  });
```
Create `src/config/secrets.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";
import { requireSecret } from "./secrets";

const base = parseServerEnv({
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_FROM: "platform@example.test",
  INVITE_TOKEN_SECRET: "x".repeat(43),
});

describe("requireSecret", () => {
  it("returns a configured secret", () => {
    expect(requireSecret("INVITE_TOKEN_SECRET", base)).toBe("x".repeat(43));
  });

  it("names a missing secret without printing values", () => {
    expect(() => requireSecret("DISPATCH_SECRET", base)).toThrow(
      "DISPATCH_SECRET is not configured",
    );
  });
});
```
Append to `src/config/public-env.test.ts`:
```ts
  it("keeps the M4 rollout flags off unless set", () => {
    const env = parsePublicEnv({ NEXT_PUBLIC_APP_URL: "https://tapnshow.vercel.app" });
    expect(env.NEXT_PUBLIC_MEETINGS_ENABLED).toBe(false);
    expect(env.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED).toBe(false);
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_APP_URL: "https://tapnshow.vercel.app",
        NEXT_PUBLIC_MEETINGS_ENABLED: "true",
      }).NEXT_PUBLIC_MEETINGS_ENABLED,
    ).toBe(true);
  });
```
(Place it inside the existing `describe`; check the file's describe name first.)

- [ ] **Step 2: Run to verify failure** — `bun run test src/config` → FAIL (unknown keys / missing module `./secrets`).

- [ ] **Step 3: Implement env + secrets** — in `src/config/env.ts`, add to the `z.object({…})` (and `import { GOOGLE_TOKEN_ENDPOINT } from "./auth";` at the top):
```ts
    GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
    INVITE_TOKEN_SECRET: z.string().min(32).optional(),
    DISPATCH_SECRET: z.string().min(32).optional(),
    GMAIL_API_BASE_URL: z.url().default("https://gmail.googleapis.com"),
    GOOGLE_OAUTH_TOKEN_URL: z.url().default(GOOGLE_TOKEN_ENDPOINT),
```
In `src/config/public-env.ts`, add to the schema and to the literal `parsePublicEnv({…})` call:
```ts
  NEXT_PUBLIC_MEETINGS_ENABLED: z.stringbool().default(false),
  NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: z.stringbool().default(false),
```
```ts
  NEXT_PUBLIC_MEETINGS_ENABLED: process.env.NEXT_PUBLIC_MEETINGS_ENABLED,
  NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: process.env.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED,
```
Create `src/config/secrets.ts`:
```ts
import "server-only";
import { getServerEnv, type ServerEnv } from "./env";

/** Secrets some features need but the app can boot without (CI, previews without sending). */
export type SecretName =
  | "GOOGLE_TOKEN_ENCRYPTION_KEY"
  | "INVITE_TOKEN_SECRET"
  | "DISPATCH_SECRET"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET";

/**
 * Returns a secret the caller cannot work without.
 * @throws Error naming the variable (never its value) when it is not set
 */
export function requireSecret(
  name: SecretName,
  env: ServerEnv = getServerEnv(),
): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}
```
In `vitest.config.mts` `test.env`, add `NEXT_PUBLIC_MEETINGS_ENABLED: "true"` (pages under test render the feature; Task 20 removes the flag).

- [ ] **Step 4: Run** — `bun run test src/config` → PASS.

- [ ] **Step 5: Failing crypto tests** — `src/server/crypto/secret-box.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  connectionAssociatedData,
  openSecret,
  parseEncryptionKey,
  sealSecret,
} from "./secret-box";

const key = randomBytes(32);
const aad = connectionAssociatedData("user-1", "sub-1");

describe("secret box", () => {
  it("round-trips with a fresh IV each time", () => {
    const a = sealSecret("1//refresh-token", key, aad);
    const b = sealSecret("1//refresh-token", key, aad);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(openSecret(a, key, aad)).toBe("1//refresh-token");
  });

  it("refuses other associated data, keys, versions and any flipped byte", () => {
    const sealed = sealSecret("secret", key, aad);
    expect(() => openSecret(sealed, key, connectionAssociatedData("user-2", "sub-1"))).toThrow();
    expect(() => openSecret(sealed, randomBytes(32), aad)).toThrow();
    expect(() => openSecret(sealed.replace(/^v1/, "v2"), key, aad)).toThrow();
    const [version, iv, body, tag] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() => openSecret([version, iv, flipped.toString("base64url"), tag].join("."), key, aad)).toThrow();
    expect(() => openSecret([version, iv, body, tag.slice(0, 8)].join("."), key, aad)).toThrow();
  });

  it("accepts only a 32-byte base64 key", () => {
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
```
`src/server/crypto/invitee-token.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deriveInviteeToken, inviteeTokenHash } from "./invitee-token";

const secret = "s".repeat(43);

describe("invitee tokens", () => {
  it("derives the same 256-bit token for the same invitee and different ones otherwise", () => {
    const a = deriveInviteeToken("11111111-1111-4111-8111-111111111111", secret);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveInviteeToken("11111111-1111-4111-8111-111111111111", secret)).toBe(a);
    expect(deriveInviteeToken("22222222-2222-4222-8222-222222222222", secret)).not.toBe(a);
    expect(deriveInviteeToken("11111111-1111-4111-8111-111111111111", "t".repeat(43))).not.toBe(a);
  });

  it("stores only a SHA-256 hex hash", () => {
    expect(inviteeTokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
```

- [ ] **Step 6: Run to verify failure** — `bun run test src/server/crypto` → FAIL (modules missing).

- [ ] **Step 7: Implement** — `src/server/crypto/secret-box.ts`:
```ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/**
 * Decodes `GOOGLE_TOKEN_ENCRYPTION_KEY`.
 * @throws Error when it is not 32 bytes of base64
 */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  }
  return key;
}

/** Associated data binding a sealed refresh token to its connection (user + Google account). */
export function connectionAssociatedData(userId: string, googleSub: string): string {
  return `google_connection:${userId}:${googleSub}`;
}

/** AES-256-GCM with a random 96-bit IV; output `v1.<iv>.<ciphertext>.<tag>` (base64url parts). */
export function sealSecret(plaintext: string, key: Buffer, associatedData: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/**
 * Opens a value from `sealSecret`.
 * @throws Error on an unknown version, a wrong key or associated data, or any tampering
 */
export function openSecret(sealed: string, key: Buffer, associatedData: string): string {
  const [version, iv, ciphertext, tag, extra] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag || extra !== undefined) {
    throw new Error("Unsupported sealed secret");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
```
`src/server/crypto/invitee-token.ts`:
```ts
import "server-only";
import { createHmac } from "node:crypto";
import { sha256Hex } from "./tokens";

/**
 * Personal-link token for one invitee (spec §6 Identity rules): HMAC-SHA256 of the invitee id with
 * `INVITE_TOKEN_SECRET`, so any later email can rebuild the same link without storing it.
 */
export function deriveInviteeToken(inviteeId: string, secret: string): string {
  return createHmac("sha256", secret).update(`invitee:${inviteeId}`).digest("base64url");
}

/** What the database stores and looks up (`meeting_invitees.token_hash`). */
export function inviteeTokenHash(token: string): string {
  return sha256Hex(token);
}
```

- [ ] **Step 8: Run** — `bun run test src/server/crypto` → PASS.

- [ ] **Step 9: Failing OAuth tests** — create `src/config/gmail.ts` first (constants only):
```ts
/** Gmail sending scope (sensitive; spec §9). */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** "Connect Gmail sending": `openid email` tell us which account was connected. */
export const GMAIL_CONNECT_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE] as const;

/** Registered redirect path of OAuth client `tapnshow-web` for the connect flow. */
export const GMAIL_CONNECT_CALLBACK_PATH = "/api/integrations/google/callback";

/** httpOnly cookie carrying state + PKCE verifier between connect and callback. */
export const GMAIL_CONNECT_COOKIE = "tn_gmail_connect";

/** The cookie is only sent to the connect routes. */
export const GMAIL_CONNECT_COOKIE_PATH = "/api/integrations/google";

/** The Google round trip must finish within this many seconds. */
export const GMAIL_CONNECT_COOKIE_MAX_AGE_SECONDS = 600;

/** From Google's OAuth 2.0 web-server guide (checked 2026-10-07). */
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** `users.messages.send` path under `GMAIL_API_BASE_URL`. */
export const GMAIL_SEND_PATH = "/gmail/v1/users/me/messages/send";
```
`src/server/google/gmail-oauth.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import {
  createGmailConnectAuthorization,
  decodeConnectCookie,
  decodeIdTokenClaims,
  encodeConnectCookie,
  exchangeGmailCode,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from "./gmail-oauth";

const idToken = (claims: object) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
const jsonResponse = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("createGmailConnectAuthorization", () => {
  it("asks for offline gmail.send with PKCE, consent and incremental scopes", () => {
    const { url, state } = createGmailConnectAuthorization({
      clientId: "client",
      redirectUri: "https://tapnshow.vercel.app/api/integrations/google/callback",
      workspaceSlug: "club-ab12",
      next: "/w/club-ab12/settings",
    });
    const params = new URL(url).searchParams;
    expect(params.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/gmail.send",
    );
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent select_account");
    expect(params.get("include_granted_scopes")).toBe("true");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe(state.state);
    expect(state.workspaceSlug).toBe("club-ab12");
  });
});

describe("connect cookie", () => {
  it("round-trips and rejects junk", () => {
    const state = { state: "s", verifier: "v", workspaceSlug: "club", next: null };
    expect(decodeConnectCookie(encodeConnectCookie(state))).toEqual(state);
    expect(decodeConnectCookie("not-base64-json")).toBeNull();
    expect(decodeConnectCookie(undefined)).toBeNull();
  });
});

describe("exchangeGmailCode", () => {
  it("returns the refresh token, granted scopes and verified claims", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send",
        id_token: idToken({ sub: "123", email: "Club@Gmail.com", email_verified: true }),
      }),
    );
    const grant = await exchangeGmailCode(
      { code: "c", verifier: "v", clientId: "id", clientSecret: "secret", redirectUri: "https://x/cb" },
      fetchMock,
    );
    expect(grant).toEqual({
      refreshToken: "rt",
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      claims: { sub: "123", email: "club@gmail.com", emailVerified: true },
    });
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("v");
  });

  it("reports a missing refresh token as null and hides Google's error body", async () => {
    const noRefresh = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ access_token: "at", scope: "openid", id_token: idToken({ sub: "1", email: "a@b.co", email_verified: true }) }),
    );
    const grant = await exchangeGmailCode(
      { code: "c", verifier: "v", clientId: "id", clientSecret: "s", redirectUri: "https://x/cb" },
      noRefresh,
    );
    expect(grant.refreshToken).toBeNull();
    const failing = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "invalid_grant", code: "c" }, 400));
    await expect(
      exchangeGmailCode({ code: "c", verifier: "v", clientId: "id", clientSecret: "s", redirectUri: "https://x/cb" }, failing),
    ).rejects.toThrow("Google token exchange failed with HTTP 400");
  });
});

describe("decodeIdTokenClaims", () => {
  it("rejects tokens without sub or email", () => {
    expect(() => decodeIdTokenClaims(idToken({ email: "a@b.co" }))).toThrow();
    expect(() => decodeIdTokenClaims("garbage")).toThrow();
  });
});

describe("refreshGoogleAccessToken", () => {
  const input = { refreshToken: "rt", clientId: "id", clientSecret: "s", tokenUrl: "https://oauth2.googleapis.com/token" };

  it("returns an access token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ access_token: "at", expires_in: 3599 }));
    expect(await refreshGoogleAccessToken(input, fetchMock)).toEqual({ kind: "ok", accessToken: "at" });
  });

  it("recognizes invalid_grant and other failures", async () => {
    const revoked = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));
    expect(await refreshGoogleAccessToken(input, revoked)).toEqual({ kind: "invalid_grant" });
    const down = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "server_error" }, 503));
    expect(await refreshGoogleAccessToken(input, down)).toEqual({ kind: "error", status: 503 });
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    expect(await refreshGoogleAccessToken(input, offline)).toEqual({ kind: "error", status: 0 });
  });
});

describe("revokeGoogleToken", () => {
  it("posts the token form-encoded and never throws", async () => {
    const ok = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    expect(await revokeGoogleToken("rt", ok)).toBe(true);
    expect(String(ok.mock.calls[0][1]?.body)).toBe("token=rt");
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    expect(await revokeGoogleToken("rt", offline)).toBe(false);
  });
});
```

- [ ] **Step 10: Run to verify failure** — `bun run test src/server/google` → FAIL (module missing).

- [ ] **Step 11: Implement** — `src/server/google/gmail-oauth.ts`:
```ts
import "server-only";
import { z } from "zod";
import { GOOGLE_AUTHORIZATION_ENDPOINT, GOOGLE_TOKEN_ENDPOINT } from "@/config/auth";
import { GMAIL_CONNECT_SCOPES, GOOGLE_REVOKE_ENDPOINT } from "@/config/gmail";
import { generateToken, sha256Base64Url } from "@/server/crypto/tokens";

const connectStateSchema = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  workspaceSlug: z.string().min(1),
  next: z.string().nullable(),
});

/** What the connect route remembers (httpOnly cookie) for the callback. */
export type GmailConnectState = z.infer<typeof connectStateSchema>;

/**
 * Google's authorization URL for "Connect Gmail sending" (spec §9): `openid email gmail.send`,
 * offline access (refresh token), forced consent so a refresh token is always issued, incremental
 * scopes, and PKCE S256.
 */
export function createGmailConnectAuthorization(input: {
  clientId: string;
  redirectUri: string;
  workspaceSlug: string;
  next: string | null;
}): { url: string; state: GmailConnectState } {
  const state: GmailConnectState = {
    state: generateToken(),
    verifier: generateToken(),
    workspaceSlug: input.workspaceSlug,
    next: input.next,
  };
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_CONNECT_SCOPES.join(" "),
    state: state.state,
    code_challenge: sha256Base64Url(state.verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
  });
  return { url: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`, state };
}

/** Cookie-safe encoding (base64url JSON). */
export function encodeConnectCookie(state: GmailConnectState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/** Decodes the cookie; null when missing or malformed. */
export function decodeConnectCookie(value: string | undefined): GmailConnectState | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = connectStateSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const idTokenClaimsSchema = z
  .object({ sub: z.string().min(1), email: z.string().min(1), email_verified: z.boolean() })
  .transform((claims) => ({
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified,
  }));

/** The account an ID token names (`sub` is Google's stable account id). */
export type IdTokenClaims = z.output<typeof idTokenClaimsSchema>;

/**
 * Reads the claims of an ID token received **directly from Google's token endpoint** over HTTPS
 * with our client secret — Google's OpenID Connect guide says such a token can be trusted without
 * signature validation. Never use this for tokens from any other source.
 * @throws Error when the token is malformed or lacks `sub` / `email`
 */
export function decodeIdTokenClaims(idToken: string): IdTokenClaims {
  const payload = idToken.split(".")[1];
  if (!payload) {
    throw new Error("Malformed ID token");
  }
  return idTokenClaimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
}

const codeResponseSchema = z.object({
  id_token: z.string().min(1),
  scope: z.string(),
  refresh_token: z.string().min(1).optional(),
});

/** What a successful connect consent produced. */
export type GmailConnectGrant = {
  refreshToken: string | null;
  scopes: string[];
  claims: IdTokenClaims;
};

/**
 * Exchanges the authorization code (PKCE verifier + client secret).
 * @throws Error naming only the HTTP status (Google's body may echo the code)
 */
export async function exchangeGmailCode(
  input: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GmailConnectGrant> {
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed with HTTP ${response.status}`);
  }
  const body = codeResponseSchema.parse(await response.json());
  return {
    refreshToken: body.refresh_token ?? null,
    scopes: body.scope.split(" ").filter(Boolean),
    claims: decodeIdTokenClaims(body.id_token),
  };
}

/** Result of turning a refresh token into an access token. */
export type RefreshResult =
  | { kind: "ok"; accessToken: string }
  | { kind: "invalid_grant" }
  | { kind: "error"; status: number };

const refreshResponseSchema = z.object({ access_token: z.string().min(1) });
const oauthErrorSchema = z.object({ error: z.string() });

/**
 * Refresh-token grant. `invalid_grant` means the connection is gone for good (revoked, password
 * changed, time-limited access ended); anything else is transient. Never throws.
 */
export async function refreshGoogleAccessToken(
  input: { refreshToken: string; clientId: string; clientSecret: string; tokenUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  try {
    const response = await fetchImpl(input.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }).toString(),
    });
    const body: object = await response.json().catch(() => ({}));
    if (response.ok) {
      const parsed = refreshResponseSchema.safeParse(body);
      return parsed.success
        ? { kind: "ok", accessToken: parsed.data.access_token }
        : { kind: "error", status: response.status };
    }
    const error = oauthErrorSchema.safeParse(body);
    return error.success && error.data.error === "invalid_grant"
      ? { kind: "invalid_grant" }
      : { kind: "error", status: response.status };
  } catch {
    return { kind: "error", status: 0 };
  }
}

/** Best-effort revocation on disconnect (spec §9). Never throws; false when Google did not confirm. */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 12: Run** — `bun run test src/server/google src/server/crypto src/config` → PASS. `bun run lint && bun run typecheck` → PASS.

- [ ] **Step 13: Commit, PR, merge** — `feat: token encryption, personal-link tokens and Gmail OAuth helpers`.

---

### Task 4: API — sender + meeting defaults routes, Gmail connect / callback / disconnect, hooks

**Labels:** `area:api`, `area:auth`

**Files:**
- Create: `src/config/meetings.ts`, `src/shared/api/meeting-settings.ts`, `src/shared/api/meeting-settings.test.ts`, `src/shared/api/sender.ts`, `src/server/queries/sender.ts`, `src/app/api/workspaces/[slug]/sender/route.ts` (+ `route.test.ts`), `src/app/api/workspaces/[slug]/meeting-defaults/route.ts` (+ `route.test.ts`), `src/app/api/integrations/google/connect/route.ts` (+ test), `src/app/api/integrations/google/callback/route.ts` (+ test), `src/app/api/integrations/google/connections/[id]/route.ts` (+ test), `src/lib/with-query.ts` (+ test), `src/hooks/use-sender.ts`, `src/hooks/use-meeting-defaults.ts`
- Modify: `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors.owner_only`)

**Interfaces:**
- Consumes: Task 2 RPCs and columns; Task 3 `requireSecret`, `parseEncryptionKey`, `sealSecret`, `openSecret`, `connectionAssociatedData`, `createGmailConnectAuthorization`, `encodeConnectCookie`, `decodeConnectCookie`, `exchangeGmailCode`, `revokeGoogleToken`, `GMAIL_*` constants; M2 `requireUser`, `getWorkspaceBySlug`, `safeNextPath`, `loginPathFor`, `tokensEqual`.
- Produces:
  - `src/config/meetings.ts` (Task 8 and the UI tasks append to it): `DELAY_OPTION_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const`, `DELAY_OPTIONS_MAX = 6`, `DURATION_CHOICES = [30, 60, 90, 120] as const`, `DURATION_MIN = 5`, `DURATION_MAX = 720`, `FOOTER_NOTE_MAX = 280` (mirrors of the database checks, like M3's field rules).
  - `src/shared/api/meeting-settings.ts`: `responseModeSchema`, `locationModeSchema`, `delayOptionsSchema`, `footerNoteSchema`, `durationMinutesSchema`, `meetingDefaultsSchema` (`{ responseMode, delayOptions, reasonRequired, commentsEnabled, footerNote, durationMinutes }`), `MeetingDefaults`, `updateMeetingDefaultsBodySchema` (partial, at least one key), `ResponseMode`, `LocationMode`.
  - `src/shared/api/sender.ts`: `workspaceSenderSchema`, `WorkspaceSender`, `setSenderBodySchema` (`{ connectionId }`), `GMAIL_CONNECT_RESULTS = ["connected"] as const`, `GMAIL_CONNECT_ERRORS = ["unavailable", "owner_only", "cancelled", "scope_denied", "no_refresh_token", "failed"] as const`, `GmailConnectError`.
  - `src/server/queries/sender.ts`: `getWorkspaceSender`, `setWorkspaceSender`, `saveGoogleConnection`, `disconnectGoogleConnection`, `getMeetingDefaults`, `updateMeetingDefaults` (each returns `{ data, error }`; never throws on a database error).
  - Routes: `GET/PUT /api/workspaces/[slug]/sender`, `GET/PATCH /api/workspaces/[slug]/meeting-defaults`, `GET /api/integrations/google/connect?workspace=<slug>&next=<path>`, `GET /api/integrations/google/callback`, `DELETE /api/integrations/google/connections/[id]`.
  - Callback outcome: a redirect to `next` (default `/w/<slug>/settings#sending`) with `?gmail=connected` or `?gmail_error=<GmailConnectError>`.
  - `withQuery(path: string, key: string, value: string): string` — adds/replaces one query parameter on a same-site path, keeping the hash.
  - Hooks: `senderQueryKey(slug)`, `useWorkspaceSender(slug)`, `useSetSender(slug)`, `useDisconnectGmail(slug)`, `gmailConnectHref(slug: string, next?: string): string`, `meetingDefaultsQueryKey(slug)`, `useMeetingDefaults(slug)`, `useUpdateMeetingDefaults(slug)`.

- [ ] **Step 1: Error code** — in `src/shared/api/errors.ts` add `"owner_only"` to `API_ERROR_CODES` and `owner_only: 403` to `API_ERROR_STATUS`; in `messages/en.json` → `ApiErrors`, add `"owner_only": "Only the workspace Owner can do this."`. (`src/shared/api/errors.test.ts` already checks that every code has a status and a message; run it.)

- [ ] **Step 2: Failing schema tests** — `src/shared/api/meeting-settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  delayOptionsSchema,
  footerNoteSchema,
  updateMeetingDefaultsBodySchema,
} from "./meeting-settings";

describe("meeting settings schemas", () => {
  it("mirrors the database rule for delay options", () => {
    expect(delayOptionsSchema.parse([30, 5, 10])).toEqual([5, 10, 30]);
    expect(delayOptionsSchema.safeParse([5, 5]).success).toBe(false);
    expect(delayOptionsSchema.safeParse([0]).success).toBe(false);
    expect(delayOptionsSchema.safeParse([241]).success).toBe(false);
    expect(delayOptionsSchema.safeParse([1, 2, 3, 4, 5, 6, 7]).success).toBe(false);
  });

  it("trims the footer note and caps it at 280", () => {
    expect(footerNoteSchema.parse("  Bring a laptop ")).toBe("Bring a laptop");
    expect(footerNoteSchema.safeParse("x".repeat(281)).success).toBe(false);
  });

  it("needs at least one field to update", () => {
    expect(updateMeetingDefaultsBodySchema.safeParse({}).success).toBe(false);
    expect(updateMeetingDefaultsBodySchema.parse({ durationMinutes: 90 })).toEqual({ durationMinutes: 90 });
  });
});
```
`src/lib/with-query.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { senderSettingsPath, withQuery } from "./with-query";

describe("withQuery", () => {
  it("adds or replaces a parameter and keeps the hash", () => {
    expect(withQuery("/w/club/settings#sending", "gmail", "connected")).toBe(
      "/w/club/settings?gmail=connected#sending",
    );
    expect(withQuery("/w/club/meetings/1/edit?step=review&gmail_error=failed", "gmail_error", "cancelled")).toBe(
      "/w/club/meetings/1/edit?step=review&gmail_error=cancelled",
    );
  });

  it("points the connect flow back at Settings > Sending", () => {
    expect(senderSettingsPath("club")).toBe("/w/club/settings#sending");
  });
});
```

- [ ] **Step 3: Run to verify failure** — `bun run test src/shared/api/meeting-settings.test.ts src/lib/with-query.test.ts` → FAIL (modules missing).

- [ ] **Step 4: Implement config, schemas, helper** — `src/config/meetings.ts`:
```ts
/** Delay chips offered for "I'll be late" (minutes; spec §4 attendance mode). */
export const DELAY_OPTION_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const;

/** At most this many delay options per meeting (database: `private.valid_delay_options`). */
export const DELAY_OPTIONS_MAX = 6;

/** Duration chips in the wizard (minutes); "Other" allows any value in range. */
export const DURATION_CHOICES = [30, 60, 90, 120] as const;

/** Duration range (database check on `meetings` and `workspaces`). */
export const DURATION_MIN = 5;
export const DURATION_MAX = 720;

/** Footer note length (database check). */
export const FOOTER_NOTE_MAX = 280;
```
`src/shared/api/meeting-settings.ts`:
```ts
import { z } from "zod";
import {
  DELAY_OPTIONS_MAX,
  DURATION_MAX,
  DURATION_MIN,
  FOOTER_NOTE_MAX,
} from "@/config/meetings";

/** How members answer (spec §4 Response modes). */
export const responseModeSchema = z.enum(["announcement", "rsvp", "attendance"]);
/** A response mode. */
export type ResponseMode = z.infer<typeof responseModeSchema>;

/** Where the meeting happens. */
export const locationModeSchema = z.enum(["in_person", "online", "hybrid"]);
/** A location mode. */
export type LocationMode = z.infer<typeof locationModeSchema>;

/** Delay options in minutes: distinct, 1–240, at most six, sorted ascending. */
export const delayOptionsSchema = z
  .array(z.number().int().min(1).max(240))
  .max(DELAY_OPTIONS_MAX)
  .refine((values) => new Set(values).size === values.length)
  .transform((values) => [...values].sort((a, b) => a - b));

/** Footer note under the response form ("" = none). */
export const footerNoteSchema = z.string().trim().max(FOOTER_NOTE_MAX);

/** Meeting length in minutes. */
export const durationMinutesSchema = z.number().int().min(DURATION_MIN).max(DURATION_MAX);

/** Settings > Meeting defaults (spec §7.2, §6 workspaces). */
export const meetingDefaultsSchema = z.object({
  responseMode: responseModeSchema,
  delayOptions: delayOptionsSchema,
  reasonRequired: z.boolean(),
  commentsEnabled: z.boolean(),
  footerNote: footerNoteSchema,
  durationMinutes: durationMinutesSchema,
});
/** Workspace meeting defaults. */
export type MeetingDefaults = z.infer<typeof meetingDefaultsSchema>;

/** `PATCH …/meeting-defaults` body. */
export const updateMeetingDefaultsBodySchema = meetingDefaultsSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0);
/** A partial defaults update. */
export type UpdateMeetingDefaultsBody = z.infer<typeof updateMeetingDefaultsBodySchema>;
```
`src/lib/with-query.ts`:
```ts
const BASE = "http://local.invalid";

/** Adds or replaces one query parameter on a same-site path, keeping any hash. */
export function withQuery(path: string, key: string, value: string): string {
  const url = new URL(path, BASE);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Where the Gmail connect flow returns by default (Settings > Sending). */
export function senderSettingsPath(slug: string): string {
  return `/w/${slug}/settings#sending`;
}
```
`src/shared/api/sender.ts`:
```ts
import { z } from "zod";

/** Health of a Google connection. */
export const connectionStatusSchema = z.enum(["active", "broken"]);

/** `GET …/sender` response (spec §7.15). */
export const workspaceSenderSchema = z.object({
  sender: z
    .object({
      connectionId: z.uuid(),
      email: z.string(),
      status: connectionStatusSchema,
      connectedBy: z.string(),
      connectedAt: z.string(),
      isMine: z.boolean(),
      sentLast24h: z.number().int(),
      dailyLimit: z.number().int(),
    })
    .nullable(),
  ownerName: z.string(),
  myConnections: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      status: connectionStatusSchema,
      usedBy: z.array(z.string()),
    }),
  ),
});
/** The workspace's sender as one member sees it. */
export type WorkspaceSender = z.infer<typeof workspaceSenderSchema>;

/** `PUT …/sender` body (Owner: use one of my connections). */
export const setSenderBodySchema = z.object({ connectionId: z.uuid() });

/** `?gmail_error=` values the connect callback can return. */
export const GMAIL_CONNECT_ERRORS = [
  "unavailable",
  "owner_only",
  "cancelled",
  "scope_denied",
  "no_refresh_token",
  "failed",
] as const;
/** One connect failure reason. */
export type GmailConnectError = (typeof GMAIL_CONNECT_ERRORS)[number];
```

- [ ] **Step 5: Run** — the two test files → PASS.

- [ ] **Step 6: Queries** — `src/server/queries/sender.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { type MeetingDefaults, meetingDefaultsSchema, type UpdateMeetingDefaultsBody } from "@/shared/api/meeting-settings";
import { type WorkspaceSender, workspaceSenderSchema } from "@/shared/api/sender";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

const dbSenderSchema = z
  .object({
    sender: z
      .object({
        connection_id: z.uuid(),
        email: z.string(),
        status: z.enum(["active", "broken"]),
        connected_by: z.string(),
        connected_at: z.string(),
        is_mine: z.boolean(),
        sent_last_24h: z.number().int(),
        daily_limit: z.number().int(),
      })
      .nullable(),
    owner_name: z.string(),
    my_connections: z.array(
      z.object({ id: z.uuid(), email: z.string(), status: z.enum(["active", "broken"]), used_by: z.array(z.string()) }),
    ),
  })
  .transform(
    (db): WorkspaceSender =>
      workspaceSenderSchema.parse({
        sender: db.sender && {
          connectionId: db.sender.connection_id,
          email: db.sender.email,
          status: db.sender.status,
          connectedBy: db.sender.connected_by,
          connectedAt: db.sender.connected_at,
          isMine: db.sender.is_mine,
          sentLast24h: db.sender.sent_last_24h,
          dailyLimit: db.sender.daily_limit,
        },
        ownerName: db.owner_name,
        myConnections: db.my_connections.map((c) => ({ id: c.id, email: c.email, status: c.status, usedBy: c.used_by })),
      }),
  );

/** `workspace_sender()` (any member). */
export async function getWorkspaceSender(
  client: Client,
  workspaceId: string,
): Promise<{ data: WorkspaceSender | null; error: DbError | null }> {
  const { data, error } = await client.rpc("workspace_sender", { p_workspace: workspaceId });
  return error ? { data: null, error } : { data: dbSenderSchema.parse(data), error: null };
}

/** `set_workspace_sender()` (Owner; own active connection). */
export async function setWorkspaceSender(
  client: Client,
  workspaceId: string,
  connectionId: string,
): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("set_workspace_sender", { p_workspace: workspaceId, p_connection: connectionId });
  return { error };
}

/**
 * `save_google_connection()`: upsert by (user, Google account); returns the connection id.
 * `client` must be the service-role client: the account id and email come from Google's verified
 * ID token in the callback, never from a browser (security review 2026-10-07).
 */
export async function saveGoogleConnection(
  client: Client,
  input: { userId: string; googleSub: string; googleEmail: string; scopes: string[]; tokenEncrypted: string },
): Promise<{ data: string | null; error: DbError | null }> {
  const { data, error } = await client.rpc("save_google_connection", {
    p_user: input.userId,
    p_google_sub: input.googleSub,
    p_google_email: input.googleEmail,
    p_scopes: input.scopes,
    p_token_encrypted: input.tokenEncrypted,
  });
  return { data: data ?? null, error };
}

const disconnectedSchema = z
  .object({ refresh_token_encrypted: z.string(), google_sub: z.string() })
  .transform((db) => ({ tokenEncrypted: db.refresh_token_encrypted, googleSub: db.google_sub }));

/** `disconnect_google_connection()`: deletes my connection, returns what revocation needs. */
export async function disconnectGoogleConnection(
  client: Client,
  connectionId: string,
): Promise<{ data: z.output<typeof disconnectedSchema> | null; error: DbError | null }> {
  const { data, error } = await client.rpc("disconnect_google_connection", { p_connection: connectionId });
  return error ? { data: null, error } : { data: disconnectedSchema.parse(data), error: null };
}

const DEFAULT_COLUMNS =
  "default_response_mode, default_delay_options, default_reason_required, default_comments_enabled, default_footer_note, default_duration_minutes";

/** The workspace's meeting defaults (any member). */
export async function getMeetingDefaults(
  client: Client,
  workspaceId: string,
): Promise<{ data: MeetingDefaults | null; error: DbError | null }> {
  const { data, error } = await client.from("workspaces").select(DEFAULT_COLUMNS).eq("id", workspaceId).single();
  if (error) {
    return { data: null, error };
  }
  return {
    data: meetingDefaultsSchema.parse({
      responseMode: data.default_response_mode,
      delayOptions: data.default_delay_options,
      reasonRequired: data.default_reason_required,
      commentsEnabled: data.default_comments_enabled,
      footerNote: data.default_footer_note,
      durationMinutes: data.default_duration_minutes,
    }),
    error: null,
  };
}

/** Updates some defaults (Owner/Admin through RLS). */
export async function updateMeetingDefaults(
  client: Client,
  workspaceId: string,
  patch: UpdateMeetingDefaultsBody,
): Promise<{ error: DbError | null }> {
  const { error } = await client
    .from("workspaces")
    .update({
      default_response_mode: patch.responseMode,
      default_delay_options: patch.delayOptions,
      default_reason_required: patch.reasonRequired,
      default_comments_enabled: patch.commentsEnabled,
      default_footer_note: patch.footerNote,
      default_duration_minutes: patch.durationMinutes,
    })
    .eq("id", workspaceId);
  return { error };
}
```
(supabase-js drops `undefined` keys from the update body, so only the sent fields change.)

- [ ] **Step 7: Failing route tests** — `src/app/api/workspaces/[slug]/sender/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const CONNECTION = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const mocks = vi.hoisted(() => ({ getWorkspaceSender: vi.fn(), setWorkspaceSender: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({ loadWorkspaceContext: async () => okContext }));
vi.mock("@/server/queries/sender", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
beforeEach(() => vi.clearAllMocks());

describe("/api/workspaces/[slug]/sender", () => {
  it("returns the sender", async () => {
    const sender = { sender: null, ownerName: "Daly", myConnections: [] };
    mocks.getWorkspaceSender.mockResolvedValueOnce({ data: sender, error: null });
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(sender);
  });

  it("answers database errors with a code", async () => {
    mocks.getWorkspaceSender.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "tn:forbidden" } });
    const { GET } = await import("./route");
    const response = await GET(jsonRequest("GET"), ctx);
    expect(response.status).toBe(403);
  });

  it("sets my connection and names owner_only", async () => {
    mocks.setWorkspaceSender.mockResolvedValueOnce({ error: null });
    const { PUT } = await import("./route");
    expect(await (await PUT(jsonRequest("PUT", { connectionId: CONNECTION }), ctx)).json()).toEqual({ ok: true });
    expect(mocks.setWorkspaceSender).toHaveBeenCalledWith({}, "w1", CONNECTION);
    mocks.setWorkspaceSender.mockResolvedValueOnce({ error: { code: "P0001", message: "tn:owner_only" } });
    expect(await (await PUT(jsonRequest("PUT", { connectionId: CONNECTION }), ctx)).json()).toEqual({
      error: { code: "owner_only" },
    });
  });

  it("refuses cross-origin writes", async () => {
    const { PUT } = await import("./route");
    const request = new Request("http://localhost:3000/api/x", {
      method: "PUT",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ connectionId: CONNECTION }),
    });
    expect((await PUT(request, ctx)).status).toBe(403);
  });
});
```
`src/app/api/workspaces/[slug]/meeting-defaults/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext, viewerContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  context: { value: null as object | null },
  getMeetingDefaults: vi.fn(),
  updateMeetingDefaults: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => mocks.context.value ?? okContext,
}));
vi.mock("@/server/queries/sender", () => ({
  getMeetingDefaults: mocks.getMeetingDefaults,
  updateMeetingDefaults: mocks.updateMeetingDefaults,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const defaults = {
  responseMode: "attendance",
  delayOptions: [5, 10, 15, 30],
  reasonRequired: true,
  commentsEnabled: false,
  footerNote: "",
  durationMinutes: 60,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("/api/workspaces/[slug]/meeting-defaults", () => {
  it("returns the defaults", async () => {
    mocks.getMeetingDefaults.mockResolvedValueOnce({ data: defaults, error: null });
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(defaults);
  });

  it("updates valid fields and refuses Viewers and bad input", async () => {
    mocks.updateMeetingDefaults.mockResolvedValue({ error: null });
    const { PATCH } = await import("./route");
    expect((await PATCH(jsonRequest("PATCH", { delayOptions: [30, 10] }), ctx)).status).toBe(200);
    expect(mocks.updateMeetingDefaults).toHaveBeenCalledWith({}, "w1", { delayOptions: [10, 30] });
    expect((await PATCH(jsonRequest("PATCH", { delayOptions: [5, 5] }), ctx)).status).toBe(400);
    mocks.context.value = viewerContext;
    expect((await PATCH(jsonRequest("PATCH", { durationMinutes: 30 }), ctx)).status).toBe(403);
  });
});
```

- [ ] **Step 8: Run to verify failure** — `bun run test src/app/api/workspaces/\[slug\]/sender src/app/api/workspaces/\[slug\]/meeting-defaults` → FAIL (route modules missing).

- [ ] **Step 9: Implement the two workspace routes** — `src/app/api/workspaces/[slug]/sender/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { getWorkspaceSender, setWorkspaceSender } from "@/server/queries/sender";
import { setSenderBodySchema } from "@/shared/api/sender";

/** The workspace's sender Gmail, its usage today, and my own connections (spec §7.15). */
export async function GET(
  _request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/sender">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getWorkspaceSender(context.supabase, context.workspace.id);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/** Owner: make one of my connected Gmail accounts the workspace sender ("Use <address>"). */
export async function PUT(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/sender">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, setSenderBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await setWorkspaceSender(context.supabase, context.workspace.id, body.data.connectionId);
  return error ? fromDatabaseError(error) : ok();
}
```
`src/app/api/workspaces/[slug]/meeting-defaults/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { getMeetingDefaults, updateMeetingDefaults } from "@/server/queries/sender";
import { updateMeetingDefaultsBodySchema } from "@/shared/api/meeting-settings";

/** Settings > Meeting defaults (any member reads). */
export async function GET(
  _request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meeting-defaults">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await getMeetingDefaults(context.supabase, context.workspace.id);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}

/** Owner/Admin change some defaults; each field saves on its own (autosave). */
export async function PATCH(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meeting-defaults">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const body = await parseJsonBody(request, updateMeetingDefaultsBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await updateMeetingDefaults(context.supabase, context.workspace.id, body.data);
  return error ? fromDatabaseError(error) : ok();
}
```
Run → PASS.

- [ ] **Step 10: Failing connect/callback/disconnect tests** — `src/app/api/integrations/google/connect/route.test.ts`:
```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: { value: true },
  user: { value: { id: "me", email: "me@example.test" } as { id: string; email: string } | null },
  workspace: { value: { id: "w1", slug: "club-ab12", myRole: "owner" } as { id: string; slug: string; myRole: string } | null },
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    get NEXT_PUBLIC_GMAIL_CONNECT_ENABLED() {
      return mocks.enabled.value;
    },
  },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", LOG_LEVEL: "info" }),
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => mocks.user.value }));
vi.mock("@/server/queries/workspaces", () => ({ getWorkspaceBySlug: async () => mocks.workspace.value }));

const request = (query: string) =>
  new NextRequest(`http://localhost:3000/api/integrations/google/connect?${query}`);

beforeEach(() => {
  mocks.enabled.value = true;
  mocks.user.value = { id: "me", email: "me@example.test" };
  mocks.workspace.value = { id: "w1", slug: "club-ab12", myRole: "owner" };
});

describe("GET /api/integrations/google/connect", () => {
  it("sends the Owner to Google with a short-lived cookie scoped to the connect routes", async () => {
    const { GET } = await import("./route");
    const response = await GET(request("workspace=club-ab12&next=%2Fw%2Fclub-ab12%2Fmeetings%2F1%2Fedit%3Fstep%3Dreview"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/google/callback",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/tn_gmail_connect=/);
    expect(cookie).toMatch(/Path=\/api\/integrations\/google/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("returns non-Owners and disabled deployments to settings with a reason", async () => {
    const { GET } = await import("./route");
    mocks.workspace.value = { id: "w1", slug: "club-ab12", myRole: "admin" };
    expect((await GET(request("workspace=club-ab12"))).headers.get("location")).toBe(
      "http://localhost:3000/w/club-ab12/settings?gmail_error=owner_only#sending",
    );
    mocks.enabled.value = false;
    expect((await GET(request("workspace=club-ab12"))).headers.get("location")).toBe(
      "http://localhost:3000/w/club-ab12/settings?gmail_error=unavailable#sending",
    );
  });

  it("sends signed-out visitors to sign in first", async () => {
    mocks.user.value = null;
    const { GET } = await import("./route");
    expect((await GET(request("workspace=club-ab12"))).headers.get("location")).toMatch(/\/login\?next=/);
  });
});
```
`src/app/api/integrations/google/callback/route.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionAssociatedData, openSecret } from "@/server/crypto/secret-box";
import { encodeConnectCookie } from "@/server/google/gmail-oauth";

const KEY = randomBytes(32);
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  revoke: vi.fn(async () => true),
  save: vi.fn(),
  setSender: vi.fn(),
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: { NEXT_PUBLIC_APP_URL: "http://localhost:3000", NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: true },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "sec",
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/google/gmail-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/gmail-oauth")>()),
  exchangeGmailCode: mocks.exchange,
  revokeGoogleToken: mocks.revoke,
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => ({ id: "user-1", email: null }) }));
vi.mock("@/server/queries/workspaces", () => ({
  getWorkspaceBySlug: async () => ({ id: "w1", slug: "club-ab12", myRole: "owner" }),
}));
vi.mock("@/server/supabase/admin-client", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));
vi.mock("@/server/queries/sender", () => ({
  saveGoogleConnection: mocks.save,
  setWorkspaceSender: mocks.setSender,
}));

const stored = { state: "s1", verifier: "v1", workspaceSlug: "club-ab12", next: null };
const callback = (query: string) =>
  new NextRequest(`http://localhost:3000/api/integrations/google/callback?${query}`, {
    headers: { cookie: `tn_gmail_connect=${encodeConnectCookie(stored)}` },
  });
const grant = (overrides: object = {}) => ({
  refreshToken: "1//rt",
  scopes: ["openid", GMAIL_SEND],
  claims: { sub: "g-1", email: "club@gmail.com", emailVerified: true },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ data: "conn-1", error: null });
  mocks.setSender.mockResolvedValue({ error: null });
});

describe("GET /api/integrations/google/callback", () => {
  it("seals the refresh token, saves the connection, makes it the sender and clears the cookie", async () => {
    mocks.exchange.mockResolvedValueOnce(grant());
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/w/club-ab12/settings?gmail=connected#sending",
    );
    expect(mocks.save.mock.calls[0][0]).toEqual({ admin: true });
    const saved = mocks.save.mock.calls[0][1];
    expect(saved).toMatchObject({ userId: "user-1", googleSub: "g-1", googleEmail: "club@gmail.com" });
    expect(openSecret(saved.tokenEncrypted, KEY, connectionAssociatedData("user-1", "g-1"))).toBe("1//rt");
    expect(mocks.setSender).toHaveBeenCalledWith({}, "w1", "conn-1");
    expect(response.headers.get("set-cookie")).toMatch(/tn_gmail_connect=;/);
  });

  it.each([
    ["error=access_denied&state=s1", "cancelled"],
    ["code=c1&state=wrong", "failed"],
  ])("fails closed for %s", async (query, reason) => {
    const { GET } = await import("./route");
    const response = await GET(callback(query));
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/w/club-ab12/settings?gmail_error=${reason}#sending`,
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses consent without gmail.send and revokes what Google issued", async () => {
    mocks.exchange.mockResolvedValueOnce(grant({ scopes: ["openid"] }));
    const { GET } = await import("./route");
    expect((await GET(callback("code=c1&state=s1"))).headers.get("location")).toContain("gmail_error=scope_denied");
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("explains a missing refresh token", async () => {
    mocks.exchange.mockResolvedValueOnce(grant({ refreshToken: null }));
    const { GET } = await import("./route");
    expect((await GET(callback("code=c1&state=s1"))).headers.get("location")).toContain("gmail_error=no_refresh_token");
  });
});
```
`src/app/api/integrations/google/connections/[id]/route.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionAssociatedData, sealSecret } from "@/server/crypto/secret-box";
import { jsonRequest } from "@/test/workspace-context-mock";

const KEY = randomBytes(32);
const mocks = vi.hoisted(() => ({ disconnect: vi.fn(), revoke: vi.fn(async () => true) }));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({ GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"), LOG_LEVEL: "info" }),
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => ({ id: "user-1", email: null }) }));
vi.mock("@/server/queries/sender", () => ({ disconnectGoogleConnection: mocks.disconnect }));
vi.mock("@/server/google/gmail-oauth", () => ({ revokeGoogleToken: mocks.revoke }));

const ID = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const ctx = { params: Promise.resolve({ id: ID }) };
beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/integrations/google/connections/[id]", () => {
  it("deletes my connection and revokes its token at Google", async () => {
    mocks.disconnect.mockResolvedValueOnce({
      data: { tokenEncrypted: sealSecret("1//rt", KEY, connectionAssociatedData("user-1", "g-1")), googleSub: "g-1" },
      error: null,
    });
    const { DELETE } = await import("./route");
    expect(await (await DELETE(jsonRequest("DELETE"), ctx)).json()).toEqual({ ok: true });
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
  });

  it("still succeeds when the token cannot be opened, and 404s for others' connections", async () => {
    mocks.disconnect.mockResolvedValueOnce({ data: { tokenEncrypted: "v1.x.y.z", googleSub: "g-1" }, error: null });
    const { DELETE } = await import("./route");
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    expect(mocks.revoke).not.toHaveBeenCalled();
    mocks.disconnect.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "tn:not_found" } });
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(404);
  });
});
```

- [ ] **Step 11: Run to verify failure** — `bun run test src/app/api/integrations` → FAIL (modules missing).

- [ ] **Step 12: Implement** — `src/app/api/integrations/google/connect/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import {
  GMAIL_CONNECT_CALLBACK_PATH,
  GMAIL_CONNECT_COOKIE,
  GMAIL_CONNECT_COOKIE_MAX_AGE_SECONDS,
  GMAIL_CONNECT_COOKIE_PATH,
} from "@/config/gmail";
import { publicEnv } from "@/config/public-env";
import { loginPathFor } from "@/lib/auth-redirect";
import { safeNextPath } from "@/lib/safe-next-path";
import { senderSettingsPath, withQuery } from "@/lib/with-query";
import { createGmailConnectAuthorization, encodeConnectCookie } from "@/server/google/gmail-oauth";
import { requireUser } from "@/server/http/require-user";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import type { GmailConnectError } from "@/shared/api/sender";

/** Starts "Connect Gmail sending" for the workspace's Owner (spec §9). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const params = request.nextUrl.searchParams;
  const slug = params.get("workspace") ?? "";
  const returnTo = safeNextPath(params.get("next")) ?? (slug ? senderSettingsPath(slug) : "/welcome");
  const back = (reason: GmailConnectError) =>
    NextResponse.redirect(new URL(withQuery(returnTo, "gmail_error", reason), request.url));

  if (!publicEnv.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return back("unavailable");
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(`${request.nextUrl.pathname}${request.nextUrl.search}`), request.url),
    );
  }
  const workspace = slug ? await getWorkspaceBySlug(supabase, user.id, slug) : null;
  if (!workspace || workspace.myRole !== "owner") {
    return back("owner_only");
  }
  const { url, state } = createGmailConnectAuthorization({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GMAIL_CONNECT_CALLBACK_PATH}`,
    workspaceSlug: workspace.slug,
    next: returnTo,
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(GMAIL_CONNECT_COOKIE, encodeConnectCookie(state), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: GMAIL_CONNECT_COOKIE_PATH,
    maxAge: GMAIL_CONNECT_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
```
`src/app/api/integrations/google/callback/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import { GMAIL_CONNECT_CALLBACK_PATH, GMAIL_CONNECT_COOKIE, GMAIL_CONNECT_COOKIE_PATH, GMAIL_SEND_SCOPE } from "@/config/gmail";
import { publicEnv } from "@/config/public-env";
import { requireSecret } from "@/config/secrets";
import { loginPathFor } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";
import { senderSettingsPath, withQuery } from "@/lib/with-query";
import { connectionAssociatedData, parseEncryptionKey, sealSecret } from "@/server/crypto/secret-box";
import { tokensEqual } from "@/server/crypto/tokens";
import {
  decodeConnectCookie,
  exchangeGmailCode,
  revokeGoogleToken,
  type GmailConnectGrant,
} from "@/server/google/gmail-oauth";
import { requireUser } from "@/server/http/require-user";
import { saveGoogleConnection, setWorkspaceSender } from "@/server/queries/sender";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import type { GmailConnectError } from "@/shared/api/sender";

function redirectClearingCookie(path: string, request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.delete({ name: GMAIL_CONNECT_COOKIE, path: GMAIL_CONNECT_COOKIE_PATH });
  return response;
}

/** Finishes "Connect Gmail sending": verify state, exchange, check scopes, seal, save, set sender. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const stored = decodeConnectCookie(request.cookies.get(GMAIL_CONNECT_COOKIE)?.value);
  if (!stored) {
    return redirectClearingCookie("/welcome", request);
  }
  const returnTo = stored.next ?? senderSettingsPath(stored.workspaceSlug);
  const fail = (reason: GmailConnectError) =>
    redirectClearingCookie(withQuery(returnTo, "gmail_error", reason), request);
  const params = request.nextUrl.searchParams;
  if (params.get("error") === "access_denied") {
    return fail("cancelled");
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || params.get("error") || !tokensEqual(state, stored.state)) {
    return fail("failed");
  }
  if (!publicEnv.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return fail("unavailable");
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return redirectClearingCookie(loginPathFor(returnTo), request);
  }
  const workspace = await getWorkspaceBySlug(supabase, user.id, stored.workspaceSlug);
  if (!workspace || workspace.myRole !== "owner") {
    return fail("owner_only");
  }
  let grant: GmailConnectGrant;
  try {
    grant = await exchangeGmailCode({
      code,
      verifier: stored.verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GMAIL_CONNECT_CALLBACK_PATH}`,
    });
  } catch (error) {
    logger.error({ err: error }, "Gmail connect code exchange failed");
    return fail("failed");
  }
  if (!grant.scopes.includes(GMAIL_SEND_SCOPE)) {
    if (grant.refreshToken) {
      await revokeGoogleToken(grant.refreshToken);
    }
    return fail("scope_denied");
  }
  if (!grant.refreshToken) {
    return fail("no_refresh_token");
  }
  if (!grant.claims.emailVerified) {
    await revokeGoogleToken(grant.refreshToken);
    return fail("failed");
  }
  const key = parseEncryptionKey(requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env));
  const saved = await saveGoogleConnection(createSupabaseAdminClient(), {
    userId: user.id,
    googleSub: grant.claims.sub,
    googleEmail: grant.claims.email,
    scopes: grant.scopes,
    tokenEncrypted: sealSecret(grant.refreshToken, key, connectionAssociatedData(user.id, grant.claims.sub)),
  });
  if (saved.error || !saved.data) {
    logger.error({ err: saved.error }, "saving the Gmail connection failed");
    return fail("failed");
  }
  const sender = await setWorkspaceSender(supabase, workspace.id, saved.data);
  if (sender.error) {
    logger.error({ err: sender.error }, "setting the workspace sender failed");
    return fail("failed");
  }
  return redirectClearingCookie(withQuery(returnTo, "gmail", "connected"), request);
}
```
`src/app/api/integrations/google/connections/[id]/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import { requireSecret } from "@/config/secrets";
import { logger } from "@/lib/logger";
import { connectionAssociatedData, openSecret, parseEncryptionKey } from "@/server/crypto/secret-box";
import { revokeGoogleToken } from "@/server/google/gmail-oauth";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { disconnectGoogleConnection } from "@/server/queries/sender";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/**
 * Disconnects one of my Gmail connections: deletes it (workspaces using it pause, spec §7.15) and
 * revokes the token at Google on a best-effort basis.
 */
export async function DELETE(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/integrations/google/connections/[id]">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const { data, error } = await disconnectGoogleConnection(supabase, id);
  if (error || !data) {
    return error ? fromDatabaseError(error) : apiError("not_found");
  }
  try {
    const env = getServerEnv();
    const key = parseEncryptionKey(requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env));
    const token = openSecret(data.tokenEncrypted, key, connectionAssociatedData(user.id, data.googleSub));
    if (!(await revokeGoogleToken(token))) {
      logger.warn("Google did not confirm token revocation");
    }
  } catch (revokeError) {
    logger.warn({ err: revokeError }, "could not open the token to revoke it");
  }
  return ok();
}
```
(`disconnect_google_connection` is a UUID-typed RPC; a malformed id returns `22P02`, which `fromDatabaseError` maps to `invalid_input`.)

- [ ] **Step 13: Hooks** — `src/hooks/use-sender.ts`:
```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { workspaceSenderSchema } from "@/shared/api/sender";

/** Query key of a workspace's sender. */
export const senderQueryKey = (slug: string) => ["sender", slug] as const;

const base = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}`;

/** Where "Connect Gmail" navigates (a full page load: Google's consent screen follows). */
export function gmailConnectHref(slug: string, next?: string): string {
  const params = new URLSearchParams({ workspace: slug });
  if (next) {
    params.set("next", next);
  }
  return `/api/integrations/google/connect?${params.toString()}`;
}

/** The workspace's sender, usage and my connections. */
export function useWorkspaceSender(slug: string) {
  return useQuery({
    queryKey: senderQueryKey(slug),
    queryFn: () => apiRequest(`${base(slug)}/sender`, { schema: workspaceSenderSchema }),
  });
}

/** Owner: "Use <address>". */
export function useSetSender(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiRequest(`${base(slug)}/sender`, { method: "PUT", body: { connectionId }, schema: okSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: senderQueryKey(slug) }),
  });
}

/** The person who connected a Gmail disconnects it. */
export function useDisconnectGmail(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiRequest(`/api/integrations/google/connections/${connectionId}`, { method: "DELETE", schema: okSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: senderQueryKey(slug) }),
  });
}
```
`apiRequest`'s `method` union lacks `"PUT"`: add `"PUT"` to it in `src/lib/api-client.ts` (and a case to `src/lib/api-client.test.ts` asserting the method is passed through).

`src/hooks/use-meeting-defaults.ts`:
```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import {
  meetingDefaultsSchema,
  type MeetingDefaults,
  type UpdateMeetingDefaultsBody,
} from "@/shared/api/meeting-settings";

/** Query key of a workspace's meeting defaults. */
export const meetingDefaultsQueryKey = (slug: string) => ["meeting-defaults", slug] as const;

const path = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}/meeting-defaults`;

/** Settings > Meeting defaults. */
export function useMeetingDefaults(slug: string) {
  return useQuery({
    queryKey: meetingDefaultsQueryKey(slug),
    queryFn: () => apiRequest(path(slug), { schema: meetingDefaultsSchema }),
  });
}

/** Saves one or more defaults optimistically; rolls back on failure. */
export function useUpdateMeetingDefaults(slug: string) {
  const queryClient = useQueryClient();
  const key = meetingDefaultsQueryKey(slug);
  return useMutation({
    mutationFn: (patch: UpdateMeetingDefaultsBody) =>
      apiRequest(path(slug), { method: "PATCH", body: patch, schema: okSchema }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MeetingDefaults>(key);
      if (previous) {
        queryClient.setQueryData<MeetingDefaults>(key, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData<MeetingDefaults>(key, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

- [ ] **Step 14: Scrub the connect callback query** — the callback URL carries `code` and `state`. Extend `OAUTH_CALLBACK` in `src/lib/observability/scrub.ts` to `/\/api\/(?:auth|integrations)\/google\/callback\?[^#\s"']*/gi`, and add a case to `src/lib/observability/scrub.test.ts`: `scrubUrl("/api/integrations/google/callback?code=4/abc&state=xyz")` contains neither `4/abc` nor `xyz`. (Check how the existing sign-in callback case is asserted and mirror it.)

- [ ] **Step 15: Run** — `bun run test src/app/api src/lib src/shared` → PASS; `bun run lint && bun run typecheck && bun run format:check` → PASS.

- [ ] **Step 16: Commit, PR, merge** — `feat(api): workspace sender, meeting defaults and the Gmail connect flow`.

- [ ] **Step 17: First real Google round trip (grilling 2026-10-07; owner + agent, nothing is sent)** —
  1. The owner adds the redirect URIs to `tapnshow-web`: Google Cloud console → project `tapnshow` → Google Auth Platform → Clients → `tapnshow-web` → Authorized redirect URIs → **Add URI** `https://tapnshow.vercel.app/api/integrations/google/callback` → **Add URI** `http://localhost:3000/api/integrations/google/callback` → **Save** (can take a few minutes).
  2. The agent generates the **preview/local** secret set (Task 20 Step 4's script, preview half only) into `~/.config/tapnshow/m4-secrets.preview.env` and `.env.local` (active values + backup block) in the same step, and sets `NEXT_PUBLIC_GMAIL_CONNECT_ENABLED=true` in `.env.local`.
  3. `bun run dev`; the owner signs in on `http://localhost:3000` (preview database), opens a throwaway workspace they own, and visits `/api/integrations/google/connect?workspace=<slug>` (the Settings card arrives in Task 16). They report what Google's screens showed (unverified-app warning, the permission list). Expected: redirect back with `?gmail=connected`; `select google_email, status, granted_scopes from google_connections` on preview (agent, `--agent no`, emails not pasted in chat) shows one active row with `gmail.send`.
  4. Test the failure paths once: cancel on Google's screen → `gmail_error=cancelled`; untick "Send email" → `gmail_error=scope_denied`.
  5. Stop the dev server. Record the outcome in the ledger.

---

### Task 5: DB — meetings, audience, invitees table, `create_meeting`, `add_meeting_people`, `meeting_audience`, import fix

**Labels:** `area:db`

**Files:**
- Create: `supabase/migrations/<timestamp>_m4_meetings.sql`, `src/server/db/meetings.db.test.ts`, `src/test/db/meetings.ts`
- Modify: `src/server/db/function-security.db.test.ts` (allow-list), `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: Task 2 enums (`response_mode`, `location_mode`), `private.valid_delay_options`, workspace defaults columns, `google_connections`; M3 `contacts`, `lists`, `list_contacts`, `private.hit_user_rate_limit`, `private.validate_workspace_timezone`, `public.import_contacts`.
- Produces:
  - Enums `public.meeting_status` (`draft` | `scheduled` | `cancelled`), `public.audience_mode` (`include` | `exclude`), `public.invitee_email_status` (`queued` | `sent` | `skipped` | `failed` | `unknown`), `public.unsubscribe_via` (`link` | `report`).
  - `contacts.unsubscribed_via` (set together with `unsubscribed_at`; CHECK keeps them paired); a trigger refuses turning a roster contact into a one-off guest (`is_adhoc` false → true = `tn:invalid_input`).
  - Tables `public.meetings`, `public.meeting_audience`, `public.meeting_audience_people`, `public.meeting_invitees` (columns exactly as spec §6; `meeting_invitees` has no writes for `authenticated` — Task 6 fills it).
  - RLS: members read everything; Owner/Admin insert/update/delete **draft** meetings through RLS; audience rows writable while the meeting is `draft` or `scheduled` (Invite more).
  - `private.audience_members(p_meeting uuid)` → `table (contact_id uuid, mode public.audience_mode, list_ids uuid[], unsubscribed boolean, reported boolean, invited boolean)` — every contact that is in a picked list, individually included or excluded, or already invited. **The single definition of the audience**, used by `meeting_audience` here and `send_meeting` in Task 6.
  - RPCs:
    - `create_meeting(p_workspace uuid) returns uuid` — Owner/Admin, rate limited (`meetings_per_user_per_hour`), copies the workspace defaults and time zone.
    - `set_meeting_audience(p_meeting uuid, p_list_ids uuid[], p_include uuid[], p_exclude uuid[]) returns void` — replaces the picked lists and the individual include/exclude sets.
    - `add_meeting_people(p_meeting uuid, p_people jsonb, p_save_to_roster boolean) returns jsonb` — `p_people` = `[{ "email", "full_name" }]` (1–50); returns `{ "contact_ids": [uuid…] }`.
    - `meeting_audience(p_meeting uuid) returns jsonb`:
      ```json
      { "list_ids": ["uuid"],
        "people": [{ "id", "full_name", "email", "list_ids": ["uuid"], "added": true, "excluded": false,
                     "unsubscribed": false, "reported": false, "invited": false }],
        "counts": { "selected": 28, "invited": 0, "unsubscribed": 1, "to_invite": 27 },
        "max_invitees": 500 }
      ```
    - `list_meetings(p_workspace uuid) returns jsonb` — `[{ "id", "title", "starts_at", "timezone", "duration_minutes", "status", "location_mode", "invited_count", "sent_count" }]`, drafts without a date last.
  - `import_contacts` now treats a one-off guest with the same email as **new** to the roster and turns `is_adhoc` off when importing them (spec §6 `is_adhoc`).
  - `private.hit_user_rate_limit` accepts `meeting_create` and `meeting_people_add`.

- [ ] **Step 1: Test helper** — `src/test/db/meetings.ts`:
```ts
import { adminClient } from "./clients";

/** Inserts a meeting directly (service role). Defaults: a draft tomorrow at 18:00 UTC, attendance mode. */
export async function seedMeeting(
  workspaceId: string,
  overrides: Partial<{
    title: string;
    status: "draft" | "scheduled" | "cancelled";
    starts_at: string | null;
    location_mode: "in_person" | "online" | "hybrid";
    location_text: string;
    meeting_url: string;
    created_by: string;
  }> = {},
): Promise<string> {
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setUTCHours(18, 0, 0, 0);
  const { data, error } = await adminClient()
    .from("meetings")
    .insert({
      workspace_id: workspaceId,
      title: "Weekly sync",
      starts_at: tomorrow.toISOString(),
      duration_minutes: 60,
      timezone: "Africa/Tunis",
      location_mode: "in_person",
      location_text: "Room B12",
      response_mode: "attendance",
      delay_options: [5, 10, 15, 30],
      reason_required: true,
      comments_enabled: false,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/** Puts contacts in a list (service role). */
export async function addToList(workspaceId: string, listId: string, contactIds: string[]): Promise<void> {
  const { error } = await adminClient()
    .from("list_contacts")
    .insert(contactIds.map((contactId) => ({ workspace_id: workspaceId, list_id: listId, contact_id: contactId })));
  if (error) {
    throw error;
  }
}
```

- [ ] **Step 2: Write the failing DB tests** — `src/server/db/meetings.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { seedContacts, seedList } from "@/test/db/roster";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const audienceSchema = z.object({
  list_ids: z.array(z.uuid()),
  people: z.array(
    z.object({
      id: z.uuid(),
      full_name: z.string(),
      email: z.string(),
      list_ids: z.array(z.uuid()),
      added: z.boolean(),
      excluded: z.boolean(),
      unsubscribed: z.boolean(),
      reported: z.boolean(),
      invited: z.boolean(),
    }),
  ),
  counts: z.object({ selected: z.number(), invited: z.number(), unsubscribed: z.number(), to_invite: z.number() }),
  max_invitees: z.number(),
});

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  outsider = await createTestUser({ fullName: "Outsider" });
  workspace = await createWorkspaceAs(owner, "Meeting Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

async function audience(meetingId: string, user: TestUser = admin) {
  const { data, error } = await user.client.rpc("meeting_audience", { p_meeting: meetingId });
  if (error) {
    throw error;
  }
  return audienceSchema.parse(data);
}

describe("create_meeting", () => {
  it("creates a draft from the workspace defaults; Viewers and outsiders cannot", async () => {
    await adminClient()
      .from("workspaces")
      .update({ default_response_mode: "rsvp", default_duration_minutes: 90, default_footer_note: "Laptops" })
      .eq("id", workspace.id);
    const created = await admin.client.rpc("create_meeting", { p_workspace: workspace.id });
    expect(created.error).toBeNull();
    const row = await admin.client
      .from("meetings")
      .select("status, response_mode, duration_minutes, timezone, footer_note, title, starts_at, created_by")
      .eq("id", created.data ?? "")
      .single();
    expect(row.data).toEqual({
      status: "draft",
      response_mode: "rsvp",
      duration_minutes: 90,
      timezone: "Africa/Tunis",
      footer_note: "Laptops",
      title: "",
      starts_at: null,
      created_by: admin.id,
    });
    await expectAppError(viewer.client.rpc("create_meeting", { p_workspace: workspace.id }), "forbidden");
    await expectAppError(outsider.client.rpc("create_meeting", { p_workspace: workspace.id }), "forbidden");
  });
});

describe("meetings RLS", () => {
  it("edits and deletes drafts only, Owner/Admin only, within the column checks", async () => {
    const draft = await seedMeeting(workspace.id);
    const scheduled = await seedMeeting(workspace.id, { status: "scheduled" });
    const ok = await admin.client.from("meetings").update({ title: "Kickoff" }).eq("id", draft).select("title");
    expect(ok.data).toEqual([{ title: "Kickoff" }]);
    const locked = await admin.client.from("meetings").update({ title: "Changed" }).eq("id", scheduled).select("id");
    expect(locked.data).toEqual([]);
    const viewerEdit = await viewer.client.from("meetings").update({ title: "V" }).eq("id", draft).select("id");
    expect(viewerEdit.data).toEqual([]);
    const badUrl = await admin.client.from("meetings").update({ meeting_url: "javascript:alert(1)" }).eq("id", draft);
    expect(badUrl.error?.code).toBe("23514");
    const badZone = await admin.client.from("meetings").update({ timezone: "Mars/Olympus" }).eq("id", draft);
    expect(badZone.error?.message).toBe("tn:invalid_timezone");
    const statusWrite = await admin.client.from("meetings").update({ status: "scheduled" }).eq("id", draft);
    expect(statusWrite.error?.code).toBe("42501");
    const outsiderRead = await outsider.client.from("meetings").select("id").eq("id", draft);
    expect(outsiderRead.data).toEqual([]);
    const deleteScheduled = await admin.client.from("meetings").delete().eq("id", scheduled).select("id");
    expect(deleteScheduled.data).toEqual([]);
    const deleteDraft = await admin.client.from("meetings").delete().eq("id", draft).select("id");
    expect(deleteDraft.data).toEqual([{ id: draft }]);
  });

  it("lets nobody but the service role write invitees", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [contact] = await seedContacts(workspace.id, 1);
    const write = await admin.client
      .from("meeting_invitees")
      .insert({ workspace_id: workspace.id, meeting_id: meeting, contact_id: contact });
    expect(write.error?.code).toBe("42501");
  });
});

describe("audience", () => {
  it("counts people once across lists, honors exclusions, additions and unsubscribes", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [a, b, c, d, e] = await seedContacts(workspace.id, 5, "aud");
    const members = await seedList(workspace.id, "Members");
    const committee = await seedList(workspace.id, "Committee");
    await addToList(workspace.id, members, [a, b, c]);
    await addToList(workspace.id, committee, [c, d]);
    await adminClient().from("contacts").update({ unsubscribed_at: new Date().toISOString(), unsubscribed_via: "link" }).eq("id", d);

    const set = await admin.client.rpc("set_meeting_audience", {
      p_meeting: meeting,
      p_list_ids: [members, committee],
      p_include: [e],
      p_exclude: [b],
    });
    expect(set.error).toBeNull();
    const result = await audience(meeting);
    expect(result.counts).toEqual({ selected: 4, invited: 0, unsubscribed: 1, to_invite: 3 });
    expect(result.people.find((p) => p.id === c)?.list_ids.sort()).toEqual([members, committee].sort());
    expect(result.people.find((p) => p.id === b)?.excluded).toBe(true);
    expect(result.people.find((p) => p.id === e)?.added).toBe(true);
    expect(result.people.find((p) => p.id === d)).toMatchObject({ unsubscribed: true, reported: false });

    await adminClient().from("meeting_invitees").insert({ workspace_id: workspace.id, meeting_id: meeting, contact_id: a });
    expect((await audience(meeting, viewer)).counts).toEqual({ selected: 4, invited: 1, unsubscribed: 1, to_invite: 2 });
  });

  it("refuses foreign ids, overlapping sets, Viewers and cancelled meetings", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [a] = await seedContacts(workspace.id, 1, "x");
    const other = await createWorkspaceAs(outsider, "Other");
    const [foreign] = await seedContacts(other.id, 1, "foreign");
    await expectAppError(
      admin.client.rpc("set_meeting_audience", { p_meeting: meeting, p_list_ids: [], p_include: [foreign], p_exclude: [] }),
      "not_found",
    );
    await expectAppError(
      admin.client.rpc("set_meeting_audience", { p_meeting: meeting, p_list_ids: [], p_include: [a], p_exclude: [a] }),
      "invalid_input",
    );
    await expectAppError(
      viewer.client.rpc("set_meeting_audience", { p_meeting: meeting, p_list_ids: [], p_include: [a], p_exclude: [] }),
      "forbidden",
    );
    const cancelled = await seedMeeting(workspace.id, { status: "cancelled" });
    await expectAppError(
      admin.client.rpc("set_meeting_audience", { p_meeting: cancelled, p_list_ids: [], p_include: [a], p_exclude: [] }),
      "meeting_not_draft",
    );
  });
});

describe("add_meeting_people", () => {
  it("adds several people at once as one-off guests or roster contacts, merging known emails", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [known] = await seedContacts(workspace.id, 1, "known");
    const guests = await admin.client.rpc("add_meeting_people", {
      p_meeting: meeting,
      p_people: [
        { email: " Nour@Uni.tn ", full_name: "Nour  H." },
        { email: "known-1@example.test", full_name: "Renamed" },
      ],
      p_save_to_roster: false,
    });
    expect(guests.error).toBeNull();
    const nour = await adminClient()
      .from("contacts")
      .select("id, full_name, is_adhoc")
      .eq("workspace_id", workspace.id)
      .eq("email", "nour@uni.tn")
      .single();
    expect(nour.data).toMatchObject({ full_name: "Nour H.", is_adhoc: true });
    const knownRow = await adminClient().from("contacts").select("full_name, is_adhoc").eq("id", known).single();
    expect(knownRow.data).toEqual({ full_name: "known 1", is_adhoc: false });
    const roster = await admin.client.rpc("roster", { p_workspace: workspace.id });
    expect(JSON.stringify(roster.data)).not.toContain("nour@uni.tn");
    expect((await audience(meeting)).counts.to_invite).toBe(2);

    await admin.client.rpc("add_meeting_people", {
      p_meeting: meeting,
      p_people: [{ email: "nour@uni.tn", full_name: "Nour H." }],
      p_save_to_roster: true,
    });
    const saved = await adminClient().from("contacts").select("is_adhoc").eq("id", nour.data?.id ?? "").single();
    expect(saved.data?.is_adhoc).toBe(false);
  });

  it("validates input and roles", async () => {
    const meeting = await seedMeeting(workspace.id);
    await expectAppError(
      admin.client.rpc("add_meeting_people", { p_meeting: meeting, p_people: [{ email: "nope", full_name: "X" }], p_save_to_roster: true }),
      "invalid_input",
    );
    await expectAppError(
      admin.client.rpc("add_meeting_people", { p_meeting: meeting, p_people: [{ email: "a@b.co", full_name: "" }], p_save_to_roster: true }),
      "invalid_input",
    );
    const tooMany = Array.from({ length: 51 }, (_, n) => ({ email: `p${n}@b.co`, full_name: `P ${n}` }));
    await expectAppError(
      admin.client.rpc("add_meeting_people", { p_meeting: meeting, p_people: tooMany, p_save_to_roster: true }),
      "invalid_input",
    );
    await expectAppError(
      viewer.client.rpc("add_meeting_people", { p_meeting: meeting, p_people: [{ email: "a@b.co", full_name: "A" }], p_save_to_roster: true }),
      "forbidden",
    );
  });
});

describe("one-off guests and the roster", () => {
  it("imports a one-off guest as new, moving them into the roster", async () => {
    const meeting = await seedMeeting(workspace.id);
    await admin.client.rpc("add_meeting_people", {
      p_meeting: meeting,
      p_people: [{ email: "guest@uni.tn", full_name: "Guest" }],
      p_save_to_roster: false,
    });
    const preview = await admin.client.rpc("import_contacts", {
      p_workspace: workspace.id,
      p_rows: [{ row: 2, email: "guest@uni.tn", full_name: "Guest", lists: [] }],
      p_dry_run: true,
    });
    expect(JSON.stringify(preview.data)).toContain('"new":1');
    await admin.client.rpc("import_contacts", {
      p_workspace: workspace.id,
      p_rows: [{ row: 2, email: "guest@uni.tn", full_name: "Guest", lists: [] }],
      p_dry_run: false,
    });
    const row = await adminClient().from("contacts").select("is_adhoc").eq("workspace_id", workspace.id).eq("email", "guest@uni.tn").single();
    expect(row.data?.is_adhoc).toBe(false);
  });

  it("never turns a roster contact into a one-off guest", async () => {
    const [id] = await seedContacts(workspace.id, 1, "stay");
    const result = await admin.client.from("contacts").update({ is_adhoc: true }).eq("id", id);
    expect(result.error?.message).toBe("tn:invalid_input");
  });
});

describe("list_meetings", () => {
  it("lists drafts and scheduled meetings with invite counts", async () => {
    const scheduled = await seedMeeting(workspace.id, { status: "scheduled", title: "Sent one" });
    await seedMeeting(workspace.id, { starts_at: null, title: "" });
    const [a, b] = await seedContacts(workspace.id, 2, "lm");
    await adminClient().from("meeting_invitees").insert([
      { workspace_id: workspace.id, meeting_id: scheduled, contact_id: a, email_status: "sent" },
      { workspace_id: workspace.id, meeting_id: scheduled, contact_id: b },
    ]);
    const { data } = await viewer.client.rpc("list_meetings", { p_workspace: workspace.id });
    const rows = z
      .array(z.object({ id: z.uuid(), title: z.string(), status: z.string(), invited_count: z.number(), sent_count: z.number(), starts_at: z.string().nullable() }))
      .parse(data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: scheduled, invited_count: 2, sent_count: 1 });
    expect(rows[1].starts_at).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure** — `bun run test:db -- src/server/db/meetings.db.test.ts` → FAIL (`relation "public.meetings" does not exist`).

- [ ] **Step 4: Migration** — `supabase migration new m4_meetings </dev/null`:
```sql
-- M4 meetings (spec §6 Meetings + contacts, §7.2).

insert into private.app_limits (name, value) values
  ('meetings_per_user_per_hour', 30),
  ('meeting_people_adds_per_user_per_hour', 120),
  ('invitees_per_meeting_max', 500),
  ('meeting_people_per_call_max', 50);

create type public.meeting_status as enum ('draft', 'scheduled', 'cancelled');
create type public.audience_mode as enum ('include', 'exclude');
create type public.invitee_email_status as enum ('queued', 'sent', 'skipped', 'failed', 'unknown');
create type public.unsubscribe_via as enum ('link', 'report');

alter table public.contacts
  add column unsubscribed_via public.unsubscribe_via,
  add constraint contacts_unsubscribe_pair check ((unsubscribed_at is null) = (unsubscribed_via is null));

-- A one-off guest may join the roster (import, "Save to roster"); a roster contact never becomes a
-- hidden guest (that would also slip past the contacts cap, which counts roster contacts only).
create function private.guard_adhoc_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_adhoc and not old.is_adhoc then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger contacts_guard_adhoc
  before update of is_adhoc on public.contacts
  for each row execute function private.guard_adhoc_flag();
grant update (is_adhoc) on table public.contacts to authenticated;

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default '' check (title = btrim(title) and char_length(title) <= 120),
  agenda_md text not null default '' check (char_length(agenda_md) <= 5000),
  starts_at timestamptz,
  duration_minutes smallint not null check (duration_minutes between 5 and 720),
  timezone text not null,
  location_mode public.location_mode not null default 'in_person',
  location_text text not null default '' check (location_text = btrim(location_text) and char_length(location_text) <= 200),
  meeting_url text not null default ''
    check (meeting_url = '' or (meeting_url ~ '^https?://[^[:space:]]+$' and char_length(meeting_url) <= 500)),
  response_mode public.response_mode not null,
  response_deadline timestamptz,
  delay_options smallint[] not null default '{}' check (private.valid_delay_options(delay_options)),
  reason_required boolean not null,
  comments_enabled boolean not null,
  footer_note text not null default '' check (footer_note = btrim(footer_note) and char_length(footer_note) <= 280),
  status public.meeting_status not null default 'draft',
  sent_at timestamptz,
  ics_uid text not null unique default (gen_random_uuid()::text || '@tapnshow.vercel.app'),
  ics_sequence integer not null default 0,
  gmail_thread_id text,
  gmail_root_message_id text,
  thread_connection_id uuid references public.google_connections (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index meetings_workspace_starts_idx on public.meetings (workspace_id, starts_at);
create index meetings_thread_connection_idx on public.meetings (thread_connection_id);
create index meetings_created_by_idx on public.meetings (created_by);
create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function private.set_updated_at();
create trigger meetings_validate_timezone
  before insert or update of timezone on public.meetings
  for each row execute function private.validate_workspace_timezone();

create table public.meeting_audience (
  workspace_id uuid not null,
  meeting_id uuid not null,
  list_id uuid not null,
  primary key (meeting_id, list_id),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade,
  foreign key (list_id, workspace_id) references public.lists (id, workspace_id) on delete cascade
);
create index meeting_audience_meeting_ws_idx on public.meeting_audience (meeting_id, workspace_id);
create index meeting_audience_list_ws_idx on public.meeting_audience (list_id, workspace_id);

create table public.meeting_audience_people (
  workspace_id uuid not null,
  meeting_id uuid not null,
  contact_id uuid not null,
  mode public.audience_mode not null,
  primary key (meeting_id, contact_id),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index meeting_audience_people_meeting_ws_idx on public.meeting_audience_people (meeting_id, workspace_id);
create index meeting_audience_people_contact_ws_idx on public.meeting_audience_people (contact_id, workspace_id);

create table public.meeting_invitees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  meeting_id uuid not null,
  contact_id uuid not null,
  token_hash text unique,
  invited_at timestamptz not null default now(),
  email_status public.invitee_email_status not null default 'queued',
  email_error text check (email_error is null or char_length(email_error) <= 300),
  sent_at timestamptz,
  unique (meeting_id, contact_id),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index meeting_invitees_meeting_ws_idx on public.meeting_invitees (meeting_id, workspace_id);
create index meeting_invitees_contact_ws_idx on public.meeting_invitees (contact_id, workspace_id);

alter table public.meetings enable row level security;
alter table public.meeting_audience enable row level security;
alter table public.meeting_audience_people enable row level security;
alter table public.meeting_invitees enable row level security;
revoke all on table public.meetings, public.meeting_audience, public.meeting_audience_people, public.meeting_invitees
  from anon, authenticated;
grant select on table public.meetings, public.meeting_audience, public.meeting_audience_people, public.meeting_invitees
  to authenticated;
grant insert (workspace_id, title, agenda_md, starts_at, duration_minutes, timezone, location_mode, location_text,
              meeting_url, response_mode, response_deadline, delay_options, reason_required, comments_enabled,
              footer_note, created_by),
      update (title, agenda_md, starts_at, duration_minutes, timezone, location_mode, location_text, meeting_url,
              response_mode, response_deadline, delay_options, reason_required, comments_enabled, footer_note),
      delete
  on table public.meetings to authenticated;
grant insert (workspace_id, meeting_id, list_id), delete on table public.meeting_audience to authenticated;
grant insert (workspace_id, meeting_id, contact_id, mode), update (mode), delete
  on table public.meeting_audience_people to authenticated;
grant all on table public.meetings, public.meeting_audience, public.meeting_audience_people, public.meeting_invitees
  to service_role;

create policy meetings_select_members on public.meetings
  for select to authenticated using (private.is_member(workspace_id));
create policy meetings_insert_managers on public.meetings
  for insert to authenticated
  with check (
    private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and created_by = (select auth.uid())
  );
create policy meetings_update_drafts on public.meetings
  for update to authenticated
  using (status = 'draft' and private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (status = 'draft' and private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy meetings_delete_drafts on public.meetings
  for delete to authenticated
  using (status = 'draft' and private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy meeting_audience_select_members on public.meeting_audience
  for select to authenticated using (private.is_member(workspace_id));
create policy meeting_audience_write_managers on public.meeting_audience
  for insert to authenticated
  with check (
    private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.status in ('draft', 'scheduled'))
  );
create policy meeting_audience_delete_managers on public.meeting_audience
  for delete to authenticated
  using (
    private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.status in ('draft', 'scheduled'))
  );

create policy meeting_audience_people_select_members on public.meeting_audience_people
  for select to authenticated using (private.is_member(workspace_id));
create policy meeting_audience_people_insert_managers on public.meeting_audience_people
  for insert to authenticated
  with check (
    private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.status in ('draft', 'scheduled'))
  );
create policy meeting_audience_people_update_managers on public.meeting_audience_people
  for update to authenticated
  using (
    private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.status in ('draft', 'scheduled'))
  )
  with check (
    private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.status in ('draft', 'scheduled'))
  );
create policy meeting_audience_people_delete_managers on public.meeting_audience_people
  for delete to authenticated
  using (
    private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.status in ('draft', 'scheduled'))
  );

create policy meeting_invitees_select_members on public.meeting_invitees
  for select to authenticated using (private.is_member(workspace_id));

create or replace function private.hit_user_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit_name text := case p_action
    when 'import' then 'imports_per_user_per_hour'
    when 'import_preview' then 'import_previews_per_user_per_hour'
    when 'contact_add' then 'contact_adds_per_user_per_hour'
    when 'meeting_create' then 'meetings_per_user_per_hour'
    when 'meeting_people_add' then 'meeting_people_adds_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- The one definition of "who is in this meeting's audience" (spec §7.2): people in a picked list,
-- individually included, individually excluded, or already invited. Runs with the caller's rights.
create function private.audience_members(p_meeting uuid)
returns table (
  contact_id uuid,
  mode public.audience_mode,
  list_ids uuid[],
  unsubscribed boolean,
  reported boolean,
  invited boolean
)
language sql
stable
set search_path = ''
as $$
  select x.contact_id, x.mode, x.list_ids, x.unsubscribed, x.reported, x.invited
  from (
    select c.id as contact_id,
      p.mode,
      coalesce((
        select array_agg(lc.list_id order by lc.list_id)
        from public.list_contacts lc
        join public.meeting_audience a on a.list_id = lc.list_id and a.meeting_id = p_meeting
        where lc.contact_id = c.id
      ), '{}') as list_ids,
      c.unsubscribed_at is not null as unsubscribed,
      c.unsubscribed_via is not distinct from 'report' as reported,
      i.id is not null as invited
    from public.meetings m
    join public.contacts c on c.workspace_id = m.workspace_id
    left join public.meeting_audience_people p on p.meeting_id = m.id and p.contact_id = c.id
    left join public.meeting_invitees i on i.meeting_id = m.id and i.contact_id = c.id
    where m.id = p_meeting
  ) x
  where x.mode is not null or x.list_ids <> '{}' or x.invited;
$$;

create function public.create_meeting(p_workspace uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('meeting_create') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  insert into public.meetings (
    workspace_id, duration_minutes, timezone, response_mode, delay_options, reason_required,
    comments_enabled, footer_note, created_by
  )
  select w.id, w.default_duration_minutes, w.timezone, w.default_response_mode, w.default_delay_options,
    w.default_reason_required, w.default_comments_enabled, w.default_footer_note, auth.uid()
  from public.workspaces w
  where w.id = p_workspace
  returning id into v_id;
  return v_id;
end;
$$;

create function public.set_meeting_audience(p_meeting uuid, p_list_ids uuid[], p_include uuid[], p_exclude uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_status public.meeting_status;
  v_lists uuid[] := coalesce(p_list_ids, '{}');
  v_include uuid[] := coalesce(p_include, '{}');
  v_exclude uuid[] := coalesce(p_exclude, '{}');
begin
  select m.workspace_id, m.status into v_workspace, v_status from public.meetings m where m.id = p_meeting;
  if v_workspace is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'tn:meeting_not_draft' using errcode = 'P0001';
  end if;
  if v_include && v_exclude then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if pg_catalog.cardinality(v_include) > private.app_limit('invitees_per_meeting_max') then
    raise exception 'tn:too_many_invitees' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(v_lists) as x(id)
    where not exists (select 1 from public.lists l where l.id = x.id and l.workspace_id = v_workspace)
  ) or exists (
    select 1 from pg_catalog.unnest(v_include || v_exclude) as x(id)
    where not exists (select 1 from public.contacts c where c.id = x.id and c.workspace_id = v_workspace)
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  delete from public.meeting_audience a where a.meeting_id = p_meeting and a.list_id <> all (v_lists);
  insert into public.meeting_audience (workspace_id, meeting_id, list_id)
  select v_workspace, p_meeting, x.id from pg_catalog.unnest(v_lists) as x(id)
  on conflict do nothing;
  delete from public.meeting_audience_people p where p.meeting_id = p_meeting;
  insert into public.meeting_audience_people (workspace_id, meeting_id, contact_id, mode)
  select distinct v_workspace, p_meeting, x.id, 'include'::public.audience_mode from pg_catalog.unnest(v_include) as x(id)
  union
  select distinct v_workspace, p_meeting, x.id, 'exclude'::public.audience_mode from pg_catalog.unnest(v_exclude) as x(id);
end;
$$;

create function private.add_meeting_people(p_meeting uuid, p_people jsonb, p_save_to_roster boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_status public.meeting_status;
  v_ids uuid[];
begin
  select m.workspace_id, m.status into v_workspace, v_status from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'tn:meeting_not_draft' using errcode = 'P0001';
  end if;
  if p_people is null or pg_catalog.jsonb_typeof(p_people) <> 'array'
    or pg_catalog.jsonb_array_length(p_people) = 0
    or pg_catalog.jsonb_array_length(p_people) > private.app_limit('meeting_people_per_call_max')
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_people) p
      where not private.is_valid_email(lower(btrim(coalesce(p ->> 'email', ''))))
        or char_length(btrim(regexp_replace(coalesce(p ->> 'full_name', ''), '[[:space:]]+', ' ', 'g'))) not between 1 and 120
    ) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('meeting_people_add') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;

  -- Same email twice in one call: the last name wins (as in import_contacts).
  insert into public.contacts (workspace_id, email, full_name, is_adhoc)
  select distinct on (i.email) v_workspace, i.email, i.full_name, not p_save_to_roster
  from (
    select lower(btrim(p ->> 'email')) as email,
      btrim(regexp_replace(p ->> 'full_name', '[[:space:]]+', ' ', 'g')) as full_name,
      ord
    from pg_catalog.jsonb_array_elements(p_people) with ordinality as x(p, ord)
  ) i
  order by i.email, i.ord desc
  on conflict (workspace_id, email) do update
    set is_adhoc = false
    where p_save_to_roster and public.contacts.is_adhoc;

  select array_agg(c.id order by c.email) into v_ids
  from public.contacts c
  where c.workspace_id = v_workspace
    and c.email in (select lower(btrim(p ->> 'email')) from pg_catalog.jsonb_array_elements(p_people) p);

  insert into public.meeting_audience_people (workspace_id, meeting_id, contact_id, mode)
  select v_workspace, p_meeting, x.id, 'include' from pg_catalog.unnest(v_ids) as x(id)
  on conflict (meeting_id, contact_id) do update set mode = 'include';

  -- Guests moved into the roster by an update skip the insert-time cap trigger; check here.
  if (select count(*) from public.contacts c where c.workspace_id = v_workspace and not c.is_adhoc)
      > private.app_limit('contacts_per_workspace_max') then
    raise exception 'tn:contacts_limit_reached' using errcode = 'P0001';
  end if;
  if (select count(*) from public.meeting_audience_people p where p.meeting_id = p_meeting and p.mode = 'include')
      > private.app_limit('invitees_per_meeting_max') then
    raise exception 'tn:too_many_invitees' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('contact_ids', pg_catalog.to_jsonb(v_ids));
end;
$$;

create function public.add_meeting_people(p_meeting uuid, p_people jsonb, p_save_to_roster boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.add_meeting_people(p_meeting, p_people, p_save_to_roster) $$;

create function public.meeting_audience(p_meeting uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_result jsonb;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  select pg_catalog.jsonb_build_object(
    'list_ids', coalesce((
      select pg_catalog.jsonb_agg(a.list_id order by a.list_id) from public.meeting_audience a where a.meeting_id = p_meeting
    ), '[]'::jsonb),
    'people', coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'email', c.email,
        'list_ids', pg_catalog.to_jsonb(am.list_ids),
        'added', am.mode is not distinct from 'include',
        'excluded', am.mode is not distinct from 'exclude',
        'unsubscribed', am.unsubscribed,
        'reported', am.reported,
        'invited', am.invited
      )
      order by lower(c.full_name), c.email
    ) filter (where c.id is not null), '[]'::jsonb),
    'counts', pg_catalog.jsonb_build_object(
      'selected', count(*) filter (where c.id is not null and am.mode is distinct from 'exclude'),
      'invited', count(*) filter (where am.invited),
      'unsubscribed', count(*) filter (where am.mode is distinct from 'exclude' and am.unsubscribed and not am.invited),
      'to_invite', count(*) filter (where am.mode is distinct from 'exclude' and not am.unsubscribed and not am.invited)
    ),
    'max_invitees', private.app_limit('invitees_per_meeting_max')
  )
  into v_result
  from private.audience_members(p_meeting) am
  right join (select 1) one on true
  left join public.contacts c on c.id = am.contact_id;
  return v_result;
end;
$$;

create function public.list_meetings(p_workspace uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'starts_at', m.starts_at,
        'timezone', m.timezone,
        'duration_minutes', m.duration_minutes,
        'status', m.status,
        'location_mode', m.location_mode,
        'invited_count', (select count(*) from public.meeting_invitees i where i.meeting_id = m.id),
        'sent_count', (select count(*) from public.meeting_invitees i where i.meeting_id = m.id and i.email_status = 'sent')
      )
      order by m.starts_at nulls last, m.created_at desc
    )
    from public.meetings m
    where m.workspace_id = p_workspace
  ), '[]'::jsonb);
end;
$$;
```
Then the `import_contacts` change — copy the **entire** current body from `supabase/migrations/20261007111304_m3_contact_add_limit.sql` (the `create or replace function public.import_contacts(…)` block) into this migration and make exactly these three edits (everything else stays byte-for-byte):
1. In the `people` CTE, add `c.is_adhoc as existing_adhoc,` after `c.full_name as existing_name,`.
2. In `final_groups`, change `when g.existing_id is null then 'new'` to `when g.existing_id is null or g.existing_adhoc then 'new'`, and in the `added` CTE change `where g.existing_id is null` to `where g.existing_id is null or g.existing_adhoc`.
3. In the contacts upsert, change the conflict clause to:
```sql
    on conflict (workspace_id, email) do update
      set full_name = excluded.full_name, is_adhoc = false
      where public.contacts.full_name is distinct from excluded.full_name or public.contacts.is_adhoc;
```
(The cap count already counts `not is_adhoc` contacts plus the `new` outcomes, so a guest joining the roster is counted once.)

Finally, grants:
```sql
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.audience_members(uuid),
  private.add_meeting_people(uuid, jsonb, boolean)
to authenticated;
grant execute on function private.audience_members(uuid) to service_role;

revoke execute on function
  public.create_meeting(uuid),
  public.set_meeting_audience(uuid, uuid[], uuid[], uuid[]),
  public.add_meeting_people(uuid, jsonb, boolean),
  public.meeting_audience(uuid),
  public.list_meetings(uuid)
from public, anon;
grant execute on function
  public.create_meeting(uuid),
  public.set_meeting_audience(uuid, uuid[], uuid[], uuid[]),
  public.add_meeting_people(uuid, jsonb, boolean),
  public.meeting_audience(uuid),
  public.list_meetings(uuid)
to authenticated;
```

- [ ] **Step 5: Apply, regenerate, allow-list** — `supabase migration up --local </dev/null && bun run db:types`. Add `"add_meeting_people"` and `"audience_members"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted).

- [ ] **Step 6: Run** — `bun run test:db` → all green, including the M3 `import-contacts.db.test.ts` unchanged. `supabase db advisors --local </dev/null` → no WARN/ERROR (if lint 0003 `auth_rls_initplan` flags `created_by = (select auth.uid())`, it is already in the recommended `(select …)` form). `bun run typecheck` → PASS.

- [ ] **Step 7: Commit, PR, merge** — `feat(db): meetings, audience and the invitee table`. Then the **Hosted migration procedure**.

---

### Task 6: DB — outbox, leases, `send_meeting`, `meeting_progress`, dispatcher functions, cron kick

**Labels:** `area:db`, `area:pipeline`

**Files:**
- Create: `supabase/migrations/<timestamp>_m4_outbox.sql`, `src/server/db/outbox.db.test.ts`, `src/test/db/outbox.ts`
- Modify: `src/server/db/function-security.db.test.ts`, `src/server/db/database.types.ts`, `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§6 `outbox_jobs` line: add `invitee_id`, `run_id`, `send_started_at`)

**Interfaces:**
- Consumes: Task 2 `google_connections`, `send_log`, `workspaces.sender_connection_id`; Task 5 `meetings`, `meeting_invitees`, `private.audience_members`; Task 1 `private.housekeeping`.
- Produces:
  - Enums `public.job_kind` (spec §6 list), `public.job_status` (`pending` | `processing` | `done` | `failed` | `paused`).
  - `public.outbox_jobs` (`id`, `kind`, `workspace_id`, `invitee_id` (nullable; set for invite jobs), `payload` (`{}` for invites), `idempotency_key` unique, `run_after`, `status`, `attempts`, `locked_until`, `run_id`, `send_started_at`, `last_error`, timestamps) — service role only.
  - `public.sender_leases` (`google_sub` PK, `run_id`, `locked_until`) — service role only.
  - Limits `gmail_sends_per_minute` 60, `dispatch_job_max_attempts` 6.
  - User RPCs (private definer + public wrapper):
    - `send_meeting(p_meeting uuid) returns jsonb` → `{ "invited": 27, "skipped_unsubscribed": 1 }`. First send and "Invite more" alike. Errors: `not_found`, `forbidden`, `meeting_not_draft` (cancelled), `meeting_incomplete`, `meeting_in_past`, `sender_not_connected`, `sender_broken`, `nothing_to_send`, `too_many_invitees`.
    - `meeting_progress(p_meeting uuid) returns jsonb` (any member):
      ```json
      { "counts": { "total": 30, "queued": 12, "sent": 16, "skipped": 1, "failed": 1, "unknown": 0 },
        "paused": 0, "resumes_at": null, "sender_state": "ok",
        "invitees": [{ "id", "contact_id", "full_name", "email", "status", "error", "sent_at" }] }
      ```
      `sender_state` ∈ `ok` | `missing` | `broken`; `resumes_at` = earliest `run_after` of a pending job more than 2 minutes away (quota deferral), else null.
  - Dispatcher RPCs (public invoker, **service_role only**; `dispatch_mark_broken` is a private definer behind a service-role-only wrapper because it reads `auth.users`):
    - `dispatch_claim(p_run uuid, p_limit integer, p_lease_seconds integer) returns jsonb` → `null` or
      ```json
      { "connection": { "id", "user_id", "google_sub", "google_email", "refresh_token_encrypted" },
        "jobs": [{ "job_id", "attempts", "invitee_id", "workspace_id", "workspace_name",
                   "contact": { "full_name", "email" },
                   "meeting": { "id", "title", "agenda_md", "starts_at", "duration_minutes", "timezone",
                                "location_mode", "location_text", "meeting_url", "response_mode",
                                "response_deadline", "footer_note", "thread_id", "root_message_id" } }] }
      ```
      (`thread_id` / `root_message_id` are null unless the stored thread belongs to this connection.) Before picking, it turns expired leases into `unknown` (send had started) or `pending` (it had not), and pauses due jobs of workspaces without an active sender.
    - `dispatch_reserve(p_job uuid) returns jsonb` → `{ "kind": "ok" }` | `{ "kind": "quota", "retry_at": "…" }` (job already put back) | `{ "kind": "done" }` (job finished here: unsubscribed → `skipped`, meeting cancelled → `skipped`, meeting started → `failed`) | `{ "kind": "gone" }`.
    - `dispatch_finish(p_job uuid, p_outcome public.invitee_email_status, p_error text, p_token_hash text) returns void` — `sent`/`skipped` → job `done`; `failed`/`unknown` → job `failed`; `failed` releases the quota reservation.
    - `dispatch_retry(p_job uuid, p_error text) returns jsonb` → `{ "kind": "retry", "retry_at" }` | `{ "kind": "failed" }`; releases the reservation; backoff 2^(attempts−1) minutes.
    - `dispatch_unclaim(p_jobs uuid[]) returns void` — claimed jobs not yet started go back to `pending` without spending an attempt.
    - `dispatch_defer_sender(p_run uuid, p_connection uuid, p_until timestamptz, p_error text) returns void` — Gmail said "slow down": this run's claimed jobs and every pending job of workspaces using the connection move to `p_until`.
    - `dispatch_mark_broken(p_run uuid, p_connection uuid, p_reason text) returns jsonb` → `{ "newly_broken": true, "alert": [{ "email", "workspace_name", "workspace_slug" }] }` — sets `broken`, pauses jobs, and returns the Owners to alert only when this call broke it **and** the platform email budget (`invite_email:platform`) allows.
    - `dispatch_set_thread(p_meeting uuid, p_connection uuid, p_thread_id text, p_root_message_id text) returns void`.
    - `dispatch_release(p_run uuid) returns void` — drops this run's sender leases.
  - Triggers: changing a workspace's sender to a non-null value, or a connection going `broken` → `active`, moves that workspace's `paused` jobs back to `pending` now.
  - `private.kick_dispatcher()` + cron job `tn-dispatch` (`* * * * *`): when jobs are due and Vault holds `tn_dispatch_url` and `tn_dispatch_secret`, `net.http_post` to the dispatcher (10 s timeout); otherwise nothing (local, CI, preview).
  - `private.housekeeping()` also deletes `done`/`failed` jobs and `send_log` rows older than 30 days, stale leases, and drafts with no title and no date older than 24 hours.

- [ ] **Step 1: Test helper** — `src/test/db/outbox.ts`:
```ts
import { z } from "zod";
import { adminClient } from "./clients";
import { queryLocalSql, runLocalSql } from "./sql";

/** Calls a dispatcher RPC as the service role and returns its JSON (throws on error). */
export async function serviceRpc(name: string, args: Record<string, string | number | string[] | null>) {
  const { data, error } = await adminClient().rpc(name as never, args as never);
  if (error) {
    throw error;
  }
  return data as object | null;
}

/** Sets a numeric limit for one test and returns a function restoring the original value. */
export function overrideLimit(name: string, value: number): () => void {
  const [row] = queryLocalSql(
    `select value from private.app_limits where name = '${name}'`,
    z.array(z.object({ value: z.number() })).length(1),
  );
  runLocalSql(`update private.app_limits set value = ${value} where name = '${name}'`);
  return () => runLocalSql(`update private.app_limits set value = ${row.value} where name = '${name}'`);
}

/** Job rows of one meeting (service role). */
export async function jobsOf(meetingId: string) {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .select("id, status, attempts, run_after, last_error, idempotency_key, send_started_at, invitee_id, meeting_invitees!inner(meeting_id)")
    .eq("meeting_invitees.meeting_id", meetingId);
  if (error) {
    throw error;
  }
  return data;
}
```
The repo bans `unknown`, and `rpc()` is typed by name; `name as never` / `args as never` keeps this one test helper generic without `any`. If the linter or typecheck rejects `as never`, replace `serviceRpc` with one typed wrapper per RPC (`claim`, `reserve`, …) calling `adminClient().rpc("dispatch_claim", { … })` directly — the generated types know every name after Step 5.

- [ ] **Step 2: Write the failing DB tests** — `src/server/db/outbox.db.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { jobsOf, overrideLimit, serviceRpc } from "@/test/db/outbox";
import { seedContacts, seedList } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const claimSchema = z
  .object({
    connection: z.object({ id: z.uuid(), google_sub: z.string(), google_email: z.string(), refresh_token_encrypted: z.string(), user_id: z.uuid() }),
    jobs: z.array(
      z.object({
        job_id: z.uuid(),
        attempts: z.number(),
        invitee_id: z.uuid(),
        workspace_name: z.string(),
        contact: z.object({ full_name: z.string(), email: z.string() }),
        meeting: z.object({ id: z.uuid(), title: z.string(), thread_id: z.string().nullable() }).loose(),
      }).loose(),
    ),
  })
  .nullable();

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;
let connection: string;
let sub: string;
let meeting: string;
let contacts: string[];
const restore: Array<() => void> = [];

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Outbox Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
  sub = `sub-${crypto.randomUUID()}`;
  connection = await seedConnection(owner.id, { sub });
  await setSender(workspace.id, connection);
  contacts = await seedContacts(workspace.id, 3, `ob-${crypto.randomUUID().slice(0, 6)}`);
  const list = await seedList(workspace.id, "Members");
  await addToList(workspace.id, list, contacts);
  meeting = await seedMeeting(workspace.id, { created_by: admin.id });
  await admin.client.rpc("set_meeting_audience", { p_meeting: meeting, p_list_ids: [list], p_include: [], p_exclude: [] });
  // Earlier tests may leave due jobs from other workspaces; park them so claims only see ours.
  runLocalSql("update public.outbox_jobs set status = 'done' where status in ('pending', 'processing')");
  runLocalSql("delete from public.sender_leases");
});

afterEach(() => {
  while (restore.length) {
    restore.pop()?.();
  }
});

const claim = async (run = crypto.randomUUID(), limit = 10) =>
  claimSchema.parse(await serviceRpc("dispatch_claim", { p_run: run, p_limit: limit, p_lease_seconds: 70 }));

describe("send_meeting", () => {
  it("snapshots the audience into invitees and one invite job each, once", async () => {
    await adminClient().from("contacts").update({ unsubscribed_at: new Date().toISOString(), unsubscribed_via: "link" }).eq("id", contacts[2]);
    const sent = await admin.client.rpc("send_meeting", { p_meeting: meeting });
    expect(sent.data).toEqual({ invited: 2, skipped_unsubscribed: 1 });
    const jobs = await jobsOf(meeting);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.status === "pending" && j.idempotency_key === `invite:${j.invitee_id}`)).toBe(true);
    const row = await adminClient().from("meetings").select("status, sent_at").eq("id", meeting).single();
    expect(row.data?.status).toBe("scheduled");
    expect(row.data?.sent_at).not.toBeNull();
    await expectAppError(admin.client.rpc("send_meeting", { p_meeting: meeting }), "nothing_to_send");
    await expectAppError(viewer.client.rpc("send_meeting", { p_meeting: meeting }), "forbidden");
  });

  it("invites only the new people on Invite more", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const [extra] = await seedContacts(workspace.id, 1, `extra-${crypto.randomUUID().slice(0, 6)}`);
    const { data: current } = await admin.client.from("meeting_audience").select("list_id").eq("meeting_id", meeting);
    await admin.client.rpc("set_meeting_audience", {
      p_meeting: meeting,
      p_list_ids: (current ?? []).map((r) => r.list_id),
      p_include: [extra],
      p_exclude: [],
    });
    expect((await admin.client.rpc("send_meeting", { p_meeting: meeting })).data).toEqual({ invited: 1, skipped_unsubscribed: 0 });
    expect(await jobsOf(meeting)).toHaveLength(4);
  });

  it("refuses incomplete, past, sender-less and broken-sender meetings", async () => {
    await adminClient().from("meetings").update({ title: "" }).eq("id", meeting);
    await expectAppError(admin.client.rpc("send_meeting", { p_meeting: meeting }), "meeting_incomplete");
    await adminClient().from("meetings").update({ title: "Sync", location_mode: "online", meeting_url: "" }).eq("id", meeting);
    await expectAppError(admin.client.rpc("send_meeting", { p_meeting: meeting }), "meeting_incomplete");
    await adminClient().from("meetings").update({ location_mode: "in_person", starts_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", meeting);
    await expectAppError(admin.client.rpc("send_meeting", { p_meeting: meeting }), "meeting_in_past");
    await adminClient().from("meetings").update({ starts_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("id", meeting);
    await setSender(workspace.id, null);
    await expectAppError(admin.client.rpc("send_meeting", { p_meeting: meeting }), "sender_not_connected");
    await setSender(workspace.id, connection);
    await adminClient().from("google_connections").update({ status: "broken" }).eq("id", connection);
    await expectAppError(admin.client.rpc("send_meeting", { p_meeting: meeting }), "sender_broken");
  });
});

describe("dispatcher claim and leases", () => {
  it("gives a sender's jobs to one run at a time", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const [a, b] = await Promise.all([claim(), claim()]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.connection).toMatchObject({ id: connection, google_sub: sub });
    expect(winners[0]?.jobs).toHaveLength(3);
    expect(winners[0]?.jobs[0].workspace_name).toBe("Outbox Club");
  });

  it("turns an expired lease into 'unknown' when sending had started, and retries otherwise", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const first = await claim(crypto.randomUUID(), 2);
    const [started, notStarted] = first?.jobs ?? [];
    expect(await serviceRpc("dispatch_reserve", { p_job: started.job_id })).toEqual({ kind: "ok" });
    runLocalSql("update public.outbox_jobs set locked_until = now() - interval '1 second' where status = 'processing'");
    runLocalSql("delete from public.sender_leases");
    const second = await claim();
    const ids = (second?.jobs ?? []).map((j) => j.job_id);
    expect(ids).toContain(notStarted.job_id);
    expect(ids).not.toContain(started.job_id);
    const invitee = await adminClient().from("meeting_invitees").select("email_status").eq("id", started.invitee_id).single();
    expect(invitee.data?.email_status).toBe("unknown");
  });

  it("pauses jobs without a sender and resumes them when one is set", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    await setSender(workspace.id, null);
    expect(await claim()).toBeNull();
    expect((await jobsOf(meeting)).every((j) => j.status === "paused")).toBe(true);
    await setSender(workspace.id, connection);
    expect((await jobsOf(meeting)).every((j) => j.status === "pending")).toBe(true);
  });
});

describe("quota reservations", () => {
  it("never lets two concurrent reserves pass the daily cap", async () => {
    restore.push(overrideLimit("gmail_sends_per_day", 2));
    await adminClient().from("send_log").insert({ google_sub: sub, workspace_id: workspace.id });
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const claimed = await claim();
    const [x, y] = claimed?.jobs ?? [];
    const results = await Promise.all([
      serviceRpc("dispatch_reserve", { p_job: x.job_id }),
      serviceRpc("dispatch_reserve", { p_job: y.job_id }),
    ]);
    const kinds = results.map((r) => z.object({ kind: z.string() }).loose().parse(r).kind).sort();
    expect(kinds).toEqual(["ok", "quota"]);
    const deferred = (await jobsOf(meeting)).find((j) => j.status === "pending");
    expect(new Date(deferred?.run_after ?? 0).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it("finishes skipped people at reserve time", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const claimed = await claim();
    const target = claimed?.jobs[0];
    const { data: invitee } = await adminClient().from("meeting_invitees").select("contact_id").eq("id", target?.invitee_id ?? "").single();
    await adminClient().from("contacts").update({ unsubscribed_at: new Date().toISOString(), unsubscribed_via: "link" }).eq("id", invitee?.contact_id ?? "");
    expect(await serviceRpc("dispatch_reserve", { p_job: target?.job_id ?? "" })).toEqual({ kind: "done" });
    const row = await adminClient().from("meeting_invitees").select("email_status").eq("id", target?.invitee_id ?? "").single();
    expect(row.data?.email_status).toBe("skipped");
  });
});

describe("finish, retry, defer, broken", () => {
  it("records a sent invite with its token hash and releases a failed one", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const [ok, bad] = (await claim())?.jobs ?? [];
    await serviceRpc("dispatch_reserve", { p_job: ok.job_id });
    await serviceRpc("dispatch_finish", { p_job: ok.job_id, p_outcome: "sent", p_error: null, p_token_hash: "a".repeat(64) });
    await serviceRpc("dispatch_reserve", { p_job: bad.job_id });
    await serviceRpc("dispatch_finish", { p_job: bad.job_id, p_outcome: "failed", p_error: "invalid_recipient", p_token_hash: null });
    const rows = await adminClient().from("meeting_invitees").select("id, email_status, token_hash, sent_at").in("id", [ok.invitee_id, bad.invitee_id]);
    expect(rows.data?.find((r) => r.id === ok.invitee_id)).toMatchObject({ email_status: "sent", token_hash: "a".repeat(64) });
    expect(rows.data?.find((r) => r.id === bad.invitee_id)).toMatchObject({ email_status: "failed", token_hash: null });
    const log = await adminClient().from("send_log").select("job_id").eq("google_sub", sub);
    expect(log.data?.map((r) => r.job_id)).toEqual([ok.job_id]);
  });

  it("backs off 1, 2, 4, 8, 16 minutes, then fails", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    let job = (await claim(crypto.randomUUID(), 1))?.jobs[0];
    // Keep only this job in play so each claim picks it again.
    runLocalSql("update public.outbox_jobs set status = 'done' where status = 'pending'");
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const result = z.object({ kind: z.string(), retry_at: z.string().optional() }).parse(
        await serviceRpc("dispatch_retry", { p_job: job?.job_id ?? "", p_error: "http_503" }),
      );
      if (result.kind === "failed") {
        expect(attempt).toBe(6);
        break;
      }
      delays.push(Math.round((new Date(result.retry_at ?? 0).getTime() - Date.now()) / 60_000));
      runLocalSql(`update public.outbox_jobs set run_after = now() where id = '${job?.job_id}'`);
      runLocalSql("delete from public.sender_leases");
      job = (await claim(crypto.randomUUID(), 1))?.jobs[0];
    }
    expect(delays).toEqual([1, 2, 4, 8, 16]);
  });

  it("defers a throttled sender and pauses a broken one, alerting the Owner once", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const run = crypto.randomUUID();
    const claimed = await claim(run);
    const until = new Date(Date.now() + 3600_000).toISOString();
    await serviceRpc("dispatch_defer_sender", { p_run: run, p_connection: connection, p_until: until, p_error: "gmail_throttled" });
    expect((await jobsOf(meeting)).every((j) => j.status === "pending" && j.attempts === 0)).toBe(true);
    runLocalSql("update public.outbox_jobs set run_after = now() where status = 'pending'");
    runLocalSql("delete from public.sender_leases");
    const run2 = crypto.randomUUID();
    await claim(run2);
    const broken = z.object({ newly_broken: z.boolean(), alert: z.array(z.object({ email: z.string(), workspace_name: z.string(), workspace_slug: z.string() })) }).parse(
      await serviceRpc("dispatch_mark_broken", { p_run: run2, p_connection: connection, p_reason: "invalid_grant" }),
    );
    expect(broken.newly_broken).toBe(true);
    expect(broken.alert).toEqual([{ email: owner.email, workspace_name: "Outbox Club", workspace_slug: workspace.slug }]);
    expect((await jobsOf(meeting)).every((j) => j.status === "paused")).toBe(true);
    const again = z.object({ newly_broken: z.boolean() }).loose().parse(
      await serviceRpc("dispatch_mark_broken", { p_run: run2, p_connection: connection, p_reason: "invalid_grant" }),
    );
    expect(again.newly_broken).toBe(false);
    await adminClient().rpc("save_google_connection", {
      p_user: owner.id,
      p_google_sub: sub,
      p_google_email: "club@gmail.com",
      p_scopes: ["https://www.googleapis.com/auth/gmail.send"],
      p_token_encrypted: "v1.n.e.w",
    });
    expect((await jobsOf(meeting)).every((j) => j.status === "pending")).toBe(true);
    expect(claimed).not.toBeNull();
  });
});

describe("meeting_progress", () => {
  it("shows counts, deferral time and sender state to members only", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const until = new Date(Date.now() + 3600_000).toISOString();
    runLocalSql(`update public.outbox_jobs set run_after = '${until}' where invitee_id in (select id from public.meeting_invitees where meeting_id = '${meeting}')`);
    const { data } = await viewer.client.rpc("meeting_progress", { p_meeting: meeting });
    const progress = z
      .object({
        counts: z.object({ total: z.number(), queued: z.number(), sent: z.number() }).loose(),
        paused: z.number(),
        resumes_at: z.string().nullable(),
        sender_state: z.string(),
        invitees: z.array(z.object({ full_name: z.string(), status: z.string() }).loose()),
      })
      .parse(data);
    expect(progress.counts).toMatchObject({ total: 3, queued: 3, sent: 0 });
    expect(new Date(progress.resumes_at ?? 0).toISOString()).toBe(new Date(until).toISOString());
    expect(progress.sender_state).toBe("ok");
    expect(progress.invitees).toHaveLength(3);
    const outsider = await createTestUser();
    await expectAppError(outsider.client.rpc("meeting_progress", { p_meeting: meeting }), "not_found");
  });
});

describe("cron kick and security", () => {
  it("calls the dispatcher only when jobs are due and Vault is configured", async () => {
    // pg_net moves requests from its queue to its response table in the background, so count both
    // and poll briefly instead of asserting on one table at one instant.
    const requests = () =>
      queryLocalSql(
        "select ((select count(*) from net.http_request_queue) + (select count(*) from net._http_response))::int as n",
        z.array(z.object({ n: z.number() })),
      )[0].n;
    const eventually = async (check: () => boolean) => {
      for (let i = 0; i < 25 && !check(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return check();
    };
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const before = requests();
    runLocalSql("select private.kick_dispatcher()");
    expect(requests()).toBe(before);
    runLocalSql(
      "select vault.create_secret('http://127.0.0.1:9/api/internal/dispatch', 'tn_dispatch_url'), vault.create_secret('test-secret', 'tn_dispatch_secret')",
    );
    try {
      runLocalSql("select private.kick_dispatcher()");
      expect(await eventually(() => requests() > before)).toBe(true);
    } finally {
      runLocalSql("delete from vault.secrets where name in ('tn_dispatch_url', 'tn_dispatch_secret')");
    }
  });

  it("cleans up empty drafts after a day and keeps everything else", async () => {
    const empty = await seedMeeting(workspace.id, { title: "", starts_at: null });
    const named = await seedMeeting(workspace.id, { title: "Named", starts_at: null });
    const fresh = await seedMeeting(workspace.id, { title: "", starts_at: null });
    runLocalSql(`update public.meetings set created_at = now() - interval '25 hours' where id in ('${empty}', '${named}')`);
    runLocalSql("select private.housekeeping()");
    const { data } = await adminClient().from("meetings").select("id").in("id", [empty, named, fresh]);
    expect((data ?? []).map((r) => r.id).sort()).toEqual([named, fresh].sort());
  });

  it("keeps dispatcher functions away from signed-in users", async () => {
    const result = await admin.client.rpc("dispatch_claim", { p_run: crypto.randomUUID(), p_limit: 1, p_lease_seconds: 70 });
    expect(result.error?.code).toBe("42501");
    const jobs = await admin.client.from("outbox_jobs").select("id");
    expect(jobs.error?.code).toBe("42501");
  });
});
```
The "before" count can also include responses pg_net trims in the background (it keeps about 6 hours, S1); if `requests()` ever decreases between the two reads on a long-lived local stack, clear `net._http_response` at the start of the test with `runLocalSql("delete from net._http_response")`.

- [ ] **Step 3: Run to verify failure** — `bun run test:db -- src/server/db/outbox.db.test.ts` → FAIL (`Could not find the function public.send_meeting`).

- [ ] **Step 4: Migration** — `supabase migration new m4_outbox </dev/null`:
```sql
-- M4 outbox and dispatcher (spec §6 Integrations & pipeline, §7.2, §8).

insert into private.app_limits (name, value) values
  ('gmail_sends_per_minute', 60),
  ('dispatch_job_max_attempts', 6);

create type public.job_kind as enum
  ('invite', 'calendar_confirm', 'update', 'cancel', 'reminder', 'sheet_sync', 'push', 'system_email');
create type public.job_status as enum ('pending', 'processing', 'done', 'failed', 'paused');

create table public.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.job_kind not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invitee_id uuid references public.meeting_invitees (id) on delete cascade,
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  run_after timestamptz not null default now(),
  status public.job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  run_id uuid,
  send_started_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbox_jobs_due_idx on public.outbox_jobs (status, run_after);
create index outbox_jobs_workspace_status_idx on public.outbox_jobs (workspace_id, status);
create index outbox_jobs_invitee_idx on public.outbox_jobs (invitee_id);
create index outbox_jobs_run_idx on public.outbox_jobs (run_id) where run_id is not null;
create trigger outbox_jobs_set_updated_at
  before update on public.outbox_jobs
  for each row execute function private.set_updated_at();

alter table public.send_log
  add constraint send_log_job_fk foreign key (job_id) references public.outbox_jobs (id) on delete set null;

create table public.sender_leases (
  google_sub text primary key,
  run_id uuid not null,
  locked_until timestamptz not null
);

alter table public.outbox_jobs enable row level security;
alter table public.sender_leases enable row level security;
revoke all on table public.outbox_jobs, public.sender_leases from anon, authenticated;
grant all on table public.outbox_jobs, public.sender_leases to service_role;

-- Paused jobs resume as soon as their workspace has a usable sender again (spec §8).
create function private.resume_paused_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'workspaces' then
    if new.sender_connection_id is not null then
      update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
      where j.workspace_id = new.id and j.status = 'paused';
    end if;
  elsif new.status = 'active' and old.status = 'broken' then
    update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
    where j.status = 'paused'
      and j.workspace_id in (select w.id from public.workspaces w where w.sender_connection_id = new.id);
  end if;
  return null;
end;
$$;
create trigger workspaces_resume_jobs
  after update of sender_connection_id on public.workspaces
  for each row execute function private.resume_paused_jobs();
create trigger google_connections_resume_jobs
  after update of status on public.google_connections
  for each row execute function private.resume_paused_jobs();

create function private.send_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_sender public.google_connections;
  v_invited integer;
  v_new integer;
  v_skipped integer;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'cancelled' then
    raise exception 'tn:meeting_not_draft' using errcode = 'P0001';
  end if;
  if v_meeting.title = ''
    or v_meeting.starts_at is null
    or (v_meeting.location_mode in ('in_person', 'hybrid') and v_meeting.location_text = '')
    or (v_meeting.location_mode in ('online', 'hybrid') and v_meeting.meeting_url = '')
    or (v_meeting.response_mode = 'attendance' and pg_catalog.cardinality(v_meeting.delay_options) = 0)
    or (v_meeting.response_deadline is not null
        and (v_meeting.response_deadline > v_meeting.starts_at or v_meeting.response_deadline <= pg_catalog.now())) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  select c.* into v_sender
  from public.workspaces w join public.google_connections c on c.id = w.sender_connection_id
  where w.id = v_meeting.workspace_id;
  if v_sender.id is null then
    raise exception 'tn:sender_not_connected' using errcode = 'P0001';
  end if;
  if v_sender.status <> 'active' then
    raise exception 'tn:sender_broken' using errcode = 'P0001';
  end if;

  select
    count(*) filter (where am.invited),
    count(*) filter (where am.mode is distinct from 'exclude' and not am.invited and not am.unsubscribed),
    count(*) filter (where am.mode is distinct from 'exclude' and not am.invited and am.unsubscribed)
  into v_invited, v_new, v_skipped
  from private.audience_members(p_meeting) am;
  if v_new = 0 then
    raise exception 'tn:nothing_to_send' using errcode = 'P0001';
  end if;
  if v_invited + v_new > private.app_limit('invitees_per_meeting_max') then
    raise exception 'tn:too_many_invitees' using errcode = 'P0001';
  end if;

  with inserted as (
    insert into public.meeting_invitees (workspace_id, meeting_id, contact_id)
    select v_meeting.workspace_id, p_meeting, am.contact_id
    from private.audience_members(p_meeting) am
    where am.mode is distinct from 'exclude' and not am.invited and not am.unsubscribed
    on conflict (meeting_id, contact_id) do nothing
    returning id
  )
  insert into public.outbox_jobs (kind, workspace_id, invitee_id, idempotency_key)
  select 'invite', v_meeting.workspace_id, i.id, 'invite:' || i.id::text from inserted i
  on conflict (idempotency_key) do nothing;

  update public.meetings set status = 'scheduled', sent_at = coalesce(sent_at, pg_catalog.now()) where id = p_meeting;
  return pg_catalog.jsonb_build_object('invited', v_new, 'skipped_unsubscribed', v_skipped);
end;
$$;

create function private.meeting_progress(p_meeting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'counts', (
      select pg_catalog.jsonb_build_object(
        'total', count(*),
        'queued', count(*) filter (where i.email_status = 'queued'),
        'sent', count(*) filter (where i.email_status = 'sent'),
        'skipped', count(*) filter (where i.email_status = 'skipped'),
        'failed', count(*) filter (where i.email_status = 'failed'),
        'unknown', count(*) filter (where i.email_status = 'unknown')
      )
      from public.meeting_invitees i where i.meeting_id = p_meeting
    ),
    'paused', (
      select count(*) from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      where i.meeting_id = p_meeting and j.status = 'paused'
    ),
    'resumes_at', (
      select min(j.run_after) from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      where i.meeting_id = p_meeting and j.status = 'pending' and j.run_after > pg_catalog.now() + interval '2 minutes'
    ),
    'sender_state', (
      select case when c.id is null then 'missing' when c.status = 'broken' then 'broken' else 'ok' end
      from public.workspaces w left join public.google_connections c on c.id = w.sender_connection_id
      where w.id = v_workspace
    ),
    'invitees', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', i.id, 'contact_id', c.id, 'full_name', c.full_name, 'email', c.email,
          'status', i.email_status, 'error', i.email_error, 'sent_at', i.sent_at
        )
        order by lower(c.full_name), c.email
      )
      from public.meeting_invitees i join public.contacts c on c.id = i.contact_id
      where i.meeting_id = p_meeting
    ), '[]'::jsonb)
  );
end;
$$;

create function public.send_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.send_meeting(p_meeting) $$;

create function public.meeting_progress(p_meeting uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.meeting_progress(p_meeting) $$;

-- Dispatcher (service role only; spec §8). One run owns one Google account at a time.
create function public.dispatch_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection public.google_connections;
  v_lease interval := pg_catalog.make_interval(secs => p_lease_seconds);
  v_rows integer;
begin
  -- A lease expired after the email may have reached Gmail: never resend (at most once).
  with lost as (
    update public.outbox_jobs j
    set status = 'failed', last_error = 'delivery_unknown', locked_until = null
    where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is not null
    returning j.invitee_id
  )
  update public.meeting_invitees i set email_status = 'unknown', email_error = 'delivery_unknown'
  from lost where i.id = lost.invitee_id;

  update public.outbox_jobs j
  set status = 'pending', locked_until = null, run_id = null
  where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is null;

  update public.outbox_jobs j
  set status = 'paused', last_error = 'no_sender'
  from public.workspaces w
  left join public.google_connections c on c.id = w.sender_connection_id
  where j.workspace_id = w.id and j.status = 'pending' and j.run_after <= pg_catalog.now()
    and (c.id is null or c.status <> 'active');

  select c.* into v_connection
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id and c.status = 'active'
  left join public.sender_leases l on l.google_sub = c.google_sub
  where j.status = 'pending' and j.run_after <= pg_catalog.now()
    and (l.google_sub is null or l.locked_until < pg_catalog.now() or l.run_id = p_run)
  order by j.run_after, j.created_at
  limit 1;
  if v_connection.id is null then
    return null;
  end if;

  insert into public.sender_leases (google_sub, run_id, locked_until)
  values (v_connection.google_sub, p_run, pg_catalog.now() + v_lease)
  on conflict (google_sub) do update
    set run_id = excluded.run_id, locked_until = excluded.locked_until
    where public.sender_leases.locked_until < pg_catalog.now() or public.sender_leases.run_id = excluded.run_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return null;
  end if;

  with picked as (
    select j.id
    from public.outbox_jobs j
    join public.workspaces w on w.id = j.workspace_id
    where w.sender_connection_id = v_connection.id and j.status = 'pending' and j.run_after <= pg_catalog.now()
    order by j.run_after, j.created_at
    limit p_limit
    for update of j skip locked
  )
  update public.outbox_jobs j
  set status = 'processing', attempts = j.attempts + 1, run_id = p_run, locked_until = pg_catalog.now() + v_lease
  from picked where j.id = picked.id;

  return pg_catalog.jsonb_build_object(
    'connection', pg_catalog.jsonb_build_object(
      'id', v_connection.id,
      'user_id', v_connection.user_id,
      'google_sub', v_connection.google_sub,
      'google_email', v_connection.google_email,
      'refresh_token_encrypted', v_connection.refresh_token_encrypted
    ),
    'jobs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'job_id', j.id,
          'attempts', j.attempts,
          'invitee_id', i.id,
          'workspace_id', w.id,
          'workspace_name', w.name,
          'contact', pg_catalog.jsonb_build_object('full_name', c.full_name, 'email', c.email),
          'meeting', pg_catalog.jsonb_build_object(
            'id', m.id, 'title', m.title, 'agenda_md', m.agenda_md, 'starts_at', m.starts_at,
            'duration_minutes', m.duration_minutes, 'timezone', m.timezone, 'location_mode', m.location_mode,
            'location_text', m.location_text, 'meeting_url', m.meeting_url, 'response_mode', m.response_mode,
            'response_deadline', m.response_deadline, 'footer_note', m.footer_note,
            'thread_id', case when m.thread_connection_id = v_connection.id then m.gmail_thread_id end,
            'root_message_id', case when m.thread_connection_id = v_connection.id then m.gmail_root_message_id end
          )
        )
        order by m.id, j.created_at
      )
      from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      join public.meetings m on m.id = i.meeting_id
      join public.contacts c on c.id = i.contact_id
      join public.workspaces w on w.id = j.workspace_id
      where j.run_id = p_run and j.status = 'processing' and w.sender_connection_id = v_connection.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.dispatch_reserve(p_job uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_count integer;
  v_oldest timestamptz;
  v_retry timestamptz;
begin
  select j.id, j.status, j.workspace_id, j.invitee_id, c.google_sub, m.status as meeting_status, m.starts_at,
    ct.unsubscribed_at
  into v_job
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id
  join public.meeting_invitees i on i.id = j.invitee_id
  join public.meetings m on m.id = i.meeting_id
  join public.contacts ct on ct.id = i.contact_id
  where j.id = p_job
  for update of j;
  if v_job.id is null or v_job.status <> 'processing' then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;

  if v_job.unsubscribed_at is not null or v_job.meeting_status <> 'scheduled' or v_job.starts_at <= pg_catalog.now() then
    update public.outbox_jobs set status = case when v_job.starts_at <= pg_catalog.now() then 'failed'::public.job_status else 'done'::public.job_status end,
      locked_until = null,
      last_error = case
        when v_job.unsubscribed_at is not null then 'unsubscribed'
        when v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
        else 'meeting_started' end
    where id = p_job;
    update public.meeting_invitees set
      email_status = case when v_job.unsubscribed_at is null and v_job.meeting_status = 'scheduled' then 'failed'::public.invitee_email_status else 'skipped'::public.invitee_email_status end,
      email_error = case
        when v_job.unsubscribed_at is not null then 'unsubscribed'
        when v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
        else 'meeting_started' end
    where id = v_job.invitee_id;
    return pg_catalog.jsonb_build_object('kind', 'done');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('send:' || v_job.google_sub));
  select count(*), min(s.sent_at) into v_count, v_oldest
  from public.send_log s where s.google_sub = v_job.google_sub and s.sent_at > pg_catalog.now() - interval '24 hours';
  if v_count >= private.app_limit('gmail_sends_per_day') then
    v_retry := v_oldest + interval '24 hours';
  else
    select count(*), min(s.sent_at) into v_count, v_oldest
    from public.send_log s where s.google_sub = v_job.google_sub and s.sent_at > pg_catalog.now() - interval '1 minute';
    if v_count >= private.app_limit('gmail_sends_per_minute') then
      v_retry := v_oldest + interval '1 minute';
    end if;
  end if;
  if v_retry is not null then
    update public.outbox_jobs
    set status = 'pending', attempts = greatest(attempts - 1, 0), run_after = v_retry, locked_until = null,
      run_id = null, last_error = 'quota'
    where id = p_job;
    return pg_catalog.jsonb_build_object('kind', 'quota', 'retry_at', v_retry);
  end if;

  insert into public.send_log (google_sub, workspace_id, job_id) values (v_job.google_sub, v_job.workspace_id, p_job)
  on conflict (job_id) where job_id is not null do nothing;
  update public.outbox_jobs set send_started_at = pg_catalog.now() where id = p_job;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;

create function public.dispatch_finish(
  p_job uuid,
  p_outcome public.invitee_email_status,
  p_error text,
  p_token_hash text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitee uuid;
begin
  update public.outbox_jobs
  set status = case when p_outcome in ('sent', 'skipped') then 'done'::public.job_status else 'failed'::public.job_status end,
    last_error = p_error, locked_until = null
  where id = p_job and status = 'processing'
  returning invitee_id into v_invitee;
  if v_invitee is null then
    return;
  end if;
  if p_outcome = 'failed' then
    delete from public.send_log s where s.job_id = p_job;
  end if;
  update public.meeting_invitees
  set email_status = p_outcome,
    email_error = p_error,
    sent_at = case when p_outcome = 'sent' then pg_catalog.now() end,
    token_hash = case when p_outcome = 'sent' then coalesce(token_hash, p_token_hash) else token_hash end
  where id = v_invitee;
end;
$$;

create function public.dispatch_retry(p_job uuid, p_error text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
  v_invitee uuid;
  v_retry timestamptz;
begin
  select j.attempts, j.invitee_id into v_attempts, v_invitee
  from public.outbox_jobs j where j.id = p_job and j.status = 'processing' for update;
  if v_attempts is null then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;
  delete from public.send_log s where s.job_id = p_job;
  if v_attempts >= private.app_limit('dispatch_job_max_attempts') then
    update public.outbox_jobs set status = 'failed', last_error = p_error, locked_until = null, send_started_at = null
    where id = p_job;
    update public.meeting_invitees set email_status = 'failed', email_error = p_error where id = v_invitee;
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;
  v_retry := pg_catalog.now() + pg_catalog.make_interval(mins => (2 ^ (v_attempts - 1))::integer);
  update public.outbox_jobs
  set status = 'pending', run_after = v_retry, last_error = p_error, locked_until = null, run_id = null, send_started_at = null
  where id = p_job;
  return pg_catalog.jsonb_build_object('kind', 'retry', 'retry_at', v_retry);
end;
$$;

create function public.dispatch_unclaim(p_jobs uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.outbox_jobs
  set status = 'pending', attempts = greatest(attempts - 1, 0), locked_until = null, run_id = null
  where id = any (p_jobs) and status = 'processing' and send_started_at is null;
$$;

create function public.dispatch_defer_sender(p_run uuid, p_connection uuid, p_until timestamptz, p_error text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.send_log s using public.outbox_jobs j
  where s.job_id = j.id and j.run_id = p_run and j.status = 'processing';
  update public.outbox_jobs j
  set status = 'pending', run_after = p_until, last_error = p_error, locked_until = null, run_id = null,
    send_started_at = null,
    attempts = case when j.status = 'processing' then greatest(j.attempts - 1, 0) else j.attempts end
  where (j.status = 'processing' and j.run_id = p_run)
    or (j.status = 'pending' and j.workspace_id in (
      select w.id from public.workspaces w where w.sender_connection_id = p_connection
    ));
end;
$$;

create function private.dispatch_mark_broken(p_run uuid, p_connection uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_alert boolean := false;
begin
  update public.google_connections
  set status = 'broken', broken_reason = left(p_reason, 200), broken_at = pg_catalog.now()
  where id = p_connection and status = 'active';
  get diagnostics v_rows = row_count;

  delete from public.send_log s using public.outbox_jobs j
  where s.job_id = j.id and j.run_id = p_run and j.status = 'processing';
  update public.outbox_jobs j
  set status = 'paused', last_error = 'sender_broken', locked_until = null, run_id = null, send_started_at = null,
    attempts = case when j.status = 'processing' then greatest(j.attempts - 1, 0) else j.attempts end
  where (j.status = 'processing' and j.run_id = p_run)
    or (j.status = 'pending' and j.workspace_id in (
      select w.id from public.workspaces w where w.sender_connection_id = p_connection
    ));

  if v_rows > 0 then
    v_alert := private.hit_rate_limit(
      'invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'newly_broken', v_rows > 0,
    'alert', case when v_alert then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('email', u.email, 'workspace_name', w.name, 'workspace_slug', w.slug))
      from public.workspaces w
      join public.workspace_roles r on r.workspace_id = w.id and r.role = 'owner'
      join auth.users u on u.id = r.user_id
      where w.sender_connection_id = p_connection
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create function public.dispatch_mark_broken(p_run uuid, p_connection uuid, p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.dispatch_mark_broken(p_run, p_connection, p_reason) $$;

create function public.dispatch_set_thread(p_meeting uuid, p_connection uuid, p_thread_id text, p_root_message_id text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.meetings
  set gmail_thread_id = p_thread_id, gmail_root_message_id = p_root_message_id, thread_connection_id = p_connection
  where id = p_meeting;
$$;

create function public.dispatch_release(p_run uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.sender_leases l where l.run_id = p_run;
$$;

-- Supabase Cron (S1): call the dispatcher only when something is due. Vault holds the URL and
-- secret on production only, so local, CI and preview projects never call out.
create function private.kick_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.outbox_jobs j
    where (j.status = 'pending' and j.run_after <= pg_catalog.now())
      or (j.status = 'processing' and j.locked_until < pg_catalog.now())
  ) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'tn_dispatch_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'tn_dispatch_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
end;
$$;

create or replace function private.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.rate_limit_events e where e.occurred_at < pg_catalog.now() - interval '2 days';
  delete from public.outbox_jobs j where j.status in ('done', 'failed') and j.updated_at < pg_catalog.now() - interval '30 days';
  delete from public.send_log s where s.sent_at < pg_catalog.now() - interval '30 days';
  delete from public.sender_leases l where l.locked_until < pg_catalog.now() - interval '1 day';
  -- "+" creates a draft at once (grilling 2026-10-07); one left untitled and undated is litter.
  delete from public.meetings m
  where m.status = 'draft' and m.title = '' and m.starts_at is null and m.created_at < pg_catalog.now() - interval '24 hours';
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on function private.kick_dispatcher(), private.housekeeping(), private.dispatch_mark_broken(uuid, uuid, text)
  from authenticated, service_role;
grant execute on function private.send_meeting(uuid), private.meeting_progress(uuid) to authenticated;
grant execute on function private.dispatch_mark_broken(uuid, uuid, text) to service_role;

revoke execute on function public.send_meeting(uuid), public.meeting_progress(uuid) from public, anon;
grant execute on function public.send_meeting(uuid), public.meeting_progress(uuid) to authenticated;

revoke execute on function
  public.dispatch_claim(uuid, integer, integer),
  public.dispatch_reserve(uuid),
  public.dispatch_finish(uuid, public.invitee_email_status, text, text),
  public.dispatch_retry(uuid, text),
  public.dispatch_unclaim(uuid[]),
  public.dispatch_defer_sender(uuid, uuid, timestamptz, text),
  public.dispatch_mark_broken(uuid, uuid, text),
  public.dispatch_set_thread(uuid, uuid, text, text),
  public.dispatch_release(uuid)
from public, anon, authenticated;
grant execute on function
  public.dispatch_claim(uuid, integer, integer),
  public.dispatch_reserve(uuid),
  public.dispatch_finish(uuid, public.invitee_email_status, text, text),
  public.dispatch_retry(uuid, text),
  public.dispatch_unclaim(uuid[]),
  public.dispatch_defer_sender(uuid, uuid, timestamptz, text),
  public.dispatch_mark_broken(uuid, uuid, text),
  public.dispatch_set_thread(uuid, uuid, text, text),
  public.dispatch_release(uuid)
to service_role;
-- The invoker dispatcher functions call these as service_role.
grant execute on function private.app_limit(text), private.audience_members(uuid) to service_role;

select cron.schedule('tn-dispatch', '* * * * *', $$select private.kick_dispatcher()$$);
```

- [ ] **Step 5: Apply, regenerate, allow-list, spec** — `supabase migration up --local </dev/null && bun run db:types`. Add `"meeting_progress"` and `"send_meeting"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted). In the spec §6 `outbox_jobs` line, add after `payload (…)`: "`invitee_id` (invite jobs), `run_id` (the claiming run), `send_started_at` (set when quota is reserved; an expired lease with it set means the outcome is unknown)".

- [ ] **Step 6: Run** — `bun run test:db` → all green; `supabase db advisors --local </dev/null` → no WARN/ERROR; `bun run typecheck` → PASS.

- [ ] **Step 7: Commit, PR, merge** — `feat(db): outbox, quota reservations, leases and dispatcher functions`. Then the **Hosted migration procedure** (the cron job exists on both projects; nothing is called until Task 20 puts the Vault secrets on production).

---

### Task 7: DB — unsubscribe, abuse reports, token-page functions, roster flags

**Labels:** `area:db`

**Files:**
- Create: `supabase/migrations/<timestamp>_m4_tokens.sql`, `src/server/db/tokens.db.test.ts`
- Modify: `src/server/db/database.types.ts`

**Interfaces:**
- Consumes: Task 5 `contacts.unsubscribed_via`, `meeting_invitees.token_hash`; M2 `private.mask_email`, `private.hit_rate_limit`, `private.app_limit`; M3 `public.roster`.
- Produces:
  - `public.abuse_reports` (`id`, `workspace_id`, `invitee_id` unique, `reported_at`) — service role only (platform admins read it in M9).
  - Limits `token_requests_per_ip_per_hour` 120, `token_requests_per_token_per_hour` 30.
  - Service-role-only RPCs:
    - `token_invitee(p_token_hash text) returns jsonb` → `null` for an unknown hash, else
      ```json
      { "invitee_id", "workspace_name", "masked_email", "unsubscribed": false, "reported": false,
        "meeting": { "title", "starts_at", "timezone", "duration_minutes", "location_mode",
                     "location_text", "meeting_url", "status" } }
      ```
    - `token_unsubscribe(p_token_hash text, p_via public.unsubscribe_via) returns boolean` — idempotent; `report` also records one `abuse_reports` row and upgrades `unsubscribed_via` to `report`; false for an unknown hash.
    - `token_resubscribe(p_token_hash text) returns boolean` — clears both columns (only the person can; spec §7.16).
    - `check_token_rate_limit(p_ip text, p_token_hash text) returns boolean` — both buckets (per IP, per token hash), rolling hour.
  - `roster()` contacts gain `"unsubscribed": boolean` and `"reported": boolean` (Task 17 shows them).

- [ ] **Step 1: Write the failing DB tests** — `src/server/db/tokens.db.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, anonClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { overrideLimit } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let contact: string;
let hash: string;
const restore: Array<() => void> = [];

const inviteeSchema = z
  .object({
    invitee_id: z.uuid(),
    workspace_name: z.string(),
    masked_email: z.string(),
    unsubscribed: z.boolean(),
    reported: z.boolean(),
    meeting: z.object({ title: z.string(), status: z.string(), timezone: z.string() }).loose(),
  })
  .nullable();

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Token Club");
  [contact] = await seedContacts(workspace.id, 1, `tok-${crypto.randomUUID().slice(0, 6)}`);
  const meeting = await seedMeeting(workspace.id, { status: "scheduled", title: "Kickoff" });
  hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
  const { error } = await adminClient()
    .from("meeting_invitees")
    .insert({ workspace_id: workspace.id, meeting_id: meeting, contact_id: contact, token_hash: hash, email_status: "sent" });
  if (error) {
    throw error;
  }
});

afterEach(() => {
  while (restore.length) {
    restore.pop()?.();
  }
});

const call = async (name: "token_invitee" | "token_unsubscribe" | "token_resubscribe", args: Record<string, string>) => {
  const { data, error } = await adminClient().rpc(name, args as never);
  if (error) {
    throw error;
  }
  return data;
};

describe("token_invitee", () => {
  it("returns only what the public pages need", async () => {
    const info = inviteeSchema.parse(await call("token_invitee", { p_token_hash: hash }));
    expect(info).toMatchObject({ workspace_name: "Token Club", unsubscribed: false, reported: false });
    expect(info?.masked_email).toMatch(/•/);
    expect(info?.meeting.title).toBe("Kickoff");
    expect(await call("token_invitee", { p_token_hash: "0".repeat(64) })).toBeNull();
  });
});

describe("unsubscribe, report, resubscribe", () => {
  it("unsubscribes by link, upgrades to a report once, and lets the person come back", async () => {
    expect(await call("token_unsubscribe", { p_token_hash: hash, p_via: "link" })).toBe(true);
    let row = await adminClient().from("contacts").select("unsubscribed_at, unsubscribed_via").eq("id", contact).single();
    expect(row.data?.unsubscribed_via).toBe("link");
    expect(await call("token_unsubscribe", { p_token_hash: hash, p_via: "report" })).toBe(true);
    expect(await call("token_unsubscribe", { p_token_hash: hash, p_via: "report" })).toBe(true);
    row = await adminClient().from("contacts").select("unsubscribed_at, unsubscribed_via").eq("id", contact).single();
    expect(row.data?.unsubscribed_via).toBe("report");
    const reports = await adminClient().from("abuse_reports").select("id").eq("workspace_id", workspace.id);
    expect(reports.data).toHaveLength(1);
    expect(inviteeSchema.parse(await call("token_invitee", { p_token_hash: hash }))).toMatchObject({ unsubscribed: true, reported: true });
    expect(await call("token_resubscribe", { p_token_hash: hash })).toBe(true);
    row = await adminClient().from("contacts").select("unsubscribed_at, unsubscribed_via").eq("id", contact).single();
    expect(row.data).toEqual({ unsubscribed_at: null, unsubscribed_via: null });
    expect(await call("token_unsubscribe", { p_token_hash: "0".repeat(64), p_via: "link" })).toBe(false);
  });

  it("shows the flags on the roster", async () => {
    await call("token_unsubscribe", { p_token_hash: hash, p_via: "report" });
    const { data } = await owner.client.rpc("roster", { p_workspace: workspace.id });
    const roster = z.object({ contacts: z.array(z.object({ id: z.uuid(), unsubscribed: z.boolean(), reported: z.boolean() }).loose()) }).loose().parse(data);
    expect(roster.contacts.find((c) => c.id === contact)).toMatchObject({ unsubscribed: true, reported: true });
  });
});

describe("token rate limit and access", () => {
  it("limits per IP and per token", async () => {
    restore.push(overrideLimit("token_requests_per_token_per_hour", 2));
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    const hits = [];
    for (let n = 0; n < 3; n += 1) {
      const { data } = await adminClient().rpc("check_token_rate_limit", { p_ip: ip, p_token_hash: hash });
      hits.push(data);
    }
    expect(hits).toEqual([true, true, false]);
  });

  it("is not callable by anon or signed-in users", async () => {
    const anon = await anonClient().rpc("token_invitee", { p_token_hash: hash });
    expect(anon.error?.code).toBe("42501");
    const user = await owner.client.rpc("token_unsubscribe", { p_token_hash: hash, p_via: "link" });
    expect(user.error?.code).toBe("42501");
    const reports = await owner.client.from("abuse_reports").select("id");
    expect(reports.error?.code).toBe("42501");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test:db -- src/server/db/tokens.db.test.ts` → FAIL (`Could not find the function public.token_invitee`).

- [ ] **Step 3: Migration** — `supabase migration new m4_tokens </dev/null`:
```sql
-- M4 public token pages (spec §7.16, §11 public token route): unsubscribe, "Not my group", lookup.

insert into private.app_limits (name, value) values
  ('token_requests_per_ip_per_hour', 120),
  ('token_requests_per_token_per_hour', 30);

create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invitee_id uuid not null unique references public.meeting_invitees (id) on delete cascade,
  reported_at timestamptz not null default now()
);
create index abuse_reports_workspace_idx on public.abuse_reports (workspace_id, reported_at);
alter table public.abuse_reports enable row level security;
revoke all on table public.abuse_reports from anon, authenticated;
grant all on table public.abuse_reports to service_role;

create function public.token_invitee(p_token_hash text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'invitee_id', i.id,
    'workspace_name', w.name,
    'masked_email', private.mask_email(c.email),
    'unsubscribed', c.unsubscribed_at is not null,
    'reported', c.unsubscribed_via is not distinct from 'report',
    'meeting', pg_catalog.jsonb_build_object(
      'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone, 'duration_minutes', m.duration_minutes,
      'location_mode', m.location_mode, 'location_text', m.location_text, 'meeting_url', m.meeting_url,
      'status', m.status
    )
  )
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = p_token_hash;
$$;

create function public.token_unsubscribe(p_token_hash text, p_via public.unsubscribe_via)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitee uuid;
  v_workspace uuid;
begin
  update public.contacts c
  set unsubscribed_at = coalesce(c.unsubscribed_at, pg_catalog.now()),
    unsubscribed_via = case when p_via = 'report' then 'report'::public.unsubscribe_via
                            else coalesce(c.unsubscribed_via, 'link'::public.unsubscribe_via) end
  from public.meeting_invitees i
  where i.token_hash = p_token_hash and c.id = i.contact_id
  returning i.id, i.workspace_id into v_invitee, v_workspace;
  if v_invitee is null then
    return false;
  end if;
  if p_via = 'report' then
    insert into public.abuse_reports (workspace_id, invitee_id) values (v_workspace, v_invitee)
    on conflict (invitee_id) do nothing;
  end if;
  return true;
end;
$$;

create function public.token_resubscribe(p_token_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  update public.contacts c
  set unsubscribed_at = null, unsubscribed_via = null
  from public.meeting_invitees i
  where i.token_hash = p_token_hash and c.id = i.contact_id
  returning c.id into v_contact;
  return v_contact is not null;
end;
$$;

create function private.check_token_rate_limit(p_ip text, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_ip, '')) not between 1 and 64 or char_length(coalesce(p_token_hash, '')) not between 1 and 128 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit('token:ip:' || p_ip, private.app_limit('token_requests_per_ip_per_hour'), interval '1 hour')
    and private.hit_rate_limit('token:hash:' || p_token_hash, private.app_limit('token_requests_per_token_per_hour'), interval '1 hour');
end;
$$;

create function public.check_token_rate_limit(p_ip text, p_token_hash text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.check_token_rate_limit(p_ip, p_token_hash) $$;
```
Then `create or replace function public.roster(p_workspace uuid)` with the **entire** current body from `supabase/migrations/20261006225150_m3_roster.sql`, changing only the contact object to:
```sql
        pg_catalog.jsonb_build_object(
          'id', c.id,
          'email', c.email,
          'full_name', c.full_name,
          'list_ids', coalesce((
            select pg_catalog.jsonb_agg(lc.list_id order by lc.list_id)
            from public.list_contacts lc where lc.contact_id = c.id
          ), '[]'::jsonb),
          'unsubscribed', c.unsubscribed_at is not null,
          'reported', c.unsubscribed_via is not distinct from 'report'
        )
```
Grants:
```sql
revoke execute on all functions in schema private from public, anon;
revoke execute on function private.check_token_rate_limit(text, text) from authenticated;
grant execute on function private.check_token_rate_limit(text, text), private.mask_email(text) to service_role;

revoke execute on function
  public.token_invitee(text),
  public.token_unsubscribe(text, public.unsubscribe_via),
  public.token_resubscribe(text),
  public.check_token_rate_limit(text, text)
from public, anon, authenticated;
grant execute on function
  public.token_invitee(text),
  public.token_unsubscribe(text, public.unsubscribe_via),
  public.token_resubscribe(text),
  public.check_token_rate_limit(text, text)
to service_role;
```

- [ ] **Step 4: Apply, regenerate, run** — `supabase migration up --local </dev/null && bun run db:types && bun run test:db` → all green (the function-security allow-list is unchanged: nothing new for `authenticated`). `supabase db advisors --local </dev/null` → clean. `bun run typecheck` → PASS (the TS roster schema ignores the two new fields until Task 17).

- [ ] **Step 5: Commit, PR, merge** — `feat(db): token pages, unsubscribe and "Not my group" reports`. Then the **Hosted migration procedure**.

---

### Task 8: Meeting time formatting, agenda Markdown, invite email template

**Labels:** `area:email`, `area:ui`

**Files:**
- Create: `src/lib/meetings/format.ts` (+ `format.test.ts`), `src/lib/markdown/agenda.ts` (+ `agenda.test.ts`), `src/emails/meeting-invite-email.tsx` (+ `meeting-invite-email.test.tsx`)
- Modify: `package.json` / `bun.lock` (`markdown-it`), `src/emails/email-layout.tsx` (optional sticker + footer), `src/emails/email-layout.test.tsx` if present, `messages/en.json` (`Email.meetingInvite`), `src/config/meetings.ts`

**Interfaces:**
- Consumes: `EmailLayout`, `emailTheme`, `brutalBox`, `getEmailTranslator` (`src/emails/*`), `APP_NAME`; Task 4 `ResponseMode`, `LocationMode`.
- Produces:
  - `src/lib/meetings/format.ts`:
    - `formatMeetingWhen(input: { startsAt: string; durationMinutes: number; timezone: string }): MeetingWhen` with `MeetingWhen = { date: string /* "Thu 9 Oct" */; start: string /* "18:00" */; end: string; zone: string }`.
    - `meetingSubject(title: string, when: MeetingWhen): string` → `"Weekly sync · Thu 9 Oct, 18:00"`.
    - `formatDeadline(iso: string, timezone: string): string` → `"Thu 9 Oct, 12:00"`.
    - `zonedWallTimeToUtc(input: { date: string /* yyyy-MM-dd */; time: string /* HH:mm */; timezone: string }): string` (ISO UTC).
    - `utcToZonedParts(iso: string, timezone: string): { date: string; time: string }`.
  - `src/lib/markdown/agenda.ts`: `renderAgendaHtml(markdown: string): string` — paragraphs, line breaks, bold, italic, bullet/numbered lists, links (`http(s):` and `mailto:` only, `target="_blank" rel="noopener noreferrer"`); raw HTML escaped; nothing else (no headings, images, tables, code blocks).
  - `src/config/meetings.ts` gains `RESPONSE_CHOICES: Record<ResponseMode, readonly ResponseChoice[]>` with `ResponseChoice = "attending" | "late" | "absent" | "going" | "not_going"` (`announcement: []`, `rsvp: ["going", "not_going"]`, `attendance: ["attending", "late", "absent"]`).
  - `src/emails/meeting-invite-email.tsx`: `MeetingInviteEmailProps`, `MeetingInviteEmail`, `renderMeetingInviteEmail(props): Promise<{ subject: string; html: string; text: string }>`.
    ```ts
    export type MeetingInviteEmailProps = {
      workspaceName: string;
      recipientName: string;
      senderEmail: string;
      meeting: {
        title: string; agendaMd: string; startsAt: string; durationMinutes: number; timezone: string;
        locationMode: LocationMode; locationText: string; meetingUrl: string;
        responseMode: ResponseMode; responseDeadline: string | null;
      };
      links: { respond: string; unsubscribe: string; report: string };
    };
    ```
    `links.respond` is `${appUrl}/r/${token}`; buttons append `?choice=<ResponseChoice>`.
  - `EmailLayout` gains optional `sticker?: string` (default `APP_NAME`) and `footer?: ReactNode` (default the current footer text), so system emails are unchanged.

- [ ] **Step 1: Install** — `bun add markdown-it@15.0.2` (ships its own types; verify `node_modules/markdown-it/package.json` has `"types"`). Commit the lockfile with the task.

- [ ] **Step 2: Failing format tests** — `src/lib/meetings/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  formatDeadline,
  formatMeetingWhen,
  meetingSubject,
  utcToZonedParts,
  zonedWallTimeToUtc,
} from "./format";

describe("meeting times (spec §7.10)", () => {
  it("formats in the meeting's zone, not the machine's", () => {
    const when = formatMeetingWhen({ startsAt: "2026-10-09T17:00:00.000Z", durationMinutes: 90, timezone: "Africa/Tunis" });
    expect(when).toEqual({ date: "Fri 9 Oct", start: "18:00", end: "19:30", zone: "Africa/Tunis" });
    expect(meetingSubject("Weekly sync", when)).toBe("Weekly sync · Fri 9 Oct, 18:00");
    expect(formatDeadline("2026-10-09T11:00:00.000Z", "Africa/Tunis")).toBe("Fri 9 Oct, 12:00");
  });

  it("turns a picked wall time into UTC across a DST change", () => {
    expect(zonedWallTimeToUtc({ date: "2026-10-09", time: "18:00", timezone: "Africa/Tunis" })).toBe("2026-10-09T17:00:00.000Z");
    expect(zonedWallTimeToUtc({ date: "2026-10-24", time: "18:00", timezone: "Europe/Paris" })).toBe("2026-10-24T16:00:00.000Z");
    expect(zonedWallTimeToUtc({ date: "2026-10-25", time: "18:00", timezone: "Europe/Paris" })).toBe("2026-10-25T17:00:00.000Z");
    expect(utcToZonedParts("2026-10-25T17:00:00.000Z", "Europe/Paris")).toEqual({ date: "2026-10-25", time: "18:00" });
  });

  it("crosses midnight cleanly", () => {
    expect(formatMeetingWhen({ startsAt: "2026-10-09T22:30:00.000Z", durationMinutes: 60, timezone: "Africa/Tunis" })).toEqual({
      date: "Fri 9 Oct",
      start: "23:30",
      end: "00:30",
      zone: "Africa/Tunis",
    });
  });
});
```
(9 Oct 2026 is a Friday — the wizard mockups said "Thu"; the tests use the real weekday.)

- [ ] **Step 3: Run to verify failure** — `bun run test src/lib/meetings` → FAIL (module missing).

- [ ] **Step 4: Implement** — `src/lib/meetings/format.ts`:
```ts
import { TZDate } from "@date-fns/tz";
import { addMinutes, format, parse } from "date-fns";

/** A meeting's time as shown everywhere (always in the meeting's own zone, spec §7.10). */
export type MeetingWhen = { date: string; start: string; end: string; zone: string };

const DATE_FORMAT = "EEE d MMM";
const TIME_FORMAT = "HH:mm";

/** Date, start, end and zone of a meeting in its own time zone. */
export function formatMeetingWhen(input: {
  startsAt: string;
  durationMinutes: number;
  timezone: string;
}): MeetingWhen {
  const start = new TZDate(input.startsAt, input.timezone);
  return {
    date: format(start, DATE_FORMAT),
    start: format(start, TIME_FORMAT),
    end: format(addMinutes(start, input.durationMinutes), TIME_FORMAT),
    zone: input.timezone,
  };
}

/** Invite subject: "<Title> · <Thu 9 Oct>, <18:00>" (spec §9). */
export function meetingSubject(title: string, when: MeetingWhen): string {
  return `${title} · ${when.date}, ${when.start}`;
}

/** "Fri 9 Oct, 12:00" in the meeting's zone. */
export function formatDeadline(iso: string, timezone: string): string {
  const deadline = new TZDate(iso, timezone);
  return `${format(deadline, DATE_FORMAT)}, ${format(deadline, TIME_FORMAT)}`;
}

/** The UTC instant of a wall-clock date + time in `timezone` (what the pickers store). */
export function zonedWallTimeToUtc(input: { date: string; time: string; timezone: string }): string {
  const wall = parse(`${input.date} ${input.time}`, "yyyy-MM-dd HH:mm", new Date(0));
  const zoned = new TZDate(
    wall.getFullYear(),
    wall.getMonth(),
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    input.timezone,
  );
  // TZDate#toISOString() keeps the zone's offset ("…+01:00"); the API stores UTC ("…Z").
  return new Date(zoned.getTime()).toISOString();
}

/** Splits a UTC instant into the date and time shown in `timezone` (what the pickers display). */
export function utcToZonedParts(iso: string, timezone: string): { date: string; time: string } {
  const zoned = new TZDate(iso, timezone);
  return { date: format(zoned, "yyyy-MM-dd"), time: format(zoned, TIME_FORMAT) };
}
```
(Checked while planning: `new TZDate(2026, 9, 25, 18, 0, "Europe/Paris").toISOString()` is `"2026-10-25T18:00:00.000+01:00"`, so the UTC string comes from `getTime()`; `format()` on a `TZDate` prints the zone's wall time.)

- [ ] **Step 5: Run** — format tests → PASS.

- [ ] **Step 6: Failing agenda tests** — `src/lib/markdown/agenda.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { renderAgendaHtml } from "./agenda";

describe("renderAgendaHtml", () => {
  it("renders the safe subset", () => {
    const html = renderAgendaHtml("- Recap\n- **Hackathon** teams\n\n[Slides](https://example.test/s) *soon*");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>Hackathon</strong>");
    expect(html).toContain('<a href="https://example.test/s" target="_blank" rel="noopener noreferrer">Slides</a>');
    expect(html).toContain("<em>soon</em>");
  });

  it("escapes HTML and drops unsafe links, images and headings", () => {
    const html = renderAgendaHtml(
      '<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](data:text/html,hi) ![img](https://example.test/a.png)\n\n# Title',
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="data');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<h1");
  });

  it("links bare URLs and keeps line breaks", () => {
    const html = renderAgendaHtml("Room B12\nhttps://meet.example.test/abc");
    expect(html).toContain("<br>");
    expect(html).toContain('href="https://meet.example.test/abc"');
  });

  it("returns an empty string for an empty agenda", () => {
    expect(renderAgendaHtml("   ")).toBe("");
  });
});
```

- [ ] **Step 7: Run to verify failure, then implement** — `src/lib/markdown/agenda.ts`:
```ts
import MarkdownIt from "markdown-it";

/**
 * The agenda renderer shared by the wizard preview and the invite email (spec §9): starts from
 * markdown-it's "zero" preset and enables only paragraphs, line breaks, emphasis, lists and links.
 * Raw HTML is escaped (`html: false`); only http(s) and mailto links survive.
 */
const markdown = new MarkdownIt("zero", { html: false, linkify: true, breaks: true }).enable([
  "list",
  "emphasis",
  "link",
  "linkify",
  "autolink",
  "newline",
  "escape",
]);

const SAFE_LINK = /^(https?:|mailto:)/i;
markdown.validateLink = (url: string) => SAFE_LINK.test(url.trim());

const renderLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderLinkOpen
    ? renderLinkOpen(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

/** Safe HTML for a Markdown agenda ("" when empty). */
export function renderAgendaHtml(source: string): string {
  return source.trim() ? markdown.render(source).trim() : "";
}
```
Run → PASS. If `![img](…)` renders as literal text (image rule disabled), that satisfies "no `<img`". If `enable([...])` throws for an unknown rule name, print `markdown.block.ruler.__rules__` names in a scratch test and adjust the list.

- [ ] **Step 8: Messages** — add to `messages/en.json` under `Email`:
```json
"meetingInvite": {
  "preview": "{workspace} invites you: {date}, {time}",
  "invitedBy": "{workspace} invites you",
  "greeting": "Hi {name},",
  "when": "When",
  "whenValue": "{date}, {start}–{end} ({zone})",
  "where": "Where",
  "joinOnline": "Join online",
  "agenda": "Agenda",
  "deadline": "Please answer by {deadline}.",
  "noAnswer": "No answer needed.",
  "choice": {
    "attending": "I'm going",
    "late": "I'll be late",
    "absent": "I can't come",
    "going": "Going",
    "not_going": "Not going"
  },
  "visibility": "Your answer is visible to {workspace} organizers.",
  "sentFrom": "Sent from {email} with {appName}.",
  "unsubscribe": "Unsubscribe from {workspace}",
  "report": "Not my group"
}
```

- [ ] **Step 9: Failing email tests** — `src/emails/meeting-invite-email.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { renderMeetingInviteEmail, type MeetingInviteEmailProps } from "./meeting-invite-email";

const EMOJI = /\p{Extended_Pictographic}/u;
const base: MeetingInviteEmailProps = {
  workspaceName: "GDG ISSAT",
  recipientName: "Amira Ben Ali",
  senderEmail: "club@gmail.com",
  meeting: {
    title: "Weekly sync",
    agendaMd: "- Recap\n- **Hackathon** teams",
    startsAt: "2026-10-09T17:00:00.000Z",
    durationMinutes: 60,
    timezone: "Africa/Tunis",
    locationMode: "hybrid",
    locationText: "Room B12",
    meetingUrl: "https://meet.example.test/abc",
    responseMode: "attendance",
    responseDeadline: "2026-10-09T11:00:00.000Z",
  },
  links: {
    respond: "https://tapnshow.vercel.app/r/TOKEN",
    unsubscribe: "https://tapnshow.vercel.app/u/TOKEN",
    report: "https://tapnshow.vercel.app/report/TOKEN",
  },
};

describe("renderMeetingInviteEmail", () => {
  it("has the subject, time in the meeting zone, place, agenda, three answers and the footer links", async () => {
    const email = await renderMeetingInviteEmail(base);
    expect(email.subject).toBe("Weekly sync · Fri 9 Oct, 18:00");
    expect(email.html).toContain("GDG ISSAT invites you");
    expect(email.html).toContain("Hi Amira Ben Ali,");
    expect(email.html).toContain("Fri 9 Oct, 18:00–19:00 (Africa/Tunis)");
    expect(email.html).toContain("Room B12");
    expect(email.html).toContain('href="https://meet.example.test/abc"');
    expect(email.html).toContain("<strong>Hackathon</strong>");
    for (const choice of ["attending", "late", "absent"]) {
      expect(email.html).toContain(`href="https://tapnshow.vercel.app/r/TOKEN?choice=${choice}"`);
    }
    expect(email.html).toContain("Please answer by Fri 9 Oct, 12:00.");
    expect(email.html).toContain('href="https://tapnshow.vercel.app/u/TOKEN"');
    expect(email.html).toContain('href="https://tapnshow.vercel.app/report/TOKEN"');
    expect(email.html).toContain("Sent from club@gmail.com with TapNShow.");
    expect(email.text).toContain("https://tapnshow.vercel.app/r/TOKEN?choice=late");
    expect(email.html).not.toContain("box-shadow");
    expect(email.html).not.toMatch(EMOJI);
  });

  it("shows two answers for RSVP and none for announcements", async () => {
    const rsvp = await renderMeetingInviteEmail({ ...base, meeting: { ...base.meeting, responseMode: "rsvp" } });
    expect(rsvp.html).toContain("?choice=going");
    expect(rsvp.html).not.toContain("?choice=late");
    const announcement = await renderMeetingInviteEmail({
      ...base,
      meeting: { ...base.meeting, responseMode: "announcement", responseDeadline: null },
    });
    expect(announcement.html).not.toContain("?choice=");
    expect(announcement.html).toContain("No answer needed.");
  });

  it("escapes user text and refuses an unsafe meeting link", async () => {
    const email = await renderMeetingInviteEmail({
      ...base,
      workspaceName: "<b>Club</b>",
      meeting: { ...base.meeting, title: "<img src=x>", agendaMd: "<script>x</script>", meetingUrl: "javascript:alert(1)" },
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).not.toContain("<img src=x>");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain('href="javascript');
  });
});
```

- [ ] **Step 10: Run to verify failure** — `bun run test src/emails/meeting-invite-email.test.tsx` → FAIL.

- [ ] **Step 11: Implement** — first `src/emails/email-layout.tsx`: add props `sticker?: string; footer?: ReactNode`; render `{sticker ?? APP_NAME}` in the sticker `Text`, and `{footer ?? tr("footer", { appName: APP_NAME })}` in the footer `Text` (change that `Text` to render children so a `ReactNode` fits). Existing email tests must still pass unchanged.

Append to `src/config/meetings.ts`:
```ts
import type { ResponseMode } from "@/shared/api/meeting-settings";

/** An answer a member can give from an email button (spec §7.3). */
export type ResponseChoice = "attending" | "late" | "absent" | "going" | "not_going";

/** The buttons each response mode shows, in order. */
export const RESPONSE_CHOICES: Record<ResponseMode, readonly ResponseChoice[]> = {
  announcement: [],
  rsvp: ["going", "not_going"],
  attendance: ["attending", "late", "absent"],
};
```
(Put the `import type` at the top of the file with the other imports.)

`src/emails/meeting-invite-email.tsx`:
```tsx
import { Button, Link, render, Section, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { RESPONSE_CHOICES, type ResponseChoice } from "@/config/meetings";
import { renderAgendaHtml } from "@/lib/markdown/agenda";
import { formatDeadline, formatMeetingWhen, meetingSubject } from "@/lib/meetings/format";
import type { LocationMode, ResponseMode } from "@/shared/api/meeting-settings";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** Everything one personal invite needs (spec §9 Meeting invite email). */
export type MeetingInviteEmailProps = {
  workspaceName: string;
  recipientName: string;
  senderEmail: string;
  meeting: {
    title: string;
    agendaMd: string;
    startsAt: string;
    durationMinutes: number;
    timezone: string;
    locationMode: LocationMode;
    locationText: string;
    meetingUrl: string;
    responseMode: ResponseMode;
    responseDeadline: string | null;
  };
  links: { respond: string; unsubscribe: string; report: string };
};

const CHOICE_FILL: Record<ResponseChoice, string> = {
  attending: t.success,
  going: t.success,
  late: t.warning,
  absent: t.danger,
  not_going: t.danger,
};

const SAFE_URL = /^https?:\/\//i;
const label = { fontSize: "13px", fontWeight: 700, margin: "16px 0 4px", textTransform: "uppercase" as const };
const body = { fontSize: "16px", lineHeight: "24px", margin: 0 };

/** One member's invite: meeting card, answer buttons by mode, and per-workspace opt-out links. */
export function MeetingInviteEmail({ workspaceName, recipientName, senderEmail, meeting, links }: MeetingInviteEmailProps) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(meeting);
  const agendaHtml = renderAgendaHtml(meeting.agendaMd);
  const choices = RESPONSE_CHOICES[meeting.responseMode];
  const showPlace = meeting.locationMode !== "online" && meeting.locationText !== "";
  const showLink = meeting.locationMode !== "in_person" && SAFE_URL.test(meeting.meetingUrl);
  return (
    <EmailLayout
      sticker={workspaceName}
      preview={tr("meetingInvite.preview", { workspace: workspaceName, date: when.date, time: when.start })}
      heading={meeting.title}
      footer={
        <>
          {tr("meetingInvite.sentFrom", { email: senderEmail, appName: APP_NAME })}{" "}
          <Link href={links.unsubscribe} style={{ color: t.muted }}>
            {tr("meetingInvite.unsubscribe", { workspace: workspaceName })}
          </Link>
          {" · "}
          <Link href={links.report} style={{ color: t.muted }}>
            {tr("meetingInvite.report")}
          </Link>
        </>
      }
    >
      <Text style={{ ...body, color: t.muted, margin: "0 0 12px" }}>
        {tr("meetingInvite.invitedBy", { workspace: workspaceName })}
      </Text>
      <Text style={body}>{tr("meetingInvite.greeting", { name: recipientName })}</Text>
      <Text style={label}>{tr("meetingInvite.when")}</Text>
      <Text style={{ ...body, fontWeight: 700 }}>
        {tr("meetingInvite.whenValue", { date: when.date, start: when.start, end: when.end, zone: when.zone })}
      </Text>
      {showPlace || showLink ? <Text style={label}>{tr("meetingInvite.where")}</Text> : null}
      {showPlace ? <Text style={body}>{meeting.locationText}</Text> : null}
      {showLink ? (
        <Text style={body}>
          <Link href={meeting.meetingUrl} style={{ color: t.ink, fontWeight: 700 }}>
            {tr("meetingInvite.joinOnline")}
          </Link>
        </Text>
      ) : null}
      {agendaHtml ? (
        <>
          <Text style={label}>{tr("meetingInvite.agenda")}</Text>
          <Section style={{ fontSize: "15px", lineHeight: "22px" }} dangerouslySetInnerHTML={{ __html: agendaHtml }} />
        </>
      ) : null}
      <Section style={{ margin: "20px 0 8px" }}>
        {choices.length === 0 ? (
          <Text style={body}>{tr("meetingInvite.noAnswer")}</Text>
        ) : (
          choices.map((choice) => (
            <Button
              key={choice}
              href={`${links.respond}?choice=${choice}`}
              style={{
                ...brutalBox(CHOICE_FILL[choice], t.radiusControl),
                color: t.ink,
                display: "inline-block",
                fontFamily: t.fontDisplay,
                fontSize: "15px",
                margin: "0 8px 8px 0",
                padding: "12px 18px",
                textDecoration: "none",
              }}
            >
              {tr(`meetingInvite.choice.${choice}`)}
            </Button>
          ))
        )}
      </Section>
      {choices.length > 0 && meeting.responseDeadline ? (
        <Text style={{ ...body, fontSize: "14px" }}>
          {tr("meetingInvite.deadline", { deadline: formatDeadline(meeting.responseDeadline, meeting.timezone) })}
        </Text>
      ) : null}
      {choices.length > 0 ? (
        <Text style={{ ...body, color: t.muted, fontSize: "13px", marginTop: "12px" }}>
          {tr("meetingInvite.visibility", { workspace: workspaceName })}
        </Text>
      ) : null}
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one invite. */
export async function renderMeetingInviteEmail(
  props: MeetingInviteEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const element = <MeetingInviteEmail {...props} />;
  return {
    subject: meetingSubject(props.meeting.title, formatMeetingWhen(props.meeting)),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
```
`emailTheme` lacks `success` and `danger`: add them to `src/emails/theme.ts` from `palette.light` (the palette has `success`/`danger`; check the key names in `src/design/tokens.ts`). If `Section` does not accept `dangerouslySetInnerHTML`, render a plain `<div>` with the same style (React Email passes standard elements through). The agenda HTML is safe by construction (`renderAgendaHtml`), which is why `dangerouslySetInnerHTML` is acceptable here; keep that reason as a one-line comment above it.

- [ ] **Step 12: Run** — `bun run test src/emails src/lib` → PASS (including the unchanged sign-in and Viewer-invite email tests). Render the email once to a file for a visual check: a throwaway `bun -e` script that writes `renderMeetingInviteEmail(base).html` to the scratchpad, opened with Playwright at 390 px; look at it before committing (outline, hard-shadow borders, button wrap on a narrow screen).

- [ ] **Step 13: Commit, PR, merge** — `feat(email): meeting invite email, agenda Markdown and time formatting`.

---

### Task 9: MIME builder and Gmail REST client

**Labels:** `area:email`, `area:pipeline`

**Files:**
- Create: `src/server/gmail/mime.ts` (+ `mime.test.ts`), `src/server/gmail/gmail-client.ts` (+ `gmail-client.test.ts`)
- Modify: `src/config/meetings.ts`

**Interfaces:**
- Consumes: `GMAIL_SEND_PATH` (Task 3), `nodemailer/lib/mail-composer` (MIME only; nothing is sent over SMTP).
- Produces:
  - `src/config/meetings.ts` gains `GMAIL_SEND_TIMEOUT_MS = 20_000`.
  - `buildMeetingMime(input: MeetingMimeInput): Promise<string>` → the raw RFC 822 message as **base64url** (what `users.messages.send` takes in `raw`).
    ```ts
    export type MeetingMimeInput = {
      from: { name: string; address: string };
      to: { name: string; address: string };
      subject: string;
      html: string;
      text: string;
      messageId: string;          // "<uuid@host>"
      inReplyTo: string | null;   // the meeting's root Message-ID, or null for the root email
      listUnsubscribeUrl: string; // RFC 8058 one-click endpoint
    };
    ```
  - `newMessageId(appUrl: string): string` → `"<uuid@host-of-appUrl>"`.
  - `sendGmailMessage(input: { baseUrl: string; accessToken: string; raw: string; threadId: string | null; timeoutMs: number }, fetchImpl?): Promise<GmailSendResult>`.
  - `classifyGmailResponse(status: number, body: string): GmailSendResult` (non-2xx only).
  - ```ts
    export type GmailSendResult =
      | { kind: "sent"; id: string; threadId: string }
      | { kind: "invalid_recipient"; reason: string } // 400: Gmail refused the message; do not retry
      | { kind: "thread_missing" }                     // 404 while sending into a thread: start a new root
      | { kind: "auth" }                               // 401: refresh the access token once, then retry
      | { kind: "throttled" }                          // 403 usageLimits, 429 "Mail sending"/bandwidth: defer the sender 1 h
      | { kind: "retry"; status: number }              // other 429, 5xx: backoff
      | { kind: "forbidden"; reason: string }          // other 403 (e.g. domainPolicy): treat as broken
      | { kind: "unknown"; reason: string };           // no HTTP response: the email may have gone out
    ```
    Mapping from Google's "Resolve errors" guide (checked 2026-10-07): 400 `badRequest`; 401 `authError`; 403 `usageLimits` (`dailyLimitExceeded`, `rateLimitExceeded`, `userRateLimitExceeded`) and `domainPolicy`; 429 "User-rate limit exceeded (Mail sending)", bandwidth, and "Too many concurrent requests for user"; 500/503 `backendError`.

- [ ] **Step 1: Failing MIME tests** — `src/server/gmail/mime.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildMeetingMime, newMessageId } from "./mime";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const headersOf = (raw: string) => decode(raw).split("\r\n\r\n")[0];

const input = {
  from: { name: `Club d'Échecs "A"`, address: "club@gmail.com" },
  to: { name: "Amira Ben Ali", address: "amira@uni.tn" },
  subject: "Weekly sync · Fri 9 Oct, 18:00",
  html: "<p>Hello</p>",
  text: "Hello",
  messageId: "<m-2@tapnshow.vercel.app>",
  inReplyTo: "<m-1@tapnshow.vercel.app>",
  listUnsubscribeUrl: "https://tapnshow.vercel.app/api/r/TOKEN/unsubscribe",
};

describe("buildMeetingMime", () => {
  it("encodes UTF-8 names and subject, threads to the root, and adds one-click unsubscribe", async () => {
    const headers = headersOf(await buildMeetingMime(input));
    expect(headers).toContain("From: =?UTF-8?Q?Club_d=27=C3=89checs_=22A=22?= <club@gmail.com>");
    expect(headers).toContain("To: Amira Ben Ali <amira@uni.tn>");
    expect(headers).toContain("Subject: =?UTF-8?Q?Weekly_sync_=C2=B7_Fri_9_Oct=2C_18=3A00?=");
    expect(headers).toContain("Message-ID: <m-2@tapnshow.vercel.app>");
    expect(headers).toContain("In-Reply-To: <m-1@tapnshow.vercel.app>");
    expect(headers).toContain("References: <m-1@tapnshow.vercel.app>");
    expect(headers).toContain("List-Unsubscribe: <https://tapnshow.vercel.app/api/r/TOKEN/unsubscribe>");
    expect(headers).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(headers).toMatch(/Content-Type: multipart\/alternative/);
    expect(headers).not.toMatch(/^Bcc:/m);
  });

  it("leaves the threading headers out of the root email", async () => {
    const headers = headersOf(await buildMeetingMime({ ...input, inReplyTo: null }));
    expect(headers).not.toContain("In-Reply-To");
    expect(headers).not.toContain("References");
  });

  it("refuses header injection through names", async () => {
    const headers = headersOf(
      await buildMeetingMime({ ...input, from: { name: "Club\r\nBcc: victim@example.test", address: "club@gmail.com" } }),
    );
    expect(headers).not.toMatch(/^Bcc:/m);
  });
});

describe("newMessageId", () => {
  it("uses the app's host", () => {
    expect(newMessageId("https://tapnshow.vercel.app")).toMatch(/^<[0-9a-f-]{36}@tapnshow\.vercel\.app>$/);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement** — `src/server/gmail/mime.ts`:
```ts
import "server-only";
import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";

/** One meeting email ready for MIME encoding (spec §9). */
export type MeetingMimeInput = {
  from: { name: string; address: string };
  to: { name: string; address: string };
  subject: string;
  html: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  listUnsubscribeUrl: string;
};

/** A new RFC 5322 Message-ID on the app's own host. */
export function newMessageId(appUrl: string): string {
  return `<${randomUUID()}@${new URL(appUrl).host}>`;
}

/**
 * Builds the raw message for Gmail's `users.messages.send` (base64url). nodemailer's composer
 * encodes non-ASCII names and subjects (RFC 2047) and folds lines; line breaks in names are
 * stripped first so a user-written workspace name can never add a header.
 */
export async function buildMeetingMime(input: MeetingMimeInput): Promise<string> {
  const singleLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const composer = new MailComposer({
    from: { name: singleLine(input.from.name), address: input.from.address },
    to: { name: singleLine(input.to.name), address: input.to.address },
    subject: singleLine(input.subject),
    html: input.html,
    text: input.text,
    messageId: input.messageId,
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: input.inReplyTo } : {}),
    headers: {
      "List-Unsubscribe": `<${input.listUnsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  const message = await composer.compile().build();
  return message.toString("base64url");
}
```
Run → PASS.

- [ ] **Step 3: Failing client tests** — `src/server/gmail/gmail-client.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { classifyGmailResponse, sendGmailMessage } from "./gmail-client";

const error = (code: number, reason: string, message: string, domain = "global") =>
  JSON.stringify({ error: { code, message, errors: [{ domain, reason, message }] } });

describe("sendGmailMessage", () => {
  it("posts raw (and threadId when threading) and returns ids", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "m1", threadId: "t1", labelIds: ["SENT"] }), { status: 200 }),
    );
    const result = await sendGmailMessage(
      { baseUrl: "https://gmail.googleapis.com", accessToken: "at", raw: "UkFX", threadId: "t1", timeoutMs: 1000 },
      fetchMock,
    );
    expect(result).toEqual({ kind: "sent", id: "m1", threadId: "t1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer at");
    expect(JSON.parse(String(init?.body))).toEqual({ raw: "UkFX", threadId: "t1" });
  });

  it("omits threadId for a root email", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "m", threadId: "t" })));
    await sendGmailMessage({ baseUrl: "https://g", accessToken: "a", raw: "r", threadId: null, timeoutMs: 1000 }, fetchMock);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ raw: "r" });
  });

  it("reports 'unknown' when no HTTP response came back", async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    expect((await sendGmailMessage({ baseUrl: "https://g", accessToken: "a", raw: "r", threadId: null, timeoutMs: 1000 }, network)).kind).toBe("unknown");
    const timeout = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect((await sendGmailMessage({ baseUrl: "https://g", accessToken: "a", raw: "r", threadId: null, timeoutMs: 1000 }, timeout)).kind).toBe("unknown");
  });
});

describe("classifyGmailResponse", () => {
  it.each([
    [400, error(400, "badRequest", "Invalid To header"), "invalid_recipient"],
    [401, error(401, "authError", "Invalid Credentials"), "auth"],
    [403, error(403, "userRateLimitExceeded", "User Rate Limit Exceeded", "usageLimits"), "throttled"],
    [403, error(403, "dailyLimitExceeded", "Daily Limit Exceeded", "usageLimits"), "throttled"],
    [403, error(403, "domainPolicy", "Not allowed"), "forbidden"],
    [404, error(404, "notFound", "Requested entity was not found."), "thread_missing"],
    [429, error(429, "rateLimitExceeded", "User-rate limit exceeded (Mail sending)"), "throttled"],
    [429, error(429, "rateLimitExceeded", "Too many concurrent requests for user"), "retry"],
    [500, error(500, "backendError", "Backend Error"), "retry"],
    [503, "Service Unavailable", "retry"],
  ])("maps HTTP %i to the right action", (status, body, kind) => {
    expect(classifyGmailResponse(status, body).kind).toBe(kind);
  });

  it("never echoes the response body into the reason beyond Google's short message", () => {
    const result = classifyGmailResponse(400, error(400, "badRequest", "Invalid To header"));
    expect(result).toEqual({ kind: "invalid_recipient", reason: "Invalid To header" });
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement** — append to `src/config/meetings.ts`:
```ts
/** Give up waiting for Gmail after this long; the outcome is then unknown (spec §8). */
export const GMAIL_SEND_TIMEOUT_MS = 20_000;
```
`src/server/gmail/gmail-client.ts`:
```ts
import "server-only";
import { z } from "zod";
import { GMAIL_SEND_PATH } from "@/config/gmail";

/** What one `users.messages.send` call means for the dispatcher (spec §8 error table). */
export type GmailSendResult =
  | { kind: "sent"; id: string; threadId: string }
  | { kind: "invalid_recipient"; reason: string }
  | { kind: "thread_missing" }
  | { kind: "auth" }
  | { kind: "throttled" }
  | { kind: "retry"; status: number }
  | { kind: "forbidden"; reason: string }
  | { kind: "unknown"; reason: string };

const sentSchema = z.object({ id: z.string().min(1), threadId: z.string().min(1) });
const errorSchema = z.object({
  error: z.object({
    message: z.string().default(""),
    errors: z.array(z.object({ domain: z.string().optional(), reason: z.string().optional() })).default([]),
  }),
});

const MAX_REASON = 200;
const THROTTLE_429 = /mail sending|bandwidth/i;

/** Classifies a non-2xx Gmail API response (Google's "Resolve errors" guide). */
export function classifyGmailResponse(status: number, body: string): GmailSendResult {
  let message = "";
  let domain = "";
  try {
    const parsed = errorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      message = parsed.data.error.message.slice(0, MAX_REASON);
      domain = parsed.data.error.errors[0]?.domain ?? "";
    }
  } catch {
    message = "";
  }
  if (status === 400) {
    return { kind: "invalid_recipient", reason: message || "bad_request" };
  }
  if (status === 401) {
    return { kind: "auth" };
  }
  if (status === 403) {
    return domain === "usageLimits" ? { kind: "throttled" } : { kind: "forbidden", reason: message || "forbidden" };
  }
  if (status === 404) {
    return { kind: "thread_missing" };
  }
  if (status === 429) {
    return THROTTLE_429.test(message) ? { kind: "throttled" } : { kind: "retry", status };
  }
  return { kind: "retry", status };
}

/**
 * Sends one raw message from the connected account. Never throws: a request that got no HTTP
 * response (network failure, timeout) is `unknown`, because Gmail may already have sent it.
 */
export async function sendGmailMessage(
  input: { baseUrl: string; accessToken: string; raw: string; threadId: string | null; timeoutMs: number },
  fetchImpl: typeof fetch = fetch,
): Promise<GmailSendResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${input.baseUrl}${GMAIL_SEND_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(input.threadId ? { raw: input.raw, threadId: input.threadId } : { raw: input.raw }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.name : "network" };
  }
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    return classifyGmailResponse(response.status, body);
  }
  try {
    const sent = sentSchema.parse(JSON.parse(body));
    return { kind: "sent", id: sent.id, threadId: sent.threadId };
  } catch {
    return { kind: "unknown", reason: "unreadable_success" };
  }
}
```
Run → PASS.

- [ ] **Step 5: From name** — the code always sets `"<Workspace>" <address>`; whether Gmail keeps the name is checked at Task 10 Step 11 (first real send).

- [ ] **Step 6: Run and commit** — `bun run test src/server/gmail && bun run lint && bun run typecheck` → PASS. Commit `feat(pipeline): MIME builder and Gmail REST client`, PR, merge.

---

### Task 10: Dispatcher service, `/api/internal/dispatch`, broken-sender alert

**Labels:** `area:pipeline`, `area:api`

**Files:**
- Create: `src/server/queries/dispatch.ts`, `src/server/dispatch/run-dispatch.ts` (+ `run-dispatch.test.ts`), `src/server/dispatch/dispatch-deps.ts`, `src/server/dispatch/schedule-dispatch.ts`, `src/server/dispatch/run-dispatch.db.test.ts`, `src/emails/sender-broken-email.tsx` (+ test), `src/app/api/internal/dispatch/route.ts` (+ `route.test.ts`)
- Modify: `src/config/meetings.ts`, `messages/en.json` (`Email.senderBroken`), `src/server/supabase/admin-client.ts` (JSDoc: allowed callers now name the dispatcher module and the token API)

**Interfaces:**
- Consumes: Task 6 dispatcher RPCs; Task 3 `openSecret`, `parseEncryptionKey`, `connectionAssociatedData`, `deriveInviteeToken`, `inviteeTokenHash`, `refreshGoogleAccessToken`, `requireSecret`, `tokensEqual`; Task 8 `renderMeetingInviteEmail`; Task 9 `buildMeetingMime`, `newMessageId`, `sendGmailMessage`; M2 `createSystemMailer`, `createSupabaseAdminClient`, `logger`.
- Produces:
  - `src/config/meetings.ts`: `DISPATCH_BUDGET_MS = 50_000`, `DISPATCH_PACE_MS = 1_000`, `DISPATCH_BATCH_SIZE = 50`, `DISPATCH_LEASE_SECONDS = 70`, `THROTTLE_DEFER_MS = 3_600_000`, `REFRESH_FAILURE_DEFER_MS = 300_000`.
  - `src/server/queries/dispatch.ts`: `DispatchStore` (interface below), `createDispatchStore(client: SupabaseClient<Database>): DispatchStore`, types `Claim`, `ClaimedJob`, `ReserveResult`, `BrokenAlert`.
    ```ts
    export type DispatchStore = {
      claim(run: string, limit: number, leaseSeconds: number): Promise<Claim | null>;
      reserve(jobId: string): Promise<ReserveResult>;
      finish(jobId: string, outcome: "sent" | "skipped" | "failed" | "unknown", error: string | null, tokenHash: string | null): Promise<void>;
      retry(jobId: string, error: string): Promise<void>;
      unclaim(jobIds: string[]): Promise<void>;
      deferSender(run: string, connectionId: string, until: Date, error: string): Promise<void>;
      markBroken(run: string, connectionId: string, reason: string): Promise<{ newlyBroken: boolean; alert: BrokenAlert[] }>;
      setThread(meetingId: string, connectionId: string, threadId: string, rootMessageId: string): Promise<void>;
      release(run: string): Promise<void>;
    };
    export type ReserveResult = { kind: "ok" } | { kind: "quota"; retryAt: string } | { kind: "done" } | { kind: "gone" };
    export type BrokenAlert = { email: string; workspaceName: string; workspaceSlug: string };
    ```
  - `src/server/dispatch/run-dispatch.ts`: `DispatchDeps`, `DispatchOptions`, `DispatchSummary`, `runDispatch(deps, options): Promise<DispatchSummary>`.
  - `src/server/dispatch/dispatch-deps.ts`: `createDispatchDeps(): DispatchDeps` (throws `Error("<SECRET> is not configured")` where sending cannot work).
  - `src/server/dispatch/schedule-dispatch.ts`: `scheduleDispatch(): void` — `after()` + `runDispatch`, never throws into the caller.
  - `POST /api/internal/dispatch` — `Authorization: Bearer <DISPATCH_SECRET>` (constant-time); 404 when the secret is not configured, 401 on mismatch, else 202 `{ ok: true }` and the run continues in `after()`. `export const maxDuration = 60`.
  - `src/emails/sender-broken-email.tsx`: `renderSenderBrokenEmail({ workspaceName, settingsUrl }): Promise<{ subject; html; text }>`.

How one run works (spec §8): claim a sender (lease) with up to 50 jobs → open the refresh token → refresh the access token (`invalid_grant` → broken + alert; other failure → defer that sender 5 min) → for each job: `reserve` (quota or skip) → render + MIME + send (root email without `threadId` if the meeting has no thread on this connection yet; later ones with it) → `finish` / `retry` / `deferSender` / `markBroken` → wait 1 s → repeat until the 50 s budget ends (unclaim the rest) → `release`.

- [ ] **Step 1: Store** — `src/server/queries/dispatch.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { locationModeSchema, responseModeSchema } from "@/shared/api/meeting-settings";

const claimSchema = z
  .object({
    connection: z.object({
      id: z.uuid(),
      user_id: z.uuid(),
      google_sub: z.string(),
      google_email: z.string(),
      refresh_token_encrypted: z.string(),
    }),
    jobs: z.array(
      z.object({
        job_id: z.uuid(),
        attempts: z.number().int(),
        invitee_id: z.uuid(),
        workspace_id: z.uuid(),
        workspace_name: z.string(),
        contact: z.object({ full_name: z.string(), email: z.string() }),
        meeting: z.object({
          id: z.uuid(),
          title: z.string(),
          agenda_md: z.string(),
          starts_at: z.string(),
          duration_minutes: z.number().int(),
          timezone: z.string(),
          location_mode: locationModeSchema,
          location_text: z.string(),
          meeting_url: z.string(),
          response_mode: responseModeSchema,
          response_deadline: z.string().nullable(),
          footer_note: z.string(),
          thread_id: z.string().nullable(),
          root_message_id: z.string().nullable(),
        }),
      }),
    ),
  })
  .transform((db) => ({
    connection: {
      id: db.connection.id,
      userId: db.connection.user_id,
      googleSub: db.connection.google_sub,
      googleEmail: db.connection.google_email,
      refreshTokenEncrypted: db.connection.refresh_token_encrypted,
    },
    jobs: db.jobs.map((job) => ({
      jobId: job.job_id,
      attempts: job.attempts,
      inviteeId: job.invitee_id,
      workspaceId: job.workspace_id,
      workspaceName: job.workspace_name,
      contact: { fullName: job.contact.full_name, email: job.contact.email },
      meeting: {
        id: job.meeting.id,
        title: job.meeting.title,
        agendaMd: job.meeting.agenda_md,
        startsAt: job.meeting.starts_at,
        durationMinutes: job.meeting.duration_minutes,
        timezone: job.meeting.timezone,
        locationMode: job.meeting.location_mode,
        locationText: job.meeting.location_text,
        meetingUrl: job.meeting.meeting_url,
        responseMode: job.meeting.response_mode,
        responseDeadline: job.meeting.response_deadline,
        threadId: job.meeting.thread_id,
        rootMessageId: job.meeting.root_message_id,
      },
    })),
  }));

/** One claimed sender and its jobs. */
export type Claim = z.output<typeof claimSchema>;
/** One claimed invite job with everything needed to render it. */
export type ClaimedJob = Claim["jobs"][number];

const reserveSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("ok") }),
    z.object({ kind: z.literal("quota"), retry_at: z.string() }),
    z.object({ kind: z.literal("done") }),
    z.object({ kind: z.literal("gone") }),
  ])
  .transform((db) => (db.kind === "quota" ? { kind: db.kind, retryAt: db.retry_at } : db));

/** What reserving quota for one job produced. */
export type ReserveResult = z.output<typeof reserveSchema>;

/** One Owner to tell that their workspace's Gmail needs reconnecting. */
export type BrokenAlert = { email: string; workspaceName: string; workspaceSlug: string };

const brokenSchema = z
  .object({
    newly_broken: z.boolean(),
    alert: z.array(z.object({ email: z.string(), workspace_name: z.string(), workspace_slug: z.string() })),
  })
  .transform((db) => ({
    newlyBroken: db.newly_broken,
    alert: db.alert.map((a) => ({ email: a.email, workspaceName: a.workspace_name, workspaceSlug: a.workspace_slug })),
  }));

/** The dispatcher's view of the queue (service role; spec §8). Every method throws on a database error. */
export type DispatchStore = {
  claim(run: string, limit: number, leaseSeconds: number): Promise<Claim | null>;
  reserve(jobId: string): Promise<ReserveResult>;
  finish(jobId: string, outcome: "sent" | "skipped" | "failed" | "unknown", error: string | null, tokenHash: string | null): Promise<void>;
  retry(jobId: string, error: string): Promise<void>;
  unclaim(jobIds: string[]): Promise<void>;
  deferSender(run: string, connectionId: string, until: Date, error: string): Promise<void>;
  markBroken(run: string, connectionId: string, reason: string): Promise<{ newlyBroken: boolean; alert: BrokenAlert[] }>;
  setThread(meetingId: string, connectionId: string, threadId: string, rootMessageId: string): Promise<void>;
  release(run: string): Promise<void>;
};

function check(error: { message: string } | null): void {
  if (error) {
    throw new Error(`dispatch store: ${error.message}`);
  }
}

/** `DispatchStore` over the `dispatch_*` RPCs. `client` must be the service-role client. */
export function createDispatchStore(client: SupabaseClient<Database>): DispatchStore {
  return {
    async claim(run, limit, leaseSeconds) {
      const { data, error } = await client.rpc("dispatch_claim", { p_run: run, p_limit: limit, p_lease_seconds: leaseSeconds });
      check(error);
      return data ? claimSchema.parse(data) : null;
    },
    async reserve(jobId) {
      const { data, error } = await client.rpc("dispatch_reserve", { p_job: jobId });
      check(error);
      return reserveSchema.parse(data);
    },
    async finish(jobId, outcome, failure, tokenHash) {
      const { error } = await client.rpc("dispatch_finish", {
        p_job: jobId,
        p_outcome: outcome,
        p_error: failure ?? undefined,
        p_token_hash: tokenHash ?? undefined,
      });
      check(error);
    },
    async retry(jobId, failure) {
      const { error } = await client.rpc("dispatch_retry", { p_job: jobId, p_error: failure });
      check(error);
    },
    async unclaim(jobIds) {
      if (jobIds.length === 0) {
        return;
      }
      const { error } = await client.rpc("dispatch_unclaim", { p_jobs: jobIds });
      check(error);
    },
    async deferSender(run, connectionId, until, failure) {
      const { error } = await client.rpc("dispatch_defer_sender", {
        p_run: run,
        p_connection: connectionId,
        p_until: until.toISOString(),
        p_error: failure,
      });
      check(error);
    },
    async markBroken(run, connectionId, reason) {
      const { data, error } = await client.rpc("dispatch_mark_broken", { p_run: run, p_connection: connectionId, p_reason: reason });
      check(error);
      return brokenSchema.parse(data);
    },
    async setThread(meetingId, connectionId, threadId, rootMessageId) {
      const { error } = await client.rpc("dispatch_set_thread", {
        p_meeting: meetingId,
        p_connection: connectionId,
        p_thread_id: threadId,
        p_root_message_id: rootMessageId,
      });
      check(error);
    },
    async release(run) {
      const { error } = await client.rpc("dispatch_release", { p_run: run });
      check(error);
    },
  };
}
```
(If the generated types make `p_error` / `p_token_hash` non-nullable strings, pass `null` with the type the generator produced; `supabase gen types` marks SQL `text` arguments as `string` but PostgREST accepts `null` — use `p_error: failure as string` only if the typecheck insists, with a comment.)

- [ ] **Step 2: Failing unit tests** — `src/server/dispatch/run-dispatch.test.ts` drives `runDispatch` with an in-memory store and a scripted Gmail:
```ts
import { describe, expect, it, vi } from "vitest";
import type { GmailSendResult } from "@/server/gmail/gmail-client";
import type { RefreshResult } from "@/server/google/gmail-oauth";
import type { Claim, DispatchStore, ReserveResult } from "@/server/queries/dispatch";
import { runDispatch, type DispatchDeps } from "./run-dispatch";

const OPTIONS = { budgetMs: 50_000, paceMs: 1_000, batchSize: 50, leaseSeconds: 70 };

function job(n: number, meetingId = "11111111-1111-4111-8111-111111111111", threadId: string | null = null) {
  return {
    jobId: `00000000-0000-4000-8000-00000000000${n}`,
    attempts: 1,
    inviteeId: `10000000-0000-4000-8000-00000000000${n}`,
    workspaceId: "20000000-0000-4000-8000-000000000000",
    workspaceName: "GDG ISSAT",
    contact: { fullName: `Member ${n}`, email: `m${n}@uni.tn` },
    meeting: {
      id: meetingId,
      title: "Weekly sync",
      agendaMd: "",
      startsAt: "2026-10-09T17:00:00.000Z",
      durationMinutes: 60,
      timezone: "Africa/Tunis",
      locationMode: "in_person" as const,
      locationText: "Room B12",
      meetingUrl: "",
      responseMode: "attendance" as const,
      responseDeadline: null,
      threadId,
      rootMessageId: threadId ? "<root@tapnshow.vercel.app>" : null,
    },
  };
}

function setup(options: {
  jobs: ReturnType<typeof job>[];
  gmail?: GmailSendResult[];
  refresh?: RefreshResult[];
  reserve?: ReserveResult[];
}) {
  const claim: Claim = {
    connection: {
      id: "30000000-0000-4000-8000-000000000000",
      userId: "40000000-0000-4000-8000-000000000000",
      googleSub: "g-1",
      googleEmail: "club@gmail.com",
      refreshTokenEncrypted: "sealed",
    },
    jobs: options.jobs,
  };
  let claimed = false;
  const reserves = [...(options.reserve ?? [])];
  const store = {
    claim: vi.fn(async () => {
      if (claimed) {
        return null;
      }
      claimed = true;
      return claim;
    }),
    reserve: vi.fn(async (): Promise<ReserveResult> => reserves.shift() ?? { kind: "ok" }),
    finish: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    unclaim: vi.fn(async () => undefined),
    deferSender: vi.fn(async () => undefined),
    markBroken: vi.fn(async () => ({ newlyBroken: true, alert: [{ email: "owner@x.test", workspaceName: "GDG ISSAT", workspaceSlug: "gdg-ab12" }] })),
    setThread: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  } satisfies DispatchStore;
  const sends = [...(options.gmail ?? [])];
  const refreshes = [...(options.refresh ?? [])];
  let clock = 0;
  const deps: DispatchDeps = {
    store,
    gmail: vi.fn<DispatchDeps["gmail"]>(async () => sends.shift() ?? { kind: "sent", id: "m", threadId: "t-new" }),
    refresh: vi.fn<DispatchDeps["refresh"]>(async () => refreshes.shift() ?? { kind: "ok", accessToken: "at" }),
    openToken: vi.fn<DispatchDeps["openToken"]>(() => "1//refresh"),
    tokenFor: (inviteeId: string) => `token-${inviteeId}`,
    appUrl: "https://tapnshow.vercel.app",
    now: () => clock,
    sleep: vi.fn<DispatchDeps["sleep"]>(async (ms) => {
      clock += ms;
    }),
    alertBroken: vi.fn<DispatchDeps["alertBroken"]>(async () => undefined),
    newRunId: () => "50000000-0000-4000-8000-000000000000",
  };
  return { deps, store, advance: (ms: number) => (clock += ms) };
}

describe("runDispatch", () => {
  it("sends the root email without a thread, threads the rest, paces, records token hashes", async () => {
    const { deps, store } = setup({ jobs: [job(1), job(2)] });
    const summary = await runDispatch(deps, OPTIONS);
    expect(summary).toMatchObject({ sent: 2, senders: 1 });
    const gmail = vi.mocked(deps.gmail).mock.calls;
    expect(gmail[0][0].threadId).toBeNull();
    expect(gmail[1][0].threadId).toBe("t-new");
    const secondRaw = Buffer.from(gmail[1][0].raw, "base64url").toString("utf8");
    expect(secondRaw).toMatch(/In-Reply-To: <[0-9a-f-]+@tapnshow\.vercel\.app>/);
    expect(store.setThread).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledWith(job(1).jobId, "sent", null, expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(deps.sleep).toHaveBeenCalledWith(1_000);
    expect(store.release).toHaveBeenCalledWith("50000000-0000-4000-8000-000000000000");
  });

  it("joins an existing thread on this connection", async () => {
    const { deps, store } = setup({ jobs: [job(1, undefined, "t-old")] });
    await runDispatch(deps, OPTIONS);
    expect(vi.mocked(deps.gmail).mock.calls[0][0].threadId).toBe("t-old");
    expect(store.setThread).not.toHaveBeenCalled();
  });

  it("starts a new root when Gmail no longer knows the thread", async () => {
    const { deps, store } = setup({ jobs: [job(1, undefined, "t-gone")], gmail: [{ kind: "thread_missing" }] });
    await runDispatch(deps, OPTIONS);
    const calls = vi.mocked(deps.gmail).mock.calls;
    expect(calls[1][0].threadId).toBeNull();
    expect(store.setThread).toHaveBeenCalledTimes(1);
  });

  it("refreshes once on 401", async () => {
    const { deps, store } = setup({ jobs: [job(1)], gmail: [{ kind: "auth" }] });
    await runDispatch(deps, OPTIONS);
    expect(deps.refresh).toHaveBeenCalledTimes(2);
    expect(store.finish).toHaveBeenCalledWith(job(1).jobId, "sent", null, expect.any(String));
  });

  it("marks the sender broken on invalid_grant and alerts the Owner", async () => {
    const { deps, store } = setup({ jobs: [job(1), job(2)], refresh: [{ kind: "invalid_grant" }] });
    await runDispatch(deps, OPTIONS);
    expect(deps.gmail).not.toHaveBeenCalled();
    expect(store.markBroken).toHaveBeenCalledWith(expect.any(String), expect.any(String), "invalid_grant");
    expect(deps.alertBroken).toHaveBeenCalledWith([{ email: "owner@x.test", workspaceName: "GDG ISSAT", workspaceSlug: "gdg-ab12" }]);
  });

  it("defers the whole sender when Gmail throttles, and stops", async () => {
    const { deps, store } = setup({ jobs: [job(1), job(2)], gmail: [{ kind: "throttled" }] });
    await runDispatch(deps, OPTIONS);
    expect(store.deferSender).toHaveBeenCalledTimes(1);
    expect(deps.gmail).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx, fails refused recipients, and never retries an unknown outcome", async () => {
    const { deps, store } = setup({
      jobs: [job(1), job(2), job(3)],
      gmail: [{ kind: "retry", status: 503 }, { kind: "invalid_recipient", reason: "Invalid To header" }, { kind: "unknown", reason: "TimeoutError" }],
    });
    const summary = await runDispatch(deps, OPTIONS);
    expect(store.retry).toHaveBeenCalledWith(job(1).jobId, "http_503");
    expect(store.finish).toHaveBeenCalledWith(job(2).jobId, "failed", "Invalid To header", null);
    expect(store.finish).toHaveBeenCalledWith(job(3).jobId, "unknown", "delivery_unknown", null);
    expect(summary).toMatchObject({ sent: 0, failed: 1, unknown: 1 });
  });

  it("stops a sender at its quota and at the time budget, handing jobs back", async () => {
    const quota = setup({ jobs: [job(1), job(2)], reserve: [{ kind: "quota", retryAt: "2026-10-10T17:00:00Z" }] });
    await runDispatch(quota.deps, OPTIONS);
    expect(quota.store.unclaim).toHaveBeenCalledWith([job(2).jobId]);
    const budget = setup({ jobs: [job(1), job(2), job(3)] });
    await runDispatch(budget.deps, { ...OPTIONS, budgetMs: 1_500 });
    expect(budget.store.unclaim).toHaveBeenCalledWith([job(3).jobId]);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `bun run test src/server/dispatch` → FAIL (module missing).

- [ ] **Step 4: Implement `runDispatch`** — append the constants to `src/config/meetings.ts`:
```ts
/** One dispatcher run sends for at most this long, leaving headroom under the 60 s route limit. */
export const DISPATCH_BUDGET_MS = 50_000;
/** Pause between two sends from one Gmail account (≤ 60/min, spec §8). */
export const DISPATCH_PACE_MS = 1_000;
/** Jobs claimed per sender per round (one budget's worth at the pace above). */
export const DISPATCH_BATCH_SIZE = 50;
/** Sender lease and job lock length; longer than the budget so a live run never loses them. */
export const DISPATCH_LEASE_SECONDS = 70;
/** Gmail said "slow down": that sender waits this long (its block lasts 1–24 h). */
export const THROTTLE_DEFER_MS = 3_600_000;
/** Google's token endpoint failed transiently: retry that sender after this long. */
export const REFRESH_FAILURE_DEFER_MS = 300_000;
```
`src/server/dispatch/run-dispatch.ts`:
```ts
import "server-only";
import { renderMeetingInviteEmail } from "@/emails/meeting-invite-email";
import { logger } from "@/lib/logger";
import { inviteeTokenHash } from "@/server/crypto/invitee-token";
import type { GmailSendResult } from "@/server/gmail/gmail-client";
import { buildMeetingMime, newMessageId } from "@/server/gmail/mime";
import type { RefreshResult } from "@/server/google/gmail-oauth";
import type { BrokenAlert, Claim, ClaimedJob, DispatchStore } from "@/server/queries/dispatch";

/** Everything the dispatcher touches, injected so tests run without Google or a database. */
export type DispatchDeps = {
  store: DispatchStore;
  gmail: (input: { accessToken: string; raw: string; threadId: string | null }) => Promise<GmailSendResult>;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  openToken: (sealed: string, userId: string, googleSub: string) => string;
  tokenFor: (inviteeId: string) => string;
  appUrl: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  alertBroken: (alert: BrokenAlert[]) => Promise<void>;
  newRunId: () => string;
};

/** Tuning for one run (values from `src/config/meetings.ts` in production). */
export type DispatchOptions = { budgetMs: number; paceMs: number; batchSize: number; leaseSeconds: number };

/** What one run did (logged; returned for tests). */
export type DispatchSummary = {
  senders: number;
  sent: number;
  failed: number;
  skipped: number;
  unknown: number;
  deferred: number;
};

type Thread = { threadId: string; rootMessageId: string };
type Session = { claim: Claim; accessToken: string; threads: Map<string, Thread> };
type JobOutcome = "continue" | "stop";

/** Drains due jobs sender by sender within the time budget (spec §8). */
export async function runDispatch(deps: DispatchDeps, options: DispatchOptions): Promise<DispatchSummary> {
  const run = deps.newRunId();
  const started = deps.now();
  const summary: DispatchSummary = { senders: 0, sent: 0, failed: 0, skipped: 0, unknown: 0, deferred: 0 };
  const outOfTime = () => deps.now() - started >= options.budgetMs;
  try {
    while (!outOfTime()) {
      const claim = await deps.store.claim(run, options.batchSize, options.leaseSeconds);
      if (!claim) {
        break;
      }
      summary.senders += 1;
      await drainSender(deps, options, run, claim, summary, outOfTime);
    }
  } finally {
    await deps.store.release(run);
  }
  logger.info({ summary }, "dispatch run finished");
  return summary;
}

async function breakSender(deps: DispatchDeps, run: string, claim: Claim, reason: string): Promise<void> {
  const result = await deps.store.markBroken(run, claim.connection.id, reason);
  if (result.alert.length > 0) {
    await deps.alertBroken(result.alert).catch((error: Error) => logger.error({ err: error }, "sender-broken alert failed"));
  }
}

async function drainSender(
  deps: DispatchDeps,
  options: DispatchOptions,
  run: string,
  claim: Claim,
  summary: DispatchSummary,
  outOfTime: () => boolean,
): Promise<void> {
  let refreshToken: string;
  try {
    refreshToken = deps.openToken(claim.connection.refreshTokenEncrypted, claim.connection.userId, claim.connection.googleSub);
  } catch (error) {
    logger.error({ err: error }, "stored refresh token cannot be opened");
    await breakSender(deps, run, claim, "token_unreadable");
    return;
  }
  const refreshed = await deps.refresh(refreshToken);
  if (refreshed.kind === "invalid_grant") {
    await breakSender(deps, run, claim, "invalid_grant");
    return;
  }
  if (refreshed.kind === "error") {
    await deps.store.deferSender(run, claim.connection.id, new Date(deps.now() + REFRESH_FAILURE_DEFER_MS), "token_refresh_failed");
    return;
  }
  const session: Session = {
    claim,
    accessToken: refreshed.accessToken,
    threads: new Map(
      claim.jobs
        .filter((job) => job.meeting.threadId && job.meeting.rootMessageId)
        .map((job) => [job.meeting.id, { threadId: job.meeting.threadId ?? "", rootMessageId: job.meeting.rootMessageId ?? "" }]),
    ),
  };
  const queue = [...claim.jobs];
  while (queue.length > 0) {
    if (outOfTime()) {
      await deps.store.unclaim(queue.map((job) => job.jobId));
      return;
    }
    const job = queue.shift() as ClaimedJob;
    const reservation = await deps.store.reserve(job.jobId);
    if (reservation.kind === "done") {
      summary.skipped += 1;
      continue;
    }
    if (reservation.kind === "gone") {
      continue;
    }
    if (reservation.kind === "quota") {
      summary.deferred += 1;
      await deps.store.unclaim(queue.map((next) => next.jobId));
      return;
    }
    const outcome = await sendJob(deps, run, session, job, summary);
    if (outcome === "stop") {
      return;
    }
    await deps.sleep(options.paceMs);
  }
}

async function sendJob(
  deps: DispatchDeps,
  run: string,
  session: Session,
  job: ClaimedJob,
  summary: DispatchSummary,
): Promise<JobOutcome> {
  const token = deps.tokenFor(job.inviteeId);
  const email = await renderMeetingInviteEmail({
    workspaceName: job.workspaceName,
    recipientName: job.contact.fullName,
    senderEmail: session.claim.connection.googleEmail,
    meeting: job.meeting,
    links: {
      respond: `${deps.appUrl}/r/${token}`,
      unsubscribe: `${deps.appUrl}/u/${token}`,
      report: `${deps.appUrl}/report/${token}`,
    },
  });
  const attempt = async (thread: Thread | undefined) => {
    const messageId = newMessageId(deps.appUrl);
    const raw = await buildMeetingMime({
      from: { name: job.workspaceName, address: session.claim.connection.googleEmail },
      to: { name: job.contact.fullName, address: job.contact.email },
      subject: email.subject,
      html: email.html,
      text: email.text,
      messageId,
      inReplyTo: thread?.rootMessageId ?? null,
      listUnsubscribeUrl: `${deps.appUrl}/api/r/${token}/unsubscribe`,
    });
    return { messageId, result: await deps.gmail({ accessToken: session.accessToken, raw, threadId: thread?.threadId ?? null }) };
  };

  let thread = session.threads.get(job.meeting.id);
  let { messageId, result } = await attempt(thread);
  if (result.kind === "auth") {
    const again = await deps.refresh(deps.openToken(session.claim.connection.refreshTokenEncrypted, session.claim.connection.userId, session.claim.connection.googleSub));
    if (again.kind !== "ok") {
      await deps.store.unclaim([job.jobId]);
      await breakSender(deps, run, session.claim, again.kind === "invalid_grant" ? "invalid_grant" : "token_refresh_failed");
      return "stop";
    }
    session.accessToken = again.accessToken;
    ({ messageId, result } = await attempt(thread));
  }
  if (result.kind === "thread_missing" && thread) {
    session.threads.delete(job.meeting.id);
    thread = undefined;
    ({ messageId, result } = await attempt(thread));
  }

  switch (result.kind) {
    case "sent":
      if (!thread) {
        session.threads.set(job.meeting.id, { threadId: result.threadId, rootMessageId: messageId });
        await deps.store.setThread(job.meeting.id, session.claim.connection.id, result.threadId, messageId);
      }
      await deps.store.finish(job.jobId, "sent", null, inviteeTokenHash(token));
      summary.sent += 1;
      return "continue";
    case "invalid_recipient":
      await deps.store.finish(job.jobId, "failed", result.reason, null);
      summary.failed += 1;
      return "continue";
    case "thread_missing":
      await deps.store.retry(job.jobId, "thread_missing");
      return "continue";
    case "retry":
      await deps.store.retry(job.jobId, `http_${result.status}`);
      return "continue";
    case "unknown":
      await deps.store.finish(job.jobId, "unknown", "delivery_unknown", null);
      summary.unknown += 1;
      return "continue";
    case "throttled":
      await deps.store.deferSender(run, session.claim.connection.id, new Date(deps.now() + THROTTLE_DEFER_MS), "gmail_throttled");
      summary.deferred += 1;
      return "stop";
    case "forbidden":
    case "auth":
      await breakSender(deps, run, session.claim, result.kind === "forbidden" ? result.reason : "auth");
      return "stop";
  }
}
```
Import `REFRESH_FAILURE_DEFER_MS` and `THROTTLE_DEFER_MS` from `@/config/meetings` at the top. The `queue.shift() as ClaimedJob` is safe inside `while (queue.length > 0)`; if the linter flags the assertion, use `const [job, ...rest] = queue` with a `let queue` instead.

- [ ] **Step 5: Run** — unit tests → PASS. (The second `refresh` in the 401 test returns the default `ok`.)

- [ ] **Step 6: Sender-broken email** — messages under `Email`:
```json
"senderBroken": {
  "subject": "Gmail sending for {workspace} needs reconnecting",
  "preview": "Meeting emails for {workspace} are paused until Gmail is reconnected.",
  "heading": "Reconnect Gmail for {workspace}",
  "body": "Google stopped accepting {appName}'s access to the Gmail account that sends {workspace}'s meeting emails, for example after a password change or if access was removed. Queued emails are paused and nothing is lost.",
  "button": "Reconnect Gmail",
  "fallback": "If the button doesn't work, copy this link:"
}
```
`src/emails/sender-broken-email.tsx` follows `invite-email.tsx` exactly (heading, body `Text`, one `Button` to `settingsUrl`, fallback line, `renderSenderBrokenEmail` returning subject/html/text) with props `{ workspaceName: string; settingsUrl: string }`. Test (`sender-broken-email.test.tsx`): subject names the workspace, the button links `https://tapnshow.vercel.app/w/gdg-ab12/settings#sending`, the text part has the link, no emoji, workspace names are escaped.

- [ ] **Step 7: Production wiring** — `src/server/dispatch/dispatch-deps.ts`:
```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/config/env";
import { GMAIL_SEND_TIMEOUT_MS } from "@/config/meetings";
import { publicEnv } from "@/config/public-env";
import { requireSecret } from "@/config/secrets";
import { renderSenderBrokenEmail } from "@/emails/sender-broken-email";
import { deriveInviteeToken } from "@/server/crypto/invitee-token";
import { connectionAssociatedData, openSecret, parseEncryptionKey } from "@/server/crypto/secret-box";
import { createSystemMailer } from "@/server/email/system-mailer";
import { sendGmailMessage } from "@/server/gmail/gmail-client";
import { refreshGoogleAccessToken } from "@/server/google/gmail-oauth";
import { createDispatchStore } from "@/server/queries/dispatch";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { DispatchDeps } from "./run-dispatch";

/**
 * Real dependencies for `runDispatch`.
 * @throws Error naming the first missing secret (sending cannot work without it)
 */
export function createDispatchDeps(): DispatchDeps {
  const env = getServerEnv();
  const key = parseEncryptionKey(requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env));
  const inviteSecret = requireSecret("INVITE_TOKEN_SECRET", env);
  const clientId = requireSecret("GOOGLE_CLIENT_ID", env);
  const clientSecret = requireSecret("GOOGLE_CLIENT_SECRET", env);
  const mailer = createSystemMailer();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  return {
    store: createDispatchStore(createSupabaseAdminClient()),
    gmail: (input) => sendGmailMessage({ ...input, baseUrl: env.GMAIL_API_BASE_URL, timeoutMs: GMAIL_SEND_TIMEOUT_MS }),
    refresh: (refreshToken) =>
      refreshGoogleAccessToken({ refreshToken, clientId, clientSecret, tokenUrl: env.GOOGLE_OAUTH_TOKEN_URL }),
    openToken: (sealed, userId, googleSub) => openSecret(sealed, key, connectionAssociatedData(userId, googleSub)),
    tokenFor: (inviteeId) => deriveInviteeToken(inviteeId, inviteSecret),
    appUrl,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    alertBroken: async (alert) => {
      for (const target of alert) {
        const content = await renderSenderBrokenEmail({
          workspaceName: target.workspaceName,
          settingsUrl: `${appUrl}/w/${target.workspaceSlug}/settings#sending`,
        });
        await mailer.send({ to: target.email, ...content });
      }
    },
    newRunId: () => randomUUID(),
  };
}
```
`src/server/dispatch/schedule-dispatch.ts`:
```ts
import "server-only";
import { after } from "next/server";
import {
  DISPATCH_BATCH_SIZE,
  DISPATCH_BUDGET_MS,
  DISPATCH_LEASE_SECONDS,
  DISPATCH_PACE_MS,
} from "@/config/meetings";
import { logger } from "@/lib/logger";
import { createDispatchDeps } from "./dispatch-deps";
import { runDispatch } from "./run-dispatch";

/** The production run options. */
export const DISPATCH_OPTIONS = {
  budgetMs: DISPATCH_BUDGET_MS,
  paceMs: DISPATCH_PACE_MS,
  batchSize: DISPATCH_BATCH_SIZE,
  leaseSeconds: DISPATCH_LEASE_SECONDS,
};

/**
 * Starts a dispatcher run after the current response is sent (Next `after()`; it runs for the
 * route's `maxDuration`). Failures are logged, never thrown into the request.
 */
export function scheduleDispatch(): void {
  after(async () => {
    try {
      await runDispatch(createDispatchDeps(), DISPATCH_OPTIONS);
    } catch (error) {
      logger.error({ err: error }, "dispatch run failed");
    }
  });
}
```

- [ ] **Step 8: Route test + route** — `src/app/api/internal/dispatch/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ secret: { value: "s".repeat(43) as string | undefined }, schedule: vi.fn() }));
vi.mock("@/config/env", () => ({ getServerEnv: () => ({ DISPATCH_SECRET: mocks.secret.value, LOG_LEVEL: "info" }) }));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({ scheduleDispatch: mocks.schedule }));

const post = (authorization?: string) =>
  new Request("http://localhost:3000/api/internal/dispatch", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secret.value = "s".repeat(43);
});

describe("POST /api/internal/dispatch", () => {
  it("starts a run for the right secret", async () => {
    const { POST } = await import("./route");
    const response = await POST(post(`Bearer ${"s".repeat(43)}`));
    expect(response.status).toBe(202);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });

  it("refuses a wrong or missing secret and hides the route where it is not configured", async () => {
    const { POST } = await import("./route");
    expect((await POST(post("Bearer nope"))).status).toBe(401);
    expect((await POST(post())).status).toBe(401);
    mocks.secret.value = undefined;
    expect((await POST(post(`Bearer ${"s".repeat(43)}`))).status).toBe(404);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
```
`src/app/api/internal/dispatch/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { tokensEqual } from "@/server/crypto/tokens";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { apiError } from "@/server/http/errors";

/** `after()` work may run this long (the dispatcher's budget is 50 s). */
export const maxDuration = 60;

/**
 * Called every minute by Supabase Cron when jobs are due, and by nothing else (spec §8). Answers at
 * once so pg_net's 10 s timeout is never hit; the run continues after the response.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = getServerEnv().DISPATCH_SECRET;
  if (!secret) {
    return apiError("not_found");
  }
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!tokensEqual(provided, secret)) {
    return apiError("unauthenticated");
  }
  scheduleDispatch();
  return NextResponse.json({ ok: true }, { status: 202 });
}
```
Check `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md` for the export form in Next 16 before committing.

- [ ] **Step 9: DB integration test** — `src/server/dispatch/run-dispatch.db.test.ts` runs the real store against local Supabase with a fake Gmail:
```ts
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveInviteeToken, inviteeTokenHash } from "@/server/crypto/invitee-token";
import { connectionAssociatedData, openSecret, sealSecret } from "@/server/crypto/secret-box";
import type { GmailSendResult } from "@/server/gmail/gmail-client";
import { createDispatchStore } from "@/server/queries/dispatch";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { overrideLimit } from "@/test/db/outbox";
import { seedContacts, seedList } from "@/test/db/roster";
import { setSender } from "@/test/db/sender";
import { runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";
import { runDispatch, type DispatchDeps } from "./run-dispatch";

const KEY = randomBytes(32);
const SECRET = "i".repeat(43);
const OPTIONS = { budgetMs: 50_000, paceMs: 0, batchSize: 50, leaseSeconds: 70 };

let owner: TestUser;
let workspace: TestWorkspace;
let connection: string;
let meeting: string;
const restore: Array<() => void> = [];

beforeEach(async () => {
  runLocalSql("update public.outbox_jobs set status = 'done' where status in ('pending', 'processing', 'paused')");
  runLocalSql("delete from public.sender_leases");
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Dispatch Club");
  const sub = `sub-${crypto.randomUUID()}`;
  const saved = await adminClient().rpc("save_google_connection", {
    p_user: owner.id,
    p_google_sub: sub,
    p_google_email: "club@gmail.com",
    p_scopes: ["https://www.googleapis.com/auth/gmail.send"],
    p_token_encrypted: sealSecret("1//refresh", KEY, connectionAssociatedData(owner.id, sub)),
  });
  connection = saved.data ?? "";
  await setSender(workspace.id, connection);
  const people = await seedContacts(workspace.id, 3, `dp-${crypto.randomUUID().slice(0, 6)}`);
  const list = await seedList(workspace.id, "Members");
  await addToList(workspace.id, list, people);
  meeting = await seedMeeting(workspace.id, { created_by: owner.id });
  await owner.client.rpc("set_meeting_audience", { p_meeting: meeting, p_list_ids: [list], p_include: [], p_exclude: [] });
});

afterEach(() => {
  while (restore.length) {
    restore.pop()?.();
  }
});

function deps(gmail: (threadId: string | null) => GmailSendResult): DispatchDeps {
  return {
    store: createDispatchStore(adminClient()),
    gmail: vi.fn<DispatchDeps["gmail"]>(async ({ threadId }) => gmail(threadId)),
    refresh: vi.fn<DispatchDeps["refresh"]>(async () => ({ kind: "ok", accessToken: "at" })),
    openToken: (sealed, userId, sub) => openSecret(sealed, KEY, connectionAssociatedData(userId, sub)),
    tokenFor: (id) => deriveInviteeToken(id, SECRET),
    appUrl: "https://tapnshow.vercel.app",
    now: () => Date.now(),
    sleep: async () => undefined,
    alertBroken: vi.fn<DispatchDeps["alertBroken"]>(async () => undefined),
    newRunId: () => crypto.randomUUID(),
  };
}

describe("dispatcher against the database", () => {
  it("sends every invite once, threads them, and stores token hashes", async () => {
    await owner.client.rpc("send_meeting", { p_meeting: meeting });
    let n = 0;
    const d = deps((threadId) => ({ kind: "sent", id: `m${(n += 1)}`, threadId: threadId ?? "t-1" }));
    expect((await runDispatch(d, OPTIONS)).sent).toBe(3);
    expect((await runDispatch(d, OPTIONS)).sent).toBe(0);
    const invitees = await adminClient().from("meeting_invitees").select("id, email_status, token_hash").eq("meeting_id", meeting);
    expect(invitees.data?.every((i) => i.email_status === "sent")).toBe(true);
    for (const invitee of invitees.data ?? []) {
      expect(invitee.token_hash).toBe(inviteeTokenHash(deriveInviteeToken(invitee.id, SECRET)));
    }
    const row = await adminClient().from("meetings").select("gmail_thread_id, thread_connection_id").eq("id", meeting).single();
    expect(row.data).toEqual({ gmail_thread_id: "t-1", thread_connection_id: connection });
    const threadIds = vi.mocked(d.gmail).mock.calls.map(([input]) => input.threadId);
    expect(threadIds).toEqual([null, "t-1", "t-1"]);
  });

  it("skips a person who unsubscribed between Send and their turn", async () => {
    await owner.client.rpc("send_meeting", { p_meeting: meeting });
    const { data: first } = await adminClient().from("meeting_invitees").select("contact_id").eq("meeting_id", meeting).limit(1).single();
    await adminClient().from("contacts").update({ unsubscribed_at: new Date().toISOString(), unsubscribed_via: "link" }).eq("id", first?.contact_id ?? "");
    const summary = await runDispatch(deps(() => ({ kind: "sent", id: "m", threadId: "t" })), OPTIONS);
    expect(summary).toMatchObject({ sent: 2, skipped: 1 });
  });

  it("holds the daily cap", async () => {
    restore.push(overrideLimit("gmail_sends_per_day", 1));
    await owner.client.rpc("send_meeting", { p_meeting: meeting });
    const summary = await runDispatch(deps(() => ({ kind: "sent", id: "m", threadId: "t" })), OPTIONS);
    expect(summary.sent).toBe(1);
    const pending = await adminClient().from("outbox_jobs").select("run_after").eq("workspace_id", workspace.id).eq("status", "pending");
    expect(pending.data?.length).toBe(2);
    expect(new Date(pending.data?.[0].run_after ?? 0).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
});
```
Run: `bun run test:db -- src/server/dispatch/run-dispatch.db.test.ts` → PASS (the DB config runs `*.db.test.ts` in Node; React Email renders there too).

- [ ] **Step 10: Run everything and commit** — `bun run test && bun run test:db && bun run lint && bun run typecheck` → PASS. Update the JSDoc of `createSupabaseAdminClient` ("Allowed callers (spec §11): the outbox dispatcher (`src/server/dispatch`), the public token API (`src/app/api/r`), and the health probe"). Commit `feat(pipeline): dispatcher run, internal dispatch route and broken-sender alert`, PR, merge.

- [ ] **Step 11: First real send (grilling 2026-10-07; to the owner's own test addresses only)** — ask the owner which addresses to use (never the club roster) and that they are ready. On localhost against the **preview** database, with the connection from Task 4 Step 17:
  1. A throwaway script in the scratchpad (not committed) uses the service role to create, in the owner's throwaway workspace, contacts for the test addresses, a meeting tomorrow (attendance mode, an agenda with a list and a link), the invitees and their `invite` jobs (rows like `send_meeting` writes), then calls `runDispatch(createDispatchDeps(), DISPATCH_OPTIONS)` once, run with `bun` from the repo root so `.env.local` loads (never `source` it).
  2. The owner checks: the emails arrived; the From line shows the workspace name (→ `Ruling: From display name kept = yes|no`, set `FROM_NAME_KEPT` when Task 15 creates it); the sender's Sent folder shows **one** conversation; buttons, layout and agenda render in Gmail web and the phone app; Gmail's own Unsubscribe (if shown) and the footer links reach `/u/…` and `/report/…` (404 until Task 17 — expected now; re-checked after Task 17).
  3. The agent checks `meeting_invitees` (`sent`, token hashes set), `send_log` (one row per email) and `meetings.gmail_thread_id`. Delete the throwaway rows afterwards. Record the results (no addresses) in the ledger.

---

### Task 11: Meetings API, shared schemas, hooks, email preview

**Labels:** `area:api`

**Files:**
- Create: `src/shared/api/meetings.ts` (+ `meetings.test.ts`), `src/server/queries/meetings.ts`, `src/server/http/meeting-context.ts` (+ test), routes under `src/app/api/workspaces/[slug]/meetings/`: `route.ts`, `[id]/route.ts`, `[id]/audience/route.ts`, `[id]/people/route.ts`, `[id]/preview/route.ts`, `[id]/send/route.ts`, `[id]/progress/route.ts` (each + `route.test.ts`), `src/hooks/use-meetings.ts`, `src/test/fixtures/meetings.ts`
- Modify: `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors`), `src/config/meetings.ts`, spec §10 (the "Meetings API" line: `POST …/send` also serves Invite more; drop `…/invitees`)

**Interfaces:**
- Consumes: Task 5/6 RPCs and tables; Task 8 `renderMeetingInviteEmail`; Task 10 `scheduleDispatch`; Task 4 `getWorkspaceSender`, meeting-settings schemas; M2/M3 HTTP helpers.
- Produces:
  - Error codes (status): `sender_not_connected` 409, `sender_broken` 409, `meeting_not_draft` 409, `meeting_in_past` 409, `meeting_incomplete` 400, `too_many_invitees` 409, `nothing_to_send` 409 — each with an `ApiErrors` message.
  - `src/config/meetings.ts`: `PROGRESS_POLL_MS = 3_000`, `TITLE_MAX = 120`, `AGENDA_MAX = 5_000`, `LOCATION_MAX = 200`, `MEETING_URL_MAX = 500`, `PEOPLE_PER_ADD_MAX = 50`.
  - `src/shared/api/meetings.ts` (all exported with their `z.infer` types): `meetingStatusSchema`, `meetingSchema` (`Meeting`), `meetingSummarySchema` (`MeetingSummary`), `meetingListSchema`, `createMeetingResponseSchema` (`{ id }`), `meetingUrlSchema`, `updateMeetingBodySchema` (`UpdateMeetingBody`, partial, ≥ 1 key), `audienceBodySchema` (`AudienceBody` = `{ listIds, include, exclude }`), `audienceSchema` (`Audience`), `audiencePersonSchema` (`AudiencePerson`), `addPeopleBodySchema` (`AddPeopleBody` = `{ people: [{ fullName, email }], saveToRoster }`), `addPeopleResponseSchema` (`{ contactIds }`), `sendResultSchema` (`{ invited, skippedUnsubscribed }`), `progressSchema` (`MeetingProgress`), `inviteeStatusSchema`, `previewSchema` (`{ subject, html, fromName, fromEmail, recipientName }`).
  - `Meeting` fields: `id, title, agendaMd, startsAt (string|null), durationMinutes, timezone, locationMode, locationText, meetingUrl, responseMode, responseDeadline (string|null), delayOptions, reasonRequired, commentsEnabled, footerNote, status, sentAt (string|null)`.
  - `loadMeetingContext(slug: string, meetingId: string): Promise<MeetingContext>` — workspace context **plus** the meeting, which must belong to that workspace (404 otherwise; the #119 lesson about trusting the slug).
  - Routes (all under `/api/workspaces/[slug]/meetings`): `GET` list, `POST` create draft → `{ id }`; `[id]`: `GET` → `Meeting`, `PATCH` (drafts) → `Meeting`, `DELETE` (drafts) → `{ ok }`; `[id]/audience`: `GET` → `Audience`, `PUT` → `Audience`; `[id]/people`: `POST` → `{ contactIds }`; `[id]/preview`: `GET` → preview; `[id]/send`: `POST` → `{ invited, skippedUnsubscribed }` (first send and Invite more); `[id]/progress`: `GET` → `MeetingProgress`.
  - Hooks (`src/hooks/use-meetings.ts`): `meetingsQueryKey`, `meetingQueryKey`, `audienceQueryKey`, `progressQueryKey`, `useMeetings`, `useMeeting`, `useCreateMeeting`, `useUpdateMeeting`, `useDeleteMeeting`, `useMeetingAudience`, `useSetAudience`, `useAddPeople`, `useMeetingPreview`, `useSendMeeting`, `useMeetingProgress`.
  - `src/test/fixtures/meetings.ts`: `MEETING_IDS`, `meetingFixture`, `audienceFixture`, `progressFixture` (UUIDs; reused by Tasks 13–15).

- [ ] **Step 1: Error codes + config** — add the seven codes to `API_ERROR_CODES` / `API_ERROR_STATUS` and to `messages/en.json` → `ApiErrors`:
```json
"sender_not_connected": "Connect a Gmail account to send this meeting.",
"sender_broken": "Gmail needs reconnecting before this meeting can be sent.",
"meeting_not_draft": "This meeting has already been sent or cancelled.",
"meeting_in_past": "This meeting's start time has passed. Pick a new time.",
"meeting_incomplete": "Some details are missing. Check the title, time and place.",
"too_many_invitees": "That's more people than one meeting can invite.",
"nothing_to_send": "Everyone in this audience has already been invited."
```
Append to `src/config/meetings.ts`:
```ts
/** How often the meeting page refreshes while emails are queued. */
export const PROGRESS_POLL_MS = 3_000;
/** Field limits (mirror the database checks on `meetings`). */
export const TITLE_MAX = 120;
export const AGENDA_MAX = 5_000;
export const LOCATION_MAX = 200;
export const MEETING_URL_MAX = 500;
/** "Add people" accepts this many rows per save (`meeting_people_per_call_max`). */
export const PEOPLE_PER_ADD_MAX = 50;
```

- [ ] **Step 2: Failing schema tests** — `src/shared/api/meetings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { addPeopleBodySchema, meetingUrlSchema, updateMeetingBodySchema } from "./meetings";

describe("meeting schemas", () => {
  it("accepts only http(s) meeting links or none", () => {
    expect(meetingUrlSchema.parse("")).toBe("");
    expect(meetingUrlSchema.parse("https://meet.example.test/abc")).toBe("https://meet.example.test/abc");
    expect(meetingUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(meetingUrlSchema.safeParse("ftp://x.test").success).toBe(false);
  });

  it("validates one step's fields at a time", () => {
    expect(updateMeetingBodySchema.safeParse({}).success).toBe(false);
    expect(updateMeetingBodySchema.parse({ title: "  Kickoff " })).toEqual({ title: "Kickoff" });
    expect(updateMeetingBodySchema.safeParse({ startsAt: "tomorrow" }).success).toBe(false);
    expect(updateMeetingBodySchema.parse({ startsAt: "2026-10-09T17:00:00.000Z", responseDeadline: null })).toEqual({
      startsAt: "2026-10-09T17:00:00.000Z",
      responseDeadline: null,
    });
  });

  it("normalizes added people and caps a save at 50", () => {
    expect(addPeopleBodySchema.parse({ people: [{ fullName: " Nour ", email: " Nour@Uni.TN " }], saveToRoster: true })).toEqual({
      people: [{ fullName: "Nour", email: "nour@uni.tn" }],
      saveToRoster: true,
    });
    const many = Array.from({ length: 51 }, (_, n) => ({ fullName: `P${n}`, email: `p${n}@x.test` }));
    expect(addPeopleBodySchema.safeParse({ people: many, saveToRoster: true }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement** — `src/shared/api/meetings.ts`:
```ts
import { z } from "zod";
import {
  AGENDA_MAX,
  LOCATION_MAX,
  MEETING_URL_MAX,
  PEOPLE_PER_ADD_MAX,
  TITLE_MAX,
} from "@/config/meetings";
import { emailSchema } from "./common";
import {
  delayOptionsSchema,
  durationMinutesSchema,
  footerNoteSchema,
  locationModeSchema,
  responseModeSchema,
} from "./meeting-settings";
import { timezoneSchema } from "./workspaces";

/** Lifecycle of a meeting. */
export const meetingStatusSchema = z.enum(["draft", "scheduled", "cancelled"]);

/** A meeting link: empty, or an http(s) URL (the database check agrees). */
export const meetingUrlSchema = z.union([
  z.literal(""),
  z.url({ protocol: /^https?$/ }).max(MEETING_URL_MAX),
]);

const isoInstant = z.iso.datetime({ offset: true });

/** `GET …/meetings/[id]` and `PATCH` responses. */
export const meetingSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  agendaMd: z.string(),
  startsAt: z.string().nullable(),
  durationMinutes: z.number().int(),
  timezone: z.string(),
  locationMode: locationModeSchema,
  locationText: z.string(),
  meetingUrl: z.string(),
  responseMode: responseModeSchema,
  responseDeadline: z.string().nullable(),
  delayOptions: z.array(z.number().int()),
  reasonRequired: z.boolean(),
  commentsEnabled: z.boolean(),
  footerNote: z.string(),
  status: meetingStatusSchema,
  sentAt: z.string().nullable(),
});
/** A meeting as the editor and meeting page see it. */
export type Meeting = z.infer<typeof meetingSchema>;

/** One card on the Meetings page. */
export const meetingSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.string().nullable(),
  timezone: z.string(),
  durationMinutes: z.number().int(),
  status: meetingStatusSchema,
  locationMode: locationModeSchema,
  invitedCount: z.number().int(),
  sentCount: z.number().int(),
});
/** A meeting in the list. */
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;
/** `GET …/meetings`. */
export const meetingListSchema = z.array(meetingSummarySchema);

/** `POST …/meetings` response (a new draft). */
export const createMeetingResponseSchema = z.object({ id: z.uuid() });

/** `PATCH …/meetings/[id]`: one wizard step's fields (drafts only). */
export const updateMeetingBodySchema = z
  .object({
    title: z.string().trim().max(TITLE_MAX),
    agendaMd: z.string().max(AGENDA_MAX),
    startsAt: isoInstant.nullable(),
    durationMinutes: durationMinutesSchema,
    timezone: timezoneSchema,
    locationMode: locationModeSchema,
    locationText: z.string().trim().max(LOCATION_MAX),
    meetingUrl: meetingUrlSchema,
    responseMode: responseModeSchema,
    responseDeadline: isoInstant.nullable(),
    delayOptions: delayOptionsSchema,
    reasonRequired: z.boolean(),
    commentsEnabled: z.boolean(),
    footerNote: footerNoteSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0);
/** A partial draft update. */
export type UpdateMeetingBody = z.infer<typeof updateMeetingBodySchema>;

/** `PUT …/audience`: picked lists and individual include / exclude sets (replaced as a whole). */
export const audienceBodySchema = z.object({
  listIds: z.array(z.uuid()).max(50),
  include: z.array(z.uuid()).max(500),
  exclude: z.array(z.uuid()).max(2000),
});
/** An audience update. */
export type AudienceBody = z.infer<typeof audienceBodySchema>;

/** One person in the Audience step. */
export const audiencePersonSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  listIds: z.array(z.uuid()),
  added: z.boolean(),
  excluded: z.boolean(),
  unsubscribed: z.boolean(),
  reported: z.boolean(),
  invited: z.boolean(),
});
/** A person in a meeting's audience. */
export type AudiencePerson = z.infer<typeof audiencePersonSchema>;

/** `GET/PUT …/audience` response. */
export const audienceSchema = z.object({
  listIds: z.array(z.uuid()),
  people: z.array(audiencePersonSchema),
  counts: z.object({
    selected: z.number().int(),
    invited: z.number().int(),
    unsubscribed: z.number().int(),
    toInvite: z.number().int(),
  }),
  maxInvitees: z.number().int(),
});
/** A meeting's resolved audience. */
export type Audience = z.infer<typeof audienceSchema>;

/** `POST …/people`: several people at once (spec §7.2 "Add people"). */
export const addPeopleBodySchema = z.object({
  people: z
    .array(z.object({ fullName: z.string().trim().min(1).max(120), email: emailSchema }))
    .min(1)
    .max(PEOPLE_PER_ADD_MAX),
  saveToRoster: z.boolean(),
});
/** An "Add people" save. */
export type AddPeopleBody = z.infer<typeof addPeopleBodySchema>;
/** `POST …/people` response. */
export const addPeopleResponseSchema = z.object({ contactIds: z.array(z.uuid()) });

/** `POST …/send` response. */
export const sendResultSchema = z.object({
  invited: z.number().int(),
  skippedUnsubscribed: z.number().int(),
});

/** Delivery state of one invitee. */
export const inviteeStatusSchema = z.enum(["queued", "sent", "skipped", "failed", "unknown"]);

/** `GET …/progress` response. */
export const progressSchema = z.object({
  counts: z.object({
    total: z.number().int(),
    queued: z.number().int(),
    sent: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    unknown: z.number().int(),
  }),
  paused: z.number().int(),
  resumesAt: z.string().nullable(),
  senderState: z.enum(["ok", "missing", "broken"]),
  invitees: z.array(
    z.object({
      id: z.uuid(),
      contactId: z.uuid(),
      fullName: z.string(),
      email: z.string(),
      status: inviteeStatusSchema,
      error: z.string().nullable(),
      sentAt: z.string().nullable(),
    }),
  ),
});
/** Live send progress of one meeting. */
export type MeetingProgress = z.infer<typeof progressSchema>;

/** `GET …/preview`: the invite as one example recipient would see it. */
export const previewSchema = z.object({
  subject: z.string(),
  html: z.string(),
  fromName: z.string(),
  fromEmail: z.string().nullable(),
  recipientName: z.string(),
});
```
Run → PASS.

- [ ] **Step 4: Queries** — `src/server/queries/meetings.ts` (snake_case ↔ camelCase in one place):
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  type AddPeopleBody,
  type Audience,
  type AudienceBody,
  audienceSchema,
  type Meeting,
  meetingSchema,
  meetingListSchema,
  type MeetingProgress,
  type MeetingSummary,
  progressSchema,
  sendResultSchema,
  type UpdateMeetingBody,
} from "@/shared/api/meetings";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;
type Result<T> = { data: T | null; error: DbError | null };

const MEETING_COLUMNS =
  "id, workspace_id, title, agenda_md, starts_at, duration_minutes, timezone, location_mode, location_text, meeting_url, response_mode, response_deadline, delay_options, reason_required, comments_enabled, footer_note, status, sent_at";

type MeetingRow = Database["public"]["Tables"]["meetings"]["Row"];

function toMeeting(row: Pick<MeetingRow, "id" | "title" | "agenda_md" | "starts_at" | "duration_minutes" | "timezone" | "location_mode" | "location_text" | "meeting_url" | "response_mode" | "response_deadline" | "delay_options" | "reason_required" | "comments_enabled" | "footer_note" | "status" | "sent_at">): Meeting {
  return meetingSchema.parse({
    id: row.id,
    title: row.title,
    agendaMd: row.agenda_md,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    locationMode: row.location_mode,
    locationText: row.location_text,
    meetingUrl: row.meeting_url,
    responseMode: row.response_mode,
    responseDeadline: row.response_deadline,
    delayOptions: row.delay_options,
    reasonRequired: row.reason_required,
    commentsEnabled: row.comments_enabled,
    footerNote: row.footer_note,
    status: row.status,
    sentAt: row.sent_at,
  });
}

/** The meeting if it belongs to `workspaceId` (RLS also hides other workspaces'). */
export async function getMeeting(client: Client, workspaceId: string, meetingId: string): Promise<Result<Meeting>> {
  const { data, error } = await client
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("id", meetingId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    return { data: null, error };
  }
  return { data: data ? toMeeting(data) : null, error: null };
}

/** All meetings of a workspace (cards). */
export async function listMeetings(client: Client, workspaceId: string): Promise<Result<MeetingSummary[]>> {
  const { data, error } = await client.rpc("list_meetings", { p_workspace: workspaceId });
  if (error) {
    return { data: null, error };
  }
  const rows = z
    .array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        starts_at: z.string().nullable(),
        timezone: z.string(),
        duration_minutes: z.number().int(),
        status: z.string(),
        location_mode: z.string(),
        invited_count: z.number().int(),
        sent_count: z.number().int(),
      }),
    )
    .parse(data);
  return {
    data: meetingListSchema.parse(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.starts_at,
        timezone: r.timezone,
        durationMinutes: r.duration_minutes,
        status: r.status,
        locationMode: r.location_mode,
        invitedCount: r.invited_count,
        sentCount: r.sent_count,
      })),
    ),
    error: null,
  };
}

/** `create_meeting()`: a draft from the workspace defaults. */
export async function createMeeting(client: Client, workspaceId: string): Promise<Result<string>> {
  const { data, error } = await client.rpc("create_meeting", { p_workspace: workspaceId });
  return { data: data ?? null, error };
}

/** Saves some draft fields; `data` is null when no draft row matched (sent, cancelled or gone). */
export async function updateMeeting(
  client: Client,
  workspaceId: string,
  meetingId: string,
  patch: UpdateMeetingBody,
): Promise<Result<Meeting>> {
  const { data, error } = await client
    .from("meetings")
    .update({
      title: patch.title,
      agenda_md: patch.agendaMd,
      starts_at: patch.startsAt,
      duration_minutes: patch.durationMinutes,
      timezone: patch.timezone,
      location_mode: patch.locationMode,
      location_text: patch.locationText,
      meeting_url: patch.meetingUrl,
      response_mode: patch.responseMode,
      response_deadline: patch.responseDeadline,
      delay_options: patch.delayOptions,
      reason_required: patch.reasonRequired,
      comments_enabled: patch.commentsEnabled,
      footer_note: patch.footerNote,
    })
    .eq("id", meetingId)
    .eq("workspace_id", workspaceId)
    .select(MEETING_COLUMNS)
    .maybeSingle();
  if (error) {
    return { data: null, error };
  }
  return { data: data ? toMeeting(data) : null, error: null };
}

/** Deletes a draft; false when no draft row matched. */
export async function deleteMeeting(client: Client, workspaceId: string, meetingId: string): Promise<Result<boolean>> {
  const { data, error } = await client
    .from("meetings")
    .delete()
    .eq("id", meetingId)
    .eq("workspace_id", workspaceId)
    .select("id");
  return error ? { data: null, error } : { data: (data ?? []).length > 0, error: null };
}

const dbAudienceSchema = z
  .object({
    list_ids: z.array(z.uuid()),
    people: z.array(
      z.object({
        id: z.uuid(),
        full_name: z.string(),
        email: z.string(),
        list_ids: z.array(z.uuid()),
        added: z.boolean(),
        excluded: z.boolean(),
        unsubscribed: z.boolean(),
        reported: z.boolean(),
        invited: z.boolean(),
      }),
    ),
    counts: z.object({ selected: z.number(), invited: z.number(), unsubscribed: z.number(), to_invite: z.number() }),
    max_invitees: z.number(),
  })
  .transform(
    (db): Audience =>
      audienceSchema.parse({
        listIds: db.list_ids,
        people: db.people.map((p) => ({
          id: p.id,
          fullName: p.full_name,
          email: p.email,
          listIds: p.list_ids,
          added: p.added,
          excluded: p.excluded,
          unsubscribed: p.unsubscribed,
          reported: p.reported,
          invited: p.invited,
        })),
        counts: {
          selected: db.counts.selected,
          invited: db.counts.invited,
          unsubscribed: db.counts.unsubscribed,
          toInvite: db.counts.to_invite,
        },
        maxInvitees: db.max_invitees,
      }),
  );

/** `meeting_audience()`. */
export async function getAudience(client: Client, meetingId: string): Promise<Result<Audience>> {
  const { data, error } = await client.rpc("meeting_audience", { p_meeting: meetingId });
  return error ? { data: null, error } : { data: dbAudienceSchema.parse(data), error: null };
}

/** `set_meeting_audience()`. */
export async function setAudience(client: Client, meetingId: string, body: AudienceBody): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("set_meeting_audience", {
    p_meeting: meetingId,
    p_list_ids: body.listIds,
    p_include: body.include,
    p_exclude: body.exclude,
  });
  return { error };
}

/** `add_meeting_people()`. */
export async function addPeople(client: Client, meetingId: string, body: AddPeopleBody): Promise<Result<string[]>> {
  const { data, error } = await client.rpc("add_meeting_people", {
    p_meeting: meetingId,
    p_people: body.people.map((p) => ({ email: p.email, full_name: p.fullName })),
    p_save_to_roster: body.saveToRoster,
  });
  if (error) {
    return { data: null, error };
  }
  return { data: z.object({ contact_ids: z.array(z.uuid()) }).parse(data).contact_ids, error: null };
}

/** `send_meeting()` (first send and Invite more). */
export async function sendMeeting(
  client: Client,
  meetingId: string,
): Promise<Result<z.infer<typeof sendResultSchema>>> {
  const { data, error } = await client.rpc("send_meeting", { p_meeting: meetingId });
  if (error) {
    return { data: null, error };
  }
  const parsed = z.object({ invited: z.number(), skipped_unsubscribed: z.number() }).parse(data);
  return { data: { invited: parsed.invited, skippedUnsubscribed: parsed.skipped_unsubscribed }, error: null };
}

const dbProgressSchema = z
  .object({
    counts: z.object({ total: z.number(), queued: z.number(), sent: z.number(), skipped: z.number(), failed: z.number(), unknown: z.number() }),
    paused: z.number(),
    resumes_at: z.string().nullable(),
    sender_state: z.enum(["ok", "missing", "broken"]),
    invitees: z.array(
      z.object({
        id: z.uuid(),
        contact_id: z.uuid(),
        full_name: z.string(),
        email: z.string(),
        status: z.enum(["queued", "sent", "skipped", "failed", "unknown"]),
        error: z.string().nullable(),
        sent_at: z.string().nullable(),
      }),
    ),
  })
  .transform(
    (db): MeetingProgress =>
      progressSchema.parse({
        counts: db.counts,
        paused: db.paused,
        resumesAt: db.resumes_at,
        senderState: db.sender_state,
        invitees: db.invitees.map((i) => ({
          id: i.id,
          contactId: i.contact_id,
          fullName: i.full_name,
          email: i.email,
          status: i.status,
          error: i.error,
          sentAt: i.sent_at,
        })),
      }),
  );

/** `meeting_progress()`. */
export async function getProgress(client: Client, meetingId: string): Promise<Result<MeetingProgress>> {
  const { data, error } = await client.rpc("meeting_progress", { p_meeting: meetingId });
  return error ? { data: null, error } : { data: dbProgressSchema.parse(data), error: null };
}
```

- [ ] **Step 5: Meeting context** — `src/server/http/meeting-context.ts`:
```ts
import "server-only";
import type { NextResponse } from "next/server";
import { getMeeting } from "@/server/queries/meetings";
import type { Meeting } from "@/shared/api/meetings";
import { apiError, fromDatabaseError } from "./errors";
import { loadWorkspaceContext, type WorkspaceContext } from "./workspace-context";

/** A workspace context plus one of its meetings. */
export type MeetingContext =
  | (Extract<WorkspaceContext, { ok: true }> & { meeting: Meeting })
  | { ok: false; response: NextResponse };

/** Session + membership + a meeting that belongs to this slug's workspace (else 404). */
export async function loadMeetingContext(slug: string, meetingId: string): Promise<MeetingContext> {
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context;
  }
  const { data, error } = await getMeeting(context.supabase, context.workspace.id, meetingId);
  if (error) {
    return { ok: false, response: fromDatabaseError(error) };
  }
  return data ? { ...context, meeting: data } : { ok: false, response: apiError("not_found") };
}
```
Test (`meeting-context.test.ts`): mock `loadWorkspaceContext` (okContext) and `getMeeting` → returns `{ data: null }` → 404; `{ error: { code: "22P02" } }` → 400; found → `ok: true` with the meeting.

- [ ] **Step 6: Test fixtures** — `src/test/fixtures/meetings.ts`:
```ts
import type { Audience, Meeting, MeetingProgress } from "@/shared/api/meetings";

/** Stable UUIDs for meeting tests. */
export const MEETING_IDS = {
  meeting: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f601",
  amira: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f602",
  youssef: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f603",
  lina: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f604",
  members: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f605",
  committee: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f606",
  invitee: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f607",
};

/** A complete draft (Fri 9 Oct 2026, 18:00 Africa/Tunis). */
export const meetingFixture: Meeting = {
  id: MEETING_IDS.meeting,
  title: "Weekly sync",
  agendaMd: "- Recap",
  startsAt: "2026-10-09T17:00:00.000Z",
  durationMinutes: 60,
  timezone: "Africa/Tunis",
  locationMode: "in_person",
  locationText: "Room B12",
  meetingUrl: "",
  responseMode: "attendance",
  responseDeadline: null,
  delayOptions: [5, 10, 15, 30],
  reasonRequired: true,
  commentsEnabled: false,
  footerNote: "",
  status: "draft",
  sentAt: null,
};

/** Members (Amira, Youssef) + Committee (Youssef, Lina — unsubscribed). */
export const audienceFixture: Audience = {
  listIds: [MEETING_IDS.members, MEETING_IDS.committee],
  people: [
    { id: MEETING_IDS.amira, fullName: "Amira B.", email: "amira@uni.tn", listIds: [MEETING_IDS.members], added: false, excluded: false, unsubscribed: false, reported: false, invited: false },
    { id: MEETING_IDS.lina, fullName: "Lina M.", email: "lina@uni.tn", listIds: [MEETING_IDS.committee], added: false, excluded: false, unsubscribed: true, reported: false, invited: false },
    { id: MEETING_IDS.youssef, fullName: "Youssef K.", email: "youssef@uni.tn", listIds: [MEETING_IDS.members, MEETING_IDS.committee], added: false, excluded: false, unsubscribed: false, reported: false, invited: false },
  ],
  counts: { selected: 3, invited: 0, unsubscribed: 1, toInvite: 2 },
  maxInvitees: 500,
};

/** Two invitees, one sent and one queued. */
export const progressFixture: MeetingProgress = {
  counts: { total: 2, queued: 1, sent: 1, skipped: 0, failed: 0, unknown: 0 },
  paused: 0,
  resumesAt: null,
  senderState: "ok",
  invitees: [
    { id: MEETING_IDS.invitee, contactId: MEETING_IDS.amira, fullName: "Amira B.", email: "amira@uni.tn", status: "sent", error: null, sentAt: "2026-10-07T10:00:00.000Z" },
    { id: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f608", contactId: MEETING_IDS.youssef, fullName: "Youssef K.", email: "youssef@uni.tn", status: "queued", error: null, sentAt: null },
  ],
};
```

- [ ] **Step 7: Failing route tests** — one `route.test.ts` per route, in the style of `src/app/api/workspaces/[slug]/lists/route.test.ts` (mock `loadWorkspaceContext` / `loadMeetingContext` and the query module). The cases each file must cover:
  - `meetings/route.test.ts`: `GET` returns the list; `POST` returns `{ id }`, maps `tn:rate_limited` to 429, refuses Viewers (403) and cross-origin (403).
  - `[id]/route.test.ts`: `GET` returns the meeting; `GET` for a meeting of another workspace → 404 (context mock returns `{ ok: false, response: apiError("not_found") }`); `PATCH` with `{ title: " X " }` calls `updateMeeting(…, { title: "X" })` and returns the meeting; `PATCH` when `updateMeeting` returns `data: null` on a scheduled meeting → 409 `meeting_not_draft`; invalid body → 400; `DELETE` draft → `{ ok: true }`; `DELETE` of a scheduled meeting → 409 `meeting_not_draft`.
  - `[id]/audience/route.test.ts`: `GET` → audience; `PUT` calls `setAudience` then returns the fresh `getAudience`; `tn:not_found` from `setAudience` → 404; Viewer → 403.
  - `[id]/people/route.test.ts`: `POST` normalizes and forwards; 51 rows → 400; `tn:contacts_limit_reached` → 409.
  - `[id]/preview/route.test.ts`: renders subject `"Weekly sync · Fri 9 Oct, 18:00"`, `fromName` = workspace name, `fromEmail` = sender email or `null` when none, `recipientName` = first person to invite (`"Amira B."` from `audienceFixture`), and HTML whose answer links point at `#` (no live token).
  - `[id]/send/route.test.ts`: success returns `{ invited, skippedUnsubscribed }` and calls `scheduleDispatch` once; `tn:sender_not_connected` → 409 without scheduling; Viewer → 403.
  - `[id]/progress/route.test.ts`: returns the progress.


  The two context mocks every file uses:
```ts
// top of each [id]/* test file
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError } from "@/server/http/errors";
import { audienceFixture, meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { jsonRequest, okContext, viewerContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ context: { value: null as object | null } }));
vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () => mocks.context.value ?? { ...okContext, meeting: meetingFixture },
}));
const ctx = { params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }) };
```
  `[id]/route.test.ts`:
```ts
const queries = vi.hoisted(() => ({ updateMeeting: vi.fn(), deleteMeeting: vi.fn() }));
vi.mock("@/server/queries/meetings", () => queries);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("/api/workspaces/[slug]/meetings/[id]", () => {
  it("returns the meeting, and 404 when it belongs to another workspace", async () => {
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(meetingFixture);
    mocks.context.value = { ok: false, response: apiError("not_found") };
    expect((await GET(jsonRequest("GET"), ctx)).status).toBe(404);
  });

  it("saves a trimmed title on a draft and refuses sent meetings and Viewers", async () => {
    queries.updateMeeting.mockResolvedValueOnce({ data: { ...meetingFixture, title: "X" }, error: null });
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest("PATCH", { title: " X " }), ctx);
    expect((await response.json()).title).toBe("X");
    expect(queries.updateMeeting).toHaveBeenCalledWith({}, "w1", MEETING_IDS.meeting, { title: "X" });
    mocks.context.value = { ...okContext, meeting: { ...meetingFixture, status: "scheduled" } };
    expect(await (await PATCH(jsonRequest("PATCH", { title: "Y" }), ctx)).json()).toEqual({ error: { code: "meeting_not_draft" } });
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await PATCH(jsonRequest("PATCH", { title: "Y" }), ctx)).status).toBe(403);
    mocks.context.value = null;
    expect((await PATCH(jsonRequest("PATCH", { meetingUrl: "javascript:x" }), ctx)).status).toBe(400);
  });

  it("deletes drafts only", async () => {
    queries.deleteMeeting.mockResolvedValueOnce({ data: true, error: null });
    const { DELETE } = await import("./route");
    expect(await (await DELETE(jsonRequest("DELETE"), ctx)).json()).toEqual({ ok: true });
    mocks.context.value = { ...okContext, meeting: { ...meetingFixture, status: "scheduled" } };
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(409);
  });
});
```
  `[id]/send/route.test.ts`:
```ts
const queries = vi.hoisted(() => ({ sendMeeting: vi.fn(), schedule: vi.fn() }));
vi.mock("@/server/queries/meetings", () => ({ sendMeeting: queries.sendMeeting }));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({ scheduleDispatch: queries.schedule }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("POST …/meetings/[id]/send", () => {
  it("sends and starts a dispatch", async () => {
    queries.sendMeeting.mockResolvedValueOnce({ data: { invited: 27, skippedUnsubscribed: 1 }, error: null });
    const { POST } = await import("./route");
    expect(await (await POST(jsonRequest("POST", {}), ctx)).json()).toEqual({ invited: 27, skippedUnsubscribed: 1 });
    expect(queries.schedule).toHaveBeenCalledTimes(1);
  });

  it("names a missing sender and does not dispatch; refuses Viewers", async () => {
    queries.sendMeeting.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "tn:sender_not_connected" } });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", {}), ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "sender_not_connected" } });
    expect(queries.schedule).not.toHaveBeenCalled();
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(403);
  });
});
```
  `[id]/preview/route.test.ts`:
```ts
const queries = vi.hoisted(() => ({ getAudience: vi.fn(), getWorkspaceSender: vi.fn() }));
vi.mock("@/server/queries/meetings", () => ({ getAudience: queries.getAudience }));
vi.mock("@/server/queries/sender", () => ({ getWorkspaceSender: queries.getWorkspaceSender }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
  queries.getAudience.mockResolvedValue({ data: audienceFixture, error: null });
});

describe("GET …/meetings/[id]/preview", () => {
  it("renders the invite for the first person to invite, with inert links", async () => {
    queries.getWorkspaceSender.mockResolvedValue({
      data: { sender: { email: "club@gmail.com" }, ownerName: "Daly", myConnections: [] },
      error: null,
    });
    const { GET } = await import("./route");
    const preview = await (await GET(jsonRequest("GET"), ctx)).json();
    expect(preview).toMatchObject({
      subject: "Weekly sync · Fri 9 Oct, 18:00",
      fromName: "Robotics Club",
      fromEmail: "club@gmail.com",
      recipientName: "Amira B.",
    });
    expect(preview.html).toContain('href="#?choice=attending"');
    expect(preview.html).not.toContain("/r/");
  });

  it("works without a sender", async () => {
    queries.getWorkspaceSender.mockResolvedValue({ data: { sender: null, ownerName: "Daly", myConnections: [] }, error: null });
    const { GET } = await import("./route");
    expect((await (await GET(jsonRequest("GET"), ctx)).json()).fromEmail).toBeNull();
  });
});
```
  `[id]/audience/route.test.ts`:
```ts
const queries = vi.hoisted(() => ({ getAudience: vi.fn(), setAudience: vi.fn() }));
vi.mock("@/server/queries/meetings", () => queries);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
  queries.getAudience.mockResolvedValue({ data: audienceFixture, error: null });
});

describe("…/meetings/[id]/audience", () => {
  it("replaces the audience and returns the fresh one", async () => {
    queries.setAudience.mockResolvedValueOnce({ error: null });
    const { PUT } = await import("./route");
    const body = { listIds: [MEETING_IDS.members], include: [], exclude: [MEETING_IDS.lina] };
    expect(await (await PUT(jsonRequest("PUT", body), ctx)).json()).toEqual(audienceFixture);
    expect(queries.setAudience).toHaveBeenCalledWith({}, MEETING_IDS.meeting, body);
  });

  it("maps a foreign id to 404 and refuses Viewers", async () => {
    queries.setAudience.mockResolvedValueOnce({ error: { code: "P0001", message: "tn:not_found" } });
    const { PUT } = await import("./route");
    expect((await PUT(jsonRequest("PUT", { listIds: [], include: [], exclude: [] }), ctx)).status).toBe(404);
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await PUT(jsonRequest("PUT", { listIds: [], include: [], exclude: [] }), ctx)).status).toBe(403);
  });
});
```
  `meetings/route.test.ts`, `[id]/people/route.test.ts` and `[id]/progress/route.test.ts` follow the same shape for the cases listed above (the people test posts 51 rows and expects 400; the list test posts with a Viewer context and expects 403 and with `tn:rate_limited` and expects 429).

- [ ] **Step 8: Run to verify failure, then implement the routes** — every handler follows the existing order (Origin → context → Viewer → body → query → errors). The two non-obvious ones in full:

`src/app/api/workspaces/[slug]/meetings/[id]/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { deleteMeeting, updateMeeting } from "@/server/queries/meetings";
import { updateMeetingBodySchema } from "@/shared/api/meetings";

type Ctx = RouteContext<"/api/workspaces/[slug]/meetings/[id]">;

/** One meeting (any member). */
export async function GET(_request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  return context.ok ? NextResponse.json(context.meeting) : context.response;
}

/** Saves one wizard step on a draft (spec §7.2: every step change saves). */
export async function PATCH(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  if (context.meeting.status !== "draft") {
    return apiError("meeting_not_draft");
  }
  const body = await parseJsonBody(request, updateMeetingBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await updateMeeting(context.supabase, context.workspace.id, id, body.data);
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? NextResponse.json(data) : apiError("meeting_not_draft");
}

/** Deletes a draft (the UI confirms first). */
export async function DELETE(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  if (context.meeting.status !== "draft") {
    return apiError("meeting_not_draft");
  }
  const { data, error } = await deleteMeeting(context.supabase, context.workspace.id, id);
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? ok() : apiError("meeting_not_draft");
}
```
`src/app/api/workspaces/[slug]/meetings/[id]/preview/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { renderMeetingInviteEmail } from "@/emails/meeting-invite-email";
import { fromDatabaseError } from "@/server/http/errors";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { getAudience } from "@/server/queries/meetings";
import { getWorkspaceSender } from "@/server/queries/sender";

/** Links in the preview go nowhere: it is rendered in a sandboxed frame and carries no token. */
const INERT = "#";

/**
 * The invite exactly as an example recipient would get it (spec §7.2 Review). Needs a start time;
 * before that the Review step shows its own "add a date" hint instead of calling this.
 */
export async function GET(
  _request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/preview">,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const [audience, sender] = await Promise.all([
    getAudience(context.supabase, id),
    getWorkspaceSender(context.supabase, context.workspace.id),
  ]);
  if (audience.error || sender.error) {
    return fromDatabaseError((audience.error ?? sender.error) as { message: string });
  }
  const example =
    audience.data?.people.find((p) => !p.excluded && !p.unsubscribed && !p.invited)?.fullName ?? context.workspace.name;
  const meeting = context.meeting;
  const email = await renderMeetingInviteEmail({
    workspaceName: context.workspace.name,
    recipientName: example,
    senderEmail: sender.data?.sender?.email ?? "",
    meeting: {
      title: meeting.title,
      agendaMd: meeting.agendaMd,
      startsAt: meeting.startsAt ?? new Date().toISOString(),
      durationMinutes: meeting.durationMinutes,
      timezone: meeting.timezone,
      locationMode: meeting.locationMode,
      locationText: meeting.locationText,
      meetingUrl: meeting.meetingUrl,
      responseMode: meeting.responseMode,
      responseDeadline: meeting.responseDeadline,
    },
    links: { respond: INERT, unsubscribe: INERT, report: INERT },
  });
  return NextResponse.json({
    subject: email.subject,
    html: email.html,
    fromName: context.workspace.name,
    fromEmail: sender.data?.sender?.email ?? null,
    recipientName: example,
  });
}
```
(With `respond = "#"`, the buttons link `#?choice=…`, which goes nowhere inside the sandboxed iframe; the preview test asserts `href="#?choice=attending"`.)

`[id]/send/route.ts`: `rejectCrossOrigin` → `loadMeetingContext` → `forbidViewer` → `sendMeeting(context.supabase, id)` → on error `fromDatabaseError(error)`; on success `scheduleDispatch()` then `NextResponse.json(data)`. Also `export const maxDuration = 60;` (the `after()` run inherits it).

`[id]/audience/route.ts`: `GET` → `getAudience`; `PUT` → Origin, context, Viewer, `audienceBodySchema`, `setAudience`, then `getAudience` → JSON.
`[id]/people/route.ts`: `POST` → Origin, context, Viewer, `addPeopleBodySchema`, `addPeople` → `{ contactIds }`; map `23505` to `conflict` is not needed (the function upserts).
`[id]/progress/route.ts`: `GET` → `getProgress`.
`meetings/route.ts`: `GET` → `listMeetings`; `POST` → Origin, workspace context, Viewer, `createMeeting` → `{ id }`.

- [ ] **Step 9: Hooks** — `src/hooks/use-meetings.ts`:
```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROGRESS_POLL_MS } from "@/config/meetings";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import {
  type AddPeopleBody,
  addPeopleResponseSchema,
  type AudienceBody,
  audienceSchema,
  createMeetingResponseSchema,
  type Meeting,
  meetingListSchema,
  meetingSchema,
  previewSchema,
  progressSchema,
  sendResultSchema,
  type UpdateMeetingBody,
} from "@/shared/api/meetings";

const base = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}/meetings`;

/** Query keys. */
export const meetingsQueryKey = (slug: string) => ["meetings", slug] as const;
export const meetingQueryKey = (slug: string, id: string) => ["meeting", slug, id] as const;
export const audienceQueryKey = (slug: string, id: string) => ["meeting-audience", slug, id] as const;
export const progressQueryKey = (slug: string, id: string) => ["meeting-progress", slug, id] as const;
const previewQueryKey = (slug: string, id: string) => ["meeting-preview", slug, id] as const;

/** All meetings (Meetings page). */
export function useMeetings(slug: string) {
  return useQuery({ queryKey: meetingsQueryKey(slug), queryFn: () => apiRequest(base(slug), { schema: meetingListSchema }) });
}

/** One meeting. */
export function useMeeting(slug: string, id: string) {
  return useQuery({
    queryKey: meetingQueryKey(slug, id),
    queryFn: () => apiRequest(`${base(slug)}/${id}`, { schema: meetingSchema }),
  });
}

/** "+": creates a draft and returns its id. */
export function useCreateMeeting(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(base(slug), { method: "POST", body: {}, schema: createMeetingResponseSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: meetingsQueryKey(slug) }),
  });
}

/** Saves one step's fields optimistically; rolls back on failure. */
export function useUpdateMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  const key = meetingQueryKey(slug, id);
  return useMutation({
    mutationFn: (patch: UpdateMeetingBody) =>
      apiRequest(`${base(slug)}/${id}`, { method: "PATCH", body: patch, schema: meetingSchema }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Meeting>(key);
      if (previous) {
        queryClient.setQueryData<Meeting>(key, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Meeting>(key, context.previous);
      }
    },
    onSuccess: (meeting) => queryClient.setQueryData<Meeting>(key, meeting),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: meetingsQueryKey(slug) });
      void queryClient.invalidateQueries({ queryKey: previewQueryKey(slug, id) });
    },
  });
}

/** Deletes a draft. */
export function useDeleteMeeting(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest(`${base(slug)}/${id}`, { method: "DELETE", schema: okSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: meetingsQueryKey(slug) }),
  });
}

/** The resolved audience. */
export function useMeetingAudience(slug: string, id: string) {
  return useQuery({
    queryKey: audienceQueryKey(slug, id),
    queryFn: () => apiRequest(`${base(slug)}/${id}/audience`, { schema: audienceSchema }),
  });
}

/** Replaces lists / include / exclude; the response is the new audience. */
export function useSetAudience(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AudienceBody) =>
      apiRequest(`${base(slug)}/${id}/audience`, { method: "PUT", body, schema: audienceSchema }),
    onSuccess: (audience) => {
      queryClient.setQueryData(audienceQueryKey(slug, id), audience);
      void queryClient.invalidateQueries({ queryKey: previewQueryKey(slug, id) });
    },
  });
}

/** "Add people" (several at once). */
export function useAddPeople(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddPeopleBody) =>
      apiRequest(`${base(slug)}/${id}/people`, { method: "POST", body, schema: addPeopleResponseSchema }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: audienceQueryKey(slug, id) });
      void queryClient.invalidateQueries({ queryKey: ["roster", slug] });
    },
  });
}

/** The invite preview (Review step). */
export function useMeetingPreview(slug: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: previewQueryKey(slug, id),
    queryFn: () => apiRequest(`${base(slug)}/${id}/preview`, { schema: previewSchema }),
    enabled,
  });
}

/** Send (or Invite more). */
export function useSendMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(`${base(slug)}/${id}/send`, { method: "POST", body: {}, schema: sendResultSchema }),
    onSettled: () => {
      for (const key of [meetingQueryKey(slug, id), audienceQueryKey(slug, id), progressQueryKey(slug, id), meetingsQueryKey(slug)]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Live progress; polls every 3 s while anything is queued (spec §7.2). */
export function useMeetingProgress(slug: string, id: string, enabled = true) {
  return useQuery({
    queryKey: progressQueryKey(slug, id),
    queryFn: () => apiRequest(`${base(slug)}/${id}/progress`, { schema: progressSchema }),
    enabled,
    refetchInterval: (query) => ((query.state.data?.counts.queued ?? 0) > 0 ? PROGRESS_POLL_MS : false),
  });
}
```
(The roster key literal `["roster", slug]` matches `rosterQueryKey` in `src/hooks/use-roster.ts`; import and use `rosterQueryKey` instead of the literal.)

- [ ] **Step 10: Run, spec line, commit** — `bun run test src/app/api/workspaces src/shared src/server/http && bun run lint && bun run typecheck` → PASS. Update spec §10's Meetings API line (send also does Invite more; no `/invitees`). Commit `feat(api): meetings, audience, preview, send and progress routes`, PR, merge.

---

### Task 12: UI primitives — DatePicker, TimePicker, MarkdownEditor, ConfirmDialog

**Labels:** `area:ui`

**Files:**
- Create: `src/components/ui/date-picker.tsx` (+ test), `src/components/ui/time-picker.tsx` (+ test), `src/components/ui/markdown-editor.tsx` (+ test), `src/components/forms/confirm-dialog.tsx` (+ test), `src/lib/meetings/time-input.ts` (+ test), `src/lib/markdown/editor-actions.ts` (+ test)
- Modify: `package.json` / `bun.lock` (`react-day-picker`), `src/components/ui/textarea.tsx` (`ref` prop), `src/app/design/design-showcase.tsx` (+ its test), `messages/en.json` (`Pickers`, `MarkdownEditor`, `Design` keys), `src/config/meetings.ts`

**Interfaces:**
- Consumes: `Popover*`, `Command*`, `Button`, `SegmentedControl`, `Textarea`, `Dialog*` (`src/components/ui/*`); Task 8 `renderAgendaHtml`.
- Produces:
  - `src/config/meetings.ts`: `TIME_STEP_MINUTES = 15`.
  - `parseTypedTime(input: string): string | null` — `"1830"`, `"18:30"`, `"18.30"`, `"9"`, `"930"`, `"6:30 pm"` → `"HH:mm"`; anything invalid → null. `timeOptions(stepMinutes: number): string[]` (`"00:00"` … `"23:45"`).
  - `applyMarkdownAction(text: string, start: number, end: number, action: MarkdownAction): { text: string; start: number; end: number }` with `MarkdownAction = "bold" | "italic" | "list" | "link"`.
  - `<DatePicker id label value onChange today min? error? />` — `value: string | null` (`yyyy-MM-dd` wall date), `onChange(date: string)`, `today: string` (`yyyy-MM-dd` in the meeting's zone; highlighted), `min?: string` (earlier days disabled). Trigger shows `"Fri 9 Oct 2026"` or "Pick a date"; Monday-first month grid in a popover; closes on pick.
  - `<TimePicker id label value onChange error? />` — `value: string | null` (`HH:mm`); list in 15-minute steps; typing jumps (`1830` → 18:30, and an exact typed time not on the list is offered as "Use 18:20").
  - `<MarkdownEditor id label value onChange onBlur? hint? maxLength />` — Write / Preview; toolbar Bold, Italic, List, Link (44 px each); Preview renders `renderAgendaHtml`.
  - `<ConfirmDialog open onOpenChange title description? confirmLabel tone? pending? onConfirm children? />` — `tone: "primary" | "danger"` (default `"primary"`); Cancel + confirm buttons of one height; confirm disabled while `pending`. Used by every important action (Global Constraints).
  - `Textarea` accepts `ref` (React 19 prop), like `Input`.

Everything follows the existing primitives: tokens only (`border-outline`, `shadow-brutal-sm`, `rounded-control`, fills), 44 px targets, popovers with `p-1.5` inner padding and `collisionPadding={16}` (default), reduced-motion fallbacks.

- [ ] **Step 1: Install** — `bun add react-day-picker@10.0.2` (v10 also publishes `@daypicker/react`, a wrapper that depends on this same package; the original name stays supported per the v10 upgrade guide). Do **not** import its stylesheet: all styling comes from `classNames` with our tokens.

- [ ] **Step 2: Failing pure-function tests** — `src/lib/meetings/time-input.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseTypedTime, timeOptions } from "./time-input";

describe("parseTypedTime", () => {
  it.each([
    ["1830", "18:30"],
    ["18:30", "18:30"],
    ["18.30", "18:30"],
    ["9", "09:00"],
    ["930", "09:30"],
    ["0905", "09:05"],
    ["6:30 pm", "18:30"],
    ["12am", "00:00"],
    ["12 pm", "12:00"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseTypedTime(input)).toBe(expected);
  });

  it.each(["", "25:00", "1860", "abc", "7:5", "13pm"])("rejects %s", (input) => {
    expect(parseTypedTime(input)).toBeNull();
  });
});

describe("timeOptions", () => {
  it("lists the day in steps", () => {
    const options = timeOptions(15);
    expect(options).toHaveLength(96);
    expect(options.slice(0, 2)).toEqual(["00:00", "00:15"]);
    expect(options.at(-1)).toBe("23:45");
  });
});
```
`src/lib/markdown/editor-actions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { applyMarkdownAction } from "./editor-actions";

describe("applyMarkdownAction", () => {
  it("wraps the selection in bold or italic and keeps it selected", () => {
    expect(applyMarkdownAction("Hackathon teams", 0, 9, "bold")).toEqual({ text: "**Hackathon** teams", start: 2, end: 11 });
    expect(applyMarkdownAction("soon", 0, 4, "italic")).toEqual({ text: "*soon*", start: 1, end: 5 });
  });

  it("inserts a placeholder when nothing is selected", () => {
    expect(applyMarkdownAction("", 0, 0, "bold")).toEqual({ text: "**bold**", start: 2, end: 6 });
  });

  it("turns the selected lines into a list", () => {
    expect(applyMarkdownAction("Recap\nTeams", 0, 11, "list")).toEqual({ text: "- Recap\n- Teams", start: 0, end: 15 });
  });

  it("makes a link with the URL part selected", () => {
    expect(applyMarkdownAction("Slides", 0, 6, "link")).toEqual({ text: "[Slides](https://)", start: 9, end: 17 });
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement** — append `export const TIME_STEP_MINUTES = 15;` (JSDoc: "Time list step in the TimePicker") to `src/config/meetings.ts`. `src/lib/meetings/time-input.ts`:
```ts
const pad = (value: number) => String(value).padStart(2, "0");

/** Every time of day in `stepMinutes` steps ("00:00" … "23:45" for 15). */
export function timeOptions(stepMinutes: number): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    options.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }
  return options;
}

const TYPED = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/i;

/** Reads what people type into the time field ("1830", "18:30", "6:30 pm"); null when not a time. */
export function parseTypedTime(input: string): string | null {
  const match = TYPED.exec(input.trim());
  if (!match) {
    return null;
  }
  const [, rawHours, rawMinutes, meridiem] = match;
  let hours = Number(rawHours);
  const minutes = rawMinutes === undefined ? 0 : Number(rawMinutes);
  if (rawMinutes === undefined && rawHours.length > 2) {
    return null;
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    hours = (hours % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}
```
`"930"` and `"1830"` are 3–4 digits without a separator: the regex reads them as `(\d{1,2})(\d{2})` (`9`+`30`, `18`+`30`) because the separator group is optional; `"7:5"` fails the two-digit minutes. Run → PASS; adjust the regex only if a listed case fails.

`src/lib/markdown/editor-actions.ts`:
```ts
/** The agenda toolbar's buttons. */
export type MarkdownAction = "bold" | "italic" | "list" | "link";

const WRAP: Record<"bold" | "italic", { mark: string; placeholder: string }> = {
  bold: { mark: "**", placeholder: "bold" },
  italic: { mark: "*", placeholder: "italic" },
};

/** Applies one toolbar action to the text and returns the new text and selection. */
export function applyMarkdownAction(
  text: string,
  start: number,
  end: number,
  action: MarkdownAction,
): { text: string; start: number; end: number } {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  if (action === "bold" || action === "italic") {
    const { mark, placeholder } = WRAP[action];
    const inner = selected || placeholder;
    return { text: `${before}${mark}${inner}${mark}${after}`, start: start + mark.length, end: start + mark.length + inner.length };
  }
  if (action === "link") {
    const label = selected || "link";
    const url = "https://";
    const urlStart = start + label.length + 3;
    return { text: `${before}[${label}](${url})${after}`, start: urlStart, end: urlStart + url.length };
  }
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const block = text.slice(lineStart, end);
  const listed = block
    .split("\n")
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
  return { text: `${text.slice(0, lineStart)}${listed}${after}`, start: lineStart, end: lineStart + listed.length };
}
```
Run → PASS.

- [ ] **Step 4: Messages** — add to `messages/en.json`:
```json
"Pickers": {
  "pickDate": "Pick a date",
  "pickTime": "Pick a time",
  "previousMonth": "Previous month",
  "nextMonth": "Next month",
  "timeSearch": "Type a time, e.g. 1830",
  "useTime": "Use {time}",
  "noTime": "Not a time. Try 1830 or 6:30 pm."
},
"MarkdownEditor": {
  "write": "Write",
  "preview": "Preview",
  "bold": "Bold",
  "italic": "Italic",
  "list": "Bulleted list",
  "link": "Link",
  "empty": "Nothing to preview yet."
}
```
and under `Design`: `"pickers": "Date and time"`, `"markdown": "Markdown editor"`, `"confirm": "Confirm dialog"`, `"confirmOpen": "Open confirm"`, `"confirmTitle": "Send 30 invites from club@gmail.com now?"`, `"confirmAction": "Send 30 invites"`.

- [ ] **Step 5: Failing component tests** — `src/components/ui/date-picker.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { DatePicker } from "./date-picker";

describe("DatePicker", () => {
  it("opens a month grid, picks a day as yyyy-MM-dd and closes", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <DatePicker id="d" label="Date" value="2026-10-07" today="2026-10-07" min="2026-10-07" onChange={onChange} />,
    );
    const trigger = screen.getByRole("button", { name: /Date.*Wed 7 Oct 2026/ });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: /9 October 2026/i }));
    expect(onChange).toHaveBeenCalledWith("2026-10-09");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("disables days before the minimum and shows a placeholder without a value", async () => {
    renderWithProviders(<DatePicker id="d" label="Date" value={null} today="2026-10-07" min="2026-10-07" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Pick a date/ }));
    expect(screen.getByRole("button", { name: /6 October 2026/i })).toBeDisabled();
  });
});
```
(react-day-picker labels day buttons with the full date, e.g. "Friday, October 9th, 2026"; if the accessible name differs, match on `/October 9/` and keep the test about behavior, not wording.)

`src/components/ui/time-picker.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { TimePicker } from "./time-picker";

describe("TimePicker", () => {
  it("picks from the 15-minute list", async () => {
    const onChange = vi.fn();
    renderWithProviders(<TimePicker id="t" label="Time" value="18:00" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Time.*18:00/ }));
    await userEvent.click(screen.getByRole("option", { name: "18:15" }));
    expect(onChange).toHaveBeenCalledWith("18:15");
  });

  it("jumps to a typed time and offers an exact one", async () => {
    const onChange = vi.fn();
    renderWithProviders(<TimePicker id="t" label="Time" value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Pick a time/ }));
    await userEvent.type(screen.getByPlaceholderText("Type a time, e.g. 1830"), "1820");
    await userEvent.click(screen.getByRole("option", { name: "Use 18:20" }));
    expect(onChange).toHaveBeenCalledWith("18:20");
  });
});
```
`src/components/ui/markdown-editor.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { MarkdownEditor } from "./markdown-editor";

function Harness() {
  const [value, setValue] = useState("Hackathon teams");
  return <MarkdownEditor id="agenda" label="Agenda" value={value} onChange={setValue} maxLength={5000} />;
}

describe("MarkdownEditor", () => {
  it("bolds the selection and previews safely", async () => {
    renderWithProviders(<Harness />);
    const area = screen.getByRole("textbox", { name: "Agenda" });
    if (area instanceof HTMLTextAreaElement) {
      area.setSelectionRange(0, 9);
    }
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(area).toHaveValue("**Hackathon** teams");
    await userEvent.click(screen.getByRole("radio", { name: "Preview" }));
    expect(screen.getByText("Hackathon").tagName).toBe("STRONG");
  });
});
```
(Radix ToggleGroup items have role `radio` in single mode; check `segmented-control.test.tsx` for the role it asserts and match it.)

`src/components/forms/confirm-dialog.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("names the consequence and confirms once", async () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <ConfirmDialog open onOpenChange={vi.fn()} title="Send 30 invites from club@gmail.com now?" confirmLabel="Send 30 invites" onConfirm={onConfirm} />,
    );
    expect(screen.getByRole("dialog", { name: "Send 30 invites from club@gmail.com now?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send 30 invites" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables the action while pending and cancels without confirming", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(
      <ConfirmDialog open pending onOpenChange={onOpenChange} title="Disconnect?" confirmLabel="Disconnect" tone="danger" onConfirm={onConfirm} />,
    );
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify failure, then implement the components.**

`src/components/forms/confirm-dialog.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Are you sure?" for important actions (owner rule, spec §4 Confirmations): the title states the
 * consequence ("Send 30 invites from club@gmail.com now?"), the button repeats the action.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "primary",
  pending = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("Common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button tone={tone} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
`src/components/ui/date-picker.tsx`:
```tsx
"use client";

import { CaretLeft, CaretRight, CalendarBlank } from "@phosphor-icons/react";
import { format, parse } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const WALL = "yyyy-MM-dd";
const toDate = (value: string) => parse(value, WALL, new Date(0));

/** Date of a meeting as a wall date in its zone (spec §7.2 Details). No browser-native picker. */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  today,
  min,
  error,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (date: string) => void;
  today: string;
  min?: string;
  error?: string;
}) {
  const t = useTranslations("Pickers");
  const [open, setOpen] = useState(false);
  const selected = value ? toDate(value) : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-bold text-ink">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-labelledby={`${id}-label ${id}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(buttonVariants({ tone: "surface" }), "w-full justify-start shadow-brutal-sm aria-invalid:bg-fill-danger")}
          >
            <CalendarBlank weight="bold" aria-hidden />
            {selected ? format(selected, "EEE d MMM yyyy") : <span className="text-muted-ink">{t("pickDate")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1.5">
          <DayPicker
            mode="single"
            weekStartsOn={1}
            selected={selected}
            defaultMonth={selected ?? toDate(today)}
            today={toDate(today)}
            disabled={min ? { before: toDate(min) } : undefined}
            onSelect={(day) => {
              if (day) {
                onChange(format(day, WALL));
                setOpen(false);
              }
            }}
            labels={{ labelPrevious: () => t("previousMonth"), labelNext: () => t("nextMonth") }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === "left" ? <CaretLeft weight="bold" aria-hidden /> : <CaretRight weight="bold" aria-hidden />,
            }}
            classNames={{
              root: "text-ink",
              months: "relative",
              month_caption: "flex h-11 items-center justify-center font-display",
              nav: "absolute inset-x-0 top-0 flex justify-between",
              button_previous: "inline-flex size-11 items-center justify-center rounded-control",
              button_next: "inline-flex size-11 items-center justify-center rounded-control",
              month_grid: "border-collapse",
              weekday: "size-11 text-xs font-bold text-muted-ink",
              day: "p-0 text-center",
              day_button: "size-11 rounded-control text-sm font-bold transition-transform active:translate-y-0.5 motion-reduce:transition-none",
              selected: "[&>button]:border-[length:var(--tn-border-width)] [&>button]:border-outline [&>button]:bg-fill-primary [&>button]:text-on-fill [&>button]:shadow-brutal-sm",
              today: "[&>button]:outline-2 [&>button]:outline-dashed [&>button]:outline-outline",
              disabled: "[&>button]:text-muted-ink [&>button]:opacity-50",
              outside: "[&>button]:text-muted-ink",
            }}
          />
        </PopoverContent>
      </Popover>
      {error ? (
        <p id={errorId} className="text-sm font-bold text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```
Read `node_modules/react-day-picker/dist/esm/UI.d.ts` (or the README) for the exact `classNames` keys and the `Chevron` / `labels` prop shapes in v10, and adjust names that differ before running the test.

`src/components/ui/time-picker.tsx`:
```tsx
"use client";

import { Clock } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { TIME_STEP_MINUTES } from "@/config/meetings";
import { parseTypedTime, timeOptions } from "@/lib/meetings/time-input";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** Meeting time (spec §7.2 Details): a 15-minute list you can type into ("1830" jumps). */
export function TimePicker({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (time: string) => void;
  error?: string;
}) {
  const t = useTranslations("Pickers");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const options = useMemo(() => timeOptions(TIME_STEP_MINUTES), []);
  const typed = parseTypedTime(search);
  const visible = typed ? options.filter((option) => option.startsWith(typed.slice(0, 2))) : options;
  const offerTyped = typed !== null && !options.includes(typed);
  const choose = (time: string) => {
    onChange(time);
    setSearch("");
    setOpen(false);
  };
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-bold text-ink">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-labelledby={`${id}-label ${id}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(buttonVariants({ tone: "surface" }), "w-full justify-start shadow-brutal-sm aria-invalid:bg-fill-danger")}
          >
            <Clock weight="bold" aria-hidden />
            {value ?? <span className="text-muted-ink">{t("pickTime")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1.5">
          <Command shouldFilter={false} value={typed ?? value ?? undefined}>
            <CommandInput placeholder={t("timeSearch")} value={search} onValueChange={setSearch} inputMode="numeric" />
            <CommandList className="max-h-64">
              {search && typed === null ? <CommandEmpty>{t("noTime")}</CommandEmpty> : null}
              {offerTyped && typed ? (
                <CommandItem value={`use-${typed}`} onSelect={() => choose(typed)}>
                  {t("useTime", { time: typed })}
                </CommandItem>
              ) : null}
              {visible.map((option) => (
                <CommandItem key={option} value={option} onSelect={() => choose(option)}>
                  {option}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? (
        <p id={errorId} className="text-sm font-bold text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```
When the popover opens with a value, scroll that option into view: give `CommandItem` a `data-time` attribute and, in an effect on `open`, call `scrollIntoView({ block: "center" })` on `[data-time="<value>"]` (the jsdom stub for `scrollIntoView` already exists in `vitest.setup.ts`).

`src/components/ui/textarea.tsx`: add `ref?: Ref<HTMLTextAreaElement>` to `TextareaProps` (import `type Ref` from "react"), passed through to `<textarea>` like `Input` does.

`src/components/ui/markdown-editor.tsx`:
```tsx
"use client";

import { LinkSimple, ListBullets, TextB, TextItalic, type Icon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { applyMarkdownAction, type MarkdownAction } from "@/lib/markdown/editor-actions";
import { renderAgendaHtml } from "@/lib/markdown/agenda";
import { Button } from "./button";
import { SegmentedControl } from "./segmented-control";
import { Textarea } from "./textarea";

const TOOLS: ReadonlyArray<{ action: MarkdownAction; icon: Icon; label: "bold" | "italic" | "list" | "link" }> = [
  { action: "bold", icon: TextB, label: "bold" },
  { action: "italic", icon: TextItalic, label: "italic" },
  { action: "list", icon: ListBullets, label: "list" },
  { action: "link", icon: LinkSimple, label: "link" },
];

/** Agenda editor (spec §7.2 Details): Markdown with a small toolbar and a safe preview. */
export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  onBlur,
  hint,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  hint?: string;
  maxLength: number;
}) {
  const t = useTranslations("MarkdownEditor");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const area = useRef<HTMLTextAreaElement>(null);
  const apply = (action: MarkdownAction) => {
    const element = area.current;
    const next = applyMarkdownAction(value, element?.selectionStart ?? value.length, element?.selectionEnd ?? value.length, action);
    onChange(next.text.slice(0, maxLength));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.start, next.end);
    });
  };
  const html = renderAgendaHtml(value);
  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl
        label={label}
        value={mode}
        onValueChange={(next) => setMode(next === "preview" ? "preview" : "write")}
        options={[
          { value: "write", label: t("write") },
          { value: "preview", label: t("preview") },
        ]}
      />
      {mode === "write" ? (
        <>
          <div className="flex gap-2">
            {TOOLS.map(({ action, icon: Glyph, label: key }) => (
              <Button key={action} aria-label={t(key)} className="size-11 justify-center px-0" onClick={() => apply(action)}>
                <Glyph weight="bold" aria-hidden />
              </Button>
            ))}
          </div>
          <Textarea
            ref={area}
            id={id}
            label={label}
            hint={hint}
            value={value}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
          />
        </>
      ) : html ? (
        // renderAgendaHtml escapes raw HTML and keeps only http(s)/mailto links, so this is safe.
        <div className="agenda-preview rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface p-3 text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-sm text-muted-ink">{t("empty")}</p>
      )}
    </div>
  );
}
```
Add minimal `.agenda-preview` styles (`ul` disc + left padding, `ol` decimal, `a` underline + bold, `p` margin) to `src/app/globals.css` with tokens only; Tailwind's preflight removes list markers.

- [ ] **Step 7: Design showcase** — add a "Date and time" card (DatePicker + TimePicker with local state), a "Markdown editor" card and a "Confirm dialog" card (a button that opens `ConfirmDialog` with the `Design.confirmTitle` text) to `src/app/design/design-showcase.tsx`; extend its test to assert the three headings render. The design-system e2e already checks 44 px targets on `/design`.

- [ ] **Step 8: Verify** — `bun run test src/components src/lib && bun run lint && bun run typecheck` → PASS. With `bun run dev` (then stop it), screenshot `/design` at 390 px light, 320 px dark and 1024 px with the date and time popovers open; check: popover inner padding, today ring, selected day fill, the time list scrolled to the value, no horizontal scroll at 320 px. Look at the screenshots before committing.

- [ ] **Step 9: Commit, PR, merge** — `feat(ui): date and time pickers, Markdown editor and confirm dialog`.

---

### Task 13: Wizard shell, Details + Responses steps, Meetings list, "+"

**Labels:** `area:ui`

**Files:**
- Create: `src/lib/meetings/partition.ts` (+ test), `src/app/w/[slug]/meetings/meetings-list.tsx` (+ test), `src/app/w/[slug]/meetings/draft-menu.tsx` (+ test), `src/app/w/[slug]/meetings/new/page.tsx` (+ test), `src/app/w/[slug]/meetings/[id]/edit/page.tsx`, `…/edit/wizard-steps.ts` (+ test), `…/edit/wizard-shell.tsx` (+ test), `…/edit/wizard-footer.tsx`, `…/edit/details-form.ts` (+ test), `…/edit/details-step.tsx` (+ test), `…/edit/responses-form.ts` (+ test), `…/edit/responses-step.tsx` (+ test), `…/edit/audience-step.tsx` and `…/edit/review-step.tsx` (placeholders replaced by Tasks 14 and 15)
- Modify: `src/app/w/[slug]/meetings/page.tsx`, `src/components/shell/nav-items.ts` (+ test), `src/components/shell/bottom-bar.tsx` (+ test), `messages/en.json` (`Meetings`, `Wizard`)

**Interfaces:**
- Consumes: Task 11 hooks and schemas; Task 12 `DatePicker`, `TimePicker`, `MarkdownEditor`; Task 8 `formatMeetingWhen`, `zonedWallTimeToUtc`, `utcToZonedParts`; Task 4 `DELAY_OPTION_CHOICES`, `DELAY_OPTIONS_MAX`, `DURATION_CHOICES`; M2 `TimezonePicker`, `useWorkspace`, `SegmentedControl`, `Chip`, `Switch`, `Input`.
- Produces:
  - `partitionMeetings(meetings: MeetingSummary[], now: Date): { upcoming; drafts; past }` — drafts = `draft` with a title or a date (untitled, undated drafts are hidden; housekeeping deletes them after 24 h); upcoming = `scheduled` and end time after `now` (soonest first); past = the rest (latest first).
  - `navItemsFor(role, slug, meetingsEnabled: boolean)` — "+" `enabled` only when the flag is on (Viewers still never see it).
  - Route `/w/[slug]/meetings/new`: creates a draft once and replaces the URL with `/w/[slug]/meetings/<id>/edit?step=details`.
  - Wizard steps: `WIZARD_STEPS = ["details", "audience", "responses", "review"]` for drafts; `INVITE_MORE_STEPS = ["audience", "review"]` for scheduled meetings; `stepsFor(status)`, `resolveStep(param: string | null, steps)`.
  - `WizardStepProps = { slug: string; meeting: Meeting; workspace: WorkspaceDetails; goTo: (step: WizardStep) => void }` — every step component takes these.
  - `WizardFooter({ onBack?, backLabel, nextLabel, onNext, nextDisabled?, pending? })` — sticky footer, two buttons of one height (`size="lg"`, single-line labels).
  - `validateDetails(values: DetailsValues, now: Date): DetailsErrors` and `detailsPatch(values): UpdateMeetingBody`; `validateResponses(values: ResponsesValues, startsAt: string | null, now: Date): ResponsesErrors` and `responsesPatch(values): UpdateMeetingBody`.

- [ ] **Step 1: Messages** — add to `messages/en.json`:
```json
"Meetings": {
  "title": "Meetings",
  "new": "New meeting",
  "tabs": { "label": "Show", "upcoming": "Upcoming", "drafts": "Drafts", "past": "Past" },
  "untitled": "Untitled draft",
  "noDate": "No date yet",
  "invited": "{count, plural, one {# invited} other {# invited}}",
  "sent": "{sent} of {total} sent",
  "draft": "Draft",
  "empty": {
    "upcoming": "No upcoming meetings.",
    "drafts": "No drafts.",
    "past": "No past meetings."
  },
  "creating": "Creating your draft…",
  "createFailed": "Couldn't create the draft.",
  "retry": "Try again"
},
"Wizard": {
  "stepOf": "Step {current} of {total}",
  "steps": { "details": "Meeting details", "audience": "Who's invited?", "responses": "Answers", "review": "Review and send" },
  "back": "Back",
  "cancel": "Close",
  "next": { "audience": "Next: Audience", "responses": "Next: Answers", "review": "Next: Review" },
  "details": {
    "title": "Title",
    "titlePlaceholder": "Weekly sync",
    "date": "Date",
    "time": "Time",
    "zone": "Time zone: {zone}",
    "changeZone": "Change",
    "zoneLabel": "Meeting time zone",
    "duration": "Duration",
    "durationOther": "Other",
    "durationMinutes": "Minutes",
    "minutes": "{count} min",
    "hours": "{hours} h",
    "hoursMinutes": "{hours} h {minutes}",
    "where": "Where",
    "inPerson": "In person",
    "online": "Online",
    "hybrid": "Both",
    "place": "Place",
    "placePlaceholder": "Room B12",
    "link": "Meeting link",
    "linkPlaceholder": "https://meet.google.com/…",
    "agenda": "Agenda (optional)",
    "agendaHint": "Markdown: **bold**, *italic*, - lists, [links](https://…)"
  },
  "responses": {
    "mode": "How do people answer?",
    "announcement": "No answers",
    "rsvp": "Going / not",
    "attendance": "Going / late / absent",
    "announcementHint": "An announcement: the email has no answer buttons.",
    "delays": "Late by",
    "delaysHint": "Pick up to {max}.",
    "reasonRequired": "Ask for a reason",
    "reasonRequiredRsvp": "Ask for a reason when not going",
    "comments": "Allow a comment",
    "footerNote": "Note under the answer form (optional)",
    "deadline": "Answer deadline",
    "deadlineDate": "Deadline date",
    "deadlineTime": "Deadline time"
  },
  "errors": {
    "titleRequired": "Give the meeting a title.",
    "dateRequired": "Pick a date.",
    "timeRequired": "Pick a time.",
    "inPast": "Pick a time in the future.",
    "placeRequired": "Say where it happens.",
    "linkRequired": "Add the meeting link.",
    "linkInvalid": "Use a link that starts with https://",
    "durationRange": "Between 5 minutes and 12 hours.",
    "delaysRequired": "Pick at least one delay.",
    "deadlineOrder": "The deadline must be before the meeting starts and in the future.",
    "saveFailed": "Couldn't save. Check your connection and try again."
  }
}
```

- [ ] **Step 2: Failing pure tests** — `src/lib/meetings/partition.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { MeetingSummary } from "@/shared/api/meetings";
import { partitionMeetings } from "./partition";

const at = (id: string, status: MeetingSummary["status"], startsAt: string | null, durationMinutes = 60): MeetingSummary => ({
  id,
  title: id,
  startsAt,
  timezone: "Africa/Tunis",
  durationMinutes,
  status,
  locationMode: "in_person",
  invitedCount: 0,
  sentCount: 0,
});

describe("partitionMeetings", () => {
  it("splits drafts, upcoming (soonest first) and past (latest first); a meeting in progress is upcoming", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const result = partitionMeetings(
      [
        at("d", "draft", null),
        { ...at("", "draft", null), id: "empty", title: "" },
        at("later", "scheduled", "2026-10-20T17:00:00Z"),
        at("soon", "scheduled", "2026-10-08T17:00:00Z"),
        at("running", "scheduled", "2026-10-07T11:30:00Z", 60),
        at("old", "scheduled", "2026-10-01T17:00:00Z"),
        at("older", "scheduled", "2026-09-01T17:00:00Z"),
        at("cancelled", "cancelled", "2026-10-10T17:00:00Z"),
      ],
      now,
    );
    expect(result.drafts.map((m) => m.id)).toEqual(["d"]);
    expect(result.upcoming.map((m) => m.id)).toEqual(["running", "soon", "later"]);
    expect(result.past.map((m) => m.id)).toEqual(["cancelled", "old", "older"]);
  });
});
```
`src/app/w/[slug]/meetings/[id]/edit/details-form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { detailsPatch, validateDetails, type DetailsValues } from "./details-form";

const now = new Date("2026-10-07T10:00:00Z");
const valid: DetailsValues = {
  title: "Weekly sync",
  date: "2026-10-09",
  time: "18:00",
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  locationMode: "in_person",
  locationText: "Room B12",
  meetingUrl: "",
  agendaMd: "",
};

describe("validateDetails", () => {
  it("accepts a complete future meeting", () => {
    expect(validateDetails(valid, now)).toEqual({});
  });

  it("names every missing or wrong field", () => {
    expect(validateDetails({ ...valid, title: " ", date: null, time: null }, now)).toEqual({
      title: "titleRequired",
      date: "dateRequired",
      time: "timeRequired",
    });
    expect(validateDetails({ ...valid, date: "2026-10-07", time: "09:00" }, now)).toEqual({ time: "inPast" });
    expect(validateDetails({ ...valid, locationMode: "hybrid", locationText: "", meetingUrl: "meet.example" }, now)).toEqual({
      locationText: "placeRequired",
      meetingUrl: "linkInvalid",
    });
    expect(validateDetails({ ...valid, locationMode: "online", meetingUrl: "" }, now)).toEqual({ meetingUrl: "linkRequired" });
    expect(validateDetails({ ...valid, durationMinutes: 3 }, now)).toEqual({ durationMinutes: "durationRange" });
  });
});

describe("detailsPatch", () => {
  it("stores the picked wall time as UTC and trims text", () => {
    expect(detailsPatch({ ...valid, title: " Kickoff " })).toMatchObject({
      title: "Kickoff",
      startsAt: "2026-10-09T17:00:00.000Z",
      timezone: "Africa/Tunis",
    });
    expect(detailsPatch({ ...valid, date: null }).startsAt).toBeNull();
  });
});
```
`src/app/w/[slug]/meetings/[id]/edit/responses-form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { responsesPatch, validateResponses, type ResponsesValues } from "./responses-form";

const now = new Date("2026-10-07T10:00:00Z");
const startsAt = "2026-10-09T17:00:00.000Z";
const base: ResponsesValues = {
  responseMode: "attendance",
  delayOptions: [5, 10],
  reasonRequired: true,
  commentsEnabled: false,
  footerNote: "",
  deadlineEnabled: false,
  deadlineDate: null,
  deadlineTime: null,
  timezone: "Africa/Tunis",
};

describe("validateResponses", () => {
  it("needs a delay in attendance mode only", () => {
    expect(validateResponses({ ...base, delayOptions: [] }, startsAt, now)).toEqual({ delayOptions: "delaysRequired" });
    expect(validateResponses({ ...base, responseMode: "rsvp", delayOptions: [] }, startsAt, now)).toEqual({});
  });

  it("keeps the deadline before the start and in the future", () => {
    expect(validateResponses({ ...base, deadlineEnabled: true, deadlineDate: "2026-10-09", deadlineTime: "19:00" }, startsAt, now)).toEqual({
      deadline: "deadlineOrder",
    });
    expect(validateResponses({ ...base, deadlineEnabled: true, deadlineDate: "2026-10-09", deadlineTime: "12:00" }, startsAt, now)).toEqual({});
  });
});

describe("responsesPatch", () => {
  it("clears the deadline when it is off and keeps delays only for attendance", () => {
    expect(responsesPatch({ ...base, responseMode: "rsvp" })).toMatchObject({ responseMode: "rsvp", responseDeadline: null, delayOptions: [] });
    expect(responsesPatch({ ...base, deadlineEnabled: true, deadlineDate: "2026-10-09", deadlineTime: "12:00" }).responseDeadline).toBe(
      "2026-10-09T11:00:00.000Z",
    );
  });
});
```
`src/app/w/[slug]/meetings/[id]/edit/wizard-steps.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { INVITE_MORE_STEPS, WIZARD_STEPS, resolveStep, stepsFor } from "./wizard-steps";

describe("wizard steps", () => {
  it("uses all four steps for drafts and two for Invite more", () => {
    expect(stepsFor("draft")).toBe(WIZARD_STEPS);
    expect(stepsFor("scheduled")).toBe(INVITE_MORE_STEPS);
  });

  it("falls back to the first step for unknown or unavailable steps", () => {
    expect(resolveStep("responses", WIZARD_STEPS)).toBe("responses");
    expect(resolveStep("details", INVITE_MORE_STEPS)).toBe("audience");
    expect(resolveStep(null, WIZARD_STEPS)).toBe("details");
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement the pure modules.**

`src/lib/meetings/partition.ts`:
```ts
import { addMinutes, isAfter } from "date-fns";
import type { MeetingSummary } from "@/shared/api/meetings";

const startOf = (m: MeetingSummary) => (m.startsAt ? new Date(m.startsAt).getTime() : 0);

/** Meetings page tabs (spec §10): Drafts, Upcoming (soonest first, including one in progress), Past. */
export function partitionMeetings(meetings: MeetingSummary[], now: Date) {
  // An untitled, undated draft is a "+" tap that went nowhere; housekeeping deletes it after 24 h.
  const drafts = meetings.filter((m) => m.status === "draft" && (m.title !== "" || m.startsAt !== null));
  const upcoming = meetings
    .filter((m) => m.status === "scheduled" && m.startsAt && isAfter(addMinutes(new Date(m.startsAt), m.durationMinutes), now))
    .sort((a, b) => startOf(a) - startOf(b));
  const past = meetings
    .filter((m) => m.status !== "draft" && !upcoming.includes(m))
    .sort((a, b) => startOf(b) - startOf(a));
  return { drafts, upcoming, past };
}
```
`src/app/w/[slug]/meetings/[id]/edit/wizard-steps.ts`:
```ts
import type { Meeting } from "@/shared/api/meetings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Draft wizard (spec §7.2). */
export const WIZARD_STEPS = ["details", "audience", "responses", "review"] as const;
/** "Invite more people" on a sent meeting reuses the Audience and Review steps. */
export const INVITE_MORE_STEPS = ["audience", "review"] as const;

/** One wizard step. */
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Steps available for a meeting's status. */
export function stepsFor(status: Meeting["status"]): readonly WizardStep[] {
  return status === "draft" ? WIZARD_STEPS : INVITE_MORE_STEPS;
}

/** The `?step=` value if it is available, else the first step. */
export function resolveStep(param: string | null, steps: readonly WizardStep[]): WizardStep {
  return steps.find((step) => step === param) ?? steps[0];
}

/** Props every step component receives from the shell. */
export type WizardStepProps = {
  slug: string;
  meeting: Meeting;
  workspace: WorkspaceDetails;
  steps: readonly WizardStep[];
  goTo: (step: WizardStep) => void;
};
```
`src/app/w/[slug]/meetings/[id]/edit/details-form.ts`:
```ts
import { DURATION_MAX, DURATION_MIN } from "@/config/meetings";
import { zonedWallTimeToUtc } from "@/lib/meetings/format";
import type { LocationMode } from "@/shared/api/meeting-settings";
import { meetingUrlSchema, type UpdateMeetingBody } from "@/shared/api/meetings";

/** The Details step's form state (date and time are wall values in `timezone`). */
export type DetailsValues = {
  title: string;
  date: string | null;
  time: string | null;
  timezone: string;
  durationMinutes: number;
  locationMode: LocationMode;
  locationText: string;
  meetingUrl: string;
  agendaMd: string;
};

/** Error keys under `Wizard.errors`, by field. */
export type DetailsErrors = Partial<
  Record<"title" | "date" | "time" | "durationMinutes" | "locationText" | "meetingUrl", string>
>;

/** What blocks "Next" on the Details step (the database re-checks at Send). */
export function validateDetails(values: DetailsValues, now: Date): DetailsErrors {
  const errors: DetailsErrors = {};
  if (!values.title.trim()) {
    errors.title = "titleRequired";
  }
  if (!values.date) {
    errors.date = "dateRequired";
  }
  if (!values.time) {
    errors.time = "timeRequired";
  }
  if (values.date && values.time) {
    const start = zonedWallTimeToUtc({ date: values.date, time: values.time, timezone: values.timezone });
    if (new Date(start) <= now) {
      errors.time = "inPast";
    }
  }
  if (values.durationMinutes < DURATION_MIN || values.durationMinutes > DURATION_MAX) {
    errors.durationMinutes = "durationRange";
  }
  if (values.locationMode !== "online" && !values.locationText.trim()) {
    errors.locationText = "placeRequired";
  }
  if (values.locationMode !== "in_person") {
    if (!values.meetingUrl.trim()) {
      errors.meetingUrl = "linkRequired";
    } else if (!meetingUrlSchema.safeParse(values.meetingUrl.trim()).success) {
      errors.meetingUrl = "linkInvalid";
    }
  }
  return errors;
}

/** The PATCH body for the Details step. */
export function detailsPatch(values: DetailsValues): UpdateMeetingBody {
  return {
    title: values.title.trim(),
    startsAt:
      values.date && values.time
        ? zonedWallTimeToUtc({ date: values.date, time: values.time, timezone: values.timezone })
        : null,
    timezone: values.timezone,
    durationMinutes: values.durationMinutes,
    locationMode: values.locationMode,
    locationText: values.locationText.trim(),
    meetingUrl: values.meetingUrl.trim(),
    agendaMd: values.agendaMd,
  };
}
```
`src/app/w/[slug]/meetings/[id]/edit/responses-form.ts`:
```ts
import { zonedWallTimeToUtc } from "@/lib/meetings/format";
import type { ResponseMode } from "@/shared/api/meeting-settings";
import type { UpdateMeetingBody } from "@/shared/api/meetings";

/** The Responses step's form state. */
export type ResponsesValues = {
  responseMode: ResponseMode;
  delayOptions: number[];
  reasonRequired: boolean;
  commentsEnabled: boolean;
  footerNote: string;
  deadlineEnabled: boolean;
  deadlineDate: string | null;
  deadlineTime: string | null;
  timezone: string;
};

/** Error keys under `Wizard.errors`. */
export type ResponsesErrors = Partial<Record<"delayOptions" | "deadline", string>>;

const deadlineOf = (values: ResponsesValues) =>
  values.deadlineEnabled && values.deadlineDate && values.deadlineTime
    ? zonedWallTimeToUtc({ date: values.deadlineDate, time: values.deadlineTime, timezone: values.timezone })
    : null;

/** What blocks "Next" on the Responses step. */
export function validateResponses(values: ResponsesValues, startsAt: string | null, now: Date): ResponsesErrors {
  const errors: ResponsesErrors = {};
  if (values.responseMode === "attendance" && values.delayOptions.length === 0) {
    errors.delayOptions = "delaysRequired";
  }
  if (values.deadlineEnabled && values.responseMode !== "announcement") {
    const deadline = deadlineOf(values);
    if (!deadline || new Date(deadline) <= now || (startsAt !== null && new Date(deadline) >= new Date(startsAt))) {
      errors.deadline = "deadlineOrder";
    }
  }
  return errors;
}

/** The PATCH body for the Responses step. */
export function responsesPatch(values: ResponsesValues): UpdateMeetingBody {
  const answers = values.responseMode !== "announcement";
  return {
    responseMode: values.responseMode,
    delayOptions: values.responseMode === "attendance" ? values.delayOptions : [],
    reasonRequired: answers && values.reasonRequired,
    commentsEnabled: answers && values.commentsEnabled,
    footerNote: answers ? values.footerNote.trim() : "",
    responseDeadline: answers ? deadlineOf(values) : null,
  };
}
```
Run the pure tests → PASS.

- [ ] **Step 4: "+" and the Meetings page** — `nav-items.ts`: add the `meetingsEnabled` parameter (`{ key: "new", href: \`${base}/meetings/new\`, enabled: meetingsEnabled }`) and update its test (`enabled` follows the flag; Viewers still get no "+"). In `bottom-bar.tsx`, pass `publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED` and render an enabled "+" as a `Link` to `item.href` (same `Sticker`, `aria-label={t("new")}`, no `aria-disabled`); keep the current disabled button when `!item.enabled`. Bottom-bar test: with the flag (Vitest sets it to `"true"` since Task 3) the "+" is a link to `/w/<slug>/meetings/new`.

`src/app/w/[slug]/meetings/page.tsx`:
```tsx
"use client";

import { useParams } from "next/navigation";
import { ComingSoon } from "@/components/shell/coming-soon";
import { publicEnv } from "@/config/public-env";
import { MeetingsList } from "./meetings-list";

/** `/w/[slug]/meetings` (spec §10): Upcoming · Drafts · Past. */
export default function MeetingsPage() {
  const { slug } = useParams<{ slug: string }>();
  return publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED ? <MeetingsList slug={slug} /> : <ComingSoon area="meetings" />;
}
```
`src/app/w/[slug]/meetings/meetings-list.tsx`:
```tsx
"use client";

import { CalendarDots, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useMeetings } from "@/hooks/use-meetings";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { partitionMeetings } from "@/lib/meetings/partition";
import type { MeetingSummary } from "@/shared/api/meetings";

type Tab = "upcoming" | "drafts" | "past";

/** The Meetings page body. */
export function MeetingsList({ slug }: { slug: string }) {
  const t = useTranslations("Meetings");
  const workspace = useWorkspace(slug);
  const meetings = useMeetings(slug);
  const [tab, setTab] = useState<Tab>("upcoming");
  const groups = useMemo(() => partitionMeetings(meetings.data ?? [], new Date()), [meetings.data]);
  const canEdit = workspace.data && workspace.data.myRole !== "viewer";
  if (!meetings.data || !workspace.data) {
    return <Skeleton className="h-64 w-full" />;
  }
  const tabs: Tab[] = canEdit ? ["upcoming", "drafts", "past"] : ["upcoming", "past"];
  const shown = groups[tab];
  const hrefFor = (m: MeetingSummary) => (m.status === "draft" ? `/w/${slug}/meetings/${m.id}/edit` : `/w/${slug}/meetings/${m.id}`);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        {canEdit ? (
          <Button asChild tone="primary">
            <Link href={`/w/${slug}/meetings/new`}>
              <Plus weight="bold" aria-hidden />
              {t("new")}
            </Link>
          </Button>
        ) : null}
      </div>
      <SegmentedControl
        label={t("tabs.label")}
        value={tab}
        onValueChange={(next) => setTab(tabs.find((item) => item === next) ?? "upcoming")}
        options={tabs.map((item) => ({ value: item, label: t(`tabs.${item}`) }))}
      />
      {shown.length === 0 ? (
        <Card className="flex items-center gap-3">
          <Sticker tone="neutral">
            <CalendarDots weight="bold" />
          </Sticker>
          <p className="text-muted-ink">{t(`empty.${tab}`)}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((meeting) => {
            const when = meeting.startsAt ? formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt }) : null;
            return (
              <li key={meeting.id}>
                <Link href={hrefFor(meeting)} className="block rounded-card focus-visible:outline-2">
                  <Card className="flex flex-col gap-1">
                    <span className="font-display text-lg break-words">{meeting.title || t("untitled")}</span>
                    <span className="text-sm text-muted-ink">
                      {when ? `${when.date}, ${when.start}–${when.end}` : t("noDate")}
                    </span>
                    <span className="text-sm font-bold">
                      {meeting.status === "draft"
                        ? t("draft")
                        : t("sent", { sent: meeting.sentCount, total: meeting.invitedCount })}
                    </span>
                  </Card>
                </Link>
                {meeting.status === "draft" && canEdit ? (
                  <DraftMenu slug={slug} meetingId={meeting.id} title={meeting.title || t("untitled")} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```
Draft cards are wrapped in `<li className="relative">` and `DraftMenu` (`src/app/w/[slug]/meetings/draft-menu.tsx`) sits at the card's top-right corner: a 44 px "…" button (`DotsThree` icon, `aria-label` "Draft actions for <title>") opening the existing `DropdownMenu` (`p-1.5` inner padding) with **Delete draft**, which opens `ConfirmDialog` (Task 12) titled "Delete this draft?" (tone danger) and calls `useDeleteMeeting(slug).mutate(meetingId)`. Messages: `Meetings.draftActions` ("Draft actions for {title}") and reuse `Wizard.review.deleteTitle` / `deleteBody` / `deleteDraft`. `draft-menu.test.tsx`: opening the menu and confirming sends `DELETE …/meetings/<id>`; cancelling sends nothing.

Test (`meetings-list.test.tsx`, with `routeFetch` for `GET /api/workspaces/robotics-cd34` (`workspaceFixture`) and `GET …/meetings`): shows "Weekly sync" under Upcoming with "1 of 2 sent"; switching to Drafts shows "Untitled draft"; a Viewer fixture (`{ ...workspaceFixture, myRole: "viewer" }`) has no Drafts tab and no "New meeting".

`src/app/w/[slug]/meetings/new/page.tsx`:
```tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { ComingSoon } from "@/components/shell/coming-soon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { publicEnv } from "@/config/public-env";
import { useCreateMeeting } from "@/hooks/use-meetings";

/** "+" target: creates one draft, then opens the wizard on it (spec §7.2). */
export default function NewMeetingPage() {
  const t = useTranslations("Meetings");
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const create = useCreateMeeting(slug);
  const started = useRef(false);
  const start = () =>
    create.mutate(undefined, {
      onSuccess: ({ id }) => router.replace(`/w/${slug}/meetings/${id}/edit?step=details`),
    });
  useEffect(() => {
    // Strict Mode runs effects twice in development; one draft per visit.
    if (!started.current && publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED) {
      started.current = true;
      start();
    }
  });
  if (!publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED) {
    return <ComingSoon area="meetings" />;
  }
  if (create.isError) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="font-bold">{t("createFailed")}</p>
        <Button tone="primary" onClick={start}>
          {t("retry")}
        </Button>
      </Card>
    );
  }
  return (
    <div aria-busy="true" aria-label={t("creating")}>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```
(`start` is defined inline; the effect intentionally has no dependency array and is guarded by the ref. If the hooks lint rule objects, use `useEffect(…, [])` with an `// eslint-disable-next-line react-hooks/exhaustive-deps` plus a one-line reason — check how M2/M3 code handled one-shot effects first and match it.) Test: mocks `useRouter`, routes `POST /api/workspaces/robotics-cd34/meetings` → `{ id }`, asserts `replace` called once with the edit URL even when rendered in `<StrictMode>`.

- [ ] **Step 5: Wizard shell + footer** — `…/edit/page.tsx`:
```tsx
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { ComingSoon } from "@/components/shell/coming-soon";
import { Skeleton } from "@/components/ui/skeleton";
import { publicEnv } from "@/config/public-env";
import { useMeeting } from "@/hooks/use-meetings";
import { useWorkspace } from "@/hooks/use-workspace";
import { WizardShell } from "./wizard-shell";

/** `/w/[slug]/meetings/[id]/edit?step=…` (spec §7.2). */
export default function EditMeetingPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const params = useSearchParams();
  const meeting = useMeeting(slug, id);
  const workspace = useWorkspace(slug);
  if (!publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED) {
    return <ComingSoon area="meetings" />;
  }
  if (!meeting.data || !workspace.data) {
    return <Skeleton className="h-96 w-full" />;
  }
  return <WizardShell slug={slug} meeting={meeting.data} workspace={workspace.data} stepParam={params.get("step")} />;
}
```
`useSearchParams` in a client page needs a `<Suspense>` boundary in Next 16 for static rendering: check `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` and wrap as the doc says (the roster page may already show the pattern).

`…/edit/wizard-shell.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { AudienceStep } from "./audience-step";
import { DetailsStep } from "./details-step";
import { ResponsesStep } from "./responses-step";
import { ReviewStep } from "./review-step";
import { resolveStep, stepsFor, type WizardStep } from "./wizard-steps";
import type { Meeting } from "@/shared/api/meetings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

const STEP_COMPONENTS = {
  details: DetailsStep,
  audience: AudienceStep,
  responses: ResponsesStep,
  review: ReviewStep,
} as const;

/** Header ("Step 2 of 4" + title) and the current step; the step lives in the URL. */
export function WizardShell({
  slug,
  meeting,
  workspace,
  stepParam,
}: {
  slug: string;
  meeting: Meeting;
  workspace: WorkspaceDetails;
  stepParam: string | null;
}) {
  const t = useTranslations("Wizard");
  const router = useRouter();
  const steps = stepsFor(meeting.status);
  const step = resolveStep(stepParam, steps);
  const goTo = (next: WizardStep) => {
    router.replace(`/w/${slug}/meetings/${meeting.id}/edit?step=${next}`, { scroll: true });
  };
  useEffect(() => {
    if (workspace.myRole === "viewer" || meeting.status === "cancelled") {
      router.replace(`/w/${slug}/meetings/${meeting.id}`);
    }
  }, [meeting.id, meeting.status, router, slug, workspace.myRole]);
  const Step = STEP_COMPONENTS[step];
  return (
    <section className="flex flex-col gap-4 pb-28">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-bold text-muted-ink">
          {t("stepOf", { current: steps.indexOf(step) + 1, total: steps.length })}
        </p>
        <h1 className="font-display text-3xl">{t(`steps.${step}`)}</h1>
      </header>
      <Step slug={slug} meeting={meeting} workspace={workspace} steps={steps} goTo={goTo} />
    </section>
  );
}
```
`…/edit/wizard-footer.tsx`:
```tsx
"use client";

import { Button } from "@/components/ui/button";

/**
 * Sticky step footer above the bottom bar: Back + Next of one fixed height with single-line labels
 * on every step (M3 smoke-test rule).
 */
export function WizardFooter({
  backLabel,
  onBack,
  nextLabel,
  onNext,
  nextDisabled = false,
  pending = false,
  nextTone = "primary",
}: {
  backLabel: string;
  onBack: () => void;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
  pending?: boolean;
  nextTone?: "primary" | "success";
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t-[length:var(--tn-border-width)] border-outline bg-background/95 px-4 py-3">
      <div className="mx-auto flex max-w-md gap-3">
        <Button size="lg" className="w-auto shrink-0 justify-center whitespace-nowrap" onClick={onBack}>
          {backLabel}
        </Button>
        <Button
          size="lg"
          tone={nextTone}
          className="justify-center truncate whitespace-nowrap"
          disabled={nextDisabled || pending}
          aria-busy={pending || undefined}
          onClick={onNext}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
```
(Measure the bottom bar's real height in the 390 px screenshot and adjust `bottom-[…]` so the footer sits exactly on it; if the shell has a CSS variable for that height, use it.)

Placeholders until Tasks 14–15 — `…/edit/audience-step.tsx` and `…/edit/review-step.tsx` each render a `Card` with the step name and a `WizardFooter` whose Back/Next call `goTo` with the neighbors from `steps`; they are replaced, not extended, later. The rollout flag keeps them off production.

`wizard-shell.test.tsx`: renders `stepParam="responses"` on `meetingFixture` → heading "Answers", "Step 3 of 4"; on `{ ...meetingFixture, status: "scheduled" }` with `stepParam="details"` → heading "Who's invited?", "Step 1 of 2"; Viewer → `router.replace` to the meeting page.

- [ ] **Step 6: Details step** — `…/edit/details-step.tsx` (form state from the meeting; Next validates, saves, moves on; blur on text fields saves quietly):
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Chip } from "@/components/ui/chip";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TimePicker } from "@/components/ui/time-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimezonePicker } from "@/components/forms/timezone-picker";
import { AGENDA_MAX, DURATION_CHOICES, LOCATION_MAX, TITLE_MAX } from "@/config/meetings";
import { useUpdateMeeting } from "@/hooks/use-meetings";
import { utcToZonedParts } from "@/lib/meetings/format";
import { locationModeSchema } from "@/shared/api/meeting-settings";
import { detailsPatch, validateDetails, type DetailsErrors, type DetailsValues } from "./details-form";
import { WizardFooter } from "./wizard-footer";
import type { WizardStepProps } from "./wizard-steps";

/** Step 1: title, when, duration, where, agenda (spec §7.2). */
export function DetailsStep({ slug, meeting, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const update = useUpdateMeeting(slug, meeting.id);
  const parts = meeting.startsAt ? utcToZonedParts(meeting.startsAt, meeting.timezone) : null;
  const [values, setValues] = useState<DetailsValues>({
    title: meeting.title,
    date: parts?.date ?? null,
    time: parts?.time ?? null,
    timezone: meeting.timezone,
    durationMinutes: meeting.durationMinutes,
    locationMode: meeting.locationMode,
    locationText: meeting.locationText,
    meetingUrl: meeting.meetingUrl,
    agendaMd: meeting.agendaMd,
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [customDuration, setCustomDuration] = useState(!DURATION_CHOICES.some((d) => d === meeting.durationMinutes));
  const set = <K extends keyof DetailsValues>(key: K, value: DetailsValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const saveQuietly = () => update.mutate(detailsPatch(values));
  const next = () => {
    const found = validateDetails(values, new Date());
    setErrors(found);
    if (Object.keys(found).length === 0) {
      update.mutate(detailsPatch(values), { onSuccess: () => goTo("audience") });
    }
  };
  const today = utcToZonedParts(new Date().toISOString(), values.timezone).date;
  const error = (key: keyof DetailsErrors) => (errors[key] ? t(`errors.${errors[key]}`) : undefined);
  const hoursLabel = (minutes: number) =>
    minutes < 60
      ? t("details.minutes", { count: minutes })
      : minutes % 60 === 0
        ? t("details.hours", { hours: minutes / 60 })
        : t("details.hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  return (
    <div className="flex flex-col gap-5">
      <Input
        id="meeting-title"
        label={t("details.title")}
        placeholder={t("details.titlePlaceholder")}
        maxLength={TITLE_MAX}
        value={values.title}
        error={error("title")}
        onChange={(event) => set("title", event.target.value)}
        onBlur={saveQuietly}
      />
      <div className="grid grid-cols-2 gap-3">
        <DatePicker id="meeting-date" label={t("details.date")} value={values.date} today={today} min={today} error={error("date")} onChange={(date) => set("date", date)} />
        <TimePicker id="meeting-time" label={t("details.time")} value={values.time} error={error("time")} onChange={(time) => set("time", time)} />
      </div>
      <Popover>
        <p className="flex items-center gap-2 text-sm text-muted-ink">
          {t("details.zone", { zone: values.timezone })}
          <PopoverTrigger className="min-h-11 font-bold text-ink underline">{t("details.changeZone")}</PopoverTrigger>
        </p>
        <PopoverContent className="w-80 p-1.5">
          <TimezonePicker id="meeting-zone" label={t("details.zoneLabel")} value={values.timezone} onChange={(zone) => set("timezone", zone)} />
        </PopoverContent>
      </Popover>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold">{t("details.duration")}</legend>
        <div className="flex flex-wrap gap-2">
          {DURATION_CHOICES.map((minutes) => (
            <Chip key={minutes} pressed={!customDuration && values.durationMinutes === minutes} onPressedChange={() => { setCustomDuration(false); set("durationMinutes", minutes); }}>
              {hoursLabel(minutes)}
            </Chip>
          ))}
          <Chip pressed={customDuration} onPressedChange={() => setCustomDuration(true)}>
            {t("details.durationOther")}
          </Chip>
        </div>
        {customDuration ? (
          <Input
            id="meeting-duration"
            label={t("details.durationMinutes")}
            inputMode="numeric"
            value={String(values.durationMinutes)}
            error={error("durationMinutes")}
            onChange={(event) => set("durationMinutes", Number.parseInt(event.target.value.replace(/\D/g, "") || "0", 10))}
          />
        ) : null}
      </fieldset>
      <SegmentedControl
        label={t("details.where")}
        value={values.locationMode}
        onValueChange={(mode) => set("locationMode", locationModeSchema.parse(mode))}
        options={[
          { value: "in_person", label: t("details.inPerson") },
          { value: "online", label: t("details.online") },
          { value: "hybrid", label: t("details.hybrid") },
        ]}
      />
      {values.locationMode !== "online" ? (
        <Input id="meeting-place" label={t("details.place")} placeholder={t("details.placePlaceholder")} maxLength={LOCATION_MAX} value={values.locationText} error={error("locationText")} onChange={(event) => set("locationText", event.target.value)} onBlur={saveQuietly} />
      ) : null}
      {values.locationMode !== "in_person" ? (
        <Input id="meeting-link" type="url" inputMode="url" label={t("details.link")} placeholder={t("details.linkPlaceholder")} value={values.meetingUrl} error={error("meetingUrl")} onChange={(event) => set("meetingUrl", event.target.value)} onBlur={saveQuietly} />
      ) : null}
      <MarkdownEditor id="meeting-agenda" label={t("details.agenda")} hint={t("details.agendaHint")} maxLength={AGENDA_MAX} value={values.agendaMd} onChange={(agenda) => set("agendaMd", agenda)} onBlur={saveQuietly} />
      {update.isError ? <p role="alert" className="font-bold">{t("errors.saveFailed")}</p> : null}
      <WizardFooter backLabel={t("cancel")} onBack={() => { saveQuietly(); history.back(); }} nextLabel={t("next.audience")} onNext={next} pending={update.isPending} />
    </div>
  );
}
```
Notes: `saveQuietly` sends the whole Details patch; the PATCH validator rejects invalid fields (e.g. a half-typed URL), which is fine for a quiet save — the error surfaces only via `update.isError` and the Next validation. "Close" (Back on step 1) saves and goes back; the lint rule may forbid `history.back()` — then use `router.push(\`/w/${slug}/meetings\`)`. The `type="url"` input is a text field, not a native picker control.

`details-step.test.tsx` (mock `next/navigation` `useRouter`; `routeFetch` for `PATCH /api/workspaces/robotics-cd34/meetings/<id>` echoing the body merged into `meetingFixture`): with an empty title, Next shows "Give the meeting a title." and sends nothing; fill title, pick date and time (use the pickers' buttons), Next sends a PATCH whose body has `startsAt` in UTC and calls `goTo("audience")`; switching Where to Online shows the link field and hides Place.

- [ ] **Step 7: Responses step** — `…/edit/responses-step.tsx`, same structure: `SegmentedControl` for the mode (three options), then by mode:
  - **announcement**: the hint text only;
  - **rsvp**: `Switch` "Ask for a reason when not going" (`reasonRequired`), `Switch` "Allow a comment";
  - **attendance**: "Late by" `Chip`s for `DELAY_OPTION_CHOICES` (pressing a seventh when six are chosen does nothing; hint "Pick up to 6."), `Switch` "Ask for a reason", `Switch` "Allow a comment";
  - rsvp + attendance: footer note `Input` (≤ 280), `Switch` "Answer deadline" revealing `DatePicker` + `TimePicker` in the meeting's zone (`min` = today, deadline errors under them).
  Labels go with `Switch` through `<label htmlFor>` (the M3 switch pattern). Next validates with `validateResponses(values, meeting.startsAt, new Date())`, saves `responsesPatch(values)`, `goTo("review")`; Back saves quietly and `goTo("audience")`.
  `responses-step.test.tsx`: Announcement hides every setting; Attendance with all chips cleared shows "Pick at least one delay." on Next; choosing a seventh chip is ignored; enabling the deadline and choosing a time after the start shows the deadline error; a valid form PATCHes `{ responseMode, delayOptions, … }` and calls `goTo("review")`.

  The component:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Chip } from "@/components/ui/chip";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { DELAY_OPTION_CHOICES, DELAY_OPTIONS_MAX, FOOTER_NOTE_MAX } from "@/config/meetings";
import { useUpdateMeeting } from "@/hooks/use-meetings";
import { utcToZonedParts } from "@/lib/meetings/format";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import { responsesPatch, validateResponses, type ResponsesErrors, type ResponsesValues } from "./responses-form";
import { WizardFooter } from "./wizard-footer";
import type { WizardStepProps } from "./wizard-steps";

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Step 3: how members answer (spec §7.2; reminders arrive in M6). */
export function ResponsesStep({ slug, meeting, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const update = useUpdateMeeting(slug, meeting.id);
  const deadline = meeting.responseDeadline ? utcToZonedParts(meeting.responseDeadline, meeting.timezone) : null;
  const [values, setValues] = useState<ResponsesValues>({
    responseMode: meeting.responseMode,
    delayOptions: meeting.delayOptions,
    reasonRequired: meeting.reasonRequired,
    commentsEnabled: meeting.commentsEnabled,
    footerNote: meeting.footerNote,
    deadlineEnabled: deadline !== null,
    deadlineDate: deadline?.date ?? null,
    deadlineTime: deadline?.time ?? null,
    timezone: meeting.timezone,
  });
  const [errors, setErrors] = useState<ResponsesErrors>({});
  const set = <K extends keyof ResponsesValues>(key: K, value: ResponsesValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const toggleDelay = (minutes: number) =>
    set(
      "delayOptions",
      values.delayOptions.includes(minutes)
        ? values.delayOptions.filter((value) => value !== minutes)
        : values.delayOptions.length < DELAY_OPTIONS_MAX
          ? [...values.delayOptions, minutes].sort((a, b) => a - b)
          : values.delayOptions,
    );
  const next = () => {
    const found = validateResponses(values, meeting.startsAt, new Date());
    setErrors(found);
    if (Object.keys(found).length === 0) {
      update.mutate(responsesPatch(values), { onSuccess: () => goTo("review") });
    }
  };
  const back = () => {
    if (Object.keys(validateResponses(values, meeting.startsAt, new Date())).length === 0) {
      update.mutate(responsesPatch(values));
    }
    goTo("audience");
  };
  const today = utcToZonedParts(new Date().toISOString(), meeting.timezone).date;
  const answers = values.responseMode !== "announcement";
  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl
        label={t("responses.mode")}
        value={values.responseMode}
        onValueChange={(mode) => set("responseMode", responseModeSchema.parse(mode))}
        options={[
          { value: "announcement", label: t("responses.announcement") },
          { value: "rsvp", label: t("responses.rsvp") },
          { value: "attendance", label: t("responses.attendance") },
        ]}
      />
      {!answers ? <p className="text-muted-ink">{t("responses.announcementHint")}</p> : null}
      {values.responseMode === "attendance" ? (
        <fieldset className="flex flex-col gap-2" aria-describedby="delays-hint">
          <legend className="text-sm font-bold">{t("responses.delays")}</legend>
          <div className="flex flex-wrap gap-2">
            {DELAY_OPTION_CHOICES.map((minutes) => (
              <Chip key={minutes} pressed={values.delayOptions.includes(minutes)} onPressedChange={() => toggleDelay(minutes)}>
                {t("details.minutes", { count: minutes })}
              </Chip>
            ))}
          </div>
          <p id="delays-hint" className="text-sm text-muted-ink">
            {errors.delayOptions ? <strong className="text-ink">{t(`errors.${errors.delayOptions}`)}</strong> : t("responses.delaysHint", { max: DELAY_OPTIONS_MAX })}
          </p>
        </fieldset>
      ) : null}
      {answers ? (
        <>
          <Toggle
            id="reason-required"
            label={values.responseMode === "rsvp" ? t("responses.reasonRequiredRsvp") : t("responses.reasonRequired")}
            checked={values.reasonRequired}
            onChange={(value) => set("reasonRequired", value)}
          />
          <Toggle id="comments-enabled" label={t("responses.comments")} checked={values.commentsEnabled} onChange={(value) => set("commentsEnabled", value)} />
          <Input id="footer-note" label={t("responses.footerNote")} maxLength={FOOTER_NOTE_MAX} value={values.footerNote} onChange={(event) => set("footerNote", event.target.value)} />
          <Toggle id="deadline-enabled" label={t("responses.deadline")} checked={values.deadlineEnabled} onChange={(value) => set("deadlineEnabled", value)} />
          {values.deadlineEnabled ? (
            <div className="grid grid-cols-2 gap-3">
              <DatePicker id="deadline-date" label={t("responses.deadlineDate")} value={values.deadlineDate} today={today} min={today} onChange={(date) => set("deadlineDate", date)} error={errors.deadline ? t(`errors.${errors.deadline}`) : undefined} />
              <TimePicker id="deadline-time" label={t("responses.deadlineTime")} value={values.deadlineTime} onChange={(time) => set("deadlineTime", time)} />
            </div>
          ) : null}
        </>
      ) : null}
      {update.isError ? <p role="alert" className="font-bold">{t("errors.saveFailed")}</p> : null}
      <WizardFooter backLabel={t("back")} onBack={back} nextLabel={t("next.review")} onNext={next} pending={update.isPending} />
    </div>
  );
}
```

- [ ] **Step 8: Preview flag** — so PR previews show the feature: `timeout 60 vercel env add NEXT_PUBLIC_MEETINGS_ENABLED preview --value true --no-sensitive --yes --non-interactive --scope dalychouikhs-projects`, and `NEXT_PUBLIC_MEETINGS_ENABLED=true` in `.env.local` (Production stays unset until Task 20 removes the flag).

- [ ] **Step 9: Verify and commit** — `bun run test src/app/w src/components/shell src/lib && bun run lint && bun run typecheck` → PASS. Screenshots (dev server, then stop it) of `/w/<slug>/meetings` and the Details and Responses steps at 390 px light, 320 px dark and 1024 px: check no horizontal scroll, the footer above the bottom bar with equal button heights, chip rows wrapping (or hidden scrollbars if they scroll), popovers padded. Look before committing. Commit `feat(ui): meeting wizard shell, Details and Answers steps, Meetings page`, PR, merge.

---

### Task 14: Audience step and "Add people" sheet

**Labels:** `area:ui`

**Files:**
- Create: `src/lib/meetings/audience-edit.ts` (+ test), `src/lib/meetings/parse-people.ts` (+ test), `src/app/w/[slug]/meetings/[id]/edit/add-people-sheet.tsx` (+ test), `src/app/w/[slug]/meetings/[id]/edit/audience-person-row.tsx`
- Modify (replace the placeholder): `src/app/w/[slug]/meetings/[id]/edit/audience-step.tsx` (+ `audience-step.test.tsx`), `messages/en.json` (`Wizard.audience`, `Wizard.addPeople`), `src/config/meetings.ts`

**Interfaces:**
- Consumes: Task 11 `useMeetingAudience`, `useSetAudience`, `useAddPeople`, `Audience`, `AudiencePerson`, `addPeopleBodySchema`; M3 `useRoster`, `ListTag`, `normalizeForSearch`, `Chip`, `Checkbox`, `Switch`, `Input`, `Textarea`, `Dialog*`; Task 13 `WizardFooter`, `WizardStepProps`.
- Produces:
  - `src/config/meetings.ts`: `AUDIENCE_PAGE_SIZE = 50` (rows shown before "Show N more").
  - `toggleList(audience: Audience, listId: string): AudienceBody`, `togglePerson(audience: Audience, personId: string, included: boolean): AudienceBody`, `audienceBodyOf(audience: Audience): AudienceBody` — pure: the next `PUT …/audience` body. Unticking someone who is only individually added removes the addition; unticking a list member excludes them; ticking clears the exclusion.
  - `parsePeopleList(text: string): ParsedPerson[]` with `ParsedPerson = { fullName: string; email: string; problem: "name" | "email" | null }` — one person per line: `Name, email`, `Name <email>`, `Name;email`, tab-separated, or `email` alone (then `problem: "name"`).
  - `<AddPeopleSheet open onOpenChange slug meetingId onAdded? />`.

UI (approved layout A, spec §7.2): list chips with counts on top (sideways scroll, hidden scrollbar) → count bar ("28 people · 2 in more than one list"; "1 unsubscribed won't be emailed") → search over the included people → rows with a checkbox (tick = invited), name, email, list tags, and a mark for Unsubscribed / Reported / Already invited (those rows' checkboxes are disabled) → "Extra people (N)" card with **Add people** → footer "Next: N people" (disabled at 0). In Invite more mode, people already invited show "Already invited" and the count names only new people.

- [ ] **Step 1: Messages** — add under `Wizard`:
```json
"audience": {
  "lists": "Lists",
  "count": "{count, plural, one {# person} other {# people}}",
  "overlap": "{count} in more than one list",
  "unsubscribed": "{count, plural, one {# unsubscribed person won't be emailed} other {# unsubscribed people won't be emailed}}",
  "search": "Search the {count} invited",
  "noPeople": "Pick a list or add people.",
  "noMatch": "Nobody matches.",
  "showMore": "Show {count} more",
  "include": "Invite {name}",
  "markUnsubscribed": "Unsubscribed",
  "markReported": "Reported: not my group",
  "markInvited": "Already invited",
  "extra": "Extra people ({count})",
  "addPeople": "Add people",
  "next": "{count, plural, =0 {Nobody to invite} one {Next: # person} other {Next: # people}}",
  "nextReview": "{count, plural, =0 {Nobody new} one {Review: # new} other {Review: # new}}",
  "tooMany": "One meeting can invite up to {max} people."
},
"addPeople": {
  "title": "Add people",
  "description": "Not in your roster yet, or not in the lists you picked. Add several at once.",
  "fullName": "Full name",
  "email": "Email",
  "remove": "Remove person {number}",
  "another": "Another person",
  "paste": "Paste a list",
  "pasteLabel": "One person per line: name, email",
  "pastePlaceholder": "Nour Hamdi, nour@uni.tn\nSami Trabelsi <sami@uni.tn>",
  "usePaste": "Use these {count}",
  "saveToRoster": "Save to roster",
  "saveToRosterOff": "Off: invited to this meeting only",
  "submit": "{count, plural, =0 {Add people} one {Add # person} other {Add # people}}",
  "nameMissing": "Add a name.",
  "emailInvalid": "Check this email.",
  "added": "{count, plural, one {Added # person} other {Added # people}}"
}
```

- [ ] **Step 2: Failing pure tests** — `src/lib/meetings/audience-edit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { audienceFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import type { Audience } from "@/shared/api/meetings";
import { audienceBodyOf, toggleList, togglePerson } from "./audience-edit";

const withAdded: Audience = {
  ...audienceFixture,
  people: [
    ...audienceFixture.people,
    { id: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa", fullName: "Nour H.", email: "nour@uni.tn", listIds: [], added: true, excluded: false, unsubscribed: false, reported: false, invited: false },
  ],
};

describe("audience edits", () => {
  it("reads the current body back from the audience", () => {
    expect(audienceBodyOf(withAdded)).toEqual({
      listIds: [MEETING_IDS.members, MEETING_IDS.committee],
      include: ["6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa"],
      exclude: [],
    });
  });

  it("toggles a list", () => {
    expect(toggleList(withAdded, MEETING_IDS.committee).listIds).toEqual([MEETING_IDS.members]);
    expect(toggleList({ ...withAdded, listIds: [] }, MEETING_IDS.committee).listIds).toEqual([MEETING_IDS.committee]);
  });

  it("excludes a list member, un-adds an added-only person, and re-includes", () => {
    expect(togglePerson(withAdded, MEETING_IDS.amira, false).exclude).toEqual([MEETING_IDS.amira]);
    expect(togglePerson(withAdded, "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa", false).include).toEqual([]);
    const excluded: Audience = {
      ...withAdded,
      people: withAdded.people.map((p) => (p.id === MEETING_IDS.amira ? { ...p, excluded: true } : p)),
    };
    expect(togglePerson(excluded, MEETING_IDS.amira, true).exclude).toEqual([]);
  });
});
```
`src/lib/meetings/parse-people.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parsePeopleList } from "./parse-people";

describe("parsePeopleList", () => {
  it("reads the common pasted shapes", () => {
    expect(parsePeopleList("Nour Hamdi, nour@uni.tn\nSami Trabelsi <SAMI@uni.tn>\nLina\tlina@uni.tn\nAhmed;ahmed@uni.tn\n\n")).toEqual([
      { fullName: "Nour Hamdi", email: "nour@uni.tn", problem: null },
      { fullName: "Sami Trabelsi", email: "sami@uni.tn", problem: null },
      { fullName: "Lina", email: "lina@uni.tn", problem: null },
      { fullName: "Ahmed", email: "ahmed@uni.tn", problem: null },
    ]);
  });

  it("flags a missing name or a bad email instead of dropping the line", () => {
    expect(parsePeopleList("guest@uni.tn\nBob, not-an-email")).toEqual([
      { fullName: "", email: "guest@uni.tn", problem: "name" },
      { fullName: "Bob", email: "not-an-email", problem: "email" },
    ]);
  });

  it("accepts email-first lines", () => {
    expect(parsePeopleList("nour@uni.tn, Nour Hamdi")).toEqual([{ fullName: "Nour Hamdi", email: "nour@uni.tn", problem: null }]);
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement** — append `export const AUDIENCE_PAGE_SIZE = 50;` (JSDoc: "Audience rows shown before 'Show N more'") to `src/config/meetings.ts`.

`src/lib/meetings/audience-edit.ts`:
```ts
import type { Audience, AudienceBody } from "@/shared/api/meetings";

/** The `PUT …/audience` body that reproduces this audience. */
export function audienceBodyOf(audience: Audience): AudienceBody {
  return {
    listIds: audience.listIds,
    include: audience.people.filter((p) => p.added).map((p) => p.id),
    exclude: audience.people.filter((p) => p.excluded).map((p) => p.id),
  };
}

/** Adds or removes one list. */
export function toggleList(audience: Audience, listId: string): AudienceBody {
  const body = audienceBodyOf(audience);
  return {
    ...body,
    listIds: body.listIds.includes(listId) ? body.listIds.filter((id) => id !== listId) : [...body.listIds, listId],
  };
}

/**
 * Ticks or unticks one person: unticking a list member excludes them; unticking someone who is only
 * individually added removes the addition; ticking clears an exclusion.
 */
export function togglePerson(audience: Audience, personId: string, included: boolean): AudienceBody {
  const body = audienceBodyOf(audience);
  const person = audience.people.find((p) => p.id === personId);
  if (!person) {
    return body;
  }
  if (included) {
    return { ...body, exclude: body.exclude.filter((id) => id !== personId) };
  }
  if (person.listIds.length === 0) {
    return { ...body, include: body.include.filter((id) => id !== personId) };
  }
  return { ...body, exclude: [...new Set([...body.exclude, personId])] };
}
```
`src/lib/meetings/parse-people.ts`:
```ts
import { emailSchema } from "@/shared/api/common";

/** One pasted line, with what is wrong with it (if anything). */
export type ParsedPerson = { fullName: string; email: string; problem: "name" | "email" | null };

const ANGLE = /^(.*?)<([^>]+)>\s*$/;
const SEPARATORS = /[,;\t]/;

function split(line: string): { name: string; email: string } {
  const angle = ANGLE.exec(line);
  if (angle) {
    return { name: angle[1], email: angle[2] };
  }
  const parts = line.split(SEPARATORS).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].includes("@") ? { name: "", email: parts[0] } : { name: parts[0], email: "" };
  }
  const emailIndex = parts.findIndex((part) => part.includes("@"));
  const at = emailIndex === -1 ? parts.length - 1 : emailIndex;
  return { name: parts.filter((_, index) => index !== at).join(" "), email: parts[at] };
}

/** Reads "name, email" lines pasted into "Add people" (also `Name <email>`, `;`, tabs, email first). */
export function parsePeopleList(text: string): ParsedPerson[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const { name, email } = split(line);
      const fullName = name.replace(/\s+/g, " ").trim();
      const parsed = emailSchema.safeParse(email);
      const normalized = parsed.success ? parsed.data : email.trim();
      return {
        fullName,
        email: normalized,
        problem: !parsed.success ? "email" : fullName === "" ? "name" : null,
      };
    });
}
```
Run → PASS.

- [ ] **Step 4: Failing component tests** — `audience-step.test.tsx` (routes: `GET …/contacts` → a roster fixture with lists Members (id `MEETING_IDS.members`) and Committee; `GET …/meetings/<id>/audience` → `audienceFixture`; `PUT …/audience` → echo `audienceFixture` with the body applied):
```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { audienceFixture, meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { AudienceStep } from "./audience-step";
import { WIZARD_STEPS } from "./wizard-steps";

const roster = {
  contacts: [],
  lists: [
    { id: MEETING_IDS.members, name: "Members", contactCount: 2 },
    { id: MEETING_IDS.committee, name: "Committee", contactCount: 2 },
  ],
  limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
};
let fetchMock: ReturnType<typeof routeFetch>;
const goTo = vi.fn();
const base = `/api/workspaces/${workspaceFixture.slug}`;

beforeEach(() => {
  goTo.mockReset();
  fetchMock = routeFetch({
    [`GET ${base}/contacts`]: json(roster),
    [`GET ${base}/meetings/${MEETING_IDS.meeting}/audience`]: json(audienceFixture),
    [`PUT ${base}/meetings/${MEETING_IDS.meeting}/audience`]: (init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ...audienceFixture, listIds: body.listIds, counts: { ...audienceFixture.counts, toInvite: body.listIds.length } }));
    },
  });
});

const renderStep = () =>
  renderWithProviders(
    <AudienceStep slug={workspaceFixture.slug} meeting={meetingFixture} workspace={workspaceFixture} steps={WIZARD_STEPS} goTo={goTo} />,
  );

describe("AudienceStep", () => {
  it("shows the picked lists, the count and marks, and names the next step with the count", async () => {
    renderStep();
    expect(await screen.findByRole("button", { name: /Members 2/, pressed: true })).toBeInTheDocument();
    expect(screen.getByText("3 people")).toBeInTheDocument();
    expect(screen.getByText("1 in more than one list")).toBeInTheDocument();
    expect(screen.getByText("1 unsubscribed person won't be emailed")).toBeInTheDocument();
    const lina = screen.getByText("Lina M.").closest("li");
    expect(within(lina as HTMLElement).getByText("Unsubscribed")).toBeInTheDocument();
    expect(within(lina as HTMLElement).getByRole("checkbox")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next: 2 people" }));
    expect(goTo).toHaveBeenCalledWith("responses");
  });

  it("saves list toggles and person toggles as audience bodies", async () => {
    renderStep();
    await userEvent.click(await screen.findByRole("button", { name: /Committee 2/ }));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ listIds: [MEETING_IDS.members], include: [], exclude: [] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Invite Amira B." }));
    const last = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").at(-1);
    expect(JSON.parse(String(last?.[1]?.body)).exclude).toContain(MEETING_IDS.amira);
  });

  it("filters by search, accent-insensitively", async () => {
    renderStep();
    await userEvent.type(await screen.findByRole("searchbox"), "youssef");
    expect(screen.queryByText("Amira B.")).not.toBeInTheDocument();
    expect(screen.getByText("Youssef K.")).toBeInTheDocument();
  });
});
```
`add-people-sheet.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { AddPeopleSheet } from "./add-people-sheet";

const path = `POST /api/workspaces/club-ab12/meetings/${MEETING_IDS.meeting}/people`;

describe("AddPeopleSheet", () => {
  it("adds several people from rows and a paste, saved to the roster by default", async () => {
    const fetchMock = routeFetch({ [path]: () => new Response(JSON.stringify({ contactIds: [MEETING_IDS.amira, MEETING_IDS.lina, MEETING_IDS.youssef] })) });
    const onOpenChange = vi.fn();
    renderWithProviders(<AddPeopleSheet open onOpenChange={onOpenChange} slug="club-ab12" meetingId={MEETING_IDS.meeting} />, { toaster: true });
    await userEvent.type(screen.getByRole("textbox", { name: "Full name" }), "Nour Hamdi");
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "nour@uni.tn");
    await userEvent.click(screen.getByRole("button", { name: "Paste a list" }));
    await userEvent.type(screen.getByRole("textbox", { name: "One person per line: name, email" }), "Sami, sami@uni.tn{enter}Lina <lina@uni.tn>");
    await userEvent.click(screen.getByRole("button", { name: "Use these 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 3 people" }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({
      people: [
        { fullName: "Nour Hamdi", email: "nour@uni.tn" },
        { fullName: "Sami", email: "sami@uni.tn" },
        { fullName: "Lina", email: "lina@uni.tn" },
      ],
      saveToRoster: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await screen.findByText("Added 3 people")).toBeInTheDocument();
  });

  it("blocks rows with a missing name or a bad email", async () => {
    const fetchMock = routeFetch({});
    renderWithProviders(<AddPeopleSheet open onOpenChange={vi.fn()} slug="club-ab12" meetingId={MEETING_IDS.meeting} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Add 1 person" }));
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
    expect(screen.getByText("Check this email.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```
(With several rows, the row inputs get labels "Full name" / "Email" plus a visually hidden row number via `aria-describedby`; when a test needs row 2, query with `getAllByRole(...)[1]`.)

- [ ] **Step 5: Implement** — `…/edit/audience-person-row.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { ListTag } from "@/app/w/[slug]/lists/list-tag";
import type { AudiencePerson } from "@/shared/api/meetings";
import type { ListSummary } from "@/shared/api/roster";

/** One person in the Audience step: tick = invited; marks explain why someone cannot be ticked. */
export function AudiencePersonRow({
  person,
  lists,
  onToggle,
}: {
  person: AudiencePerson;
  lists: ListSummary[];
  onToggle: (included: boolean) => void;
}) {
  const t = useTranslations("Wizard.audience");
  const mark = person.invited
    ? t("markInvited")
    : person.reported
      ? t("markReported")
      : person.unsubscribed
        ? t("markUnsubscribed")
        : null;
  const locked = person.invited || person.unsubscribed;
  return (
    <li className="flex items-center gap-2 border-b border-dashed border-outline/30 py-1 last:border-b-0">
      <Checkbox
        aria-label={t("include", { name: person.fullName })}
        checked={person.invited || (!person.excluded && !person.unsubscribed)}
        disabled={locked}
        onCheckedChange={(checked) => onToggle(checked === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={person.excluded ? "font-bold break-words text-muted-ink line-through" : "font-bold break-words"}>
          {person.fullName}
        </span>
        <span className="truncate text-sm text-muted-ink">{person.email}</span>
      </div>
      <div className="flex max-w-[40%] shrink-0 flex-col items-end gap-1">
        {mark ? <span className="text-xs font-bold text-muted-ink">{mark}</span> : null}
        {person.listIds.slice(0, 2).map((id) => {
          const list = lists.find((l) => l.id === id);
          return list ? <ListTag key={id} list={list} /> : null;
        })}
      </div>
    </li>
  );
}
```
(`ListTag` lives under the roster route; if importing from `src/app/w/[slug]/lists/list-tag` feels wrong, move it to `src/components/forms/list-tag.tsx` in this task and update the roster imports — Task 19 also dedupes its `FILL` map, so the move fits there; pick one and note it in the ledger.)

`…/edit/audience-step.tsx`:
```tsx
"use client";

import { UserPlus } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AUDIENCE_PAGE_SIZE } from "@/config/meetings";
import { useMeetingAudience, useSetAudience } from "@/hooks/use-meetings";
import { useRoster } from "@/hooks/use-roster";
import { togglePerson, toggleList } from "@/lib/meetings/audience-edit";
import { normalizeForSearch } from "@/lib/roster/filter-contacts";
import { AddPeopleSheet } from "./add-people-sheet";
import { AudiencePersonRow } from "./audience-person-row";
import { WizardFooter } from "./wizard-footer";
import type { WizardStepProps } from "./wizard-steps";

/** Step 2 (or Invite more): lists first, then untick individuals; "Add people" for anyone else. */
export function AudienceStep({ slug, meeting, steps, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const roster = useRoster(slug);
  const audience = useMeetingAudience(slug, meeting.id);
  const setAudience = useSetAudience(slug, meeting.id);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(AUDIENCE_PAGE_SIZE);
  const [adding, setAdding] = useState(false);
  const people = audience.data?.people ?? [];
  const visible = useMemo(() => {
    const query = normalizeForSearch(search);
    return query
      ? people.filter((p) => normalizeForSearch(`${p.fullName} ${p.email}`).includes(query))
      : people;
  }, [people, search]);
  if (!audience.data || !roster.data) {
    return <Skeleton className="h-96 w-full" />;
  }
  const data = audience.data;
  const lists = roster.data.lists;
  const inviteMore = meeting.status === "scheduled";
  const overlap = people.filter((p) => !p.excluded && p.listIds.length > 1).length;
  const extra = people.filter((p) => p.added && p.listIds.length === 0);
  const index = steps.indexOf("audience");
  const back = () => (index > 0 ? goTo(steps[index - 1]) : history.back());
  const nextStep = steps[index + 1];
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t("audience.lists")} className="flex [scrollbar-width:none] gap-2 overflow-x-auto pt-1 pb-2 [&::-webkit-scrollbar]:hidden">
        {lists.map((list) => (
          <Chip key={list.id} className="shrink-0" pressed={data.listIds.includes(list.id)} onPressedChange={() => setAudience.mutate(toggleList(data, list.id))}>
            {list.name} {list.contactCount}
          </Chip>
        ))}
      </div>
      <Card className="flex flex-col gap-0.5 bg-fill-warning text-on-fill">
        <span className="font-display text-lg">{t("audience.count", { count: data.counts.selected })}</span>
        {overlap > 0 ? <span className="text-sm">{t("audience.overlap", { count: overlap })}</span> : null}
        {data.counts.unsubscribed > 0 ? <span className="text-sm">{t("audience.unsubscribed", { count: data.counts.unsubscribed })}</span> : null}
      </Card>
      {people.length === 0 ? (
        <p className="text-muted-ink">{t("audience.noPeople")}</p>
      ) : (
        <Card className="flex flex-col gap-2">
          <Input id="audience-search" type="search" label={t("audience.search", { count: data.counts.selected })} hideLabel placeholder={t("audience.search", { count: data.counts.selected })} value={search} onChange={(event) => setSearch(event.target.value)} />
          {visible.length === 0 ? <p className="text-muted-ink">{t("audience.noMatch")}</p> : null}
          <ul>
            {visible.slice(0, shown).map((person) => (
              <AudiencePersonRow key={person.id} person={person} lists={lists} onToggle={(included) => setAudience.mutate(togglePerson(data, person.id, included))} />
            ))}
          </ul>
          {visible.length > shown ? (
            <Button onClick={() => setShown((count) => count + AUDIENCE_PAGE_SIZE)}>{t("audience.showMore", { count: Math.min(AUDIENCE_PAGE_SIZE, visible.length - shown) })}</Button>
          ) : null}
        </Card>
      )}
      <Card className="flex flex-col gap-2 bg-fill-success text-on-fill">
        <span className="font-bold">{t("audience.extra", { count: extra.length })}</span>
        {extra.length > 0 ? <span className="text-sm break-words">{extra.map((p) => p.fullName).join(", ")}</span> : null}
        <Button onClick={() => setAdding(true)}>
          <UserPlus weight="bold" aria-hidden />
          {t("audience.addPeople")}
        </Button>
      </Card>
      {setAudience.isError ? <p role="alert" className="font-bold">{t("errors.saveFailed")}</p> : null}
      <AddPeopleSheet open={adding} onOpenChange={setAdding} slug={slug} meetingId={meeting.id} />
      <WizardFooter
        backLabel={index > 0 ? t("back") : t("cancel")}
        onBack={back}
        nextLabel={inviteMore ? t("audience.nextReview", { count: data.counts.toInvite }) : t("audience.next", { count: data.counts.toInvite })}
        nextDisabled={data.counts.toInvite === 0}
        pending={setAudience.isPending}
        onNext={() => goTo(nextStep)}
      />
    </div>
  );
}
```
(Same `history.back()` lint note as the Details step: replace with `router.push(\`/w/${slug}/meetings/${meeting.id}\`)` in Invite more mode if the linter forbids it.)

`…/edit/add-people-sheet.tsx`:
```tsx
"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PEOPLE_PER_ADD_MAX } from "@/config/meetings";
import { useAddPeople } from "@/hooks/use-meetings";
import { ApiClientError } from "@/lib/api-client";
import { parsePeopleList } from "@/lib/meetings/parse-people";
import { emailSchema } from "@/shared/api/common";

type Row = { key: number; fullName: string; email: string };
type RowError = { fullName?: string; email?: string };

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, fullName: "", email: "" });

/** "Add people": several non-roster people at once (rows or a pasted list), saved to the roster by default. */
export function AddPeopleSheet({
  open,
  onOpenChange,
  slug,
  meetingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  meetingId: string;
}) {
  const t = useTranslations("Wizard.addPeople");
  const tErrors = useTranslations("ApiErrors");
  const add = useAddPeople(slug, meetingId);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [errors, setErrors] = useState<Record<number, RowError>>({});
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [saveToRoster, setSaveToRoster] = useState(true);
  const filled = rows.filter((row) => row.fullName.trim() || row.email.trim());
  const parsedPaste = parsePeopleList(pasted);
  const reset = () => {
    setRows([emptyRow()]);
    setErrors({});
    setPasting(false);
    setPasted("");
    setSaveToRoster(true);
  };
  const close = (next: boolean) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };
  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const usePaste = () => {
    const incoming = parsedPaste.map((person) => ({ key: nextKey++, fullName: person.fullName, email: person.email }));
    setRows((current) => [...current.filter((row) => row.fullName.trim() || row.email.trim()), ...incoming].slice(0, PEOPLE_PER_ADD_MAX));
    setPasting(false);
    setPasted("");
  };
  const submit = () => {
    const found: Record<number, RowError> = {};
    for (const row of filled) {
      const rowError: RowError = {};
      if (!row.fullName.trim()) {
        rowError.fullName = t("nameMissing");
      }
      if (!emailSchema.safeParse(row.email).success) {
        rowError.email = t("emailInvalid");
      }
      if (rowError.fullName || rowError.email) {
        found[row.key] = rowError;
      }
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || filled.length === 0) {
      return;
    }
    add.mutate(
      { people: filled.map((row) => ({ fullName: row.fullName.trim(), email: emailSchema.parse(row.email) })), saveToRoster },
      {
        onSuccess: ({ contactIds }) => {
          toast.success(t("added", { count: contactIds.length }));
          close(false);
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li key={row.key} className="flex flex-col gap-2 rounded-control border-[length:var(--tn-border-width)] border-outline p-3">
              <Input id={`person-${row.key}-name`} label={t("fullName")} autoComplete="off" value={row.fullName} error={errors[row.key]?.fullName} onChange={(event) => update(row.key, { fullName: event.target.value })} />
              <Input id={`person-${row.key}-email`} label={t("email")} type="email" inputMode="email" autoComplete="off" value={row.email} error={errors[row.key]?.email} onChange={(event) => update(row.key, { email: event.target.value })} />
              {rows.length > 1 ? (
                <Button aria-label={t("remove", { number: index + 1 })} className="self-end" onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}>
                  <Trash weight="bold" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button disabled={rows.length >= PEOPLE_PER_ADD_MAX} onClick={() => setRows((current) => [...current, emptyRow()])}>
            <Plus weight="bold" aria-hidden />
            {t("another")}
          </Button>
          <Button tone="info" onClick={() => setPasting((value) => !value)}>
            {t("paste")}
          </Button>
        </div>
        {pasting ? (
          <div className="flex flex-col gap-2">
            <Textarea id="people-paste" label={t("pasteLabel")} placeholder={t("pastePlaceholder")} value={pasted} onChange={(event) => setPasted(event.target.value)} />
            <Button disabled={parsedPaste.length === 0} onClick={usePaste}>
              {t("usePaste", { count: parsedPaste.length })}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="save-to-roster" className="flex flex-col">
            <span className="font-bold">{t("saveToRoster")}</span>
            {!saveToRoster ? <span className="text-sm text-muted-ink">{t("saveToRosterOff")}</span> : null}
          </label>
          <Switch id="save-to-roster" checked={saveToRoster} onCheckedChange={setSaveToRoster} />
        </div>
        {add.error instanceof ApiClientError ? <p role="alert" className="font-bold">{tErrors(add.error.code)}</p> : null}
        <DialogFooter>
          <Button size="lg" tone="primary" className="justify-center" disabled={add.isPending} onClick={submit}>
            {t("submit", { count: filled.length || 1 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
The `"Paste a list"` lines with a problem stay as rows so the person can fix them; `usePaste` keeps every parsed line. Rows with both fields empty are ignored. The roster cache is invalidated by `useAddPeople` (Task 11).

- [ ] **Step 6: Verify and commit** — `bun run test src/app/w/\[slug\]/meetings src/lib/meetings && bun run lint && bun run typecheck` → PASS. Screenshots at 390 px light, 320 px dark, 1024 px of the Audience step (with the long-name contact from M3's Review Focus 5: `"Mohamed Ali Ben Abdallah El Kefi"` / `"mohamedali.benabdallah.elkefi@etudiant-issatso.u-sousse.tn"`) and of the open "Add people" sheet with three rows and the paste box: no horizontal scroll at 320 px; the chip row scrolls sideways with no visible scrollbar; the dialog is centered at 1024 px. Look before committing. Commit `feat(ui): Audience step and Add people sheet`, PR, merge.

---

### Task 15: Review step, Send confirm, meeting page with progress, Invite more

**Labels:** `area:ui`

**Files:**
- Create: `src/lib/meetings/quota-line.ts` (+ test), `src/app/w/[slug]/meetings/[id]/edit/email-preview-dialog.tsx`, `src/app/w/[slug]/meetings/[id]/page.tsx` (+ test), `src/app/w/[slug]/meetings/[id]/send-progress.tsx` (+ test), `src/app/w/[slug]/meetings/[id]/invitee-list.tsx` (+ test), `src/app/w/[slug]/meetings/[id]/meeting-header.tsx`
- Modify (replace the placeholder): `src/app/w/[slug]/meetings/[id]/edit/review-step.tsx` (+ `review-step.test.tsx`); `messages/en.json` (`Wizard.review`, `MeetingPage`); `src/config/meetings.ts`

**Interfaces:**
- Consumes: Task 11 hooks (`useMeetingAudience`, `useMeetingPreview`, `useSendMeeting`, `useMeetingProgress`, `useDeleteMeeting`, `useMeeting`); Task 4 `useWorkspaceSender`, `gmailConnectHref`; Task 12 `ConfirmDialog`; Task 13 `WizardFooter`, `WizardStepProps`; Task 8 `formatMeetingWhen`, `formatDeadline`.
- Produces:
  - `src/config/meetings.ts`: `FROM_NAME_KEPT: boolean` — set from the From-name ruling (Tracking). `true` shows "From **GDG ISSAT** <club@gmail.com>"; `false` shows "From club@gmail.com".
  - `quotaLine(input: { toSend: number; sentLast24h: number; dailyLimit: number }): { now: number; queued: number; leftAfter: number }` — how many go out now, how many wait for the rolling window, and what is left today afterwards.
  - The meeting page `/w/[slug]/meetings/[id]` (drafts redirect to the editor): header (title, when, where), `SendProgress`, `InviteeList`, **Invite more people** (Owner/Admin, scheduled, before the start) → `/edit?step=audience`.
  - Review step: summary cards with Edit (Details, Audience, Answers), email preview card → `EmailPreviewDialog` (sandboxed iframe), sender + quota lines, **Save draft**, **Delete draft** (confirm, drafts only), **Send N invites** → `ConfirmDialog` "Send 30 invites from club@gmail.com now?" → POST send → meeting page + toast.

- [ ] **Step 1: Messages** — under `Wizard`:
```json
"review": {
  "details": "Details",
  "audience": "Audience",
  "answers": "Answers",
  "edit": "Edit",
  "people": "{count, plural, one {# person} other {# people}}",
  "unsubscribedSkipped": "{count} unsubscribed skipped",
  "newPeople": "{count, plural, one {# new person} other {# new people}}",
  "mode": { "announcement": "Announcement, no answers", "rsvp": "Going / not going", "attendance": "Going / late / absent" },
  "reasonRequired": "Reason required",
  "deadline": "Answer by {deadline}",
  "preview": "Email preview",
  "open": "Open",
  "previewTitle": "Email preview",
  "previewTo": "To: {name} (example)",
  "previewSubject": "Subject: {subject}",
  "fromNamed": "From {name} <{email}>",
  "fromEmail": "From {email}",
  "quota": "{now, plural, one {# email now} other {# emails now}} · {left} left today on this Gmail",
  "quotaQueued": "{now} now, {queued} wait for tomorrow's budget",
  "connect": "Connect Gmail to send",
  "askOwner": "Ask {owner} to connect Gmail to send. You can save this draft.",
  "saveDraft": "Save draft",
  "deleteDraft": "Delete draft",
  "deleteTitle": "Delete this draft?",
  "deleteBody": "It has not been sent. This can't be undone.",
  "send": "{count, plural, one {Send # invite} other {Send # invites}}",
  "sendMore": "{count, plural, one {Send # more invite} other {Send # more invites}}",
  "confirmSend": "{count, plural, one {Send # invite from {email} now?} other {Send # invites from {email} now?}}",
  "confirmSendMore": "{count, plural, one {Send # more invite from {email} now?} other {Send # more invites from {email} now?}}",
  "confirmBody": "Each person gets their own email with their personal answer link.",
  "sending": "{count, plural, one {Sending # invite} other {Sending # invites}}",
  "addDate": "Add a date and time to see the email."
},
```
and a new namespace:
```json
"MeetingPage": {
  "progressTitle": "Invites",
  "sending": "Sending {done} of {total}",
  "leave": "You can leave this page.",
  "queuedResume": "{count} queued, resumes about {time}",
  "pausedMissing": "Paused: connect Gmail to send.",
  "pausedBroken": "Paused: Gmail needs reconnecting.",
  "done": "{count, plural, one {# invite sent} other {# invites sent}}",
  "doneWithIssues": "{sent} sent · {failed} failed · {unknown} unknown",
  "bounces": "Bounce notices arrive in the sender's Gmail; TapNShow can't read them.",
  "connect": "Connect Gmail",
  "inviteMore": "Invite more people",
  "status": { "queued": "Queued", "sent": "Sent", "skipped": "Skipped", "failed": "Failed", "unknown": "Delivery unknown" },
  "reason": {
    "unsubscribed": "Unsubscribed",
    "meeting_cancelled": "Meeting cancelled",
    "meeting_started": "Meeting had started",
    "delivery_unknown": "Check the Sent folder",
    "other": "Gmail refused this address"
  },
  "invitees": "Invited people"
}
```

- [ ] **Step 2: Failing pure test** — `src/lib/meetings/quota-line.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { quotaLine } from "./quota-line";

describe("quotaLine", () => {
  it("sends everything now when the budget allows", () => {
    expect(quotaLine({ toSend: 30, sentLast24h: 0, dailyLimit: 400 })).toEqual({ now: 30, queued: 0, leftAfter: 370 });
  });

  it("queues what does not fit in the rolling window", () => {
    expect(quotaLine({ toSend: 30, sentLast24h: 390, dailyLimit: 400 })).toEqual({ now: 10, queued: 20, leftAfter: 0 });
    expect(quotaLine({ toSend: 5, sentLast24h: 410, dailyLimit: 400 })).toEqual({ now: 0, queued: 5, leftAfter: 0 });
  });
});
```
Implement `src/lib/meetings/quota-line.ts`:
```ts
/** Review step quota line (spec §8): what goes out now, what waits, what is left today. */
export function quotaLine(input: { toSend: number; sentLast24h: number; dailyLimit: number }) {
  const left = Math.max(input.dailyLimit - input.sentLast24h, 0);
  const now = Math.min(input.toSend, left);
  return { now, queued: input.toSend - now, leftAfter: left - now };
}
```
Append to `src/config/meetings.ts` (value from the ledger ruling):
```ts
/**
 * Whether Gmail keeps a custom From display name set by the Gmail API (checked at Task 10's first
 * real send; see the M4 ledger). When false, the Review step shows only the address.
 */
export const FROM_NAME_KEPT = true;
```

- [ ] **Step 3: Failing component tests** — `review-step.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { audienceFixture, meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { ReviewStep } from "./review-step";
import { WIZARD_STEPS } from "./wizard-steps";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const base = `/api/workspaces/${workspaceFixture.slug}`;
const meetingPath = `${base}/meetings/${MEETING_IDS.meeting}`;
const sender = (overrides: object = {}) => ({
  sender: { connectionId: "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60", email: "club@gmail.com", status: "active", connectedBy: "Daly", connectedAt: "2026-10-07T10:00:00Z", isMine: true, sentLast24h: 12, dailyLimit: 400 },
  ownerName: "Daly",
  myConnections: [],
  ...overrides,
});
let fetchMock: ReturnType<typeof routeFetch>;

const routes = (senderBody: object) => ({
  [`GET ${meetingPath}/audience`]: json(audienceFixture),
  [`GET ${base}/sender`]: json(senderBody),
  [`GET ${base}/contacts`]: json({ contacts: [], lists: [{ id: MEETING_IDS.members, name: "Members", contactCount: 2 }, { id: MEETING_IDS.committee, name: "Committee", contactCount: 2 }], limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 } }),
  [`GET ${meetingPath}/preview`]: json({ subject: "Weekly sync · Fri 9 Oct, 18:00", html: "<p>Hi Amira</p>", fromName: "Robotics Club", fromEmail: "club@gmail.com", recipientName: "Amira B." }),
  [`POST ${meetingPath}/send`]: json({ invited: 2, skippedUnsubscribed: 1 }),
});

const renderReview = (workspace = workspaceFixture) =>
  renderWithProviders(<ReviewStep slug={workspace.slug} meeting={meetingFixture} workspace={workspace} steps={WIZARD_STEPS} goTo={vi.fn()} />, { toaster: true });

beforeEach(() => {
  push.mockReset();
});

describe("ReviewStep", () => {
  it("summarizes, shows sender and quota, and sends only after the confirm dialog", async () => {
    fetchMock = routeFetch(routes(sender()));
    renderReview();
    expect(await screen.findByText("From Robotics Club <club@gmail.com>")).toBeInTheDocument();
    expect(screen.getByText("2 emails now · 386 left today on this Gmail")).toBeInTheDocument();
    expect(screen.getByText("1 unsubscribed skipped")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send 2 invites" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Send 2 invites from club@gmail.com now?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send 2 invites" }));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/send") && init?.method === "POST")).toBe(true);
    expect(push).toHaveBeenCalledWith(`/w/${workspaceFixture.slug}/meetings/${MEETING_IDS.meeting}`);
  });

  it("lets an Admin without a sender only save the draft", async () => {
    fetchMock = routeFetch(routes(sender({ sender: null })));
    renderReview({ ...workspaceFixture, myRole: "admin" });
    expect(await screen.findByText("Ask Daly to connect Gmail to send. You can save this draft.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  it("gives the Owner a connect link that returns to this step", async () => {
    fetchMock = routeFetch(routes(sender({ sender: null })));
    renderReview({ ...workspaceFixture, myRole: "owner" });
    const link = await screen.findByRole("link", { name: "Connect Gmail to send" });
    expect(link.getAttribute("href")).toBe(
      `/api/integrations/google/connect?workspace=${workspaceFixture.slug}&next=${encodeURIComponent(`/w/${workspaceFixture.slug}/meetings/${MEETING_IDS.meeting}/edit?step=review`)}`,
    );
  });

  it("opens the email preview in a sandboxed frame", async () => {
    fetchMock = routeFetch(routes(sender()));
    renderReview();
    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    const frame = await screen.findByTitle("Email preview");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("Hi Amira");
  });
});
```
(Add `within` to the `@testing-library/react` import.) `workspaceFixture.myRole` — check `src/test/fixtures/me.ts`; the first test assumes an Owner/Admin fixture.

`send-progress.test.tsx` — render `SendProgress` with `progressFixture` variants and assert the caption:
```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { progressFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { SendProgress } from "./send-progress";

const props = { slug: "club-ab12", canConnect: false };

describe("SendProgress", () => {
  it("shows live sending with the done count", () => {
    renderWithProviders(<SendProgress {...props} progress={progressFixture} />);
    expect(screen.getByText("Sending 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("You can leave this page.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("explains a quota wait, a pause and the finished state", () => {
    const { rerender } = renderWithProviders(
      <SendProgress {...props} progress={{ ...progressFixture, resumesAt: "2026-10-08T13:20:00.000Z" }} />,
    );
    expect(screen.getByText(/1 queued, resumes about \d{2}:\d{2}/)).toBeInTheDocument();
    rerender(<SendProgress {...props} progress={{ ...progressFixture, paused: 1, senderState: "missing" }} />);
    expect(screen.getByText("Paused: connect Gmail to send.")).toBeInTheDocument();
    rerender(
      <SendProgress {...props} progress={{ ...progressFixture, counts: { ...progressFixture.counts, queued: 0, sent: 1, failed: 1 } }} />,
    );
    expect(screen.getByText("1 sent · 1 failed · 0 unknown")).toBeInTheDocument();
    expect(screen.getByText("Bounce notices arrive in the sender's Gmail; TapNShow can't read them.")).toBeInTheDocument();
  });
});
```
(`rerender` from `renderWithProviders` loses the providers; wrap the second render in a small helper that re-renders with the same providers, or render three times with `unmount` between — follow whichever M3 test already does this.)

`invitee-list.test.tsx`: renders statuses "Sent" / "Queued", and for `{ status: "unknown", error: "delivery_unknown" }` shows "Delivery unknown" + "Check the Sent folder"; for `{ status: "failed", error: "Invalid To header" }` shows "Gmail refused this address".

`[id]/page.test.tsx`: a scheduled meeting renders the header, progress and "Invite more people" linking to `/edit?step=audience`; a Viewer sees no "Invite more people"; a draft calls `router.replace` to the editor.

- [ ] **Step 4: Implement** — `…/edit/email-preview-dialog.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The rendered invite in a sandboxed iframe (`sandbox=""`: no scripts, no navigation out, no
 * same-origin access), so the email's own styles cannot leak into the app.
 */
export function EmailPreviewDialog({
  open,
  onOpenChange,
  html,
  subject,
  recipientName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  subject: string;
  recipientName: string;
}) {
  const t = useTranslations("Wizard.review");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("previewTitle")}</DialogTitle>
          <p className="text-sm text-muted-ink">{t("previewTo", { name: recipientName })}</p>
          <p className="text-sm break-words text-muted-ink">{t("previewSubject", { subject })}</p>
        </DialogHeader>
        <iframe title={t("previewTitle")} sandbox="" srcDoc={html} className="h-[60dvh] w-full rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface" />
      </DialogContent>
    </Dialog>
  );
}
```
Check at 1024 px that `sm:max-w-xl` did not knock out the dialog's centering classes (tailwind-merge only conflicts on the same property group; `max-w` is safe, positional classes are not).

`…/edit/review-step.tsx`:
```tsx
"use client";

import { EnvelopeSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FROM_NAME_KEPT } from "@/config/meetings";
import { useDeleteMeeting, useMeetingAudience, useMeetingPreview, useSendMeeting } from "@/hooks/use-meetings";
import { useRoster } from "@/hooks/use-roster";
import { gmailConnectHref, useWorkspaceSender } from "@/hooks/use-sender";
import { ApiClientError } from "@/lib/api-client";
import { formatDeadline, formatMeetingWhen } from "@/lib/meetings/format";
import { quotaLine } from "@/lib/meetings/quota-line";
import { EmailPreviewDialog } from "./email-preview-dialog";
import { WizardFooter } from "./wizard-footer";
import type { WizardStepProps, WizardStep } from "./wizard-steps";

function Summary({ title, onEdit, editLabel, children }: { title: string; onEdit?: () => void; editLabel: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        {onEdit ? (
          <button type="button" className="min-h-11 px-2 font-bold underline" onClick={onEdit}>
            {editLabel}
          </button>
        ) : null}
      </div>
      <div className="text-sm text-muted-ink">{children}</div>
    </Card>
  );
}

/** Step 4: summary, email preview, sender and quota, then Send behind a confirm dialog (spec §7.2). */
export function ReviewStep({ slug, meeting, workspace, steps, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const audience = useMeetingAudience(slug, meeting.id);
  const roster = useRoster(slug);
  const sender = useWorkspaceSender(slug);
  const preview = useMeetingPreview(slug, meeting.id, meeting.startsAt !== null);
  const send = useSendMeeting(slug, meeting.id);
  const remove = useDeleteMeeting(slug);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!audience.data || !sender.data || !roster.data) {
    return <Skeleton className="h-96 w-full" />;
  }
  const inviteMore = meeting.status === "scheduled";
  const editable = (step: WizardStep) => (steps.includes(step) ? () => goTo(step) : undefined);
  const count = audience.data.counts.toInvite;
  const connection = sender.data.sender;
  const usable = connection?.status === "active";
  const isOwner = workspace.myRole === "owner";
  const when = meeting.startsAt ? formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt }) : null;
  const listNames = roster.data.lists.filter((l) => audience.data.listIds.includes(l.id)).map((l) => l.name);
  const quota = connection ? quotaLine({ toSend: count, sentLast24h: connection.sentLast24h, dailyLimit: connection.dailyLimit }) : null;
  const editUrl = `/w/${slug}/meetings/${meeting.id}/edit?step=review`;
  const confirmSend = () =>
    send.mutate(undefined, {
      onSuccess: ({ invited }) => {
        setConfirming(false);
        toast.success(t("review.sending", { count: invited }));
        router.push(`/w/${slug}/meetings/${meeting.id}`);
      },
      onError: () => setConfirming(false),
    });
  return (
    <div className="flex flex-col gap-3">
      <Summary title={meeting.title} editLabel={t("review.edit")} onEdit={editable("details")}>
        {when ? `${when.date}, ${when.start}–${when.end} (${when.zone})` : t("review.addDate")}
        {meeting.locationText ? ` · ${meeting.locationText}` : ""}
      </Summary>
      <Summary
        title={inviteMore ? t("review.newPeople", { count }) : t("review.people", { count })}
        editLabel={t("review.edit")}
        onEdit={editable("audience")}
      >
        {listNames.join(", ")}
        {audience.data.counts.unsubscribed > 0 ? (
          <span className="block">{t("review.unsubscribedSkipped", { count: audience.data.counts.unsubscribed })}</span>
        ) : null}
      </Summary>
      {!inviteMore ? (
        <Summary title={t(`review.mode.${meeting.responseMode}`)} editLabel={t("review.edit")} onEdit={editable("responses")}>
          {meeting.responseMode !== "announcement" && meeting.reasonRequired ? t("review.reasonRequired") : null}
          {meeting.responseDeadline ? ` · ${t("review.deadline", { deadline: formatDeadline(meeting.responseDeadline, meeting.timezone) })}` : null}
        </Summary>
      ) : null}
      <Card className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <EnvelopeSimple weight="bold" aria-hidden />
          <span className="truncate font-bold">{preview.data?.subject ?? t("review.preview")}</span>
        </div>
        <Button disabled={!preview.data} onClick={() => setPreviewOpen(true)}>
          {t("review.open")}
        </Button>
      </Card>
      {connection && usable ? (
        <div className="px-1 text-sm text-muted-ink">
          <p className="font-bold text-ink">
            {FROM_NAME_KEPT ? t("review.fromNamed", { name: workspace.name, email: connection.email }) : t("review.fromEmail", { email: connection.email })}
          </p>
          {quota ? (
            <p>
              {quota.queued > 0
                ? t("review.quotaQueued", { now: quota.now, queued: quota.queued })
                : t("review.quota", { now: quota.now, left: quota.leftAfter })}
            </p>
          ) : null}
        </div>
      ) : isOwner ? (
        <Button asChild tone="primary">
          <a href={gmailConnectHref(slug, editUrl)}>{t("review.connect")}</a>
        </Button>
      ) : (
        <p className="px-1 text-sm font-bold">{t("review.askOwner", { owner: sender.data.ownerName })}</p>
      )}
      {send.error instanceof ApiClientError ? <p role="alert" className="font-bold">{tErrors(send.error.code)}</p> : null}
      {!inviteMore ? (
        <button type="button" className="min-h-11 self-start px-1 font-bold underline" onClick={() => setDeleting(true)}>
          {t("review.deleteDraft")}
        </button>
      ) : null}
      {preview.data ? (
        <EmailPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} html={preview.data.html} subject={preview.data.subject} recipientName={preview.data.recipientName} />
      ) : null}
      {connection ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={inviteMore ? t("review.confirmSendMore", { count, email: connection.email }) : t("review.confirmSend", { count, email: connection.email })}
          description={t("review.confirmBody")}
          confirmLabel={inviteMore ? t("review.sendMore", { count }) : t("review.send", { count })}
          pending={send.isPending}
          onConfirm={confirmSend}
        />
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("review.deleteTitle")}
        description={t("review.deleteBody")}
        confirmLabel={t("review.deleteDraft")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate(meeting.id, { onSuccess: () => router.push(`/w/${slug}/meetings`) })}
      />
      {usable ? (
        <WizardFooter
          backLabel={inviteMore ? t("back") : t("review.saveDraft")}
          onBack={() => (inviteMore ? goTo("audience") : router.push(`/w/${slug}/meetings`))}
          nextLabel={inviteMore ? t("review.sendMore", { count }) : t("review.send", { count })}
          nextDisabled={count === 0 || meeting.startsAt === null}
          onNext={() => setConfirming(true)}
        />
      ) : (
        <WizardFooter backLabel={t("back")} onBack={() => goTo(steps[steps.indexOf("review") - 1])} nextLabel={t("review.saveDraft")} onNext={() => router.push(`/w/${slug}/meetings`)} />
      )}
    </div>
  );
}
```
(Import `type ReactNode` from "react" for `Summary` instead of the `React.` namespace. The test expects "Save draft" to be a button: with a usable sender it is the footer's Back; without one it is the Next slot.)

`send-progress.tsx`:
```tsx
"use client";

import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { gmailConnectHref } from "@/hooks/use-sender";
import type { MeetingProgress } from "@/shared/api/meetings";

/** Live send progress (spec §7.2): a bar, one caption for the current state, the bounce note. */
export function SendProgress({ slug, progress, canConnect }: { slug: string; progress: MeetingProgress; canConnect: boolean }) {
  const t = useTranslations("MeetingPage");
  const { counts } = progress;
  const done = counts.total - counts.queued;
  const paused = progress.paused > 0 || progress.senderState !== "ok";
  const caption = paused
    ? progress.senderState === "broken"
      ? t("pausedBroken")
      : t("pausedMissing")
    : progress.resumesAt
      ? t("queuedResume", { count: counts.queued, time: format(new Date(progress.resumesAt), "HH:mm") })
      : counts.queued > 0
        ? t("sending", { done, total: counts.total })
        : counts.failed + counts.unknown > 0
          ? t("doneWithIssues", { sent: counts.sent, failed: counts.failed, unknown: counts.unknown })
          : t("done", { count: counts.sent });
  const tone = paused ? "bg-fill-warning" : counts.queued > 0 ? "bg-fill-info" : "bg-fill-success";
  return (
    <Card as="section" aria-live="polite" className={`flex flex-col gap-2 text-on-fill ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg">{t("progressTitle")}</h2>
        <span className="font-bold">{done} / {counts.total}</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={done} className="h-4 overflow-hidden rounded-full border-[length:var(--tn-border-width)] border-outline bg-surface">
        <div className="h-full border-r-[length:var(--tn-border-width)] border-outline bg-fill-success transition-[width] motion-reduce:transition-none" style={{ width: `${counts.total ? (done / counts.total) * 100 : 0}%` }} />
      </div>
      <p className="font-bold">{caption}</p>
      {counts.queued > 0 && !paused ? <p className="text-sm">{t("leave")}</p> : null}
      {paused && canConnect ? (
        <Button asChild tone="primary">
          <a href={gmailConnectHref(slug)}>{t("connect")}</a>
        </Button>
      ) : null}
      <p className="text-sm">{t("bounces")}</p>
    </Card>
  );
}
```
The inline `style` width is the one dynamic value a token cannot express; keep it.

`invitee-list.tsx`: a `Card` with a heading "Invited people" and one row per invitee: name, email (truncate), a status pill (`Sent` success fill, `Queued` neutral, `Skipped` neutral, `Failed` danger, `Delivery unknown` warning) and, for failed/unknown/skipped, a reason line mapped with `MeetingPage.reason.<code>` when the code is one of `unsubscribed`, `meeting_cancelled`, `meeting_started`, `delivery_unknown`, else `reason.other`. Show the first 50 with "Show N more" (`AUDIENCE_PAGE_SIZE`).

`meeting-header.tsx`: title (`font-display text-3xl`, `break-words`), "Fri 9 Oct, 18:00–19:00 (Africa/Tunis)", and the place and/or link (link opens in a new tab with `rel="noopener noreferrer"`), plus "(your time: …)" when the viewer's browser zone differs (spec §7.10; `browserTimezone()` from `src/lib/timezones.ts`).

`[id]/page.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ComingSoon } from "@/components/shell/coming-soon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { publicEnv } from "@/config/public-env";
import { useMeeting, useMeetingProgress } from "@/hooks/use-meetings";
import { useWorkspace } from "@/hooks/use-workspace";
import { InviteeList } from "./invitee-list";
import { MeetingHeader } from "./meeting-header";
import { SendProgress } from "./send-progress";

/** `/w/[slug]/meetings/[id]` (spec §7.2): details, live send progress, invitees, Invite more. */
export default function MeetingPage() {
  const t = useTranslations("MeetingPage");
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const meeting = useMeeting(slug, id);
  const workspace = useWorkspace(slug);
  const progress = useMeetingProgress(slug, id, meeting.data?.status === "scheduled");
  useEffect(() => {
    if (meeting.data?.status === "draft") {
      router.replace(`/w/${slug}/meetings/${id}/edit`);
    }
  }, [id, meeting.data?.status, router, slug]);
  if (!publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED) {
    return <ComingSoon area="meetings" />;
  }
  if (!meeting.data || !workspace.data || meeting.data.status === "draft") {
    return <Skeleton className="h-96 w-full" />;
  }
  const canEdit = workspace.data.myRole !== "viewer";
  const started = meeting.data.startsAt !== null && new Date(meeting.data.startsAt) <= new Date();
  return (
    <div className="flex flex-col gap-4">
      <MeetingHeader meeting={meeting.data} />
      {progress.data ? <SendProgress slug={slug} progress={progress.data} canConnect={workspace.data.myRole === "owner"} /> : <Skeleton className="h-32 w-full" />}
      {canEdit && meeting.data.status === "scheduled" && !started ? (
        <Button asChild tone="primary">
          <Link href={`/w/${slug}/meetings/${id}/edit?step=audience`}>{t("inviteMore")}</Link>
        </Button>
      ) : null}
      {progress.data ? <InviteeList invitees={progress.data.invitees} /> : null}
    </div>
  );
}
```

- [ ] **Step 5: Verify and commit** — `bun run test src/app/w src/lib && bun run lint && bun run typecheck` → PASS. Screenshots at 390 px light, 320 px dark and 1024 px of: Review (sender present), Review (Admin, no sender), the confirm dialog (centered at 1024 px), the preview dialog, the meeting page while sending, paused, and finished with one failure. Look at each before committing. Commit `feat(ui): Review step, Send confirmation and the meeting page`, PR, merge.

---

### Task 16: Settings — Sending + Meeting defaults cards; Home checklist and needs-attention

**Labels:** `area:ui`

**Files:**
- Create: `src/app/w/[slug]/settings/sending-section.tsx` (+ test), `src/app/w/[slug]/settings/meeting-defaults-section.tsx` (+ test), `src/app/w/[slug]/settings/gmail-connect-result.tsx` (+ test), `src/app/w/[slug]/needs-attention.tsx` (+ test)
- Modify: `src/app/w/[slug]/settings/page.tsx` (+ test), `src/app/w/[slug]/home-checklist.tsx` (+ test), `src/app/w/[slug]/page.tsx`, `messages/en.json` (`Settings.sending`, `Settings.defaults`, `WorkspaceHome`)

**Interfaces:**
- Consumes: Task 4 `useWorkspaceSender`, `useSetSender`, `useDisconnectGmail`, `gmailConnectHref`, `useMeetingDefaults`, `useUpdateMeetingDefaults`, `GMAIL_CONNECT_ERRORS`; Task 11 `useMeetings`; Task 12 `ConfirmDialog`; M2 `Card`, `Sticker`, `Switch`, `Chip`, `SegmentedControl`, `Input`.
- Produces:
  - `<SendingSection workspace />` (anchor `id="sending"`): status line, usage, Owner actions (Connect / Reconnect / Replace / Use <address>), Disconnect for the person who connected; connect-screen guidance (group Gmail suggestion, "Admins of <workspace> can send…", what to click on Google's unverified-app screen).
  - `<MeetingDefaultsSection workspace />`: each change saves at once (optimistic, rolled back with a toast on failure); Viewers see the values read-only.
  - `<GmailConnectResult />`: reads `?gmail=connected` / `?gmail_error=<code>` once, shows a toast (success) or an inline explanation (error), then removes the parameter with `router.replace`.
  - `<NeedsAttention workspace />` on Home for Owner/Admin: "Gmail sending needs reconnecting" (broken; Owner gets Reconnect, Admin gets "Ask <Owner>") and, for the Owner, "A draft is waiting: connect Gmail to send it" when there is no sender and at least one draft.
  - Home checklist: "Connect Gmail to send invites" links to Settings > Sending (Owner) and shows **Done** once a sender is active; Admins see it as information ("<Owner> connects Gmail").

- [ ] **Step 1: Messages** — `Settings`:
```json
"sending": {
  "title": "Sending",
  "none": "No Gmail connected yet. Meeting invites can't be sent until the Owner connects one.",
  "from": "Sending from {workspace} <{email}>",
  "connectedBy": "Connected by {name} on {date}",
  "usage": "{sent} of {limit} emails in the last 24 hours",
  "active": "Active",
  "broken": "Needs reconnecting",
  "brokenHelp": "Google stopped accepting access to this Gmail (for example after a password change). Queued emails wait until it is reconnected.",
  "askOwner": "Only {owner}, the Owner, can connect or change the sending Gmail.",
  "connect": "Connect Gmail",
  "reconnect": "Reconnect Gmail",
  "replace": "Use a different Gmail",
  "use": "Use {email}",
  "useTitle": "Send {workspace}'s emails from {email}?",
  "useBody": "Queued and future meeting emails go out from this address.",
  "replaceTitle": "Connect a different Gmail for {workspace}?",
  "replaceBody": "Google will ask which account to use. Emails already sent stay in the old account's Sent folder.",
  "replaceAction": "Continue to Google",
  "disconnect": "Disconnect {email}",
  "disconnectTitle": "Disconnect {email}?",
  "disconnectBody": "Sending pauses in: {workspaces}. Nothing queued is lost; it waits until a Gmail is connected again.",
  "disconnectAction": "Disconnect",
  "disconnected": "Gmail disconnected",
  "tipGroup": "Tip: connect your group's own Gmail (for example the club's account), not a personal one. Each meeting's emails appear as one conversation in its Sent folder.",
  "tipAdmins": "Admins of {workspace} can send meeting emails from this address.",
  "unverifiedTitle": "Google shows \"Google hasn't verified this app\"",
  "unverifiedBody": "That's expected while TapNShow waits for Google's review. Click Advanced, then Go to tapnshow.vercel.app, then allow \"Send email on your behalf\".",
  "connected": "Gmail connected. You can send meetings now.",
  "error": {
    "unavailable": "Gmail sending isn't available on this version of the site.",
    "owner_only": "Only the workspace Owner can connect Gmail.",
    "cancelled": "Connecting was cancelled. Nothing changed.",
    "scope_denied": "Google didn't give permission to send email. Try again and keep \"Send email on your behalf\" ticked.",
    "no_refresh_token": "Google didn't return lasting access. Try again; if it keeps happening, remove TapNShow at myaccount.google.com/permissions first.",
    "failed": "Connecting Gmail failed. Try again."
  }
},
"defaults": {
  "title": "Meeting defaults",
  "help": "New meetings start with these. Each meeting can change them.",
  "saved": "Saved",
  "duration": "Default duration"
}
```
(Mode, delay, reason, comment and footer labels reuse `Wizard.responses.*` and `Wizard.details.*`.) `WorkspaceHome`: `"connectGmailAction": "Connect"`, `"done": "Done"`, `"ownerConnects": "{owner} connects Gmail"`, `"attentionTitle": "Needs attention"`, `"attentionBroken": "Gmail sending needs reconnecting. Queued invites are paused."`, `"attentionDraft": "A draft is waiting: connect Gmail to send it."`, `"attentionAskOwner": "Ask {owner} to reconnect Gmail."`, `"reconnect": "Reconnect"`, `"connect": "Connect Gmail"`.

- [ ] **Step 2: Failing tests** — `sending-section.test.tsx` (`routeFetch` on `GET /api/workspaces/robotics-cd34/sender`; `next/navigation` mocked):
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { SendingSection } from "./sending-section";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const CONN = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const OTHER = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f61";
const path = "/api/workspaces/robotics-cd34/sender";
const active = {
  sender: { connectionId: CONN, email: "club@gmail.com", status: "active", connectedBy: "Amira Ben Ali", connectedAt: "2026-10-07T10:00:00Z", isMine: true, sentLast24h: 12, dailyLimit: 400 },
  ownerName: "Amira Ben Ali",
  myConnections: [
    { id: CONN, email: "club@gmail.com", status: "active", usedBy: ["Robotics Club", "Chess Club"] },
    { id: OTHER, email: "other@gmail.com", status: "active", usedBy: [] },
  ],
};

describe("SendingSection", () => {
  it("guides the Owner to connect when nothing is connected", async () => {
    routeFetch({ [`GET ${path}`]: json({ sender: null, ownerName: "Amira Ben Ali", myConnections: [] }) });
    renderWithProviders(<SendingSection workspace={workspaceFixture} />);
    const connect = await screen.findByRole("link", { name: "Connect Gmail" });
    expect(connect).toHaveAttribute("href", "/api/integrations/google/connect?workspace=robotics-cd34");
    expect(screen.getByText(/connect your group's own Gmail/)).toBeInTheDocument();
    expect(screen.getByText(/Google hasn't verified this app/)).toBeInTheDocument();
  });

  it("shows the sender, usage and lets the person who connected it disconnect after confirming", async () => {
    const fetchMock = routeFetch({
      [`GET ${path}`]: json(active),
      [`DELETE /api/integrations/google/connections/${CONN}`]: json({ ok: true }),
    });
    renderWithProviders(<SendingSection workspace={workspaceFixture} />, { toaster: true });
    expect(await screen.findByText("Sending from Robotics Club <club@gmail.com>")).toBeInTheDocument();
    expect(screen.getByText("12 of 400 emails in the last 24 hours")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect club@gmail.com" }));
    expect(screen.getByText(/Sending pauses in: Robotics Club, Chess Club/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("switches to another of my connections after confirming", async () => {
    const fetchMock = routeFetch({ [`GET ${path}`]: json(active), [`PUT ${path}`]: json({ ok: true }) });
    renderWithProviders(<SendingSection workspace={workspaceFixture} />);
    await userEvent.click(await screen.findByRole("button", { name: "Use other@gmail.com" }));
    await userEvent.click(screen.getByRole("button", { name: "Use other@gmail.com" }));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ connectionId: OTHER });
  });

  it("tells Admins who can change it", async () => {
    routeFetch({ [`GET ${path}`]: json({ ...active, sender: { ...active.sender, isMine: false }, myConnections: [] }) });
    renderWithProviders(<SendingSection workspace={{ ...workspaceFixture, myRole: "admin" }} />);
    expect(await screen.findByText("Only Amira Ben Ali, the Owner, can connect or change the sending Gmail.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Gmail/ })).not.toBeInTheDocument();
  });
});
```
(The second "Use other@gmail.com" click hits the confirm dialog's button; both share the label — scope the second query with `within(screen.getByRole("dialog"))`.)

`meeting-defaults-section.test.tsx`: Owner toggles the 20-minute delay chip → `PATCH …/meeting-defaults` body `{ delayOptions: [5, 10, 15, 20, 30] }`; changing the mode to RSVP hides the delay chips; a Viewer sees "Going / late / absent" as text and no chips or switches.

`gmail-connect-result.test.tsx`: with `?gmail_error=scope_denied` it shows the scope explanation and calls `router.replace` without the parameter; with `?gmail=connected` it shows the success toast.

`needs-attention.test.tsx`: broken sender + Owner → "Gmail sending needs reconnecting. Queued invites are paused." with a Reconnect link; broken + Admin → "Ask Amira Ben Ali to reconnect Gmail."; no sender + one draft + Owner → the draft item; everything fine → renders nothing.

`home-checklist.test.tsx` (extend): the Gmail step shows "Done" when the sender is active, and links to `/w/robotics-cd34/settings#sending` otherwise.

- [ ] **Step 3: Implement** — `src/app/w/[slug]/settings/sending-section.tsx`:
```tsx
"use client";

import { EnvelopeSimple, Warning } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { gmailConnectHref, useDisconnectGmail, useSetSender, useWorkspaceSender } from "@/hooks/use-sender";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { GmailConnectResult } from "./gmail-connect-result";

type Pending =
  | { kind: "use"; id: string; email: string }
  | { kind: "replace" }
  | { kind: "disconnect"; id: string; email: string; usedBy: string[] }
  | null;

/** Settings > Sending (spec §7.15): the workspace's sender Gmail. Only the Owner changes it. */
export function SendingSection({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("Settings.sending");
  const sender = useWorkspaceSender(workspace.slug);
  const setSender = useSetSender(workspace.slug);
  const disconnect = useDisconnectGmail(workspace.slug);
  const [pending, setPending] = useState<Pending>(null);
  const isOwner = workspace.myRole === "owner";
  if (!sender.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  const { sender: current, myConnections, ownerName } = sender.data;
  const connectHref = gmailConnectHref(workspace.slug);
  const others = myConnections.filter((c) => c.status === "active" && c.id !== current?.connectionId);
  const mine = current?.isMine ? myConnections.find((c) => c.id === current.connectionId) : undefined;
  return (
    <Card as="section" id="sending" className="flex scroll-mt-20 flex-col gap-3">
      <GmailConnectResult />
      <div className="flex items-center gap-3">
        <Sticker tone={current?.status === "broken" ? "warning" : "primary"}>
          {current?.status === "broken" ? <Warning weight="bold" /> : <EnvelopeSimple weight="bold" />}
        </Sticker>
        <h2 className="font-display text-xl">{t("title")}</h2>
      </div>
      {current ? (
        <div className="flex flex-col gap-1">
          <p className="font-bold break-words">{t("from", { workspace: workspace.name, email: current.email })}</p>
          <p className="text-sm text-muted-ink">
            {t("connectedBy", { name: current.connectedBy, date: format(new Date(current.connectedAt), "d MMM yyyy") })}
          </p>
          <p className="text-sm">
            <span className="rounded-full border-2 border-outline px-2 text-xs font-bold">{current.status === "active" ? t("active") : t("broken")}</span>{" "}
            {t("usage", { sent: current.sentLast24h, limit: current.dailyLimit })}
          </p>
          {current.status === "broken" ? <p className="text-sm">{t("brokenHelp")}</p> : null}
        </div>
      ) : (
        <p>{t("none")}</p>
      )}
      {isOwner ? (
        <div className="flex flex-col gap-2">
          {!current || current.status === "broken" ? (
            <Button asChild tone="primary">
              <a href={connectHref}>{current ? t("reconnect") : t("connect")}</a>
            </Button>
          ) : (
            <Button onClick={() => setPending({ kind: "replace" })}>{t("replace")}</Button>
          )}
          {others.map((connection) => (
            <Button key={connection.id} onClick={() => setPending({ kind: "use", id: connection.id, email: connection.email })}>
              {t("use", { email: connection.email })}
            </Button>
          ))}
          <p className="text-sm text-muted-ink">{t("tipGroup")}</p>
          <p className="text-sm text-muted-ink">{t("tipAdmins", { workspace: workspace.name })}</p>
          <details className="rounded-control border-[length:var(--tn-border-width)] border-outline p-3 text-sm">
            <summary className="min-h-11 cursor-pointer font-bold">{t("unverifiedTitle")}</summary>
            <p className="mt-2">{t("unverifiedBody")}</p>
          </details>
        </div>
      ) : (
        <p className="text-sm text-muted-ink">{t("askOwner", { owner: ownerName })}</p>
      )}
      {mine ? (
        <Button tone="danger" onClick={() => setPending({ kind: "disconnect", id: mine.id, email: mine.email, usedBy: mine.usedBy })}>
          {t("disconnect", { email: mine.email })}
        </Button>
      ) : null}
      <ConfirmDialog
        open={pending?.kind === "use"}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.kind === "use" ? t("useTitle", { workspace: workspace.name, email: pending.email }) : ""}
        description={t("useBody")}
        confirmLabel={pending?.kind === "use" ? t("use", { email: pending.email }) : ""}
        pending={setSender.isPending}
        onConfirm={() => pending?.kind === "use" && setSender.mutate(pending.id, { onSuccess: () => setPending(null) })}
      />
      <ConfirmDialog
        open={pending?.kind === "replace"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("replaceTitle", { workspace: workspace.name })}
        description={t("replaceBody")}
        confirmLabel={t("replaceAction")}
        onConfirm={() => {
          window.location.href = connectHref;
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "disconnect"}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.kind === "disconnect" ? t("disconnectTitle", { email: pending.email }) : ""}
        description={pending?.kind === "disconnect" ? t("disconnectBody", { workspaces: pending.usedBy.join(", ") }) : ""}
        confirmLabel={t("disconnectAction")}
        tone="danger"
        pending={disconnect.isPending}
        onConfirm={() =>
          pending?.kind === "disconnect" &&
          disconnect.mutate(pending.id, {
            onSuccess: () => {
              setPending(null);
              toast(t("disconnected"));
            },
          })
        }
      />
    </Card>
  );
}
```
The repo's lint forbids `window.location.assign`; plain `window.location.href =` for a full navigation to an API redirect route may be flagged too. If it is, render the replace dialog's confirm as `<Button asChild tone="primary"><a href={connectHref}>…</a></Button>` by giving `ConfirmDialog` an optional `confirmHref` prop (link instead of button) — add that prop in this task with a test.

`gmail-connect-result.tsx`:
```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GMAIL_CONNECT_ERRORS, type GmailConnectError } from "@/shared/api/sender";

/** Shows the outcome of the Gmail connect round trip once, then cleans the URL. */
export function GmailConnectResult() {
  const t = useTranslations("Settings.sending");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<GmailConnectError | null>(null);
  useEffect(() => {
    const code = params.get("gmail_error");
    const connected = params.get("gmail") === "connected";
    if (!code && !connected) {
      return;
    }
    const known = GMAIL_CONNECT_ERRORS.find((value) => value === code) ?? (code ? "failed" : null);
    if (connected) {
      toast.success(t("connected"));
    }
    setError(known);
    const next = new URLSearchParams(params.toString());
    next.delete("gmail");
    next.delete("gmail_error");
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}${window.location.hash}`, { scroll: false });
  }, [params, pathname, router, t]);
  return error ? (
    <p role="alert" className="rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-danger p-3 text-sm font-bold text-on-fill">
      {t(`error.${error}`)}
    </p>
  ) : null;
}
```
(Also mount `<GmailConnectResult />` in the Review step (Task 15's file) so a connect started there reports back there.)

`src/components/forms/switch-row.tsx` (moved out of `responses-step.tsx`, which now imports it):
```tsx
"use client";

import { Switch } from "@/components/ui/switch";

/** A labelled switch row (label on the left, 44 px switch on the right). */
export function SwitchRow({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
```
`meeting-defaults-section.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SwitchRow } from "@/components/forms/switch-row";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { DELAY_OPTION_CHOICES, DELAY_OPTIONS_MAX, DURATION_CHOICES, FOOTER_NOTE_MAX } from "@/config/meetings";
import { useMeetingDefaults, useUpdateMeetingDefaults } from "@/hooks/use-meeting-defaults";
import { type MeetingDefaults, responseModeSchema, type UpdateMeetingDefaultsBody } from "@/shared/api/meeting-settings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Settings > Meeting defaults (spec §7.2): each change saves at once; Viewers read only. */
export function MeetingDefaultsSection({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("Settings.defaults");
  const tw = useTranslations("Wizard");
  const tErrors = useTranslations("ApiErrors");
  const defaults = useMeetingDefaults(workspace.slug);
  const update = useUpdateMeetingDefaults(workspace.slug);
  const [footer, setFooter] = useState<string | null>(null);
  if (!defaults.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  const value: MeetingDefaults = defaults.data;
  const readOnly = workspace.myRole === "viewer";
  const save = (patch: UpdateMeetingDefaultsBody) =>
    update.mutate(patch, { onError: () => toast.error(tErrors("internal")) });
  const minutes = (count: number) =>
    count < 60 ? tw("details.minutes", { count }) : count % 60 === 0 ? tw("details.hours", { hours: count / 60 }) : tw("details.hoursMinutes", { hours: Math.floor(count / 60), minutes: count % 60 });
  const toggleDelay = (delay: number) => {
    const next = value.delayOptions.includes(delay)
      ? value.delayOptions.filter((d) => d !== delay)
      : value.delayOptions.length < DELAY_OPTIONS_MAX
        ? [...value.delayOptions, delay].sort((a, b) => a - b)
        : value.delayOptions;
    if (next !== value.delayOptions) {
      save({ delayOptions: next });
    }
  };
  if (readOnly) {
    return (
      <Card as="section" className="flex flex-col gap-2">
        <h2 className="font-display text-xl">{t("title")}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-bold">{tw("responses.mode")}</dt>
          <dd>{tw(`review.mode.${value.responseMode}`)}</dd>
          <dt className="font-bold">{t("duration")}</dt>
          <dd>{minutes(value.durationMinutes)}</dd>
        </dl>
      </Card>
    );
  }
  return (
    <Card as="section" className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-xl">{t("title")}</h2>
        <p className="text-sm text-muted-ink">{t("help")}</p>
      </div>
      <SegmentedControl
        label={tw("responses.mode")}
        value={value.responseMode}
        onValueChange={(mode) => save({ responseMode: responseModeSchema.parse(mode) })}
        options={[
          { value: "announcement", label: tw("responses.announcement") },
          { value: "rsvp", label: tw("responses.rsvp") },
          { value: "attendance", label: tw("responses.attendance") },
        ]}
      />
      {value.responseMode === "attendance" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-bold">{tw("responses.delays")}</legend>
          <div className="flex flex-wrap gap-2">
            {DELAY_OPTION_CHOICES.map((delay) => (
              <Chip key={delay} pressed={value.delayOptions.includes(delay)} onPressedChange={() => toggleDelay(delay)}>
                {tw("details.minutes", { count: delay })}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}
      {value.responseMode !== "announcement" ? (
        <>
          <SwitchRow id="default-reason" label={tw("responses.reasonRequired")} checked={value.reasonRequired} onChange={(checked) => save({ reasonRequired: checked })} />
          <SwitchRow id="default-comments" label={tw("responses.comments")} checked={value.commentsEnabled} onChange={(checked) => save({ commentsEnabled: checked })} />
          <Input
            id="default-footer"
            label={tw("responses.footerNote")}
            maxLength={FOOTER_NOTE_MAX}
            value={footer ?? value.footerNote}
            onChange={(event) => setFooter(event.target.value)}
            onBlur={() => {
              if (footer !== null && footer.trim() !== value.footerNote) {
                save({ footerNote: footer.trim() });
              }
              setFooter(null);
            }}
          />
        </>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold">{t("duration")}</legend>
        <div className="flex flex-wrap gap-2">
          {DURATION_CHOICES.map((duration) => (
            <Chip key={duration} pressed={value.durationMinutes === duration} onPressedChange={() => save({ durationMinutes: duration })}>
              {minutes(duration)}
            </Chip>
          ))}
        </div>
      </fieldset>
    </Card>
  );
}
```

`needs-attention.tsx`:
```tsx
"use client";

import { Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import { useMeetings } from "@/hooks/use-meetings";
import { gmailConnectHref, useWorkspaceSender } from "@/hooks/use-sender";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Home "needs attention" (spec §7.2, §7.15): a broken sender, or drafts waiting for a sender. */
export function NeedsAttention({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("WorkspaceHome");
  const sender = useWorkspaceSender(workspace.slug);
  const meetings = useMeetings(workspace.slug);
  if (!sender.data || workspace.myRole === "viewer") {
    return null;
  }
  const isOwner = workspace.myRole === "owner";
  const broken = sender.data.sender?.status === "broken";
  const draftWaiting = isOwner && !sender.data.sender && (meetings.data ?? []).some((m) => m.status === "draft");
  if (!broken && !draftWaiting) {
    return null;
  }
  return (
    <Card as="section" className="flex flex-col gap-3 bg-fill-warning text-on-fill">
      <div className="flex items-center gap-3">
        <Sticker tone="warning">
          <Warning weight="bold" />
        </Sticker>
        <h2 className="font-display text-xl">{t("attentionTitle")}</h2>
      </div>
      <p className="font-bold">{broken ? t("attentionBroken") : t("attentionDraft")}</p>
      {isOwner ? (
        <Button asChild tone="primary">
          <a href={gmailConnectHref(workspace.slug)}>{broken ? t("reconnect") : t("connect")}</a>
        </Button>
      ) : (
        <p>{t("attentionAskOwner", { owner: sender.data.ownerName })}</p>
      )}
      <Link className="sr-only" href={`/w/${workspace.slug}/settings#sending`}>
        {t("connectGmail")}
      </Link>
    </Card>
  );
}
```
(Drop the `sr-only` link if it adds nothing for screen readers once you check it in the a11y tree; it is there only so keyboard users can reach the full Sending settings from Home.)

`page.tsx` (Home): render `<NeedsAttention workspace={…} />` above `<HomeChecklist />` when `publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED`.

`home-checklist.tsx`: when the flag is on, the `connectGmail` step gets `href: (slug) => \`/w/${slug}/settings#sending\``, `actionKey: "connectGmailAction"` for the Owner; it reads `useWorkspaceSender(slug)` and shows a "Done" pill when `sender?.status === "active"`; for Admins it shows `t("ownerConnects", { owner })` instead of a button. Keep "Coming soon" for `connectSheets`.

`settings/page.tsx`: when the flag is on, insert `<SendingSection workspace={…} />` and `<MeetingDefaultsSection workspace={…} />` after `GeneralSection`. `SendingSection` uses `useSearchParams` (through `GmailConnectResult`): wrap it in `<Suspense fallback={<Skeleton className="h-40 w-full" />}>` per the Next 16 `useSearchParams` doc. Settings page test: with the flag the two headings render.

- [ ] **Step 4: Verify and commit** — `bun run test src/app/w src/components && bun run lint && bun run typecheck` → PASS. Screenshots at 390 px light, 320 px dark and 1024 px of Settings (no sender as Owner; connected as Owner; broken as Admin), both confirm dialogs, Home with the needs-attention card. Look before committing. Commit `feat(ui): Sending and Meeting defaults settings, Home attention items`, PR, merge.

---

### Task 17: Public pages `/u`, `/report`, `/r` placeholder; token API; headers + scrubbing; roster marks

**Labels:** `area:ui`, `area:api`, `area:security`

**Files:**
- Create: `src/shared/api/tokens.ts`, `src/server/queries/tokens.ts`, `src/server/http/token-context.ts` (+ test), `src/app/api/r/[token]/route.ts` (+ test), `src/app/api/r/[token]/unsubscribe/route.ts` (+ test), `src/app/api/r/[token]/resubscribe/route.ts` (+ test), `src/app/api/r/[token]/report/route.ts` (+ test), `src/components/public/public-page.tsx`, `src/components/public/meeting-card.tsx`, `src/app/u/[token]/page.tsx` + `unsubscribe-view.tsx` (+ test), `src/app/report/[token]/page.tsx` + `report-view.tsx` (+ test), `src/app/r/[token]/page.tsx` + `response-placeholder.tsx` (+ test), `src/hooks/use-token-page.ts`
- Modify: `src/config/security-headers.ts` (+ test), `src/lib/observability/scrub.ts` (+ test), `src/shared/api/roster.ts`, `src/test/fixtures/roster.ts`, `src/server/queries/roster.ts`, `src/app/w/[slug]/lists/contact-card.tsx` and `roster-grid.tsx` (+ their tests), `messages/en.json` (`TokenPages`, `Lists.markUnsubscribed`, `Lists.markReported`)

**Interfaces:**
- Consumes: Task 7 `token_*` RPCs and `check_token_rate_limit`; Task 3 `inviteeTokenHash`; Task 8 `formatMeetingWhen`; M2 `createSupabaseAdminClient`, `clientIp`, `apiError`, `ok`.
- Produces:
  - `src/shared/api/tokens.ts`: `TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/`, `tokenInfoSchema` (`TokenInfo` = `{ workspaceName, maskedEmail, unsubscribed, reported, meeting: { title, startsAt, timezone, durationMinutes, locationMode, locationText, meetingUrl, status } }`).
  - `loadTokenContext(request: Request, token: string): Promise<{ ok: true; client; tokenHash } | { ok: false; response }>` — malformed token → 404 (same as unknown, so nothing is revealed); rate limit (per IP and per token) → 429.
  - Routes: `GET /api/r/[token]` → `TokenInfo`; `GET /api/r/[token]/unsubscribe` → 303 to `/u/[token]` (a browser opening the List-Unsubscribe link); `POST /api/r/[token]/unsubscribe` → `{ ok: true }` (our button **and** RFC 8058 one-click: `application/x-www-form-urlencoded` body `List-Unsubscribe=One-Click`); `POST …/resubscribe` → `{ ok: true }`; `POST …/report` → `{ ok: true }`. Unknown token → 404 `not_found`.
  - Pages `/u/[token]`, `/report/[token]`, `/r/[token]` (no session needed; the proxy only guards `/welcome` and `/w/**`).
  - `Roster` contacts gain `unsubscribed: boolean` and `reported: boolean` (default `false` in the schema so older fixtures still parse); the roster card and grid row show "Unsubscribed" / "Reported: not my group".

- [ ] **Step 1: Messages** —
```json
"TokenPages": {
  "invalidTitle": "This link isn't valid",
  "invalidBody": "It may have been mistyped or the invitation was removed.",
  "limited": "Too many tries. Wait a few minutes and try again.",
  "unsubscribeTitle": "Stop emails from {workspace}?",
  "unsubscribeBody": "{email} will stop getting meeting emails from {workspace}. Other groups on TapNShow are not affected.",
  "unsubscribe": "Unsubscribe",
  "unsubscribedTitle": "You're unsubscribed",
  "unsubscribedBody": "{workspace} won't email {email} again.",
  "resubscribe": "Subscribe again",
  "resubscribedTitle": "You're subscribed again",
  "resubscribedBody": "You'll get {workspace}'s meeting emails again.",
  "reportTitle": "Don't know this group?",
  "reportBody": "If you never joined {workspace}, tell us. We'll stop its emails to {email} and our team will look at it.",
  "report": "Report and unsubscribe",
  "reportedTitle": "Thanks for telling us",
  "reportedBody": "You won't hear from {workspace} again.",
  "placeholderTitle": "Answering opens soon",
  "placeholderBody": "You'll be able to answer this invitation here very soon. The meeting details are below.",
  "when": "When",
  "where": "Where",
  "join": "Join online",
  "cancelled": "This meeting was cancelled."
}
```
`Lists.markUnsubscribed`: "Unsubscribed", `Lists.markReported`: "Reported: not my group".

- [ ] **Step 2: Failing server tests** — `src/server/http/token-context.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/server/supabase/admin-client", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

const TOKEN = "a".repeat(43);
const request = new Request("http://localhost:3000/api/r/x", { headers: { "x-real-ip": "198.51.100.7" } });

beforeEach(() => vi.clearAllMocks());

describe("loadTokenContext", () => {
  it("hashes a well-formed token and checks the rate limit by IP and token", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    const { loadTokenContext } = await import("./token-context");
    const context = await loadTokenContext(request, TOKEN);
    expect(context.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("check_token_rate_limit", {
      p_ip: "198.51.100.7",
      p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("answers 404 for a malformed token without touching the database, and 429 when limited", async () => {
    const { loadTokenContext } = await import("./token-context");
    const bad = await loadTokenContext(request, "short");
    expect(bad.ok ? 200 : bad.response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    const limited = await loadTokenContext(request, TOKEN);
    expect(limited.ok ? 200 : limited.response.status).toBe(429);
  });
});
```
`src/app/api/r/[token]/unsubscribe/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsubscribe: vi.fn() }));
vi.mock("@/server/http/token-context", () => ({
  loadTokenContext: async () => ({ ok: true, client: {}, tokenHash: "h".repeat(64) }),
}));
vi.mock("@/server/queries/tokens", () => ({ unsubscribeToken: mocks.unsubscribe }));

const TOKEN = "a".repeat(43);
const ctx = { params: Promise.resolve({ token: TOKEN }) };
beforeEach(() => vi.clearAllMocks());

describe("/api/r/[token]/unsubscribe", () => {
  it("accepts RFC 8058 one-click from a mail provider (no Origin, form body)", async () => {
    mocks.unsubscribe.mockResolvedValueOnce({ data: true, error: null });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/r/x/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://mail.google.com" },
        body: "List-Unsubscribe=One-Click",
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(mocks.unsubscribe).toHaveBeenCalledWith({}, "h".repeat(64), "link");
  });

  it("404s for an unknown token and sends browsers to the page on GET", async () => {
    mocks.unsubscribe.mockResolvedValueOnce({ data: false, error: null });
    const { GET, POST } = await import("./route");
    expect((await POST(new Request("http://localhost:3000/x", { method: "POST" }), ctx)).status).toBe(404);
    const redirect = await GET(new Request("http://localhost:3000/api/r/x/unsubscribe"), ctx);
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe(`http://localhost:3000/u/${TOKEN}`);
  });
});
```
The `GET /api/r/[token]`, `resubscribe` and `report` route tests follow the same mocks: info maps the DB row to `TokenInfo` (no `invitee_id` in the response), `null` → 404; resubscribe/report call `resubscribeToken` / `unsubscribeToken(…, "report")` and return `{ ok: true }`.

- [ ] **Step 3: Run to verify failure, then implement** — `src/shared/api/tokens.ts`:
```ts
import { z } from "zod";
import { locationModeSchema } from "./meeting-settings";
import { meetingStatusSchema } from "./meetings";

/** Personal-link tokens: 32 bytes base64url (Task 3 `deriveInviteeToken`). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `GET /api/r/[token]`: only what the public pages show (spec §11 public token route). */
export const tokenInfoSchema = z.object({
  workspaceName: z.string(),
  maskedEmail: z.string(),
  unsubscribed: z.boolean(),
  reported: z.boolean(),
  meeting: z.object({
    title: z.string(),
    startsAt: z.string().nullable(),
    timezone: z.string(),
    durationMinutes: z.number().int(),
    locationMode: locationModeSchema,
    locationText: z.string(),
    meetingUrl: z.string(),
    status: meetingStatusSchema,
  }),
});
/** What one personal link shows. */
export type TokenInfo = z.infer<typeof tokenInfoSchema>;
```
`src/server/queries/tokens.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { type TokenInfo, tokenInfoSchema } from "@/shared/api/tokens";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

const dbInfoSchema = z
  .object({
    workspace_name: z.string(),
    masked_email: z.string(),
    unsubscribed: z.boolean(),
    reported: z.boolean(),
    meeting: z.object({
      title: z.string(),
      starts_at: z.string().nullable(),
      timezone: z.string(),
      duration_minutes: z.number().int(),
      location_mode: z.string(),
      location_text: z.string(),
      meeting_url: z.string(),
      status: z.string(),
    }),
  })
  .transform(
    (db): TokenInfo =>
      tokenInfoSchema.parse({
        workspaceName: db.workspace_name,
        maskedEmail: db.masked_email,
        unsubscribed: db.unsubscribed,
        reported: db.reported,
        meeting: {
          title: db.meeting.title,
          startsAt: db.meeting.starts_at,
          timezone: db.meeting.timezone,
          durationMinutes: db.meeting.duration_minutes,
          locationMode: db.meeting.location_mode,
          locationText: db.meeting.location_text,
          meetingUrl: db.meeting.meeting_url,
          status: db.meeting.status,
        },
      }),
  );

/** `token_invitee()`: null for an unknown token. Service-role client only. */
export async function lookupToken(client: Client, tokenHash: string): Promise<{ data: TokenInfo | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_invitee", { p_token_hash: tokenHash });
  return error ? { data: null, error } : { data: data ? dbInfoSchema.parse(data) : null, error: null };
}

/** `token_unsubscribe()`: false for an unknown token. */
export async function unsubscribeToken(
  client: Client,
  tokenHash: string,
  via: "link" | "report",
): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_unsubscribe", { p_token_hash: tokenHash, p_via: via });
  return { data: data ?? null, error };
}

/** `token_resubscribe()`: false for an unknown token. */
export async function resubscribeToken(client: Client, tokenHash: string): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_resubscribe", { p_token_hash: tokenHash });
  return { data: data ?? null, error };
}

/** `check_token_rate_limit()`: false when this IP or this token is over its hourly budget. */
export async function checkTokenRateLimit(client: Client, ip: string, tokenHash: string): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("check_token_rate_limit", { p_ip: ip, p_token_hash: tokenHash });
  return { data: data ?? null, error };
}
```
`src/server/http/token-context.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database } from "@/server/db/database.types";
import { inviteeTokenHash } from "@/server/crypto/invitee-token";
import { checkTokenRateLimit } from "@/server/queries/tokens";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import { TOKEN_PATTERN } from "@/shared/api/tokens";
import { apiError, fromDatabaseError } from "./errors";
import { clientIp } from "./request";

/** A public token request that may proceed (service-role client; spec §11 allowed caller). */
export type TokenContext =
  | { ok: true; client: SupabaseClient<Database>; tokenHash: string }
  | { ok: false; response: NextResponse };

/**
 * Validates the token's shape (a malformed token looks exactly like an unknown one: 404), hashes it,
 * and spends the per-IP and per-token budgets before any lookup.
 */
export async function loadTokenContext(request: Request, token: string): Promise<TokenContext> {
  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, response: apiError("not_found") };
  }
  const client = createSupabaseAdminClient();
  const tokenHash = inviteeTokenHash(token);
  const allowed = await checkTokenRateLimit(client, clientIp(request), tokenHash);
  if (allowed.error) {
    return { ok: false, response: fromDatabaseError(allowed.error) };
  }
  return allowed.data ? { ok: true, client, tokenHash } : { ok: false, response: apiError("rate_limited") };
}
```
`src/app/api/r/[token]/unsubscribe/route.ts`:
```ts
import { NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { loadTokenContext } from "@/server/http/token-context";
import { unsubscribeToken } from "@/server/queries/tokens";

type Ctx = RouteContext<"/api/r/[token]/unsubscribe">;

/** A browser opening the List-Unsubscribe link lands on the confirmation page (never a GET side effect). */
export async function GET(request: Request, ctx: Ctx): Promise<NextResponse> {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${token}`, request.url), 303);
}

/**
 * Unsubscribes from this workspace. Serves our page's button and RFC 8058 one-click POSTs from mail
 * providers, so there is no Origin check: the token is the credential and no cookie is involved.
 */
export async function POST(request: Request, ctx: Ctx): Promise<NextResponse> {
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await unsubscribeToken(context.client, context.tokenHash, "link");
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? ok() : apiError("not_found");
}
```
`src/app/api/r/[token]/route.ts` (`GET` → `loadTokenContext` → `lookupToken` → JSON or 404), `…/resubscribe/route.ts` and `…/report/route.ts` (`POST`, same shape as unsubscribe with `resubscribeToken` / `unsubscribeToken(…, "report")`). Add `export const dynamic = "force-dynamic";` only if the Next 16 route docs say token routes would otherwise be cached (they are `POST` or read params, which are dynamic by default — check before adding).

- [ ] **Step 4: Headers and scrubbing** — `security-headers.ts`: sources become `["/invite/:token*", "/r/:token*", "/u/:token*", "/report/:token*", "/api/r/:token*"]`; update its test. `scrub.ts`: `TOKEN_LINK` segment group becomes `(r|u|report|invite)` (the `/api/r/<token>` URLs already contain `/r/<token>`); add cases to `scrub.test.ts`: `"/u/abc"`, `"/report/abc?x=1"`, `"/api/r/abc/unsubscribe"` and `"https://tapnshow.vercel.app/r/abc?choice=late"` each lose the token; `"/w/club/lists"` is untouched.

- [ ] **Step 5: Pages** — `src/components/public/public-page.tsx`:
```tsx
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Centered single card for the public token pages (no workspace shell, no sign-in). */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <Card as="section" className="flex flex-col gap-4">
        {children}
      </Card>
    </main>
  );
}
```
`src/hooks/use-token-page.ts`:
```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { tokenInfoSchema } from "@/shared/api/tokens";

const key = (token: string) => ["token-page", token] as const;
const noLogin = () => undefined;

/** The personal link's public info (no session; a 401 never happens here). */
export function useTokenInfo(token: string) {
  return useQuery({
    queryKey: key(token),
    queryFn: () => apiRequest(`/api/r/${token}`, { schema: tokenInfoSchema, onUnauthenticated: noLogin }),
    retry: false,
  });
}

/** Unsubscribe / report / resubscribe, then refresh the info. */
export function useTokenAction(token: string, action: "unsubscribe" | "report" | "resubscribe") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(`/api/r/${token}/${action}`, { method: "POST", body: {}, schema: okSchema, onUnauthenticated: noLogin }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(token) }),
  });
}
```
`src/app/u/[token]/unsubscribe-view.tsx`:
```tsx
"use client";

import { BellSlash } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useTokenAction, useTokenInfo } from "@/hooks/use-token-page";
import { ApiClientError } from "@/lib/api-client";
import { InvalidLink } from "@/components/public/invalid-link";

/** `/u/[token]`: opening never unsubscribes (link scanners open links); the button does (spec §7.16). */
export function UnsubscribeView() {
  const t = useTranslations("TokenPages");
  const { token } = useParams<{ token: string }>();
  const info = useTokenInfo(token);
  const unsubscribe = useTokenAction(token, "unsubscribe");
  const resubscribe = useTokenAction(token, "resubscribe");
  if (info.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (!info.data) {
    return <InvalidLink limited={info.error instanceof ApiClientError && info.error.code === "rate_limited"} />;
  }
  const values = { workspace: info.data.workspaceName, email: info.data.maskedEmail };
  if (info.data.unsubscribed) {
    return (
      <>
        <Sticker tone="neutral">
          <BellSlash weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl break-words">{resubscribe.isSuccess ? t("resubscribedTitle") : t("unsubscribedTitle")}</h1>
        <p>{t("unsubscribedBody", values)}</p>
        <Button disabled={resubscribe.isPending} onClick={() => resubscribe.mutate()}>
          {t("resubscribe")}
        </Button>
      </>
    );
  }
  return (
    <>
      <Sticker tone="warning">
        <BellSlash weight="bold" />
      </Sticker>
      <h1 className="font-display text-2xl break-words">{resubscribe.isSuccess ? t("resubscribedTitle") : t("unsubscribeTitle", values)}</h1>
      <p>{resubscribe.isSuccess ? t("resubscribedBody", values) : t("unsubscribeBody", values)}</p>
      <Button tone="danger" size="lg" className="justify-center" disabled={unsubscribe.isPending} onClick={() => unsubscribe.mutate()}>
        {t("unsubscribe")}
      </Button>
    </>
  );
}
```
`src/components/public/invalid-link.tsx` renders the neutral "This link isn't valid" (or "Too many tries…" when `limited`) with a `LinkBreak` sticker. `src/app/u/[token]/page.tsx` = `<PublicPage><UnsubscribeView /></PublicPage>` (a server component wrapping the client view, like `/invite/[token]`). `/report/[token]` mirrors it with `report-view.tsx` (title "Don't know this group?", body, **Report and unsubscribe**, then "Thanks for telling us" — a person who already reported sees the thanks state, decided by `info.reported`). `/r/[token]` renders `response-placeholder.tsx`: `meeting-card.tsx` (title, `formatMeetingWhen` in the meeting's zone, place / "Join online" link with `rel="noopener noreferrer"`, "This meeting was cancelled." when cancelled) plus "Answering opens soon" (`?choice=` is ignored until M5).

Tests (`unsubscribe-view.test.tsx`, `report-view.test.tsx`, `response-placeholder.test.tsx`; mock `useParams` → a 43-char token; `routeFetch` for `GET /api/r/<token>` and the POSTs): the unsubscribe page sends nothing on load, POSTs on click, then shows "You're unsubscribed" and **Subscribe again** (POST resubscribe → "You're subscribed again"); the report page POSTs `…/report` and shows the thanks; an unknown token (404) shows "This link isn't valid" on all three; the placeholder shows "Fri 9 Oct, 18:00–19:00 (Africa/Tunis)" for `meetingFixture`'s time.

- [ ] **Step 6: Roster marks** — in `src/shared/api/roster.ts`, add `unsubscribed: z.boolean().default(false), reported: z.boolean().default(false)` to the contact schema; map `unsubscribed` / `reported` in `dbRosterSchema` (`src/server/queries/roster.ts`, also `.default(false)` there). In `contact-card.tsx` and the grid row, show a small neutral pill "Unsubscribed" (or "Reported: not my group" when reported) next to the name; Admins cannot clear it (no control — only the person can resubscribe). Tests: a card for a contact with `unsubscribed: true` shows the pill; with `reported: true` shows the report pill.

- [ ] **Step 7: Verify and commit** — `bun run test && bun run lint && bun run typecheck` → PASS. Screenshots of `/u/<token>`, `/report/<token>`, `/r/<token>` and an invalid token at 390 px light, 320 px dark and 1024 px (seed a token locally: insert an invitee with `token_hash = sha256(token)` through `supabase db query --local --agent no`). Check with `curl -sI http://localhost:3000/u/<token>` that `Referrer-Policy: no-referrer` is sent. Commit `feat: unsubscribe, Not my group and response placeholder pages`, PR, merge.

---

### Task 18: #119 data/API minors

**Labels:** `area:db`, `area:api`

Items of #119 handled here (each fixed test-first or recorded as a `Ruling:` in the ledger and on #119): import timing, failed commits and the rate limit, concurrent imports at the cap, `PATCH …/contacts/[id]` atomicity and workspace check, `GET …/contacts` error body, name whitespace parity, UTF-16 text files.

**Files:**
- Create: `supabase/migrations/<timestamp>_m4_update_contact.sql`, `src/server/db/update-contact.db.test.ts`
- Modify: `src/server/db/import-contacts.db.test.ts`, `src/server/queries/roster.ts`, `src/app/api/workspaces/[slug]/contacts/route.ts` (+ test), `src/app/api/workspaces/[slug]/contacts/[id]/route.ts` (+ test), `src/shared/api/roster.ts` (+ test), `src/lib/import/decode-text.ts` (+ test), `src/server/db/database.types.ts`

**Interfaces:**
- Produces: `update_contact(p_workspace uuid, p_contact uuid, p_full_name text, p_email text, p_list_ids uuid[]) returns void` (`SECURITY INVOKER`; `null` = leave unchanged; one transaction; `tn:not_found` when the contact or a list is not in `p_workspace`); `getRoster` returns `{ data, error }`; `contactNameSchema` collapses inner whitespace like `import_contacts`.

- [ ] **Step 1: Concurrent imports at the cap (spec §12)** — add to `src/server/db/import-contacts.db.test.ts`:
```ts
it("lets only one of two concurrent imports cross the contacts cap", async () => {
  const restoreCap = overrideLimit("contacts_per_workspace_max", 10);
  try {
    await seedContacts(workspace.id, 6, "cap");
    const rows = (prefix: string) =>
      Array.from({ length: 3 }, (_, n) => ({ row: n + 2, email: `${prefix}-${n}@example.test`, full_name: `${prefix} ${n}`, lists: [] }));
    const results = await Promise.all([
      admin.client.rpc("import_contacts", { p_workspace: workspace.id, p_rows: rows("a"), p_dry_run: false }),
      owner.client.rpc("import_contacts", { p_workspace: workspace.id, p_rows: rows("b"), p_dry_run: false }),
    ]);
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toBe("tn:contacts_limit_reached");
    const { count } = await adminClient().from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id);
    expect(count).toBe(9);
  } finally {
    restoreCap();
  }
});
```
(`overrideLimit` comes from `src/test/db/outbox.ts` (Task 6); adapt variable names to the file's `beforeEach`.) Run → it should already PASS (the cap trigger takes an advisory lock); if it fails, that is a real bug: stop and fix the trigger test-first.

- [ ] **Step 2: Time a 2,000-row import on the free tier** — on the **preview** project (never production), with a throwaway workspace created through the app, run a dry run and a commit of 2,000 generated rows through `POST …/contacts/import` from a scratch script using a signed-in session (or through `supabase db query --linked` calling `import_contacts` inside a `set local role authenticated; set local request.jwt.claims …` block). Record both durations. **Ruling:** if the commit stays under 4 s (half the 8 s statement timeout), record "keep as is" with the numbers on #119; otherwise write a follow-up migration that pre-aggregates `list_contacts` membership per email once (a CTE joined instead of the correlated `exists` subqueries in `added` and `final_groups`), with `EXPLAIN (ANALYZE, BUFFERS)` before/after in the PR, and keep `import-contacts.db.test.ts` green. Delete the throwaway workspace afterwards.

- [ ] **Step 3: Failed commits and the rate limit — Ruling, no code.** A commit that raises (`contacts_limit_reached`) rolls back its own rate-limit row because both live in one transaction; recording the hit outside it would need a second round trip that a direct API caller could skip. Every UI commit is preceded by a budgeted dry run (120/h), Vercel and Supabase bound request volume, and the statement timeout bounds the cost of each failing call. Record: "Accepted: failed commits are not budgeted; the dry-run budget and request-level limits cover abuse (M4, #119)." Add the same sentence to spec §6 after the `import_contacts` budget sentence.

- [ ] **Step 4: Failing tests for `update_contact`** — `src/server/db/update-contact.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { seedContacts, seedList } from "@/test/db/roster";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let admin: TestUser;
let workspace: TestWorkspace;
let other: TestWorkspace;

beforeEach(async () => {
  const owner = await createTestUser();
  admin = await createTestUser();
  workspace = await createWorkspaceAs(owner, "A");
  other = await createWorkspaceAs(admin, "B");
  await addMember(workspace.id, admin.id, "admin");
});

describe("update_contact", () => {
  it("changes name and lists in one transaction", async () => {
    const [contact] = await seedContacts(workspace.id, 1, "uc");
    const dev = await seedList(workspace.id, "Dev");
    const ok = await admin.client.rpc("update_contact", {
      p_workspace: workspace.id,
      p_contact: contact,
      p_full_name: "New Name",
      p_email: null,
      p_list_ids: [dev],
    });
    expect(ok.error).toBeNull();
    const row = await adminClient().from("contacts").select("full_name").eq("id", contact).single();
    expect(row.data?.full_name).toBe("New Name");
    const memberships = await adminClient().from("list_contacts").select("list_id").eq("contact_id", contact);
    expect(memberships.data).toEqual([{ list_id: dev }]);
  });

  it("rejects a contact or list from another workspace and leaves everything unchanged", async () => {
    const [contact] = await seedContacts(workspace.id, 1, "uc2");
    const foreignList = await seedList(other.id, "Foreign");
    await expectAppError(
      admin.client.rpc("update_contact", { p_workspace: other.id, p_contact: contact, p_full_name: "X", p_email: null, p_list_ids: null }),
      "not_found",
    );
    await expectAppError(
      admin.client.rpc("update_contact", { p_workspace: workspace.id, p_contact: contact, p_full_name: "Changed", p_email: null, p_list_ids: [foreignList] }),
      "not_found",
    );
    const row = await adminClient().from("contacts").select("full_name").eq("id", contact).single();
    expect(row.data?.full_name).toBe("uc2 1");
  });
});
```
- [ ] **Step 5: Migration** — `supabase migration new m4_update_contact </dev/null`:
```sql
-- #119: one atomic edit for the roster sheet, scoped to the slug's workspace.
create function public.update_contact(
  p_workspace uuid,
  p_contact uuid,
  p_full_name text,
  p_email text,
  p_list_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.contacts c where c.id = p_contact and c.workspace_id = p_workspace and not c.is_adhoc) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_list_ids is not null and exists (
    select 1 from pg_catalog.unnest(p_list_ids) as x(id)
    where not exists (select 1 from public.lists l where l.id = x.id and l.workspace_id = p_workspace)
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_full_name is not null or p_email is not null then
    update public.contacts
    set full_name = coalesce(p_full_name, full_name), email = coalesce(p_email, email)
    where id = p_contact;
  end if;
  if p_list_ids is not null then
    delete from public.list_contacts lc where lc.contact_id = p_contact and lc.list_id <> all (p_list_ids);
    insert into public.list_contacts (workspace_id, list_id, contact_id)
    select p_workspace, x.id, p_contact from pg_catalog.unnest(p_list_ids) as x(id)
    on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.update_contact(uuid, uuid, text, text, uuid[]) from public, anon;
grant execute on function public.update_contact(uuid, uuid, text, text, uuid[]) to authenticated;
```
Apply, regenerate types, run the DB tests → PASS; advisors clean.

- [ ] **Step 6: Route + query changes (tests first)** —
  - `src/server/queries/roster.ts`: replace `updateContact` + the route's `setContactLists` call with `updateContact(client, { workspaceId, contactId, fullName, email, listIds })` calling the RPC (`p_full_name: fullName ?? null`, etc.); keep `setContactLists` only if another caller uses it (grep; otherwise delete it and its tests). `getRoster` returns `{ data: Roster | null; error: DbError | null }`.
  - `contacts/[id]/route.ts` `PATCH`: one `updateContact` call; errors through `fromDatabaseError(error, UNIQUE_EMAIL)`. Route test: a body with only `listIds` calls `updateContact` with `workspaceId: "w1"` (the slug's), and a `tn:not_found` answers 404.
  - `contacts/route.ts` `GET`: `const { data, error } = await getRoster(…); return error ? fromDatabaseError(error) : NextResponse.json(data);`. Route test: a database error answers `{ error: { code: "forbidden" } }` with 403 instead of a bare 500.
  - Update every `getRoster` caller (grep) to the new shape.
- [ ] **Step 7: Name whitespace parity** — `src/shared/api/roster.ts`: `contactNameSchema = z.string().trim().min(1).max(120).transform((name) => name.replace(/\s+/g, " "))` — but the max must apply after collapsing; write it as `z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(1).max(120))`. Test: `"Nour  Ben   Ali "` → `"Nour Ben Ali"`. The add-contact and sheet forms use the same schema, so an edited double space no longer reports "updated" on every re-import.
- [ ] **Step 8: UTF-16 text files** — `src/lib/import/decode-text.ts`: before the UTF-8 attempt, check the BOM: `FF FE` → `new TextDecoder("utf-16le")`, `FE FF` → `"utf-16be"` (TextDecoder drops the BOM). Test with bytes built from `"﻿Full name\tEmail\r\nInès\tines@example.test"` encoded as UTF-16LE (`Buffer.from(text, "utf16le")`, prefixed with `0xFF 0xFE`): decodes to the text with "Inès" intact; the existing cp1252 and UTF-8 tests still pass.
- [ ] **Step 9: Verify, record, commit** — `bun run test && bun run test:db && bun run lint && bun run typecheck` → PASS. Comment on #119 with the rulings (Steps 2–3) and the fixed items. Commit `fix: M3 data and API minors (#119)`, PR, merge, then the **Hosted migration procedure**.

---

### Task 19: #119 roster UI minors

**Labels:** `area:ui`

Items: the Undo e2e for bulk delete, pending deletions reappearing after navigation, the grid header's indeterminate state, stale list filters, a failed rename keeping the rejected name, the "Merged duplicates" tile filter, and the duplicated `FILL` map.

**Files:**
- Modify: `src/app/w/[slug]/lists/use-deferred-delete.ts` (+ test), `src/app/w/[slug]/lists/roster-grid.tsx` (+ test), `src/app/w/[slug]/lists/roster-view.tsx` (+ test), `src/app/w/[slug]/lists/manage-lists-dialog.tsx` (+ test), `src/app/w/[slug]/lists/import/preview-step.tsx` (+ test), `src/app/w/[slug]/lists/list-tag.tsx` (exports `LIST_FILL`), `e2e/roster.spec.ts`

- [ ] **Step 1: Pending deletions survive navigation** — move `pendingIds` out of component state into a module-level store read with `useSyncExternalStore` (a tiny `createPendingDeletes()` in `use-deferred-delete.ts`: `add(ids)`, `remove(ids)`, `subscribe`, `snapshot`), so leaving Lists and returning within the Undo window still hides the people being deleted; the toast callbacks (already global) remove them from the store when the request is sent or undone. Test: render the roster, delete a person, unmount, mount again within 5 s → the person is still hidden; after the toast auto-closes and the DELETE resolves, the store is empty.
- [ ] **Step 2: Header checkbox indeterminate** — in `roster-grid.tsx` pass `checked={all ? true : some ? "indeterminate" : false}` to the header `Checkbox` (Radix supports `"indeterminate"`), and render a dash icon for that state in `src/components/ui/checkbox.tsx` (`CheckboxPrimitive.Indicator` shows `Minus` when `data-state="indeterminate"`). Tests: header `aria-checked="mixed"` with one of three selected; `checkbox.test.tsx` covers the indeterminate rendering.
- [ ] **Step 3: Stale filter** — in `roster-view.tsx`, derive the effective filter: if the selected list id no longer exists, or the "No list" chip is selected and nobody is listless, fall back to `null` ("All") in render (not in an effect), and clear the stored selection. Tests: delete the selected list → "All N" is pressed and people show; give the last listless person a list while "No list" is selected → "All N" is pressed.
- [ ] **Step 4: Failed rename** — in `manage-lists-dialog.tsx`, when the rename mutation fails, reset the input to the list's current name (and keep the inline error). Test: a `list_name_taken` response restores "Dev" in the input and shows the error.
- [ ] **Step 5: Merged duplicates tile** — in `preview-step.tsx`, filtering by "Merged duplicates" lists the merged **rows** (one line per absorbed input row, "Row 7 merged into row 3 (amira@…)"), matching the count on the tile. Test: a result with `mergedRows: [5, 7]` on one person shows two lines under that filter.
- [ ] **Step 6: One `FILL` map** — export `LIST_FILL` from `list-tag.tsx` and import it in `preview-step.tsx` (delete the copy). Existing tests cover both.
- [ ] **Step 7: Bulk delete with Undo e2e (spec §12)** — extend `e2e/roster.spec.ts`: Select mode → pick two people → Delete 2 → confirm → both disappear and the toast shows Undo → click Undo → both are back after reload; repeat without Undo → after the toast closes, reload → both are gone.
- [ ] **Step 8: Verify and commit** — `bun run test && bun run lint && bun run typecheck` → PASS; stop any dev server, `bun run test:e2e e2e/roster.spec.ts` → PASS. Screenshots of the grid header (indeterminate) at 1024 px. Comment on #119 listing each item and its PR; close #119 when Tasks 18 and 19 are merged. Commit `fix(ui): M3 roster minors (#119)`, PR, merge.

---

### Task 20: Rollout — e2e story, secrets, Vault, OAuth URIs, flag removal, production check, final review

**Labels:** `area:infra`, `area:pipeline`

**Files:**
- Create: `e2e/meetings.spec.ts`, `e2e/helpers/fake-gmail.ts`, `e2e/helpers/seed-sender.ts`
- Modify: `e2e/global-setup.ts`, `playwright.config.ts`, `.env.local` (git-ignored; active values + backup blocks), the flag sites (`src/config/public-env.ts`, `vitest.config.mts`, `src/components/shell/nav-items.ts`, `bottom-bar.tsx`, the Meetings pages, Settings page, Home), spec §14 (M4 row "Done when" evidence)

- [ ] **Step 1: Fake Gmail for e2e** — `e2e/helpers/fake-gmail.ts`: a `node:http` server on `127.0.0.1:44399` with three routes: `POST /token` → `{ "access_token": "fake", "expires_in": 3600 }`; `POST /gmail/v1/users/me/messages/send` → stores `{ raw, threadId }` and answers `{ id, threadId: threadId ?? "t-<n>" }`; `GET /__messages` → the stored list (JSON). `e2e/global-setup.ts` starts it and stops it in the returned teardown (alongside the existing limit restore). `playwright.config.ts` `webServer.env` adds (check in the Playwright docs whether `env` merges with `process.env`; if it replaces it, spread `process.env` first):
```ts
env: {
  ...process.env,
  NEXT_PUBLIC_MEETINGS_ENABLED: "true",
  GMAIL_API_BASE_URL: "http://127.0.0.1:44399",
  GOOGLE_OAUTH_TOKEN_URL: "http://127.0.0.1:44399/token",
  GOOGLE_CLIENT_ID: "e2e-client",
  GOOGLE_CLIENT_SECRET: "e2e-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: E2E_TOKEN_KEY,
  INVITE_TOKEN_SECRET: E2E_INVITE_SECRET,
},
```
with the two constants exported from `e2e/helpers/seed-sender.ts` (fixed test-only values, each 32 random bytes generated once and committed as fixtures; they protect nothing).

- [ ] **Step 2: Seed a sender in e2e** — `e2e/helpers/seed-sender.ts`: `seedSender(slug, ownerEmail)` inserts a `google_connections` row for the Owner (service role) with `refresh_token_encrypted` sealed exactly like `src/server/crypto/secret-box.ts` (AES-256-GCM, `v1.<iv>.<ct>.<tag>`, associated data `google_connection:<user_id>:<google_sub>`; the app module imports `server-only`, so this test helper carries a short copy with a comment pointing at the original) and sets it as the workspace sender.

- [ ] **Step 3: The M4 e2e story** — `e2e/meetings.spec.ts` (projects `phone` and `small-phone`):
  1. Owner signs in with an email code (existing helper), creates a workspace, imports or seeds two contacts in a "Members" list (existing roster seed helper), `seedSender`.
  2. "+" → Details: title "E2E sync", tomorrow 18:00 via the pickers, place "Room 1" → Next → Audience: press "Members" → "Next: 2 people" → Answers: Attendance, default delays → Next → Review: sees "From E2E Club <…>" and "2 emails now · 398 left today on this Gmail" → **Send 2 invites** → the confirm dialog "Send 2 invites from … now?" → confirm.
  3. The meeting page reaches "2 invites sent" (poll up to 30 s; `after()` runs the dispatch).
  4. `GET http://127.0.0.1:44399/__messages`: 2 messages; the first has no `threadId`, the second has the first's thread id; decode one `raw` (base64url) and assert `From:` names "E2E Club", `List-Unsubscribe` is present, and pull its `/u/<token>` link.
  5. Open `/u/<token>`: "Stop emails from E2E Club…" → **Unsubscribe** → "You're unsubscribed" → back in Lists the person shows "Unsubscribed".
  6. `expectNoHorizontalScroll` (M3 helper) on the Details, Audience and Review steps.
  A second test: an Admin of a workspace with no sender reaches Review and sees "Ask … to connect Gmail to send. You can save this draft." with no Send button.
  Run: stop any dev server (`ss -ltnp`, kill by PID), then `bun run test:e2e` → all projects PASS. CI's `db` job runs it too.

- [ ] **Step 4: Secrets (no value is ever printed)** — the preview/local set exists since Task 4 Step 17; generate the Production set the same way (and the preview one only if missing) with a script that writes straight into chmod-600 files:
```bash
umask 077
for target in production preview; do
  file="$HOME/.config/tapnshow/m4-secrets.$target.env"
  : > "$file"
  {
    printf 'GOOGLE_TOKEN_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)"
    printf 'INVITE_TOKEN_SECRET=%s\n' "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
    printf 'DISPATCH_SECRET=%s\n' "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
  } >> "$file"
done
cut -d= -f1 "$HOME/.config/tapnshow/m4-secrets.production.env"
```
  In the **same step**: copy the preview set into `.env.local`'s active values and both sets into its `VERCEL BACKUP` block, with a script that reads the files and edits `.env.local` without echoing values (as done for M2 secrets). Then add them to Vercel, values through stdin:
```bash
set -a; . "$HOME/.config/tapnshow/m4-secrets.production.env"; set +a
for name in GOOGLE_TOKEN_ENCRYPTION_KEY INVITE_TOKEN_SECRET DISPATCH_SECRET; do
  printf '%s' "${!name}" | timeout 60 vercel env add "$name" production --sensitive --yes --non-interactive --scope dalychouikhs-projects
done
```
  Repeat with the preview file and `preview`. Add the plain flag: `timeout 60 vercel env add NEXT_PUBLIC_GMAIL_CONNECT_ENABLED production --value true --no-sensitive --yes --non-interactive --scope dalychouikhs-projects`, and `NEXT_PUBLIC_GMAIL_CONNECT_ENABLED=true` in `.env.local`. Verify names only: `vercel env ls --scope dalychouikhs-projects`.
  **Note:** rotating `INVITE_TOKEN_SECRET` later invalidates every personal link already sent; rotating `GOOGLE_TOKEN_ENCRYPTION_KEY` breaks every stored connection (Owners must reconnect). Write both facts next to the backup block in `.env.local`.

- [ ] **Step 5: Google Cloud** — already done in Task 4 Step 17; confirm both URIs are still listed on `tapnshow-web` and that the Audience is still "In production" (unverified).

- [ ] **Step 6: Vault on production (dispatcher cron)** — write the SQL to a chmod-600 file in the scratchpad (never on the command line), run it, delete it:
```bash
umask 077
set -a; . "$HOME/.config/tapnshow/m4-secrets.production.env"; set +a
sql="$SCRATCHPAD/vault.sql"
printf "select vault.create_secret('https://tapnshow.vercel.app/api/internal/dispatch', 'tn_dispatch_url');\nselect vault.create_secret('%s', 'tn_dispatch_secret');\n" "$DISPATCH_SECRET" > "$sql"
supabase db query --linked --agent no -f "$sql" </dev/null >/dev/null
rm -f "$sql"
supabase db query --linked --agent no "select name from vault.secrets where name like 'tn_dispatch_%' order by 1" </dev/null
```
  (Repo linked to production. Preview gets no Vault secrets, by design.) Within a minute of a due job, `cron.job_run_details` for `tn-dispatch` shows `succeeded`, and Vercel logs show `POST /api/internal/dispatch 202`.

- [ ] **Step 7: Remove the rollout flag** (one PR, after Steps 1–6 work on Preview): delete `NEXT_PUBLIC_MEETINGS_ENABLED` from `public-env.ts` (+ test), `vitest.config.mts`, `playwright.config.ts`, every `publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED` branch (nav, bottom bar, Meetings pages, Settings, Home, `ComingSoon` usage for meetings — delete the `meetings` copy from `ComingSoon` if nothing else uses it), the Vercel Preview variable (`vercel env rm NEXT_PUBLIC_MEETINGS_ENABLED preview --yes --scope dalychouikhs-projects`) and the `.env.local` line. `bun run test && bun run test:e2e && bun run lint && bun run typecheck` → PASS. Merge → production now has the feature.

- [ ] **Step 8: Production check with the owner (ask first; never the club roster)** — the owner, on production: creates a separate "M4 test" workspace whose roster holds only their own test addresses; connects the club Gmail (or a test Gmail) as sender; sends a meeting to those addresses. Check together: inbox delivery; From line ("<Workspace>"); Sent shows **one conversation**; the email renders in Gmail web and the Gmail phone app (buttons, outline, no broken layout); the answer buttons open the "Answering opens soon" page; **Unsubscribe** (footer link and, if Gmail shows it, Gmail's own Unsubscribe) and **Not my group** both work and mark the person in the roster; the meeting page shows the progress and final counts. Record evidence (no addresses) in the ledger and on the epic.

- [ ] **Step 9: Advisors and Sentry** — `supabase db advisors --linked </dev/null` on preview and production → no new WARN/ERROR (the `pg_net` warning is gone). Sentry: no new issues from M4 routes (Sentry MCP `search_issues` for project `tapnshow`, last 24 h).

- [ ] **Step 10: Final review** — invoke `superpowers:requesting-code-review` with a fresh reviewer on the most capable model over the whole M4 diff (`git diff <M4 start>..main`), naming the Review Focus list above as must-check items. Fix every finding test-first in follow-up PRs; put minors into a `[task] M4 deferred minors` issue under the M5 epic (#7).

- [ ] **Step 11: Owner smoke test** — the owner tries M4 on a real phone and on a desktop and reports in plain language; ask follow-up questions when a report is ambiguous; fix each item (test-first) in small PRs.

- [ ] **Step 12: Close** — spec §14 M4 row: "**Done <date>:** …" with the production-check evidence; close epic #6 and milestone "M4 Meetings & sending"; delete `.superpowers/sdd/2026-10-07-m4-meetings-and-sending/` (root-owned files: `docker run --rm -v "$PWD/.superpowers:/w" alpine rm -rf /w/sdd/2026-10-07-m4-meetings-and-sending`); prune merged branches (`commit-commands:clean_gone`).

---

## Self-review notes (plan author)

- **Spec coverage:** §4 Sending/Wizard/Confirmations → Tasks 2, 4, 12–16; §5 scheduler on production only → Tasks 6, 20; §6 workspaces/contacts/meetings/pipeline tables → Tasks 2, 5, 6, 7; identity rules (derived tokens) → Tasks 3, 10; §7.2 → Tasks 13–15; §7.12 → Task 7, 17; §7.15 → Tasks 2, 4, 16; §7.16 → Tasks 7, 17; §8 dispatcher, claiming, quotas, errors, idempotency, housekeeping, `pg_net` move → Tasks 1, 6, 9, 10; §9 connect flow, redirect URIs, disconnect/revoke, invite email, compliance headers → Tasks 3, 4, 8, 9, 17, 20; §10 routes and API → Tasks 11, 13–17; §11 service-role callers, secrets, rate limits, headers, scrubbing → Tasks 3, 4, 10, 17, 20; §12 M4 tests → every task + Task 20 e2e; §14 → Task 20; #119 → Tasks 18–19.
- **Decided while planning:** `outbox_jobs` gains `invitee_id`, `run_id`, `send_started_at` (spec updated in Task 6); "Invite more" uses `POST …/send` (spec updated in Task 11); retries = first try + 5 (1, 2, 4, 8, 16 min) → `dispatch_job_max_attempts` 6; the AES associated data is `user_id + google_sub` (the row id does not exist yet when sealing); `TZDate#toISOString()` keeps the zone offset, so UTC strings come from `getTime()` (checked locally).
- **Checked while planning:** Gmail limits (500/day, 500 recipients, 6,000 units/min, `messages.send` = 100) and error mapping (Google docs, 2026-10-07); Google OIDC guidance on ID tokens from the token endpoint; `include_granted_scopes`, granular consent and the revoke endpoint; Supabase's `pg_net` fix; Vercel bypass not needed (previews do not send); nodemailer `MailComposer` header encoding (probe output in this plan's history: UTF-8 Q-encoding of the From name and subject, `List-Unsubscribe-Post` kept); markdown-it 15 ships its own types; react-day-picker 10 is v9 minus deprecated props (upgrade guide).
- **Open on purpose:** the From-name ruling (Tracking) sets `FROM_NAME_KEPT`; Task 18 Step 2's timing decides whether `import_contacts` needs the pre-aggregation migration.
