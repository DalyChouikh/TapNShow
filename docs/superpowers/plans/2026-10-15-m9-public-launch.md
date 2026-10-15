# TapNShow M9 (Public launch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TapNShow is ready for organizers of other groups and for Google's verification: zero warnings, a rate limit on every write and pre-sign-in route, every list bounded, a nonce CSP and the security headers, Sentry (errors, logs, uptime) and Discord for operations, a Supabase keep-alive and nightly encrypted backups that are restored before they are kept, Vercel Analytics without tokens, the theme choice and Settings icons, a landing page, Privacy and Terms linked wherever data is involved, and a platform admin area with automatic and manual sending suspension, email-bound admin invites and an admin log.

**Architecture:**
- **Guardrails first** (slice 1): a route registry (`src/server/http/route-registry.ts`) records, for every route file and method, where its rate limit lives and how a GET bounds what it returns; unit and DB tests fail for a route without an entry or a limit the database doesn't have. Direct writes are limited by statement triggers (`current_user = 'authenticated'`, once per transaction per action), definer bodies by their thin wrappers. A nonce CSP is set by `proxy.ts` (report-only until the launch task) and the e2e console guard fails on any console error or CSP report.
- **Operations** (slice 2): one Discord embed builder (`src/lib/discord/`) used by GitHub Actions scripts (deploys, keep-alive, backups) and by the app's own `#platform` lane; Sentry Logs fed from the existing scrubbing stream after scrubbing.
- **Public surface** (slice 3): one `PublicShell` for the landing, the legal pages, sign-in and not-found; legal texts as typed content modules rendered with `markdown-it`; one `LEGAL_LINKS` config.
- **Platform admin** (slice 4): `platform_admins`, `platform_admin_invites`, `platform_events` (the admin log and the outbox for `#platform` and Owner emails), `workspace_sending_suspensions`, `platform_daily` (counts that would otherwise be purged). Every admin read and write is a `private` definer body behind a `public` wrapper that checks the platform role; a suspension is opened or lifted in one place and enforced at `dispatch_reserve` (renamed body + thin check), so no claim or resume path changes.
- **Launch** (slice 5): the WAF rule, the CSP enforced, the verification runbook, a fresh review, the production check.

**Tech Stack:**
- Next.js 16.3.8 (App Router, `proxy.ts`, metadata routes, `after()`), React 19.2.8, TypeScript 5, bun 1.3.11.
- `@supabase/supabase-js` 2.117.2, Supabase CLI 2.119.0 (local ports 44320–44329), Postgres 17.
- `zod` 4, `@tanstack/react-query` 5, `next-intl` 4, `next-themes` 0.4.6, `radix-ui` 1.6.7, `markdown-it` 15.0.2, `date-fns` 4, `react-email`, `pino` 10.4.0, `@sentry/nextjs` 11.4.0.
- Vitest 5.0.3, Playwright 1.63.0; Lighthouse 13.5.0 (run with `bunx`, not a dependency).
- **New dependencies** (checked on npm 2026-10-15): `@vercel/analytics` 2.0.1 (MIT, 2026-03-12) and `@vercel/speed-insights` 2.0.0 (Apache-2.0, 2026-03-10). **Removed:** `vite-tsconfig-paths` (Vite 8 resolves tsconfig paths itself).
- **Tools in CI only:** `age` (Ubuntu package) for backups; `actions/upload-artifact@v7`.

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md`. Read these sections before starting:
- §3: Platform admin, Platform owner rows.
- §4: Tenancy, Pagination, Visual style, Public pages, Platform admin, Operations rows.
- §5: Operations (M9).
- §6: `abuse_reports`, `workspace_sending_suspensions`, `platform_admins`, `platform_admin_invites`, `platform_events`, `platform_daily`, Access pattern (M9).
- §7.12 (M9), §7.18, §7.19.
- §8: Platform events (M9), Daily rollup (M9), Suspension (M9).
- §9: Google verification (M9).
- §10: Routes, Route registries, Theme, Settings icons, Admin API.
- §11: Rate limiting (M9), Headers (M9), Secrets (M9), Accepted advisor warning.
- §12: M9 tests, Zero warnings.
- §14: M9 row. §15: Sentry after the trial, GitHub schedules, After M9.

Design approved 2026-10-15 (#325). Epic #11.

## Global Constraints

- **Earlier plans still apply.** Everything in the Global Constraints of the M0+M1 to M8 plans still applies:
  - free only; bun;
  - **no Server Actions** and no RSC data reads: every read and write goes through `src/app/api/**/route.ts` + TanStack Query;
  - no emojis anywhere (UI, emails, notifications, Discord);
  - no `any` and no `unknown` (the ESLint rule bans the keyword, including `as unknown as`);
  - no `console.*`; JSDoc on every export; imports at the top of the file only;
  - no hardcoded values: limits in `private.app_limits`, client tuning in `src/config/*`, each client constant names its DB twin;
  - SQL only in `supabase/migrations/*` and `src/server/queries/*`;
  - every UI, email and notification string through next-intl (`messages/en.json`). Discord embeds are operator messages (like log lines): their English words live in one module (`src/lib/discord/platform-events.ts`, the workflow scripts' arguments), never in product UI;
  - Soft Neobrutalism; Expressive motion with a reduced-motion fallback; WCAG 2.2 AA; ≥ 44 px tap targets;
  - one branch + PR per task with the repo template; CI green including `db`; squash merge; the commit trailer from the session's attribution reminder.
- **Owner rules (memories):**
  - **never "GDG ISSAT" (or ISSAT) as an example**, in product copy, fixtures, mockups or docs written from now on; invented names only (Robotics Club, Riverside Volunteers);
  - no native form controls (Switch, Chip, SegmentedControl, Select, Dialog from `src/components/ui/`);
  - an "Are you sure?" dialog naming the consequence before Suspend, Lift, Remove admin, Revoke invite;
  - **no technical text for users**: never "token", "CSP", "rate limit", "webhook", "suspension record"; say "Sending is paused", "Too many attempts";
  - padded menus (`p-1.5`, `collisionPadding` 16); dialogs centred at 1024 px; chip rows use `CHIP_ROW_CLASS`; no horizontal scroll at 320 px;
  - **engineering bar**: judge by robustness, tests, performance and scale, never by how little code it takes; list the edge cases, then pin each with a test.
- **DRY rules for M9 (one place each):**
  - **Route registry:** `ROUTES` in `src/server/http/route-registry.ts` is the only list of routes, their limits and their list bounds. A new route without an entry fails `route-registry.test.ts`.
  - **Rate limits in SQL:** `private.hit_user_rate_limit`'s `case` is the only action → limit map; `private.require_user_limit` the only "spend or refuse" for wrappers; `private.limit_direct_writes` the only trigger function for direct writes. Each later migration that adds an action copies the newest body.
  - **Discord:** `discordMessage` (`src/lib/discord/embed.ts`) is the only embed builder and `postToDiscord` (`send.ts`) the only sender, for scripts and the app.
  - **Token URLs:** `TOKEN_LINK` (`src/lib/observability/scrub.ts`) is the only pattern; `scrubUrl` (logs, Sentry) and `routePatternUrl` (analytics) both use it.
  - **Legal links:** `LEGAL_LINKS`, `contactHref`, `PRIVACY_POLICY_URL` (`src/config/legal.ts`).
  - **Theme modes:** `THEME_MODES` / `THEME_ICONS` (`src/components/theme/theme-modes.ts`) for both switches.
  - **Public pages:** `PublicShell` for landing, legal, sign-in, not-found; `PublicPage` for the token pages and the error view.
  - **Platform events:** `private.record_platform_event` is the only writer of `platform_events`; `private.open_suspension` / `private.lift_suspension` the only paths that change a suspension; `private.mask_email` the only masking rule in SQL (and its TS twin `maskEmail` in `scripts/set-platform-owner.ts`, plus the admin UI's Owner email, which uses the same shape).
  - **Remove what is unused, in the task that makes it unused:** `vite-tsconfig-paths` (Task 1), `allowOtpRequest` (Task 3), `Home.title` and the placeholder page (Task 12), the bottom bar's inline item markup (Task 19, moved to `NavLink`).
- **Function security (spec §11):**
  - Every new `private` function reachable by signed-in users is added to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted) in `src/server/db/function-security.db.test.ts` in the same PR. Tasks list theirs.
  - Worker and system functions are executable by `service_role` only: `record_worker_failure`, `platform_events_claim`, `platform_event_owner_target`, `platform_event_done`, `platform_event_failed`, the renamed `dispatch_reserve_unchecked` (it keeps its grants) and the new `dispatch_reserve`.
  - `public.set_platform_owner` is executable by nobody through the Data API (the script runs SQL as `postgres`).
  - `anon` may execute exactly one public function: `keep_alive` (Task 7 pins it).
  - Run `supabase db advisors --local </dev/null` after every migration. Expected: nothing beyond `auth_leaked_password_protection` (accepted, spec §11).
- **Changing an existing function:** copy the latest body from **the newest migration that defines it** (`grep -ln "function <schema>.<name>(" supabase/migrations/* | sort | tail -1`) and change only what the task says. Latest bodies at the start of M9:

| Function | Newest migration |
|---|---|
| `private.hit_user_rate_limit` | `20261015092518_m8_minors.sql` (then Task 3's, then Task 14's) |
| `private.check_ip_rate_limit` | `20261006080206_m2_core_workspaces.sql` (moved to `private` by `20261006224354_m3_definer_wrappers.sql`) |
| `private.workers_due` | `20261014160152_m8_push.sql` |
| `private.housekeeping` | `20261014221206_m8_review_fixes.sql` |
| `private.push_done`, `private.push_drop` | `20261014160152_m8_push.sql` |
| `public.dispatch_reserve` | `20261011124719_m7_minors_edits.sql` (renamed, not copied, in Task 15) |
| `public.send_meeting`, `public.nudge_meeting` wrappers | Task 3's migration (then Task 15's) |
| `public.edit_sent_meeting` wrapper | `select private.edit_sent_meeting(…)` (catalog; Task 15 replaces it) |
| `public.delete_account` wrapper | `select private.delete_account(p_confirm)` (catalog; Task 14 replaces it) |

  A signature or return-type change is `drop function … (old args)` + `create function` + re-grant. After each M9 migration merges, the next task copies from **that** migration.
- **PostgREST resolves functions by argument names.** Pass SQL null with `sqlNullable()` (`src/server/db/rpc-args.ts`).
- **New error codes:** `workspace_seats_limit_reached` (409, Task 4), `platform_owner` (409, Task 14), `sending_suspended` (409, Task 15). Each goes in `API_ERROR_CODES`, `API_ERROR_STATUS` and `messages/en.json` `ApiErrors`.
- **New limits (`private.app_limits`):** Task 3 (23 write and IP limits; `token_requests_per_ip_per_hour` 120 → 1500), Task 4 (`workspace_seats_per_user_max` 50), Task 14 (4 admin limits, `platform_notify_attempts_max` 5), Task 15 (`suspension_window_days` 7, `suspension_reports_min` 3, `suspension_report_rate_min_bp` 200).
- **Env and secrets (each asked first; values pasted by the Owner, never in chat; each backed up in `.env.local`):** Vercel `SENTRY_AUTH_TOKEN` (Task 6), `DISCORD_PLATFORM_WEBHOOK` (Task 17, server-only); GitHub secrets `DISCORD_DEPLOYS_WEBHOOK`, `DISCORD_UPTIME_WEBHOOK` (Task 7), `SUPABASE_PROD_DB_URL` (Task 8); GitHub variables `SUPABASE_PROD_URL`, `SUPABASE_PROD_PUBLISHABLE_KEY`, `SUPABASE_PREVIEW_URL`, `SUPABASE_PREVIEW_PUBLISHABLE_KEY` (Task 7, public values); the `age` key pair (Task 8; private key never in GitHub).
- **Production writes, always asked first:** setting the platform owner (Task 21), the WAF rule (Task 21), the auth templates push (Task 13), suspending the Owner's test workspace (Task 21). Never the club workspace.
- **Sends during development:** fake Gmail and fake push service in tests and e2e. Discord posts only through the Owner's channels after the merges that need them.
- **UI verification:** screenshots through `.superpowers/scripts/screens/pw.config.ts` at **390 px light, 320 px dark and 1024 px** for every new or changed screen and dialog; look at them, send them (`SendUserFile`) and ask "Looks right?" (AskUserQuestion) **before merging**. `toBeVisible()` passes at opacity 0, so look at the image.
- **Local stack:** as in the M8 plan (`supabase start`, ports 44321–44325, `</dev/null` on the CLI, `supabase db reset --local </dev/null` per branch, `bun run db:types` after each migration, stop any server on :3000 before e2e, start the app by hand only with `bun scripts/with-local-supabase.ts …`).
- **Before every commit, chained with `&&`, never `;`, never piped into `tail`; redirect to a log and grep it:**
  - `bunx prettier --write <touched files, not .sql> && bun run format:check && bun run lint && bun run typecheck && bun run test -- --run`;
  - add `supabase db reset --local </dev/null && bun run db:types && bun run test:db && supabase db advisors --local </dev/null` for DB work;
  - add `TZ=UTC bun run test:e2e` (`run_in_background`) when a flow changes, then `bun scripts/check-build-log.ts .e2e-build.log` (from Task 1).
- **Merging and hosted migrations (owner-approved):** PR body from `.github/pull_request_template.md` (`Closes #<task issue>`, `Part of #11`, labels `type:task` + the task's `area:*`), then `bash .superpowers/scripts/merge-when-green.sh <pr>` (`run_in_background`), verify `MERGED`, and right after a PR with a migration merges, `bash .superpowers/scripts/hosted-push.sh` (record the advisors). Migrations land in this order: Tasks 3 → 4 → 7 → 14 → 15 → 16 → 17. Create each migration file (`supabase migration new <name>`) only when its task starts.
- **Rulings.** Every deviation becomes a ledger line `Task N: Ruling: <what> — <why> — <cost if wrong>` in `.superpowers/sdd/2026-10-15-m9-public-launch/progress.md`.

## Review Focus

1. **Shared campus Wi-Fi.** A club meets in a lecture hall; 100 members answer within minutes from one public IP, and organizers watch the meeting page. Expected: everyone can answer and nobody sees "Too many attempts". Today's `token_requests_per_ip_per_hour` (120) would block the 41st member for an hour.
   - Pinned in Task 3 (the per-IP token limit raised to 1500, and a DB test: 100 tokens × 3 requests from one IP all pass) and Task 21 (the WAF limit is chosen from the measured calls per member and per organizer, with room for 100 members in one minute).
2. **Browser extensions and the CSP.** Extensions inject scripts into pages; each injection is a CSP report. Expected: they never use up Sentry's 5k free events or hide real reports.
   - Pinned in Task 5 Step 6 (Sentry's ignored sources for extension schemes and the extension filter, verified with the Sentry tools and a test report that must be dropped) and Task 21 Step 1 (reports counted per source before enforcing).
3. **Midnight UTC in the figures.** An email sent at 23:59 and one at 00:01 UTC, with the rollup run in between. Expected: counted once each (rolled-up yesterday + live today, never both).
   - Pinned in Task 16 (DB test "never counts an email twice across midnight UTC").
4. **A workspace deleted after it was suspended or reported.** Expected: the admin log still names it, its links lead nowhere broken (the page is not found), and the figures drop it like the rest of its data.
   - Pinned in Task 16 (DB test: the log keeps the name with `workspace_id` null, `admin_workspace` is `not_found`).
5. **An admin removed while the admin area is open on their phone.** Expected: the next screen they open shows the not-found view, not an error or stale data.
   - Pinned in Task 19 (shell test: a 404 from an admin query refetches `/api/me` and shows the not-found view) and Task 14 (the database refuses the removed person at once).

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge this plan (and the spec amendments in its PR); create the task issues (Tracking) | — |
| 1 | Task 1: zero warnings, console guards, GDG cleanup, `/design` hidden | 0 |
| 2 | Task 2: not-found and error pages, API 404 | 1 |
| 3 | Task 3: route registry (limits) and DB write limits | 2 |
| 4 | Task 4: route registry (lists) and the seat cap | 3 |
| 5 | Task 5: security headers, nonce CSP report-only, Sentry tunnel | 1 |
| 6 | Task 6: Sentry Logs, alert rules, uptime | 5 |
| 7 | Task 7: Discord builder, `#deploys`, keep-alive | 4 |
| 8 | Task 8: backups and restore check | 7 |
| 9 | Task 9: Vercel Analytics and Speed Insights | 5 |
| 10 | Task 10: theme in the user menu, Settings icons | 1 |
| 11 | Task 11: public shell, Privacy and Terms, robots, sitemap | 2, 10 |
| 12 | Task 12: landing page | 11 |
| 13 | Task 13: legal links on sign-in, token pages, account, emails | 11 |
| 14 | Task 14: DB platform admins, invites, events, owner script | 4, 7 |
| 15 | Task 15: DB suspensions | 14 |
| 16 | Task 16: DB rollup, push counters, admin reads | 15 |
| 17 | Task 17: platform lane, Owner emails, organizer banner | 7, 16 |
| 18 | Task 18: admin API, `platformRole` | 16 |
| 19 | Task 19: admin UI (shell, Overview, Workspaces) | 2, 11, 18 |
| 20 | Task 20: admin UI (Reports, Admins, Log, join page) | 19 |
| 21 | Task 21: WAF, CSP enforced, verification runbook, final review, production check | 1–20 |

**Why this order:**
- Slice 1 (Tasks 1–5) first, so every later PR is born under the console guard, the route registry and the CSP report.
- Tasks 3 → 4 → 7 → 14 → 15 → 16 → 17 are the migration chain (each copies the previous `hit_user_rate_limit` / wrapper bodies).
- The Sentry tunnel ships with the CSP (Task 5), not with Task 6, so report-only never reports Sentry's own requests.
- The admin UI (19–20) sits on its API (18), which sits on the DB tasks (14–16).
- Task 21 needs three clean days of report-only CSP on production, so start counting as soon as Task 5 is deployed.

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–21 with the agent-task template, labels `type:task` + the task's area labels, milestone `M9 Public launch` (milestone 10). Add each as a sub-issue of epic #11:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/11/sub_issues -F sub_issue_id="$id"
```
  `gh issue create` once returned a GraphQL error without creating the issue: check with `gh issue list --search "<title>"` before retrying.
- [ ] Rewrite epic #11's body: outcome, scope and completion criteria from spec §4/§14. Tick "Plan written for M9".
- [ ] Ledger: `bash ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/sdd-workspace docs/superpowers/plans/2026-10-15-m9-public-launch.md` → `.superpowers/sdd/2026-10-15-m9-public-launch/progress.md`; per task `task-start` / `task-done` (`…/executing-plans/scripts/`), `task-done` only on an up-to-date `main` after verifying the merge.
- [ ] **Design rulings (2026-10-15)**, copied into the ledger: the 26 brainstorm answers (spec §4–§15 M9), the owner script instead of a migration, the workspace name in `#platform`, the embeds' look.
- [ ] **Plan rulings (made while writing this plan; the spec is amended in the plan PR):** the API 404 keeps `{ error: { code } }`; `abuse_reports.invitee_id` was already `on delete set null` (no change); `platform_daily` keeps only purged counts; the restore check runs nightly before encryption; the keep-alive calls `public.keep_alive()`; the owner script runs SQL as `postgres` (no service-role key); `token_requests_per_ip_per_hour` 120 → 1500; Discord words are operator constants; `/design`'s production rule is unit-tested; the seat-cap message names no number; sign-out and the OAuth callbacks have no DB limit (reasons in the registry); HSTS comes from Vercel; the Sentry tunnel ships with the CSP; the workflows are proven right after merge; analytics drops query strings; `/admin` shows the not-found view (status 200) to non-admins; the not-found page's signed-in button is "Open TapNShow".

## File Structure

| Area | Files | Task |
|---|---|---|
| Guards | `src/test/console-guard.ts`, `e2e/helpers/test.ts`, `scripts/check-build-log.ts`, `src/lib/deployment.ts` | 1 |
| Errors | `src/components/errors/*`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/api/[...path]/route.ts` | 2 |
| Registry and limits | `src/server/http/route-registry.ts`, `src/server/rate-limit/ip-rate-limit.ts`, migrations `m9_write_limits`, `m9_seat_cap`, `src/test/db/limits.ts`, `src/test/db/invites.ts` | 3, 4 |
| Headers | `src/config/security-headers.ts`, `src/proxy.ts`, `src/server/supabase/proxy-session.ts`, `src/lib/observability/sentry-security-endpoint.ts` | 5 |
| Observability | `src/lib/observability/sentry-log-sink.ts`, `src/lib/logger.ts`, `src/lib/json.ts`, `src/components/providers/page-analytics.tsx`, `src/config/analytics.ts`, `docs/runbooks/monitoring.md` | 6, 9 |
| Discord and workflows | `src/lib/discord/*`, `scripts/discord-notify.ts`, `scripts/keep-alive.ts`, `scripts/compare-counts.ts`, `scripts/backup-counts.sql`, `.github/workflows/{notify,keep-alive,backup}.yml`, migration `m9_keep_alive`, `docs/runbooks/restore.md` | 7, 8 |
| Theme and Settings | `src/components/theme/theme-modes.ts`, `theme-menu-choice.tsx`, `src/components/ui/dropdown-menu.tsx`, `src/app/w/[slug]/settings/section-icon.tsx` | 10 |
| Public pages | `src/components/public/{public-shell,public-header,public-footer,legal-line}.tsx`, `src/components/legal/legal-page.tsx`, `src/content/legal/*`, `src/lib/markdown/legal.ts`, `src/config/legal.ts`, `src/app/{privacy,terms}/page.tsx`, `src/app/{robots,sitemap}.ts`, `src/components/landing/*`, `src/app/page.tsx`, `src/app/opengraph-image.tsx` | 11, 12, 13 |
| Platform DB | migrations `m9_platform_admins`, `m9_suspension`, `m9_admin_reads`, `m9_platform_lane`; `src/test/db/{platform,reports}.ts` | 14–17 |
| Owner script | `scripts/set-platform-owner.ts`, `docs/runbooks/platform-admin.md` | 14 |
| Platform lane | `src/server/platform/*`, `src/server/queries/platform.ts`, `src/config/platform.ts`, `src/components/shell/suspended-banner.tsx` | 17 |
| Admin API | `src/shared/api/admin.ts`, `src/server/queries/admin.ts`, `src/server/http/admin-context.ts`, `src/server/admin/deliver-admin-invite.ts`, `src/emails/admin-invite-email.tsx`, `src/app/api/admin/**`, `src/hooks/use-admin.ts`, `src/config/admin.ts` | 18 |
| Admin UI | `src/components/admin/*`, `src/components/shell/nav-link.tsx`, `src/components/invites/invite-cards.tsx`, `src/app/admin/(area)/**`, `src/app/admin/join/[token]/*`, `src/lib/admin/format.ts` | 19, 20 |
| Launch | `scripts/probe-rate-limit.ts`, `docs/runbooks/google-verification.md` | 21 |

---

### Task 1: Zero warnings, the console guards, GDG ISSAT examples replaced, `/design` hidden on production

**Issue labels:** `type:task`, `area:infra`, `area:frontend`. **Branch:** `chore/<issue>-zero-warnings`.

**Files:**
- Modify: `src/app/w/[slug]/lists/import/preview-step.tsx:62` (the one lint warning)
- Create: `src/assets/fonts/google-sans-500-latin.woff2`, `src/assets/fonts/OFL-google-sans.txt`; Modify: `src/app/fonts.ts` (the one build warning)
- Modify: `vitest.config.mts`, `vitest.db.config.mts`, `package.json` (drop `vite-tsconfig-paths`), `vitest.setup.ts`
- Create: `src/test/console-guard.ts`, `src/test/console-guard.test.ts`
- Modify: `src/config/env.ts`, `src/config/env.test.ts` (`LOG_LEVEL` accepts `silent`)
- Create: `e2e/helpers/test.ts`; Modify: every `e2e/*.spec.ts` (import `test` from it), `eslint.config.mjs`
- Create: `scripts/check-build-log.ts`, `scripts/check-build-log.test.ts`; Modify: `playwright.config.ts`, `.github/workflows/ci.yml`, `.gitignore`
- Create: `src/lib/deployment.ts`, `src/lib/deployment.test.ts`, `src/app/design/page.test.tsx`; Modify: `src/app/design/page.tsx`
- Modify (GDG ISSAT examples): `messages/en.json` (`Design.meetingPlace`), `src/lib/export/file-name.ts`, `e2e/roster.spec.ts`, `e2e/fixtures/roster.csv`, and the test files listed in Step 9

**Interfaces:**
- Produces: `allowConsole(pattern: RegExp): void` (`src/test/console-guard.ts`, unit tests that expect a console message); `test` and `expect` from `e2e/helpers/test.ts` with the `allowConsole` option (`test.use({ allowConsole: [/…/] })`); `isProductionDeployment(vercelEnv: string | undefined): boolean` (`src/lib/deployment.ts`); `buildWarnings(log: string): string[]` (`scripts/check-build-log.ts`).
- Every later task's e2e spec imports `test` from `./helpers/test`, so a new console error or CSP report fails it (Task 5 turns CSP reports into console errors).

- [ ] **Step 1: Write the failing unit tests for the guards and the deployment rule**

`src/test/console-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createConsoleGuard } from "./console-guard";

describe("createConsoleGuard", () => {
  it("collects console.error and console.warn calls", () => {
    const target = { error: () => {}, warn: () => {} };
    const guard = createConsoleGuard(target);
    target.error("Warning: %s is deprecated", "x");
    target.warn("careful");
    expect(guard.take()).toEqual([
      "console.error: Warning: x is deprecated",
      "console.warn: careful",
    ]);
    expect(guard.take()).toEqual([]);
  });

  it("lets a test expect a message, once per test", () => {
    const target = { error: () => {}, warn: () => {} };
    const guard = createConsoleGuard(target);
    guard.allow(/expected boom/);
    target.error("expected boom happened");
    expect(guard.take()).toEqual([]);
    target.error("expected boom happened");
    expect(guard.take()).toEqual(["console.error: expected boom happened"]);
  });
});
```

`src/lib/deployment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isProductionDeployment } from "./deployment";

describe("isProductionDeployment", () => {
  it.each([
    ["production", true],
    ["preview", false],
    ["development", false],
    [undefined, false],
  ])("VERCEL_ENV=%s → %s", (env, expected) => {
    expect(isProductionDeployment(env)).toBe(expected);
  });
});
```

`src/app/design/page.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ VERCEL_ENV: undefined as string | undefined }));
vi.mock("@/config/env", () => ({ getServerEnv: () => env }));
vi.mock("./design-showcase", () => ({ DesignShowcase: () => null }));

describe("DesignPage", () => {
  it("is not found on production", async () => {
    env.VERCEL_ENV = "production";
    const { default: DesignPage } = await import("./page");
    expect(() => DesignPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("renders on previews and locally", async () => {
    env.VERCEL_ENV = "preview";
    const { default: DesignPage } = await import("./page");
    expect(() => DesignPage()).not.toThrow();
  });
});
```

`scripts/check-build-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildWarnings } from "./check-build-log";

describe("buildWarnings", () => {
  it("finds Turbopack and Next warnings", () => {
    const log = [
      "▲ Next.js 16.3.8 (Turbopack)",
      "- Experiments (use with caution):",
      "Turbopack build encountered 1 warning:",
      "Warning: Failed to find font override values for font `Google Sans`",
      "⚠ Compiled with warnings",
      "✓ Compiled successfully in 3.3s",
    ].join("\n");
    expect(buildWarnings(log)).toEqual([
      "Turbopack build encountered 1 warning:",
      "Warning: Failed to find font override values for font `Google Sans`",
      "⚠ Compiled with warnings",
    ]);
  });

  it("passes a clean log", () => {
    expect(buildWarnings("✓ Compiled successfully\n✓ Generating static pages")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun run test -- --run src/test/console-guard src/lib/deployment src/app/design scripts/check-build-log`
Expected: FAIL (`Cannot find module './console-guard'`, `./deployment`, `./check-build-log`; the design page renders on production).

- [ ] **Step 3: Implement the unit-test console guard and wire it into `vitest.setup.ts`**

`src/test/console-guard.ts`:

```ts
import { format } from "node:util";

type ConsoleTarget = { error: (...args: never[]) => void; warn: (...args: never[]) => void };

/** Collects console.error / console.warn calls so a test fails on any it didn't expect. */
export type ConsoleGuard = {
  /** The messages since the last call (then forgets them and the test's expectations). */
  take: () => string[];
  /** One expected message for the current test (matched once). */
  allow: (pattern: RegExp) => void;
};

/**
 * Replaces `target.error` and `target.warn` (the global console in `vitest.setup.ts`) with
 * collectors. React warnings, act() warnings and jsdom errors all arrive through these two.
 */
export function createConsoleGuard(target: ConsoleTarget): ConsoleGuard {
  const seen: string[] = [];
  const expected: RegExp[] = [];
  for (const method of ["error", "warn"] as const) {
    target[method] = ((...args: Parameters<typeof format>) => {
      const text = format(...args);
      const index = expected.findIndex((pattern) => pattern.test(text));
      if (index >= 0) {
        expected.splice(index, 1);
        return;
      }
      seen.push(`console.${method}: ${text}`);
    }) as ConsoleTarget[typeof method];
  }
  return {
    take: () => {
      expected.length = 0;
      return seen.splice(0, seen.length);
    },
    allow: (pattern) => {
      expected.push(pattern);
    },
  };
}

let current: ConsoleGuard | null = null;

/** Installs the guard on the global console (once, from `vitest.setup.ts`). */
export function installConsoleGuard(): ConsoleGuard {
  current ??= createConsoleGuard(console);
  return current;
}

/** A test that provokes a console message on purpose declares it first. */
export function allowConsole(pattern: RegExp): void {
  installConsoleGuard().allow(pattern);
}
```

In `vitest.setup.ts`, add after the existing stubs (keep the file's other lines as they are):

```ts
import { installConsoleGuard } from "./src/test/console-guard";

// jsdom has no window.scrollTo; components that call it (dialogs restoring focus) get a no-op
// instead of jsdom's "Not implemented" error on stderr.
window.scrollTo = () => {};

const consoleGuard = installConsoleGuard();
```

and extend the existing `afterEach`:

```ts
afterEach(() => {
  cleanup();
  setReducedMotion(false);
  setWideViewport(false);
  // Zero warnings (spec §12, M9): any console.error / console.warn a test didn't expect fails it.
  const problems = consoleGuard.take();
  if (problems.length > 0) {
    throw new Error(`Unexpected console output:\n${problems.join("\n")}`);
  }
});
```

The `vitest.db.config.mts` run has no setup file and no React; it keeps printing only test results.

- [ ] **Step 4: Silence the test logger and drop the deprecated Vite plugin**

`src/config/env.ts`: the `LOG_LEVEL` enum becomes `z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")`. In `src/config/env.test.ts`, add next to the `"loud"` case:

```ts
  it("accepts silent (tests)", () => {
    expect(parseServerEnv({ ...supabase, ...smtp, LOG_LEVEL: "silent" }).LOG_LEVEL).toBe("silent");
  });
```

`vitest.config.mts`: remove `import tsconfigPaths from "vite-tsconfig-paths";`, remove `tsconfigPaths()` from `plugins` (leaving `plugins: [react()]`), add `tsconfigPaths: true` inside `resolve` (next to `alias`), and add `LOG_LEVEL: "silent"` to `test.env`. Tests that assert log lines already pass their own `destination` to `createLogger` with an explicit level, so they are unaffected.

`vitest.db.config.mts`: the same plugin removal (`plugins` disappears entirely) and `resolve.tsconfigPaths: true`.

`package.json`: remove `"vite-tsconfig-paths": "6.1.1"` from `devDependencies`, then `bun install`.

Run: `bun run test -- --run 2>&1 | tee /tmp/unit.log >/dev/null; grep -cE "vite-tsconfig-paths|Not implemented|\"level\":" /tmp/unit.log`
Expected: `0`, and the run passes (1,381+ tests).

- [ ] **Step 5: Fix the lint warning**

The app does not run React Compiler (`next.config.ts` has no `reactCompiler`), so the rule's "compilation skipped" note has no runtime effect, and `"use no memo"` does not silence it (checked 2026-10-15). TanStack Virtual has no compiler-compatible API yet. Mark the one call with the reason:

```tsx
  // React Compiler is not enabled; TanStack Virtual has no compiler-safe API, so the rule's
  // "compilation skipped" note changes nothing here (M9 zero-warnings ruling).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
```

Run: `bun run lint`
Expected: no output, exit 0.

- [ ] **Step 6: Fix the build warning (Google Sans fallback metrics)**

Turbopack's Google font loader warns "Failed to find font override values for font `Google Sans`" even with `adjustFontFallback: false`. Google Sans is OFL on Google Fonts (`ofl/googlesans/METADATA.pb`, checked 2026-10-15), so self-host the one weight the Google button uses:

```bash
mkdir -p src/assets/fonts
css=$(curl -s "https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&display=swap" -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
url=$(printf '%s' "$css" | awk '/\/\* latin \*\//{f=1} f && /src: url/{match($0,/https:[^)]+/); print substr($0,RSTART,RLENGTH); exit}')
test -n "$url" && curl -s "$url" -o src/assets/fonts/google-sans-500-latin.woff2
curl -s https://raw.githubusercontent.com/google/fonts/main/ofl/googlesans/OFL.txt -o src/assets/fonts/OFL-google-sans.txt
file src/assets/fonts/google-sans-500-latin.woff2
```

Expected: `Web Open Font Format (Version 2)`. If the CSS has no `/* latin */` block, take the only `src: url(...)` instead.

`src/app/fonts.ts`: replace the `googleSans` export (keep the other two):

```ts
import localFont from "next/font/local";

/**
 * Google's sign-in button font (branding guidelines: Google Sans Medium 14/20); used only there.
 * Self-hosted (OFL, `src/assets/fonts/OFL-google-sans.txt`): Turbopack's Google loader has no
 * fallback metrics for it and warns on every build.
 */
export const googleSans = localFont({
  src: "../assets/fonts/google-sans-500-latin.woff2",
  weight: "500",
  display: "swap",
  adjustFontFallback: false,
});
```

and drop `Google_Sans` from the `next/font/google` import. In `vitest.setup.ts`, add `vi.mock("next/font/local", () => ({ default: () => ({ className: "", variable: "", style: { fontFamily: "" } }) }));` next to the Google mock, and remove `Google_Sans: font` from it.

Run: `bun run build 2>&1 | tee /tmp/build.log >/dev/null; bun scripts/check-build-log.ts /tmp/build.log`
Expected (after Step 7 creates the script): exit 0, "No build warnings."

- [ ] **Step 7: The build-log check and the e2e console guard**

`scripts/check-build-log.ts`:

```ts
import { readFileSync } from "node:fs";

const WARNING = /\bwarn(?:ing|ings)?\b|⚠/i;

/** Lines of a `next build` log that report a warning (spec §12: the build has none). */
export function buildWarnings(log: string): string[] {
  return log.split("\n").filter((line) => WARNING.test(line));
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("usage: bun scripts/check-build-log.ts <build.log>\n");
    process.exit(2);
  }
  const warnings = buildWarnings(readFileSync(path, "utf8"));
  if (warnings.length > 0) {
    process.stderr.write(`Build warnings:\n${warnings.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("No build warnings.\n");
}
```

`playwright.config.ts`, `webServer.command`: keep a copy of the build output for CI (the pipe keeps the build's exit status):

```ts
    command: `bash -o pipefail -c "bun run build 2>&1 | tee .e2e-build.log" && bun run start -p ${PORT}`,
```

`.gitignore`: add `.e2e-build.log`. `.github/workflows/ci.yml`, `db` job, after `- run: bun run test:e2e`:

```yaml
      - run: bun scripts/check-build-log.ts .e2e-build.log
```

`e2e/helpers/test.ts`:

```ts
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

type Fixtures = {
  /** Console messages this test provokes on purpose (for example a 404 it asks for). */
  allowConsole: RegExp[];
  /** Fails the test on any browser console error or warning or uncaught error (spec §12, M9). */
  browserConsole: void;
};

/**
 * Every e2e spec imports `test` from here (ESLint enforces it). The guard watches the test's own
 * context and every context the test opens with `browser.newContext()`, including their pages
 * opened later (popups, new tabs). CSP reports reach it as console errors (Task 5).
 */
export const test = base.extend<Fixtures>({
  allowConsole: [[], { option: true }],
  browserConsole: [
    async ({ browser, context, allowConsole }, use) => {
      const problems: string[] = [];
      const watchPage = (page: Page) => {
        page.on("console", (message) => {
          const type = message.type();
          if (type !== "error" && type !== "warning") {
            return;
          }
          const text = message.text();
          if (!allowConsole.some((pattern) => pattern.test(text))) {
            problems.push(`${type}: ${text} (${page.url()})`);
          }
        });
        page.on("pageerror", (error) => {
          problems.push(`uncaught: ${error.message} (${page.url()})`);
        });
      };
      const watchContext = (watched: BrowserContext) => {
        watched.pages().forEach(watchPage);
        watched.on("page", watchPage);
      };
      watchContext(context);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const created = await newContext(options);
        watchContext(created);
        return created;
      };
      try {
        await use();
      } finally {
        browser.newContext = newContext;
      }
      expect(problems, "browser console errors and warnings").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
```

In every `e2e/*.spec.ts`, change `import { expect, test } from "@playwright/test";` (and the variants with `type Page` / `type Browser`) so `test` and `expect` come from `./helpers/test` and only types stay on `@playwright/test`:

```bash
for f in e2e/*.spec.ts; do
  python3 - "$f" <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.search(r'import \{([^}]*)\} from "@playwright/test";\n', s)
if not m:
    sys.exit(0)
names = [n.strip() for n in m.group(1).split(",") if n.strip()]
values = [n for n in names if n in ("test", "expect")]
types = [n for n in names if n not in ("test", "expect")]
lines = []
if types:
    lines.append('import { ' + ", ".join(types) + ' } from "@playwright/test";\n')
if values:
    lines.append('import { ' + ", ".join(values) + ' } from "./helpers/test";\n')
s = s.replace(m.group(0), "".join(lines), 1)
open(p, "w").write(s)
EOF
done
grep -L 'from "./helpers/test"' e2e/*.spec.ts
```

Expected: no file printed. `eslint.config.mjs`, a new block after the shared `rules` block:

```js
  {
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test", "expect"],
              message: "Import test and expect from ./helpers/test (it fails on browser console errors).",
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 8: Hide `/design` on production**

`src/lib/deployment.ts`:

```ts
/**
 * Whether this is the production deployment (`VERCEL_ENV`, set by Vercel; unset locally, in CI
 * and in e2e). Internal pages such as `/design` exist everywhere else.
 */
export function isProductionDeployment(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}
```

`src/app/design/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerEnv } from "@/config/env";
import { isProductionDeployment } from "@/lib/deployment";
import { DesignShowcase } from "./design-showcase";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Internal design-system showcase (not linked from the product; not found on production, M9). */
export default function DesignPage() {
  if (isProductionDeployment(getServerEnv().VERCEL_ENV)) {
    notFound();
  }
  return <DesignShowcase />;
}
```

e2e builds are not Vercel production builds, so `e2e/design-system.spec.ts` keeps using the page; the unit test above pins the production rule.

- [ ] **Step 9: Replace every GDG ISSAT example (Owner rule: never GDG ISSAT, invented names only)**

```bash
python3 - <<'EOF'
import pathlib
pairs = [
    ("GDG on Campus ISSAT Sousse", "Riverside Volunteers of Sousse"),
    ("gdg-on-campus-issat-sousse", "riverside-volunteers-of-sousse"),
    ("GDG ISSAT", "Robotics Club"),
    ("gdg-issat", "robotics-club"),
    ("gdg-ab12", "robotics-ab12"),
    ("GDG · TapNShow", "Robotics Club · TapNShow"),
    ("GDG Club", "Robotics Club"),
    ("Adresse e-mail (ISSAT)", "Adresse e-mail (club)"),
    ("ISSAT Sousse, Room B12", "Main Library, Room B12"),
    ("mohamedali.benabdallah.elkefi@etudiant-issatso.u-sousse.tn",
     "mohamedali.benabdallah.elkefi@students.riverside-university.example"),
]
files = """messages/en.json src/lib/export/file-name.ts e2e/roster.spec.ts e2e/fixtures/roster.csv
src/app/account/use-download-my-answers.test.tsx src/app/invites/invite-card.test.tsx
src/emails/calendar-confirm-email.test.tsx src/emails/meeting-cancel-email.test.tsx
src/emails/meeting-invite-email.test.tsx src/emails/meeting-reminder-email.test.tsx
src/emails/owner-alert-email.test.tsx src/lib/calendar/ics.test.ts src/lib/export/file-name.test.ts
src/lib/export/rows.test.ts src/lib/export/xlsx.test.ts src/lib/import/guess-columns.test.ts
src/lib/push/message.test.ts src/lib/push/sw-handlers.test.ts src/lib/sheets/content.test.ts
src/lib/slug.test.ts src/server/db/core.db.test.ts src/server/dispatch/run-dispatch.test.ts
src/server/email/owner-alert.test.ts src/server/google/sheets-client.test.ts
src/server/push/run-push.test.ts src/server/queries/dispatch.test.ts src/server/queries/push.test.ts
src/server/sheets/run-sheets.test.ts src/test/fixtures/emails.ts src/test/fixtures/my-invites.ts""".split()
for f in files:
    p = pathlib.Path(f); s = p.read_text()
    for old, new in pairs:
        s = s.replace(old, new)
    p.write_text(s)
EOF
grep -rniI "gdg\|issat" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=.superpowers --exclude-dir=docs . | grep -v bun.lock
```

Expected: no output. (`docs/` keeps its history: the spec's Origin line and old plans stay as written.) A replaced example that a test compares against a computed value (a slug, a file name, an email length) is fixed in the expectation, never by loosening the test.

- [ ] **Step 10: Run the whole chain, then e2e, and fix every console finding at its root**

Run (chained, logs grepped):

```bash
bunx prettier --write src/test/console-guard.ts src/test/console-guard.test.ts src/lib/deployment.ts src/lib/deployment.test.ts src/app/design/page.tsx src/app/design/page.test.tsx src/app/fonts.ts scripts/check-build-log.ts scripts/check-build-log.test.ts e2e vitest.setup.ts vitest.config.mts vitest.db.config.mts playwright.config.ts eslint.config.mjs messages/en.json && bun run format:check && bun run lint && bun run typecheck && bun run test -- --run > /tmp/unit.log 2>&1 && grep -E "Tests +[0-9]+ passed" /tmp/unit.log
```

Then `TZ=UTC bun run test:e2e > /tmp/e2e.log 2>&1` (`run_in_background`). For each `browser console errors and warnings` failure: find the cause and fix it in the product (a React key warning, a hydration mismatch, an unhandled rejection, a preload warning). Only a message the test provokes on purpose is allowed, with `test.use({ allowConsole: [/…/] })` scoped to that `describe` and a comment naming why (for example, a spec that opens an expired invite gets Chromium's `Failed to load resource: the server responded with a status of 410`). Then `bun scripts/check-build-log.ts .e2e-build.log`. Expected: e2e all passed, "No build warnings."

Also run `supabase db reset --local </dev/null && bun run test:db > /tmp/db.log 2>&1 && grep -iE "warn" /tmp/db.log | head`. Expected: nothing beyond test names.

- [ ] **Step 11: Commit, PR, merge**

```bash
git add -A src e2e scripts vitest.setup.ts vitest.config.mts vitest.db.config.mts playwright.config.ts eslint.config.mjs messages/en.json package.json bun.lock .gitignore .github/workflows/ci.yml
git commit -m "chore: zero warnings — console guards, build-log check, Google Sans self-hosted, /design hidden on production, no GDG ISSAT examples"
```

PR body notes the rulings: the one `eslint-disable-next-line` (React Compiler off; no compiler-safe TanStack Virtual API), and `/design`'s production rule pinned by a unit test (e2e builds aren't Vercel production).
### Task 2: Not-found and error pages, `global-error` on `retry()`, the API's JSON 404

**Issue labels:** `type:task`, `area:frontend`, `area:api`. **Branch:** `feat/<issue>-error-pages`.

**Files:**
- Create: `src/components/errors/not-found-view.tsx`, `src/components/errors/not-found-view.test.tsx`, `src/components/errors/error-view.tsx`
- Modify: `src/app/design/design-showcase.tsx` (an "Error pages" section, for screenshots)
- Create: `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/error.test.tsx`
- Modify: `src/app/global-error.tsx`, `src/app/global-error.test.tsx`
- Modify: `src/server/http/auth-cookie.ts`, `src/server/http/auth-cookie.test.ts` (`isSessionCookieName`)
- Create: `src/app/api/[...path]/route.ts`, `src/app/api/[...path]/route.test.ts`
- Modify: `messages/en.json` (`Errors`)
- Create: `e2e/errors.spec.ts`

**Interfaces:**
- Consumes: `PublicPage` (`src/components/public/public-page.tsx`), `Button`, `Sticker`, `apiError` (`src/server/http/errors.ts`).
- Produces: `isSessionCookieName(name: string): boolean` (`src/server/http/auth-cookie.ts`, also used by `PublicShell` in Task 11); `NotFoundView({ signedIn }: { signedIn: boolean })`. Task 11 moves `not-found.tsx` into the public shell; Task 3's route registry lists `api/[...path]` as `{ kind: "outer", reason: "unknown address" }`.

**Rulings (copy into the ledger):**
- The signed-in button reads **Open TapNShow** and goes to `/welcome`, which already sends each person where they belong (last workspace, or `/invites` for members without one). The spec's "Go to my workspaces" would be wrong for members with no workspace.
- The API 404 keeps the existing body shape `{ "error": { "code": "not_found" } }` (`apiErrorBodySchema`), not the spec's shorthand `{ "error": "not_found" }`; every client already parses this shape.

- [ ] **Step 1: Messages**

`messages/en.json`, `Errors` becomes (keep `global` and `retry`):

```json
  "Errors": {
    "global": "Something went wrong. Please reload the page.",
    "retry": "Try again",
    "notFoundTitle": "We can't find that page",
    "notFoundBody": "The link may be old, or the address has a typo.",
    "openApp": "Open TapNShow",
    "goHome": "Go to the home page",
    "errorTitle": "Something went wrong",
    "errorBody": "This page stopped working. Try again, or start from the home page."
  },
```

- [ ] **Step 2: Write the failing tests**

`src/components/errors/not-found-view.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { NotFoundView } from "./not-found-view";

describe("NotFoundView", () => {
  it("offers the home page to everyone", () => {
    renderWithProviders(<NotFoundView signedIn={false} />);
    expect(screen.getByRole("heading", { name: "We can't find that page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Open TapNShow" })).toBeNull();
  });

  it("offers the app first to someone signed in", () => {
    renderWithProviders(<NotFoundView signedIn />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Open TapNShow", "Go to the home page"]);
    expect(links[0]).toHaveAttribute("href", "/welcome");
  });
});
```

`src/app/error.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import ErrorPage from "./error";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

describe("ErrorPage", () => {
  it("reports the error once and shows no technical details", () => {
    const error = Object.assign(new Error("db password=hunter2 failed"), { digest: "123" });
    renderWithProviders(<ErrorPage error={error} retry={vi.fn()} />);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.queryByText(/hunter2|123/)).toBeNull();
  });

  it("tries again with retry()", () => {
    const retry = vi.fn();
    renderWithProviders(<ErrorPage error={new Error("x")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });
});
```

`src/app/global-error.test.tsx`: rename `reset` to `retry` in both tests (`render(<GlobalError error={new Error("boom")} retry={retry} />)`, the first test's title becomes "offers a retry that calls retry").

`src/server/http/auth-cookie.test.ts`, add:

```ts
describe("isSessionCookieName", () => {
  it.each([
    ["sb-abc-auth-token", true],
    ["sb-abc-auth-token.0", true],
    ["sb-abc-auth-token-code-verifier", false],
    ["tn_theme", false],
  ])("%s → %s", (name, expected) => {
    expect(isSessionCookieName(name)).toBe(expected);
  });
});
```

(import `isSessionCookieName` next to `hasAuthCookie`).

`src/app/api/[...path]/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("unknown API addresses", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s answers 404 JSON",
    async (method) => {
      const route = await import("./route");
      const response = await route[method]();
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toEqual({ error: { code: "not_found" } });
    },
  );
});
```

Run: `bun run test -- --run src/components/errors src/app/error src/app/global-error auth-cookie "api/\[...path\]"`
Expected: FAIL (modules missing; `retry` is not called because the component still calls `reset`).

- [ ] **Step 3: Implement**

`src/server/http/auth-cookie.ts` becomes:

```ts
import "server-only";

const SESSION_COOKIE_NAME = /^sb-[^=;]+-auth-token(?:\.\d+)?$/;

/**
 * Whether a cookie name is a Supabase session cookie (`@supabase/ssr` names it
 * `sb-<ref>-auth-token`, split into `.0`, `.1` … when long). Server components use it with
 * `cookies()`; routes use `hasAuthCookie`.
 */
export function isSessionCookieName(name: string): boolean {
  return SESSION_COOKIE_NAME.test(name);
}

/**
 * Whether the request carries a Supabase session cookie. Public pages use it to skip the session
 * check for the many visitors who never signed in.
 */
export function hasAuthCookie(request: Request): boolean {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .some((part) => isSessionCookieName(part.split("=", 1)[0]?.trim() ?? ""));
}
```

`src/components/errors/not-found-view.tsx`:

```tsx
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PublicPage } from "@/components/public/public-page";
import { Button } from "@/components/ui/button";
import { Sticker } from "@/components/ui/sticker";

/**
 * The not-found page (spec §7.18): any unknown address and every `notFound()`. Someone signed in
 * gets the app first (`/welcome` sends each person to their place).
 */
export function NotFoundView({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("Errors");
  return (
    <PublicPage>
      <Sticker tone="info">
        <MagnifyingGlass weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("notFoundTitle")}</h1>
      <p>{t("notFoundBody")}</p>
      <div className="flex flex-col gap-3">
        {signedIn ? (
          <Button asChild tone="primary">
            <Link href="/welcome">{t("openApp")}</Link>
          </Button>
        ) : null}
        <Button asChild tone={signedIn ? "surface" : "primary"}>
          <Link href="/">{t("goHome")}</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
```

`src/app/not-found.tsx`:

```tsx
import { cookies } from "next/headers";
import { NotFoundView } from "@/components/errors/not-found-view";
import { isSessionCookieName } from "@/server/http/auth-cookie";

/** Root not-found (spec §7.18). Reads the session cookie only: no database call for a 404. */
export default async function NotFound() {
  const signedIn = (await cookies())
    .getAll()
    .some((cookie) => isSessionCookieName(cookie.name));
  return <NotFoundView signedIn={signedIn} />;
}
```

`src/components/errors/error-view.tsx`:

```tsx
"use client";

import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PublicPage } from "@/components/public/public-page";
import { Button } from "@/components/ui/button";
import { Sticker } from "@/components/ui/sticker";

/** What a crashed page shows (spec §7.18): plain words, no technical details. */
export function ErrorView({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("Errors");
  return (
    <PublicPage>
      <Sticker tone="warning">
        <WarningCircle weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("errorTitle")}</h1>
      <p>{t("errorBody")}</p>
      <div className="flex flex-col gap-3">
        <Button tone="primary" onClick={onRetry}>
          {t("retry")}
        </Button>
        <Button asChild>
          <Link href="/">{t("goHome")}</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
```

`src/app/error.tsx`:

```tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorView } from "@/components/errors/error-view";

/** A page crashed inside the root layout (spec §7.18): theme and fonts stay; Sentry gets it. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return <ErrorView onRetry={() => retry()} />;
}
```

`src/app/global-error.tsx`: the props become `{ error, retry }` with `retry: () => void`, the button calls `retry()`, and the JSDoc says "offers a retry (`retry()`, Next 16 docs: it re-fetches, unlike `reset()`)".

`src/app/api/[...path]/route.ts`:

```ts
import type { NextResponse } from "next/server";
import { apiError } from "@/server/http/errors";

/**
 * Any `/api/…` address no route handles (spec §7.18): JSON 404, never the HTML not-found page.
 * Specific routes always win over this catch-all.
 */
function notFound(): NextResponse {
  return apiError("not_found");
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
```

Run: the Step 2 command. Expected: PASS.

- [ ] **Step 4: e2e**

`e2e/errors.spec.ts`:

```ts
import { expect, test } from "./helpers/test";

test.describe("error pages", () => {
  // The browser logs the 404 of the page it was asked for.
  test.use({ allowConsole: [/status of 404/] });

  for (const scheme of ["light", "dark"] as const) {
    test(`an unknown address shows the not-found page (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const response = await page.goto("/this-page-does-not-exist");
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await page.getByRole("link", { name: "Go to the home page" }).click();
      await expect(page).toHaveURL("/");
    });
  }

  test("an unknown API address answers JSON", async ({ request }) => {
    const response = await request.post("/api/nothing-here", { data: {} });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });
});
```

The error page has no e2e trigger in a production build (no route crashes on purpose); its unit test covers it. Run: `TZ=UTC bun run test:e2e e2e/errors.spec.ts`. Expected: PASS.

- [ ] **Step 5: Screenshots and the Owner's look**

Add an "Error pages" section at the end of `src/app/design/design-showcase.tsx` that renders `<NotFoundView signedIn={false} />`, `<NotFoundView signedIn />` and `<ErrorView onRetry={() => {}} />` one under the other (the showcase is a client component; `NotFoundView` has no server-only import, so it renders there too). Screenshot `/this-page-does-not-exist` and that section at 390 light, 320 dark and 1024 through `.superpowers/scripts/screens/pw.config.ts`, send them (`SendUserFile`) and ask "Looks right?" (AskUserQuestion) before merging.

- [ ] **Step 6: Chain, commit, PR, merge**

Run the full chain from Global Constraints (no DB work). Commit: `feat: not-found and error pages in the app's style, global-error on retry(), JSON 404 for unknown API addresses`.
### Task 3: The route registry (rate limits) and the missing database limits

**Issue labels:** `type:task`, `area:db`, `area:api`. **Branch:** `feat/<issue>-write-limits`. **Migration:** `supabase migration new m9_write_limits`.

**Files:**
- Create: `supabase/migrations/<ts>_m9_write_limits.sql`
- Create: `src/server/http/route-registry.ts`, `src/server/http/route-registry.test.ts`
- Create: `src/server/db/m9-write-limits.db.test.ts`, `src/test/db/limits.ts`
- Modify: `src/server/rate-limit/ip-rate-limit.ts`, `src/server/rate-limit/ip-rate-limit.test.ts`
- Modify: `src/app/api/auth/otp/send/route.ts`, `src/app/api/auth/otp/verify/route.ts` (+ its test), `src/app/api/auth/google/start/route.ts` (+ its test)
- Modify: `src/app/login/login-screen.tsx` (+ its test: `?error=rate_limited`)
- Modify: `src/server/db/function-security.db.test.ts` (`require_user_limit` allowed)

**Interfaces:**
- Produces:
  - `ROUTES` (`src/server/http/route-registry.ts`): `Record<string, Partial<Record<RouteMethod, RouteEntry>>>`, keyed by the route's folder under `src/app/api/` (`"workspaces/[slug]/lists"`). `RouteEntry = { limits: readonly LimitRule[]; list?: ListRule }` (`list` is filled by Task 4). Every later task that adds a route adds its entry in the same PR, or the unit test fails.
  - `LimitRule` kinds: `user(action, in)` (a function whose definition spends the action), `write(action, table)` (the statement trigger on direct writes), `ip(action)`, `TOKEN`, `SECRET`, `SIGNED_IN_READ`, `outer(reason)`.
  - SQL: `private.require_user_limit(p_action text) returns void` (raises `tn:rate_limited`), `private.limit_direct_writes()` (statement trigger function), new `hit_user_rate_limit` actions, `check_ip_rate_limit` actions `otp_verify` and `google_signin`.
  - TS: `allowIpRequest(action: IpLimitAction, ip: string): Promise<boolean>` replaces `allowOtpRequest`.
- Later tasks add their actions to `private.hit_user_rate_limit` by copying **this** migration's body.

**Rulings (copy into the ledger):**
- `token_requests_per_ip_per_hour` goes from 120 to 1500 (Review Focus 1, shared campus Wi-Fi; the Owner confirms this value when approving the plan). The per-token limit (30 an hour) is unchanged.
- Sign-out has no database limit: signing out must always work, and it writes nothing (registry reason). The WAF guard caps abuse.
- The two OAuth callbacks have no database limit of their own: each is refused at once without the state cookie that only its rate-limited start sets, so their cost is bounded by the start's limit.
- Direct writes (RLS writes through the Data API, and `SECURITY INVOKER` functions such as `update_contact`) are limited by statement triggers that fire only when `current_user = 'authenticated'`, and count **once per transaction per action** (`set_config('tn.counted.<action>', 'on', true)`), so one `update_contact` call is one write however many statements it runs. `SECURITY DEFINER` functions run as their owner and keep their own limits. The Data API can't skip a trigger the way it can skip a route.
- `SECURITY DEFINER` bodies behind thin wrappers get their limit **in the wrapper** (`select private.require_user_limit('<action>'); select private.<fn>(…)`), so no body is copied. `invite_preview`'s wrapper becomes `volatile` (it now writes a rate-limit event).

- [ ] **Step 1: The registry and its unit test (red)**

`src/server/http/route-registry.ts`:

```ts
/** HTTP methods a route file can export. */
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Per-IP limits for routes used before sign-in (`private.check_ip_rate_limit`). */
export type IpLimitAction = "otp_send" | "otp_verify" | "google_signin";

/**
 * Where a route's rate limit lives (spec §10 Route registries, §11 Rate limiting). The outer guard
 * (the Vercel WAF rule on `/api/*`) covers every route on top of these.
 */
export type LimitRule =
  /** The named function's definition spends `action` (through `hit_user_rate_limit`). */
  | { kind: "user"; action: string; in: `${"public" | "private"}.${string}` }
  /** A statement trigger on `table` spends `action` for direct writes by signed-in users. */
  | { kind: "write"; action: string; table: `public.${string}` }
  | { kind: "ip"; action: IpLimitAction }
  /** The public token routes: per IP and per token (`loadTokenContext`). */
  | { kind: "token" }
  /** The internal worker route: the dispatch secret. */
  | { kind: "secret" }
  /** Nothing beyond the outer guard, and why that is enough. */
  | { kind: "outer"; reason: string };

/** How a GET route bounds what it returns (filled by Task 4). */
export type ListRule =
  | { kind: "paged"; size: string }
  | { kind: "bounded"; by: string }
  | { kind: "single" };

/** One method of one route. */
export type RouteEntry = { limits: readonly LimitRule[]; list?: ListRule };

const user = (action: string, fn: `${"public" | "private"}.${string}`): LimitRule => ({
  kind: "user",
  action,
  in: fn,
});
const write = (action: string, table: `public.${string}`): LimitRule => ({
  kind: "write",
  action,
  table,
});
const ip = (action: IpLimitAction): LimitRule => ({ kind: "ip", action });
const outer = (reason: string): LimitRule => ({ kind: "outer", reason });
const TOKEN: LimitRule = { kind: "token" };
const SECRET: LimitRule = { kind: "secret" };
const SIGNED_IN_READ = outer("signed-in read: the WAF guard");

/**
 * Every route file and exported method under `src/app/api/` (route-registry.test.ts fails for a
 * missing or stale one). Adding a route is a decision about its limit: write it here in the
 * same PR.
 */
export const ROUTES: Record<string, Partial<Record<RouteMethod, RouteEntry>>> = {
  "[...path]": {
    GET: { limits: [outer("unknown address: answers 404 with no database call")] },
    POST: { limits: [outer("unknown address: answers 404 with no database call")] },
    PUT: { limits: [outer("unknown address: answers 404 with no database call")] },
    PATCH: { limits: [outer("unknown address: answers 404 with no database call")] },
    DELETE: { limits: [outer("unknown address: answers 404 with no database call")] },
  },
  "auth/google/callback": {
    GET: { limits: [outer("refused at once without the state cookie that only the IP-limited start sets")] },
  },
  "auth/google/start": {
    GET: { limits: [ip("google_signin")] },
  },
  "auth/otp/send": {
    POST: { limits: [ip("otp_send")] },
  },
  "auth/otp/verify": {
    POST: { limits: [ip("otp_verify")] },
  },
  "auth/signout": {
    POST: { limits: [outer("signing out must always work; no database write")] },
  },
  "health": {
    GET: { limits: [outer("uptime probe, excluded from the WAF rule; one constant query")] },
  },
  "integrations/google/callback": {
    GET: { limits: [outer("refused at once without the state cookie that only the rate-limited connect start sets")] },
  },
  "integrations/google/connect": {
    GET: { limits: [user("google_connect", "public.hit_google_connect_limit")] },
  },
  "integrations/google/connections/[id]": {
    DELETE: { limits: [user("google_disconnect", "public.disconnect_google_connection")] },
  },
  "internal/dispatch": {
    POST: { limits: [SECRET] },
  },
  "invites/accept": {
    POST: { limits: [user("invite_accept", "public.accept_invite")] },
  },
  "invites/preview": {
    POST: { limits: [user("invite_preview", "public.invite_preview")] },
  },
  "me": {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("profile_write", "public.profiles")] },
    DELETE: { limits: [user("account_delete", "private.delete_account")] },
  },
  "me/account": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "me/answers": {
    GET: { limits: [user("answers_download", "private.my_answers")] },
  },
  "me/invites": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "me/invites/[id]/link": {
    GET: { limits: [user("invite_link", "private.my_invite")] },
  },
  "me/push-subscriptions": {
    POST: { limits: [user("push_subscribe", "private.push_subscribe")] },
    DELETE: { limits: [user("push_unsubscribe", "private.push_unsubscribe")] },
  },
  "r/[token]": {
    GET: { limits: [TOKEN] },
  },
  "r/[token]/calendar": {
    POST: { limits: [TOKEN] },
  },
  "r/[token]/ics": {
    GET: { limits: [TOKEN] },
  },
  "r/[token]/report": {
    POST: { limits: [TOKEN] },
  },
  "r/[token]/response": {
    PUT: { limits: [TOKEN] },
  },
  "r/[token]/resubscribe": {
    POST: { limits: [TOKEN] },
  },
  "r/[token]/unsubscribe": {
    GET: { limits: [outer("redirects to /u/<token>; no database call")] },
    POST: { limits: [TOKEN] },
  },
  "workspaces": {
    POST: { limits: [user("workspace_create", "public.create_workspace")] },
  },
  "workspaces/[slug]": {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("workspace_write", "public.workspaces")] },
    DELETE: { limits: [user("workspace_delete", "public.delete_workspace")] },
  },
  "workspaces/[slug]/attendance": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/attendance/details": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/contacts": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/contacts/[id]": {
    PATCH: { limits: [write("contact_write", "public.contacts")] },
    DELETE: { limits: [write("contact_write", "public.contacts")] },
  },
  "workspaces/[slug]/contacts/[id]/history": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/contacts/bulk": {
    POST: { limits: [write("contact_write", "public.contacts"), write("contact_write", "public.list_contacts")] },
  },
  "workspaces/[slug]/contacts/import": {
    POST: { limits: [user("import", "public.import_contacts"), user("import_preview", "public.import_contacts")] },
  },
  "workspaces/[slug]/invites": {
    GET: { limits: [SIGNED_IN_READ] },
    POST: { limits: [user("invite_create", "public.create_invite")] },
  },
  "workspaces/[slug]/invites/[id]": {
    DELETE: { limits: [user("invite_revoke", "public.revoke_invite")] },
  },
  "workspaces/[slug]/invites/[id]/renew": {
    POST: { limits: [user("invite_renew", "public.renew_invite")] },
  },
  "workspaces/[slug]/lists": {
    POST: { limits: [write("list_write", "public.lists")] },
  },
  "workspaces/[slug]/lists/[id]": {
    PATCH: { limits: [write("list_write", "public.lists")] },
    DELETE: { limits: [write("list_write", "public.lists")] },
  },
  "workspaces/[slug]/meeting-defaults": {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("workspace_write", "public.workspaces")] },
  },
  "workspaces/[slug]/meetings": {
    GET: { limits: [SIGNED_IN_READ] },
    POST: { limits: [user("meeting_create", "private.create_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]": {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("meeting_write", "public.meetings")] },
    DELETE: { limits: [write("meeting_write", "public.meetings"), user("meeting_delete", "public.delete_cancelled_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/audience": {
    GET: { limits: [SIGNED_IN_READ] },
    PUT: { limits: [user("audience_set", "public.set_meeting_audience")] },
  },
  "workspaces/[slug]/meetings/[id]/cancel": {
    POST: { limits: [user("meeting_cancel", "public.cancel_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/changes": {
    POST: { limits: [user("meeting_edit_email", "private.edit_sent_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/check-in": {
    PUT: { limits: [user("check_in_mark", "private.mark_attendance")] },
  },
  "workspaces/[slug]/meetings/[id]/check-in/rest": {
    POST: { limits: [user("check_in_rest", "private.mark_rest_as_declared")] },
  },
  "workspaces/[slug]/meetings/[id]/duplicate": {
    POST: { limits: [user("meeting_create", "private.duplicate_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/nudge": {
    POST: { limits: [user("meeting_nudge", "public.nudge_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/people": {
    GET: { limits: [SIGNED_IN_READ] },
    POST: { limits: [user("meeting_people_add", "private.add_meeting_people")] },
  },
  "workspaces/[slug]/meetings/[id]/preview": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/meetings/[id]/results": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/meetings/[id]/send": {
    POST: { limits: [user("meeting_send", "public.send_meeting")] },
  },
  "workspaces/[slug]/members": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/members/[userId]": {
    PATCH: { limits: [user("member_change", "public.change_role")] },
    DELETE: { limits: [user("member_change", "public.remove_member"), user("member_change", "public.leave_workspace")] },
  },
  "workspaces/[slug]/sender": {
    GET: { limits: [SIGNED_IN_READ] },
    PUT: { limits: [user("sender_set", "public.set_workspace_sender")] },
  },
  "workspaces/[slug]/sheet": {
    GET: { limits: [SIGNED_IN_READ] },
    DELETE: { limits: [user("sheet_off", "public.turn_off_sheet")] },
  },
  "workspaces/[slug]/sheet/retry": {
    POST: { limits: [user("sheet_retry", "private.retry_sheet")] },
  },
  "workspaces/[slug]/transfer": {
    POST: { limits: [user("ownership_transfer", "public.transfer_ownership")] },
  },
};
```

`src/server/http/route-registry.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, type RouteMethod } from "./route-registry";

const API = join(process.cwd(), "src/app/api");
const METHODS: readonly RouteMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(path);
    }
    return entry.name === "route.ts" ? [path] : [];
  });
}

const files = routeFiles(API).map((path) => ({
  key: relative(API, path).replace(/\/?route\.ts$/, ""),
  source: readFileSync(path, "utf8"),
}));

function exportedMethods(source: string): RouteMethod[] {
  return METHODS.filter((method) =>
    new RegExp(`export (?:async function|const) ${method}\\b`).test(source),
  );
}

describe("route registry (spec §10)", () => {
  it("has exactly one entry per route file and exported method", () => {
    const actual = Object.fromEntries(
      files.map(({ key, source }) => [key, exportedMethods(source)]),
    );
    const registered = Object.fromEntries(
      Object.entries(ROUTES).map(([key, methods]) => [
        key,
        METHODS.filter((method) => methods[method]),
      ]),
    );
    expect(registered).toEqual(actual);
  });

  it("names at least one limit for every method", () => {
    for (const [key, methods] of Object.entries(ROUTES)) {
      for (const [method, entry] of Object.entries(methods)) {
        expect(entry?.limits.length, `${method} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("finds each route-level limit in its route's source", () => {
    for (const { key, source } of files) {
      for (const entry of Object.values(ROUTES[key] ?? {})) {
        for (const rule of entry?.limits ?? []) {
          if (rule.kind === "ip") {
            expect(source, key).toContain(`allowIpRequest("${rule.action}"`);
          } else if (rule.kind === "token") {
            expect(source, key).toContain("loadTokenContext(");
          } else if (rule.kind === "secret") {
            expect(source, key).toContain("requireInternalSecret(");
          }
        }
      }
    }
  });
});
```

Run: `bun run test -- --run src/server/http/route-registry`
Expected: the first test passes (the registry matches the 60 files today), the third FAILS on `auth/otp/verify` and `auth/google/start` (no `allowIpRequest` yet) and on `auth/otp/send` (still `allowOtpRequest`).

- [ ] **Step 2: The migration**

`supabase/migrations/<ts>_m9_write_limits.sql`:

```sql
-- M9 (spec §10 Route registries, §11 Rate limiting): every write and every pre-sign-in route
-- has its own limit. Values are per user per hour unless named per IP.
insert into private.app_limits (name, value) values
  ('contact_writes_per_user_per_hour', 600),
  ('list_writes_per_user_per_hour', 300),
  ('meeting_writes_per_user_per_hour', 600),
  ('workspace_writes_per_user_per_hour', 120),
  ('profile_writes_per_user_per_hour', 300),
  ('google_disconnects_per_user_per_hour', 20),
  ('invite_accepts_per_user_per_hour', 30),
  ('invite_previews_per_user_per_hour', 120),
  ('invite_creates_per_user_per_hour', 200),
  ('invite_renewals_per_user_per_hour', 100),
  ('invite_revokes_per_user_per_hour', 200),
  ('audience_sets_per_user_per_hour', 600),
  ('meeting_cancels_per_user_per_hour', 30),
  ('meeting_deletes_per_user_per_hour', 60),
  ('meeting_sends_per_user_per_hour', 60),
  ('meeting_nudges_per_user_per_hour', 30),
  ('member_changes_per_user_per_hour', 120),
  ('workspace_deletions_per_user_per_hour', 10),
  ('sender_sets_per_user_per_hour', 30),
  ('ownership_transfers_per_user_per_hour', 10),
  ('sheet_offs_per_user_per_hour', 20),
  ('otp_verify_per_ip_per_hour', 120),
  ('google_signin_per_ip_per_hour', 120);

-- Review Focus 1 (shared campus Wi-Fi): 100 members answering from one IP make about 3 token
-- requests each. 120 per IP per hour blocked the 41st member; the per-token limit (30) still
-- stops a single link from being hammered.
update private.app_limits set value = 1500 where name = 'token_requests_per_ip_per_hour';

-- Copied from 20261015092518_m8_minors.sql; adds the M9 actions.
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
    when 'meeting_edit_email' then 'meeting_email_edits_per_user_per_hour'
    when 'sheet_retry' then 'sheet_retries_per_user_per_hour'
    when 'google_connect' then 'google_connects_per_user_per_hour'
    when 'check_in_mark' then 'check_in_marks_per_user_per_hour'
    when 'check_in_rest' then 'check_in_rests_per_user_per_hour'
    when 'invite_link' then 'invite_links_per_user_per_hour'
    when 'answers_download' then 'answer_downloads_per_user_per_hour'
    when 'account_delete' then 'account_deletions_per_user_per_hour'
    when 'push_subscribe' then 'push_subscribes_per_user_per_hour'
    when 'push_unsubscribe' then 'push_unsubscribes_per_user_per_hour'
    when 'contact_write' then 'contact_writes_per_user_per_hour'
    when 'list_write' then 'list_writes_per_user_per_hour'
    when 'meeting_write' then 'meeting_writes_per_user_per_hour'
    when 'workspace_write' then 'workspace_writes_per_user_per_hour'
    when 'profile_write' then 'profile_writes_per_user_per_hour'
    when 'google_disconnect' then 'google_disconnects_per_user_per_hour'
    when 'invite_accept' then 'invite_accepts_per_user_per_hour'
    when 'invite_preview' then 'invite_previews_per_user_per_hour'
    when 'invite_create' then 'invite_creates_per_user_per_hour'
    when 'invite_renew' then 'invite_renewals_per_user_per_hour'
    when 'invite_revoke' then 'invite_revokes_per_user_per_hour'
    when 'audience_set' then 'audience_sets_per_user_per_hour'
    when 'meeting_cancel' then 'meeting_cancels_per_user_per_hour'
    when 'meeting_delete' then 'meeting_deletes_per_user_per_hour'
    when 'meeting_send' then 'meeting_sends_per_user_per_hour'
    when 'meeting_nudge' then 'meeting_nudges_per_user_per_hour'
    when 'member_change' then 'member_changes_per_user_per_hour'
    when 'workspace_delete' then 'workspace_deletions_per_user_per_hour'
    when 'sender_set' then 'sender_sets_per_user_per_hour'
    when 'ownership_transfer' then 'ownership_transfers_per_user_per_hour'
    when 'sheet_off' then 'sheet_offs_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- Spends one unit of the caller's budget for p_action or refuses (wrappers call it first).
create function private.require_user_limit(p_action text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.hit_user_rate_limit(p_action) then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function private.require_user_limit(text) from public, anon;
grant execute on function private.require_user_limit(text) to authenticated;

-- Pre-sign-in routes, per IP (was otp_send only; same key format).
create or replace function private.check_ip_rate_limit(p_action text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit_name text := case p_action
    when 'otp_send' then 'otp_send_per_ip_per_hour'
    when 'otp_verify' then 'otp_verify_per_ip_per_hour'
    when 'google_signin' then 'google_signin_per_ip_per_hour'
  end;
begin
  if v_limit_name is null or char_length(coalesce(p_ip, '')) not between 1 and 64 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':ip:' || p_ip, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- Direct writes by signed-in people (RLS writes through the Data API, and SECURITY INVOKER
-- functions): one unit per transaction per action, however many statements it runs. SECURITY
-- DEFINER functions run as their owner (current_user <> 'authenticated') and keep their own limits.
-- SECURITY INVOKER on purpose: in a definer function current_user would always be the owner.
create function private.limit_direct_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and pg_catalog.current_setting('tn.counted.' || tg_argv[0], true) is distinct from 'on' then
    if not private.hit_user_rate_limit(tg_argv[0]) then
      raise exception 'tn:rate_limited' using errcode = 'P0001';
    end if;
    perform pg_catalog.set_config('tn.counted.' || tg_argv[0], 'on', true);
  end if;
  return null;
end;
$$;
revoke execute on function private.limit_direct_writes() from public, anon, authenticated;

create trigger contacts_limit_writes before insert or update or delete on public.contacts
  for each statement execute function private.limit_direct_writes('contact_write');
create trigger list_contacts_limit_writes before insert or update or delete on public.list_contacts
  for each statement execute function private.limit_direct_writes('contact_write');
create trigger lists_limit_writes before insert or update or delete on public.lists
  for each statement execute function private.limit_direct_writes('list_write');
create trigger meetings_limit_writes before insert or update or delete on public.meetings
  for each statement execute function private.limit_direct_writes('meeting_write');
create trigger workspaces_limit_writes before insert or update or delete on public.workspaces
  for each statement execute function private.limit_direct_writes('workspace_write');
create trigger profiles_limit_writes before insert or update or delete on public.profiles
  for each statement execute function private.limit_direct_writes('profile_write');

-- Thin wrappers over SECURITY DEFINER bodies: the limit first, then the unchanged body.
-- create or replace keeps each wrapper's grants (authenticated only).
create or replace function public.accept_invite(p_token_hash text)
returns text language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_accept'); select private.accept_invite(p_token_hash) $$;

create or replace function public.invite_preview(p_token_hash text)
returns table (status text, workspace_name text, workspace_slug text, role public.workspace_role, masked_email text)
language sql volatile security invoker set search_path = ''
as $$ select private.require_user_limit('invite_preview'); select * from private.invite_preview(p_token_hash) $$;

create or replace function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role, p_token_hash text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_create'); select private.create_invite(p_workspace, p_email, p_role, p_token_hash) $$;

create or replace function public.renew_invite(p_invite uuid, p_token_hash text)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_renew'); select private.renew_invite(p_invite, p_token_hash) $$;

create or replace function public.revoke_invite(p_invite uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_revoke'); select private.revoke_invite(p_invite) $$;

create or replace function public.change_role(p_workspace uuid, p_user uuid, p_role public.workspace_role, p_can_check_in boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('member_change'); select private.change_role(p_workspace, p_user, p_role, p_can_check_in) $$;

create or replace function public.remove_member(p_workspace uuid, p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('member_change'); select private.remove_member(p_workspace, p_user) $$;

create or replace function public.leave_workspace(p_workspace uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('member_change'); select private.leave_workspace(p_workspace) $$;

create or replace function public.transfer_ownership(p_workspace uuid, p_new_owner uuid, p_confirm_name text)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('ownership_transfer'); select private.transfer_ownership(p_workspace, p_new_owner, p_confirm_name) $$;

create or replace function public.delete_workspace(p_workspace uuid, p_confirm_name text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('workspace_delete'); select private.delete_workspace(p_workspace, p_confirm_name) $$;

create or replace function public.set_meeting_audience(p_meeting uuid, p_list_ids uuid[], p_include uuid[], p_exclude uuid[])
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('audience_set'); select private.set_meeting_audience(p_meeting, p_list_ids, p_include, p_exclude) $$;

create or replace function public.send_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_send'); select private.send_meeting(p_meeting) $$;

create or replace function public.cancel_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_cancel'); select private.cancel_meeting(p_meeting) $$;

create or replace function public.delete_cancelled_meeting(p_meeting uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_delete'); select private.delete_cancelled_meeting(p_meeting) $$;

create or replace function public.nudge_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_nudge'); select private.nudge_meeting(p_meeting) $$;

create or replace function public.set_workspace_sender(p_workspace uuid, p_connection uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('sender_set'); select private.set_workspace_sender(p_workspace, p_connection) $$;

create or replace function public.turn_off_sheet(p_workspace uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('sheet_off'); select private.turn_off_sheet(p_workspace) $$;

create or replace function public.disconnect_google_connection(p_connection uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('google_disconnect'); select private.disconnect_google_connection(p_connection) $$;
```

Before writing each wrapper, confirm its current body is the thin `select private.<fn>(…)` form and that the private function exists with that signature:

```bash
psql postgresql://postgres:postgres@127.0.0.1:44322/postgres -Atc "select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(array['accept_invite','invite_preview','create_invite','renew_invite','revoke_invite','change_role','remove_member','leave_workspace','transfer_ownership','delete_workspace','set_meeting_audience','send_meeting','cancel_meeting','delete_cancelled_meeting','nudge_meeting','set_workspace_sender','turn_off_sheet','disconnect_google_connection'])" | grep -c "select private\."
```

Expected: `18`. If a wrapper has more than the one call (logic of its own), stop and write a ledger Ruling: copy that wrapper's newest body and add `perform private.require_user_limit(…)` at its start instead.

Apply: `supabase db reset --local </dev/null && bun run db:types && supabase db advisors --local </dev/null`. Expected: only `auth_leaked_password_protection`.

- [ ] **Step 3: The DB tests (behaviour and the registry against the database)**

`src/test/db/limits.ts` (each `runLocalSql` is its own session, so the old value is kept in TypeScript):

```ts
import { z } from "zod";
import { queryLocalSql, runLocalSql } from "./sql";

const value = z.array(z.object({ value: z.number() })).length(1);

/**
 * Runs `fn` with one `private.app_limits` value changed, then restores it (DB tests run one file
 * at a time, so no other test sees the change). Clears past rate-limit events first, so earlier
 * tests' spending doesn't count.
 */
export async function withLimit<T>(
  name: string,
  limit: number,
  fn: () => Promise<T>,
): Promise<T> {
  const [{ value: kept }] = queryLocalSql(
    `select value from private.app_limits where name = '${name}'`,
    value,
  );
  runLocalSql(
    `update private.app_limits set value = ${limit} where name = '${name}'; delete from private.rate_limit_events;`,
  );
  try {
    return await fn();
  } finally {
    runLocalSql(`update private.app_limits set value = ${kept} where name = '${name}'`);
  }
}
```

`src/server/db/m9-write-limits.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ROUTES, type LimitRule } from "@/server/http/route-registry";
import { adminClient, createTestUser } from "@/test/db/clients";
import { withLimit } from "@/test/db/limits";
import { queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const flag = z.array(z.object({ ok: z.boolean() })).length(1);
const rules = Object.values(ROUTES).flatMap((methods) =>
  Object.values(methods).flatMap((entry) => entry?.limits ?? []),
);
const userRules = rules.filter((rule): rule is Extract<LimitRule, { kind: "user" }> => rule.kind === "user");
const writeRules = rules.filter((rule): rule is Extract<LimitRule, { kind: "write" }> => rule.kind === "write");

describe("route registry against the database (spec §10)", () => {
  it.each(userRules.map((rule) => [rule.in, rule.action]))(
    "%s spends %s",
    (fn, action) => {
      const [schema, name] = fn.split(".");
      const [row] = queryLocalSql(
        `select bool_or(pg_get_functiondef(p.oid) like '%''${action}%') as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = '${schema}' and p.proname = '${name}'`,
        flag,
      );
      expect(row.ok).toBe(true);
    },
  );

  it.each(writeRules.map((rule) => [rule.table, rule.action]))(
    "%s has the write trigger for %s",
    (table, action) => {
      const [row] = queryLocalSql(
        `select exists (select 1 from pg_trigger t where t.tgrelid = '${table}'::regclass and not t.tgisinternal
           and t.tgfoid = 'private.limit_direct_writes'::regproc
           and encode(t.tgargs, 'escape') like '${action}%') as ok`,
        flag,
      );
      expect(row.ok).toBe(true);
    },
  );

  it("maps every user and write action to a limit that exists", () => {
    // workspace_create predates hit_user_rate_limit (its own key in create_workspace).
    const actions = [...new Set([...userRules, ...writeRules].map((rule) => rule.action))].filter(
      (action) => action !== "workspace_create",
    );
    for (const action of actions) {
      const [row] = queryLocalSql(
        `select pg_get_functiondef('private.hit_user_rate_limit(text)'::regprocedure) like '%when ''${action}'' then%' as ok`,
        flag,
      );
      expect(row.ok, action).toBe(true);
    }
  });
});

describe("direct-write limits (M9)", () => {
  it("refuses the write past the limit, with tn:rate_limited", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Write Limits");
    await withLimit("list_writes_per_user_per_hour", 2, async () => {
      for (const name of ["A", "B"]) {
        const { error } = await owner.client.from("lists").insert({ workspace_id: workspace.id, name });
        expect(error).toBeNull();
      }
      const { error } = await owner.client.from("lists").insert({ workspace_id: workspace.id, name: "C" });
      expect(error?.message).toBe("tn:rate_limited");
    });
  });

  it("counts one invoker call once, however many tables it writes", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "One Call");
    const { data: list } = await owner.client
      .from("lists")
      .insert({ workspace_id: workspace.id, name: "Team" })
      .select("id")
      .single();
    const { data: contact } = await owner.client
      .from("contacts")
      .insert({ workspace_id: workspace.id, email: "a@example.test", full_name: "A" })
      .select("id")
      .single();
    await withLimit("contact_writes_per_user_per_hour", 1, async () => {
      // update_contact updates the contact and replaces its lists: three statements, one unit.
      const first = await owner.client.rpc("update_contact", {
        p_workspace: workspace.id,
        p_contact: contact!.id,
        p_full_name: "A B",
        p_email: "a@example.test",
        p_list_ids: [list!.id],
      });
      expect(first.error).toBeNull();
      const second = await owner.client.rpc("update_contact", {
        p_workspace: workspace.id,
        p_contact: contact!.id,
        p_full_name: "A C",
        p_email: "a@example.test",
        p_list_ids: [],
      });
      expect(second.error?.message).toBe("tn:rate_limited");
    });
  });

  it("never counts SECURITY DEFINER writes (create_meeting inserts meetings)", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Definer");
    await withLimit("meeting_writes_per_user_per_hour", 0, async () => {
      const { error } = await owner.client.rpc("create_meeting", { p_workspace: workspace.id });
      expect(error).toBeNull();
    });
  });

  it("never counts the service role", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Service");
    await withLimit("workspace_writes_per_user_per_hour", 0, async () => {
      const { error } = await adminClient()
        .from("workspaces")
        .update({ name: "Service Renamed" })
        .eq("id", workspace.id);
      expect(error).toBeNull();
    });
  });
});

describe("shared Wi-Fi (Review Focus 1)", () => {
  it("lets 100 members behind one IP open and answer their own links", async () => {
    const admin = adminClient();
    for (let member = 0; member < 100; member += 1) {
      const tokenHash = `${member}`.padStart(64, "0");
      for (let request = 0; request < 3; request += 1) {
        const { data } = await admin.rpc("check_token_rate_limit", { p_ip: "203.0.113.50", p_token_hash: tokenHash });
        expect(data, `member ${member} request ${request}`).toBe(true);
      }
    }
  });
});

describe("wrapper and IP limits (M9)", () => {
  it("refuses a wrapper call past its limit", async () => {
    const user = await createTestUser();
    await withLimit("invite_previews_per_user_per_hour", 1, async () => {
      const first = await user.client.rpc("invite_preview", { p_token_hash: "0".repeat(64) });
      expect(first.error).toBeNull();
      const second = await user.client.rpc("invite_preview", { p_token_hash: "0".repeat(64) });
      expect(second.error?.message).toBe("tn:rate_limited");
    });
  });

  it("limits Google sign-in starts per IP and rejects unknown actions", async () => {
    await withLimit("google_signin_per_ip_per_hour", 1, async () => {
      const admin = adminClient();
      const first = await admin.rpc("check_ip_rate_limit", { p_action: "google_signin", p_ip: "198.51.100.7" });
      expect(first.data).toBe(true);
      const second = await admin.rpc("check_ip_rate_limit", { p_action: "google_signin", p_ip: "198.51.100.7" });
      expect(second.data).toBe(false);
      const other = await admin.rpc("check_ip_rate_limit", { p_action: "google_signin", p_ip: "198.51.100.8" });
      expect(other.data).toBe(true);
      const unknown = await admin.rpc("check_ip_rate_limit", { p_action: "made_up", p_ip: "198.51.100.7" });
      expect(unknown.error?.message).toBe("tn:invalid_input");
    });
  });
});
```

Check the helper names before running (`createWorkspaceAs` lives in `src/test/db/workspaces.ts`; `create_meeting`'s argument names in `src/server/db/database.types.ts`); adapt the calls to the real signatures, never the assertions. Add `"require_user_limit"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted) in `src/server/db/function-security.db.test.ts`.

Run: `bun run test:db -- src/server/db/m9-write-limits src/server/db/function-security > /tmp/db.log 2>&1; grep -E "Tests|FAIL" /tmp/db.log`
Expected: PASS. Then the whole `bun run test:db`: if an existing test now hits a new limit because one user does more than an hour's worth of writes, give that test a fresh user per scenario (never raise a production value for a test).

- [ ] **Step 4: The IP limiter in TypeScript and the routes**

`src/server/rate-limit/ip-rate-limit.ts`:

```ts
import "server-only";
import type { IpLimitAction } from "@/server/http/route-registry";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/**
 * Per-IP limit for a pre-sign-in route (limits in `private.app_limits`). Uses the secret key
 * because the caller is not signed in yet; `check_ip_rate_limit` is executable by `service_role`
 * only. Allowed admin-client caller per spec §11.
 * @throws Error when the database call fails
 */
export async function allowIpRequest(action: IpLimitAction, ip: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().rpc("check_ip_rate_limit", {
    p_action: action,
    p_ip: ip,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data === true;
}
```

`ip-rate-limit.test.ts`: rename to `allowIpRequest`, call it with `"otp_send"` in the first test and assert `{ p_action: "otp_send", p_ip: "203.0.113.5" }`; add a case for `"google_signin"`.

`src/app/api/auth/otp/send/route.ts`: `allowOtpRequest(clientIp(request))` → `allowIpRequest("otp_send", clientIp(request))`.

`src/app/api/auth/otp/verify/route.ts`, after the body parses:

```ts
  try {
    if (!(await allowIpRequest("otp_verify", clientIp(request)))) {
      return apiError("rate_limited");
    }
  } catch (error) {
    logger.error({ err: error }, "otp verify ip rate limit failed");
    return apiError("internal");
  }
```

(imports: `clientIp` from `@/server/http/request`, `allowIpRequest`, `logger`). Its route test gains: "429 when the IP is over its limit" (mock `allowIpRequest` → false, expect status 429 and `verifyOtp` not called).

`src/app/api/auth/google/start/route.ts`, after the `google_unavailable` check:

```ts
  try {
    if (!(await allowIpRequest("google_signin", clientIp(request)))) {
      return NextResponse.redirect(new URL("/login?error=rate_limited", request.url));
    }
  } catch (error) {
    logger.error({ err: error }, "google sign-in ip rate limit failed");
    return NextResponse.redirect(new URL("/login?error=google_failed", request.url));
  }
```

Its test gains the same over-limit case (redirect to `/login?error=rate_limited`, no state cookie set).

`src/app/login/login-screen.tsx`: the alert block also shows for `errorParam === "rate_limited"` with `tErrors("rate_limited")` ("Too many attempts. Wait a bit and try again."). Its test: render with `?error=rate_limited`, expect that text in the `alert`.

Run: `bun run test -- --run src/server/http/route-registry src/server/rate-limit src/app/api/auth src/app/login`
Expected: PASS (the registry's third test is now green).

- [ ] **Step 5: Chain, commit, PR, merge, hosted push**

Full chain with the DB part. Commit: `feat(db): a limit on every write and pre-sign-in route, and the route registry that proves it`. After merging: `bash .superpowers/scripts/hosted-push.sh` and record the advisor output in the ledger.
### Task 4: The route registry (lists) and the 50-seat cap

**Issue labels:** `type:task`, `area:db`, `area:api`. **Branch:** `feat/<issue>-seat-cap`. **Migration:** `supabase migration new m9_seat_cap`.

**Files:**
- Create: `supabase/migrations/<ts>_m9_seat_cap.sql`, `src/server/db/m9-seat-cap.db.test.ts`
- Modify: `src/server/http/route-registry.ts` (every GET gets `list`), `src/server/http/route-registry.test.ts`
- Modify: `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors.workspace_seats_limit_reached`)
- Create: `src/test/db/invites.ts`

**Interfaces:**
- Consumes: `ROUTES`, `ListRule` (Task 3), `withLimit` (Task 3).
- Produces: `ListRule` on every GET entry; error code `workspace_seats_limit_reached` (409); `private.enforce_seat_cap()` trigger on `public.workspace_roles`; limit `workspace_seats_per_user_max` (50). Task 18's admin routes add their own `list` entries.

**Ruling (copy into the ledger):** the refusal text does not name the number ("You're in the most workspaces allowed. Leave one to join this one."): the value lives in `app_limits`, and a hardcoded "50" in the copy would drift from it.

- [ ] **Step 1: Every GET names how it is bounded (red test first)**

Add to `src/server/http/route-registry.test.ts`:

```ts
  it("says how every GET bounds what it returns, and only GETs", () => {
    for (const [key, methods] of Object.entries(ROUTES)) {
      for (const [method, entry] of Object.entries(methods)) {
        if (method === "GET") {
          expect(entry?.list, `GET ${key}`).toBeDefined();
        } else {
          expect(entry?.list, `${method} ${key}`).toBeUndefined();
        }
      }
    }
  });

  it("pages every paged GET with readPageParams", () => {
    for (const { key, source } of files) {
      if (ROUTES[key]?.GET?.list?.kind === "paged") {
        expect(source, key).toContain("readPageParams(");
      }
    }
  });
```

Run: `bun run test -- --run src/server/http/route-registry` → FAIL (no GET has `list`).

In `src/server/http/route-registry.ts`, add next to the other helpers:

```ts
const PAGED: ListRule = { kind: "paged", size: "PAGE_SIZE_DEFAULT / PAGE_SIZE_MAX (src/config/pagination.ts)" };
const SINGLE: ListRule = { kind: "single" };
const bounded = (by: string): ListRule => ({ kind: "bounded", by });
```

and give every GET entry its `list` (exactly these):

| Route | `list` |
|---|---|
| `[...path]`, `auth/google/callback`, `auth/google/start`, `health`, `integrations/google/callback`, `integrations/google/connect`, `me/invites/[id]/link`, `r/[token]`, `r/[token]/ics`, `r/[token]/unsubscribe`, `workspaces/[slug]`, `workspaces/[slug]/meeting-defaults`, `workspaces/[slug]/meetings/[id]`, `workspaces/[slug]/meetings/[id]/preview`, `workspaces/[slug]/sender`, `workspaces/[slug]/sheet` | `SINGLE` |
| `me/answers`, `me/invites`, `workspaces/[slug]/attendance/details`, `workspaces/[slug]/contacts/[id]/history`, `workspaces/[slug]/invites`, `workspaces/[slug]/meetings`, `workspaces/[slug]/meetings/[id]/people`, `workspaces/[slug]/members` | `PAGED` |
| `me` | `bounded("workspace_seats_per_user_max")` |
| `me/account` | `bounded("workspaces_owned_max")` |
| `workspaces/[slug]/contacts`, `workspaces/[slug]/attendance` | `bounded("contacts_per_workspace_max")` |
| `workspaces/[slug]/meetings/[id]/audience` | `bounded("invitees_per_meeting_max")` |
| `workspaces/[slug]/meetings/[id]/results` | `bounded("aggregate counts")` |

For example: `GET: { limits: [SIGNED_IN_READ], list: bounded("contacts_per_workspace_max") },`.

Run again → PASS.

- [ ] **Step 2: The DB side of the bounded routes and the seat cap (red)**

`src/server/db/m9-seat-cap.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser, type TestUser } from "@/test/db/clients";
import { withLimit } from "@/test/db/limits";
import { queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";
import { createInviteAs } from "@/test/db/invites";

const flag = z.array(z.object({ ok: z.boolean() })).length(1);

describe("bounded reads return one result (spec §10)", () => {
  it.each(["roster", "attendance_summary", "meeting_audience", "meeting_results", "my_account"])(
    "public.%s returns a single value, so max_rows can never cut it",
    (name) => {
      const [row] = queryLocalSql(
        `select bool_and(not p.proretset) as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = '${name}'`,
        flag,
      );
      expect(row.ok).toBe(true);
    },
  );

  it("caps seats below the Data API's max_rows (1,000), so /api/me lists them all", () => {
    const [row] = queryLocalSql(
      `select private.app_limit('workspace_seats_per_user_max') < 1000 as ok`,
      flag,
    );
    expect(row.ok).toBe(true);
  });
});

async function acceptInto(owner: TestUser, member: TestUser) {
  const workspace = await createWorkspaceAs(owner, "Seat Club");
  const tokenHash = await createInviteAs(owner, workspace.id, member.email, "viewer");
  return member.client.rpc("accept_invite", { p_token_hash: tokenHash });
}

describe("workspace seats per person (M9)", () => {
  it("refuses an invite past the cap and a new workspace past it", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    await withLimit("workspace_seats_per_user_max", 2, async () => {
      await createWorkspaceAs(member, "Own One");
      expect((await acceptInto(owner, member)).error).toBeNull();
      expect((await acceptInto(owner, member)).error?.message).toBe("tn:workspace_seats_limit_reached");
      await expect(createWorkspaceAs(member, "Own Two")).rejects.toMatchObject({
        message: "tn:workspace_seats_limit_reached",
      });
    });
  });

  it("lets exactly one of two simultaneous accepts take the last seat", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    await withLimit("workspace_seats_per_user_max", 1, async () => {
      const workspaceA = await createWorkspaceAs(owner, "A");
      const workspaceB = await createWorkspaceAs(owner, "B");
      const [hashA, hashB] = await Promise.all([
        createInviteAs(owner, workspaceA.id, member.email, "viewer"),
        createInviteAs(owner, workspaceB.id, member.email, "viewer"),
      ]);
      const results = await Promise.all([
        member.client.rpc("accept_invite", { p_token_hash: hashA }),
        member.client.rpc("accept_invite", { p_token_hash: hashB }),
      ]);
      expect(results.filter((result) => result.error === null)).toHaveLength(1);
      expect(results.map((result) => result.error?.message ?? "ok").sort()).toEqual([
        "ok",
        "tn:workspace_seats_limit_reached",
      ]);
    });
  });
});
```

`src/test/db/invites.ts` (new; the same steps as the `invite()` helper in `src/server/db/invites.db.test.ts`, which keeps its own because it also returns the id):

```ts
import { createHash, randomBytes } from "node:crypto";
import type { TestUser } from "./clients";

/** Creates a workspace invite as `by` and returns its token hash (the raw token is never needed). */
export async function createInviteAs(
  by: TestUser,
  workspaceId: string,
  email: string,
  role: "admin" | "viewer",
): Promise<string> {
  const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  const { error } = await by.client.rpc("create_invite", {
    p_workspace: workspaceId,
    p_email: email,
    p_role: role,
    p_token_hash: tokenHash,
  });
  if (error) {
    throw error;
  }
  return tokenHash;
}
```

Run: `bun run test:db -- src/server/db/m9-seat-cap` → FAIL (`unknown limit workspace_seats_per_user_max`).

- [ ] **Step 3: The migration**

`supabase/migrations/<ts>_m9_seat_cap.sql`:

```sql
-- M9 (spec §4 Tenancy): a person holds at most 50 seats (any role), so /api/me always lists them
-- all (the Data API returns at most 1,000 rows) and the workspace switcher stays usable.
insert into private.app_limits (name, value) values ('workspace_seats_per_user_max', 50);

-- Every path that adds a seat (create_workspace, accept_invite, the service role) goes through this
-- trigger. The advisory lock per person makes two simultaneous accepts take turns, and the count
-- after the lock sees the other one's committed seat (read committed: a new snapshot per statement).
create function private.enforce_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('seats:' || new.user_id::text));
  select count(*) into v_seats from public.workspace_roles r where r.user_id = new.user_id;
  if v_seats >= private.app_limit('workspace_seats_per_user_max') then
    raise exception 'tn:workspace_seats_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function private.enforce_seat_cap() from public, anon, authenticated;

create trigger workspace_roles_seat_cap
  before insert on public.workspace_roles
  for each row execute function private.enforce_seat_cap();
```

`src/shared/api/errors.ts`: add `"workspace_seats_limit_reached"` to `API_ERROR_CODES` (after `"reminders_unavailable"`) and `workspace_seats_limit_reached: 409` to `API_ERROR_STATUS`. `messages/en.json` → `ApiErrors`: `"workspace_seats_limit_reached": "You're in the most workspaces allowed. Leave one to join this one."`. The create-workspace form and the invite page already show `tErrors(code)`, so no component changes.

Apply: `supabase db reset --local </dev/null && bun run db:types && supabase db advisors --local </dev/null`, then `bun run test:db > /tmp/db.log 2>&1; grep -E "Tests|FAIL" /tmp/db.log`. Expected: all pass, advisors unchanged.

- [ ] **Step 4: Chain, commit, PR, merge, hosted push**

Commit: `feat(db): a person holds at most 50 workspace seats; every GET says how it is bounded`. After merging: `bash .superpowers/scripts/hosted-push.sh`.
### Task 5: Security headers, the nonce CSP (report-only), the Sentry tunnel, `X-Robots-Tag`

**Issue labels:** `type:task`, `area:infra`, `area:frontend`. **Branch:** `feat/<issue>-csp`.

**Files:**
- Modify: `src/config/security-headers.ts`, `src/config/security-headers.test.ts`
- Create: `src/lib/observability/sentry-security-endpoint.ts`, `src/lib/observability/sentry-security-endpoint.test.ts`
- Modify: `src/proxy.ts`, `src/server/supabase/proxy-session.ts`; Create: `src/proxy.test.ts`
- Modify: `next.config.ts` (static headers, `tunnelRoute`), `src/app/layout.tsx` (nonce to the theme script), `src/components/theme/theme-provider.tsx`
- Modify: `e2e/helpers/test.ts` (CSP reports become console errors); Create: `e2e/headers.spec.ts`

**Interfaces:**
- Consumes: `test` (Task 1).
- Produces:
  - `contentSecurityPolicy(input: { nonce: string; development: boolean; reportUri?: string }): string`
  - `CSP_HEADER: "Content-Security-Policy-Report-Only"` (Task 21 changes it to `"Content-Security-Policy"`, the one-line switch the runbook names)
  - `sentrySecurityEndpoint(dsn: string | undefined, environment: string): string | undefined`
  - `staticSecurityHeaders`, `noIndexHeaders`, `serviceWorkerCsp` (header rules for `next.config.ts`)
  - `ThemeProvider({ nonce, children })`
- The browser Sentry SDK posts to `/monitoring` from here on, so `connect-src 'self'` holds (spec §5).

**Rulings (copy into the ledger):**
- HSTS is not set by the app: Vercel already sends `strict-transport-security: max-age=63072000; includeSubDomains; preload` on every response (checked on production 2026-10-15). The headers e2e asserts it on the production check (Task 21), not locally.
- The Sentry tunnel ships here, not with Task 6: without it the report-only CSP would report every browser error event as a violation.
- `/monitoring` is excluded from the proxy matcher (no session refresh for Sentry events).

- [ ] **Step 1: Failing tests for the policy, the endpoint and the proxy**

`src/config/security-headers.test.ts`, add:

```ts
import {
  CSP_HEADER,
  contentSecurityPolicy,
  noIndexHeaders,
  serviceWorkerCsp,
  staticSecurityHeaders,
} from "./security-headers";

describe("contentSecurityPolicy (spec §11 M9)", () => {
  const directives = (policy: string) =>
    Object.fromEntries(
      policy.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values];
      }),
    );

  it("allows only our own origin, scripts by nonce, and no plugins, frames or base", () => {
    const policy = directives(contentSecurityPolicy({ nonce: "abc", development: false }));
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(policy["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(policy["connect-src"]).toEqual(["'self'"]);
    for (const name of ["font-src", "worker-src", "manifest-src", "form-action"]) {
      expect(policy[name]).toEqual(["'self'"]);
    }
    for (const name of ["object-src", "base-uri", "frame-ancestors"]) {
      expect(policy[name]).toEqual(["'none'"]);
    }
    expect(policy["report-uri"]).toBeUndefined();
  });

  it("adds unsafe-eval in development only (React's dev error stacks) and the report endpoint", () => {
    const policy = directives(
      contentSecurityPolicy({ nonce: "n", development: true, reportUri: "https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=k" }),
    );
    expect(policy["script-src"]).toContain("'unsafe-eval'");
    expect(policy["report-uri"]).toEqual(["https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=k"]);
    expect(policy["report-to"]).toEqual(["csp"]);
  });

  it("is report-only until the launch task enforces it", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("staticSecurityHeaders", () => {
  it("applies nosniff, a strict referrer and no camera, microphone or location to everything", () => {
    expect(staticSecurityHeaders).toEqual([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]);
  });
});

describe("noIndexHeaders", () => {
  it("keeps every private and token address out of search engines", () => {
    expect(noIndexHeaders.map((rule) => rule.source)).toEqual([
      "/w/:path*",
      "/r/:path*",
      "/u/:path*",
      "/report/:path*",
      "/invite/:path*",
      "/admin/:path*",
      "/admin",
      "/api/:path*",
    ]);
    for (const rule of noIndexHeaders) {
      expect(rule.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
    }
  });
});

describe("serviceWorkerCsp", () => {
  it("lets the worker reach only our own origin", () => {
    expect(serviceWorkerCsp.source).toBe("/serwist/:path*");
    expect(serviceWorkerCsp.headers).toEqual([
      { key: CSP_HEADER, value: "default-src 'self'; script-src 'self'; connect-src 'self'" },
    ]);
  });
});
```

`src/lib/observability/sentry-security-endpoint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sentrySecurityEndpoint } from "./sentry-security-endpoint";

describe("sentrySecurityEndpoint", () => {
  it("turns a DSN into Sentry's CSP report address", () => {
    expect(
      sentrySecurityEndpoint("https://abc123@o4507.ingest.de.sentry.io/4508", "production"),
    ).toBe("https://o4507.ingest.de.sentry.io/api/4508/security/?sentry_key=abc123&sentry_environment=production");
  });

  it("has none without a DSN (local, CI) or with a malformed one", () => {
    expect(sentrySecurityEndpoint(undefined, "development")).toBeUndefined();
    expect(sentrySecurityEndpoint("not a url", "development")).toBeUndefined();
  });
});
```

`src/proxy.test.ts`:

```ts
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const forwarded = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("@/server/supabase/proxy-session", async () => {
  const { NextResponse } = await import("next/server");
  return {
    updateSession: async (_request: NextRequest, extra: Headers) => {
      forwarded.headers = extra;
      return NextResponse.next();
    },
  };
});

describe("proxy (CSP nonce)", () => {
  it("makes a fresh nonce per request, forwards it and sets the policy", async () => {
    const { proxy } = await import("./proxy");
    const first = await proxy(new NextRequest("http://localhost:3000/"));
    const nonceA = forwarded.headers?.get("x-nonce");
    const second = await proxy(new NextRequest("http://localhost:3000/"));
    const nonceB = forwarded.headers?.get("x-nonce");
    expect(nonceA).toMatch(/^[A-Za-z0-9+/=]{24,}$/);
    expect(nonceB).not.toBe(nonceA);
    const policy = first.headers.get("Content-Security-Policy-Report-Only");
    expect(policy).toContain(`'nonce-${nonceA}'`);
    expect(forwarded.headers?.get("Content-Security-Policy-Report-Only")).toBe(
      second.headers.get("Content-Security-Policy-Report-Only"),
    );
  });
});
```

Run: `bun run test -- --run src/config/security-headers src/lib/observability/sentry-security-endpoint src/proxy.test`
Expected: FAIL (exports missing).

- [ ] **Step 2: The policy, the endpoint, the header rules**

`src/config/security-headers.ts`, add (keep `tokenPageHeaders` and `serviceWorkerHeaders`; update the old "The full header audit is M9." JSDoc line to "Spec §11 M9.") :

```ts
/**
 * The CSP header the app sends. Report-only first (spec §11 M9); the launch task enforces it once
 * preview and production have run 3 days with zero reports. Going back is this one line.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only" as const;

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
      ["'self'", `'nonce-${input.nonce}'`, "'strict-dynamic'", ...(input.development ? ["'unsafe-eval'"] : [])],
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
    directives.push(["report-uri", [input.reportUri]], ["report-to", ["csp"]]);
  }
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** Headers for every response (spec §11 M9). HSTS comes from Vercel itself. */
export const staticSecurityHeaders: HeaderRule[] = [
  {
    source: "/:path*",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
].map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }));

/** The service worker is outside the proxy matcher: its own policy, same origin only. */
export const serviceWorkerCsp: HeaderRule = {
  source: "/serwist/:path*",
  headers: [{ key: CSP_HEADER, value: "default-src 'self'; script-src 'self'; connect-src 'self'" }],
};
```

`src/lib/observability/sentry-security-endpoint.ts`:

```ts
/**
 * Sentry's CSP report address for a DSN (`https://<key>@<host>/<project>` →
 * `https://<host>/api/<project>/security/?sentry_key=<key>&sentry_environment=<env>`).
 * Undefined without a usable DSN (local development, CI, e2e), so no report directive is sent.
 */
export function sentrySecurityEndpoint(
  dsn: string | undefined,
  environment: string,
): string | undefined {
  if (!dsn || !URL.canParse(dsn)) {
    return undefined;
  }
  const url = new URL(dsn);
  const project = url.pathname.replace(/^\//, "");
  if (!url.username || !project) {
    return undefined;
  }
  const query = new URLSearchParams({ sentry_key: url.username, sentry_environment: environment });
  return `${url.protocol}//${url.host}/api/${project}/security/?${query.toString()}`;
}
```

- [ ] **Step 3: The proxy sets the nonce; the session refresh keeps it**

`src/server/supabase/proxy-session.ts`: `updateSession(request: NextRequest, extra: Headers)`. Every `NextResponse.next({ request })` in it becomes `forward(request, extra)`:

```ts
/**
 * Continues to the page with the request's own headers (cookies as refreshed by Supabase, which
 * `request.cookies.set` keeps in the cookie header) plus the proxy's extra ones (the CSP nonce).
 */
function forward(request: NextRequest, extra: Headers): NextResponse {
  const headers = new Headers(request.headers);
  extra.forEach((value, key) => headers.set(key, value));
  return NextResponse.next({ request: { headers } });
}
```

`src/proxy.ts`:

```ts
import type { NextRequest, NextResponse } from "next/server";
import { CSP_HEADER, contentSecurityPolicy } from "@/config/security-headers";
import { publicEnv } from "@/config/public-env";
import { sentrySecurityEndpoint } from "@/lib/observability/sentry-security-endpoint";
import { updateSession } from "@/server/supabase/proxy-session";

/**
 * Next 16 proxy (formerly middleware): a fresh CSP nonce per request (Next reads it from the
 * forwarded CSP header and puts it on its own scripts; `x-nonce` is for our layout), and fresh
 * Supabase sessions.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    reportUri: sentrySecurityEndpoint(
      publicEnv.NEXT_PUBLIC_SENTRY_DSN,
      publicEnv.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    ),
  });
  const extra = new Headers({ "x-nonce": nonce, [CSP_HEADER]: policy });
  const response = await updateSession(request, extra);
  response.headers.set(CSP_HEADER, policy);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|serwist|icons|monitoring|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
```

Next reads the nonce from the forwarded request header `content-security-policy` **or** `content-security-policy-report-only` (`node_modules/next/dist/server/app-render/app-render.js:209`, checked 2026-10-15), so forwarding `CSP_HEADER` is enough in both modes.

- [ ] **Step 4: Static headers, the tunnel, and the nonce on the theme script**

`next.config.ts`:

```ts
import {
  noIndexHeaders,
  serviceWorkerCsp,
  serviceWorkerHeaders,
  staticSecurityHeaders,
  tokenPageHeaders,
} from "./src/config/security-headers";

const nextConfig: NextConfig = {
  // Later rules win for the same header: the token pages' no-referrer overrides the default.
  headers: async () => [
    ...staticSecurityHeaders,
    ...noIndexHeaders,
    ...tokenPageHeaders,
    ...serviceWorkerHeaders,
    serviceWorkerCsp,
  ],
};
```

and in the `withSentryConfig` options add `tunnelRoute: "/monitoring",` (a fixed path: the proxy matcher excludes it).

`src/components/theme/theme-provider.tsx`: accept `{ nonce, children }: { nonce?: string; children: ReactNode }` and pass `nonce={nonce}` to `NextThemesProvider` (its no-flash script is inline and needs the nonce). JSDoc: "The nonce is this request's CSP nonce (root layout)."

`src/app/layout.tsx`:

```tsx
import { headers } from "next/headers";
…
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // This request's CSP nonce (proxy.ts). Reading headers renders every page per request, which the
  // nonce needs anyway (spec §11 M9).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  …
          <ThemeProvider nonce={nonce}>
```

Run: `bun run test -- --run src/config src/lib/observability src/proxy.test src/server/supabase src/components/theme` → PASS. Then `bun run build 2>&1 | tee /tmp/build.log >/dev/null; grep -E "^[○●ƒ]" /tmp/build.log | head -40; bun scripts/check-build-log.ts /tmp/build.log`. Expected: pages are now `ƒ` (dynamic), no build warnings.

- [ ] **Step 5: CSP reports fail e2e, and the headers e2e**

`e2e/helpers/test.ts`: the guard also turns CSP reports into console errors. Replace the fixture body's `watchContext` and its two call sites with:

```ts
      const watchContext = async (watched: BrowserContext) => {
        // Report-only violations still fire this event; the console guard then fails the test.
        await watched.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (event) => {
            console.error(
              `CSP ${event.disposition}: ${event.effectiveDirective} blocked ${event.blockedURI || "inline"}`,
            );
          });
        });
        watched.pages().forEach(watchPage);
        watched.on("page", watchPage);
      };
      await watchContext(context);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const created = await newContext(options);
        await watchContext(created);
        return created;
      };
```

(the `try { await use(); } finally { … }` and the final `expect` stay as in Task 1). Playwright runs a context's init scripts in every page of the context on its next navigation, including pages opened before the script was added, so every test that navigates is covered.

`e2e/headers.spec.ts`:

```ts
import { expect, test } from "./helpers/test";

const CSP = "content-security-policy-report-only";

test("pages carry a fresh nonce CSP and the static headers", async ({ request, page }) => {
  const first = await request.get("/login");
  const second = await request.get("/login");
  const nonceOf = (policy: string | undefined) => /'nonce-([^']+)'/.exec(policy ?? "")?.[1];
  expect(nonceOf(first.headers()[CSP])).toBeTruthy();
  expect(nonceOf(first.headers()[CSP])).not.toBe(nonceOf(second.headers()[CSP]));
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  expect(first.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(first.headers()["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  expect(first.headers()["x-robots-tag"]).toBeUndefined();

  await page.goto("/login");
  const nonces = await page.locator("script[src]").evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).nonce),
  );
  expect(nonces.length).toBeGreaterThan(0);
  expect(nonces.every((nonce) => nonce.length > 0)).toBe(true);
});

test("token pages send no referrer and are never indexed", async ({ request }) => {
  const response = await request.get("/u/not-a-real-token");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const api = await request.get("/api/health");
  expect(api.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the service worker has its own same-origin policy", async ({ request }) => {
  const response = await request.get("/serwist/sw.js");
  expect(response.headers()[CSP]).toBe("default-src 'self'; script-src 'self'; connect-src 'self'");
});
```

Run the whole e2e (`run_in_background`): every existing story now also fails on any CSP report. Fix each at its root (a missing nonce, an inline handler, an image from another origin): never widen the policy without a ledger Ruling naming the origin and why.

- [ ] **Step 6: Keep extension noise out of the Sentry quota (Review Focus 2)**

Browser extensions inject scripts into pages and every injection becomes a CSP report; on the free plan (5k events a month) they could crowd out real errors. Add to `docs/runbooks/monitoring.md` and ask the Owner to set, in Sentry → Project → Settings → Security & Privacy (Security Headers): "Additional ignored sources" `chrome-extension://*`, `moz-extension://*`, `safari-web-extension://*`, `safari-extension://*` and the inbound filter "Filter out errors known to be caused by browser extensions" on. Verify with the Sentry tools that both are set, then send one test report from a page with an extension's URI (`curl -X POST` of a CSP report body with `"blocked-uri":"chrome-extension://abc"` to the endpoint `sentrySecurityEndpoint` builds) and check it is dropped. Record it in the ledger.

- [ ] **Step 7: Chain, commit, PR, merge**

Commit: `feat(security): nonce CSP (report-only), static security headers, noindex for private pages, Sentry tunnel`. The PR body names the follow-up: Task 21 enforces after 3 clean days.
### Task 6: Sentry Logs from the scrubbing stream, `beforeSendLog`, the alert rules and the uptime monitor

**Issue labels:** `type:task`, `area:observability`. **Branch:** `feat/<issue>-sentry-logs`.

**Files:**
- Create: `src/lib/json.ts`; Modify: `src/lib/sheets/types.ts` (re-export `Json` from it)
- Modify: `src/lib/logger.ts`, `src/lib/logger.test.ts`
- Create: `src/lib/observability/sentry-log-sink.ts`, `src/lib/observability/sentry-log-sink.test.ts`
- Modify: `src/lib/observability/sentry-options.ts`, `src/lib/observability/sentry-options.test.ts` (`beforeSendLog`)
- Create: `docs/runbooks/monitoring.md`

**Interfaces:**
- Produces: `Json` (`src/lib/json.ts`); `createLogger({ level, destination?, forward? })` where `forward: (record: LogRecord) => void` gets each line **after** scrubbing; `LogRecord = { level: number; msg?: string; [key: string]: Json | undefined }`; `toSentryLog(record: LogRecord): SentryLog | null`; `SENTRY_LOG_MIN_LEVEL = 30` (pino `info`); `SentryOptions.beforeSendLog`.
- `docs/runbooks/monitoring.md` is extended by Task 7 (Discord webhooks, workflows), Task 8 (backups) and Task 21 (WAF rule, CSP switch).

**Ruling (copy into the ledger):** Sentry 11.4.0 has no `enableLogs` switch: `Sentry.logger.*` always sends when a client exists, and `pinoIntegration` is not a default integration (checked in `node_modules/@sentry/node/build/cjs/sdk/index.js`). So only our sink sends logs, and only scrubbed ones.

- [ ] **Step 1: Failing tests**

`src/lib/observability/sentry-log-sink.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));
vi.mock("@sentry/nextjs", () => ({ logger }));

import { SENTRY_LOG_MIN_LEVEL, sentryLogSink, toSentryLog } from "./sentry-log-sink";

describe("toSentryLog", () => {
  it("maps pino levels and keeps flat attributes (objects as JSON)", () => {
    expect(
      toSentryLog({ level: 50, time: 1, app: "TapNShow", msg: "dispatch run finished", summary: { sent: 2 }, jobId: "j1" }),
    ).toEqual({
      level: "error",
      message: "dispatch run finished",
      attributes: { app: "TapNShow", summary: '{"sent":2}', jobId: "j1" },
    });
  });

  it("sends info and above only (spec §5: info+)", () => {
    expect(SENTRY_LOG_MIN_LEVEL).toBe(30);
    expect(toSentryLog({ level: 30, msg: "kept" })?.level).toBe("info");
    expect(toSentryLog({ level: 20, msg: "debug line" })).toBeNull();
  });
});

describe("sentryLogSink", () => {
  it("never throws into the logger", () => {
    logger.warn.mockImplementationOnce(() => {
      throw new Error("sdk down");
    });
    expect(() => sentryLogSink({ level: 40, msg: "careful" })).not.toThrow();
  });
});
```

`src/lib/logger.test.ts`, add:

```ts
  it("forwards each line to the sink only after scrubbing it", () => {
    const lines: string[] = [];
    const forwarded: LogRecord[] = [];
    const log = createLogger({
      level: "info",
      destination: { write: (line: string) => lines.push(line) },
      forward: (record) => forwarded.push(record),
    });
    log.info({ link: "https://tapnshow.vercel.app/r/abcDEF123secret" }, "opened /u/zzzSecret");
    expect(JSON.stringify(forwarded)).not.toMatch(/abcDEF123secret|zzzSecret/);
    expect(forwarded[0]?.msg).toBe("opened /u/[REDACTED]");
    expect(lines).toHaveLength(1);
  });

  it("keeps writing when the sink throws", () => {
    const lines: string[] = [];
    const log = createLogger({
      level: "info",
      destination: { write: (line: string) => lines.push(line) },
      forward: () => {
        throw new Error("sink down");
      },
    });
    log.info("still written");
    expect(lines).toHaveLength(1);
  });
```

(import `type LogRecord` next to `createLogger`). `src/lib/observability/sentry-options.test.ts`, add:

```ts
  it("scrubs logs before they leave and drops one it cannot scrub", () => {
    const options = buildSentryOptions({ dsn: "https://k@o1.ingest.de.sentry.io/2", environment: "test" });
    const log = options.beforeSendLog({
      level: "info",
      message: "opened /r/secretToken123",
      attributes: { url: "/invite/abcSecret" },
    });
    expect(JSON.stringify(log)).not.toMatch(/secretToken123|abcSecret/);
  });
```

Run: `bun run test -- --run src/lib/observability src/lib/logger` → FAIL.

- [ ] **Step 2: Implement**

`src/lib/json.ts`:

```ts
/** Any JSON value (log records, Sheets requests). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
```

`src/lib/sheets/types.ts`: replace its own `Json` declaration with `export type { Json } from "@/lib/json";` (and import it where the file uses it).

`src/lib/observability/sentry-log-sink.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import type { Json } from "@/lib/json";

/** One finished, scrubbed log line (pino's JSON). */
export type LogRecord = { level: number; msg?: string; [key: string]: Json | undefined };

type SentryLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** A log as Sentry Logs takes it. */
export type SentryLog = { level: SentryLevel; message: string; attributes: Record<string, string | number | boolean> };

/** Lowest pino level sent to Sentry Logs (30 = info; spec §5: info and above). */
export const SENTRY_LOG_MIN_LEVEL = 30;

const LEVELS: ReadonlyArray<[number, SentryLevel]> = [
  [60, "fatal"],
  [50, "error"],
  [40, "warn"],
  [30, "info"],
  [20, "debug"],
  [10, "trace"],
];

/** pino's bookkeeping fields, not attributes. */
const SKIPPED = new Set(["level", "time", "msg", "pid", "hostname"]);

/** A scrubbed pino line as a Sentry log, or null below the minimum level. */
export function toSentryLog(record: LogRecord): SentryLog | null {
  if (record.level < SENTRY_LOG_MIN_LEVEL) {
    return null;
  }
  const level = LEVELS.find(([value]) => record.level >= value)?.[1] ?? "info";
  const attributes: SentryLog["attributes"] = {};
  for (const [key, value] of Object.entries(record)) {
    if (SKIPPED.has(key) || value === undefined || value === null) {
      continue;
    }
    attributes[key] = typeof value === "object" ? JSON.stringify(value) : value;
  }
  return { level, message: record.msg ?? "", attributes };
}

/**
 * Sends one scrubbed line to Sentry Logs (free: 5 GB/month, 30-day lookback). Sentry links it to
 * the active trace itself. Never throws into the logger.
 */
export function sentryLogSink(record: LogRecord): void {
  try {
    const log = toSentryLog(record);
    if (log) {
      Sentry.logger[log.level](log.message, log.attributes);
    }
  } catch {
    // A failing SDK must not break logging; the line is already on stdout.
  }
}
```

`src/lib/logger.ts`: `scrubbingStream(target, forward?)` and `createLogger({ level, destination, forward })`:

```ts
function scrubbingStream(target: DestinationStream, forward?: (record: LogRecord) => void): DestinationStream {
  return {
    write(line: string) {
      let record: LogRecord;
      try {
        record = scrubDeep(JSON.parse(line) as LogRecord);
        target.write(`${JSON.stringify(record)}\n`);
      } catch {
        target.write(DROPPED_LINE);
        return;
      }
      if (forward) {
        try {
          forward(record);
        } catch {
          // The sink failing never loses the stdout line.
        }
      }
    },
  };
}
```

(`JSON.parse` returns `any`, so the `as LogRecord` is a type annotation of parsed JSON, not a cast through `unknown`.) Add `forward?: (record: LogRecord) => void` to `createLogger`'s options with JSDoc "receives each finished line after scrubbing (Sentry Logs in production)", pass it to `scrubbingStream`, and export the app logger as:

```ts
/** Application-wide server logger. Use instead of `console.*`. Lines also go to Sentry Logs. */
export const logger: Logger = createLogger({
  level: getServerEnv().LOG_LEVEL,
  forward: sentryLogSink,
});
```

`src/lib/observability/sentry-options.ts`: add `beforeSendLog: (log: Log) => Log | null;` to `SentryOptions` (`import type { Log } from "@sentry/core"`) and `beforeSendLog: failClosed(scrubDeep<Log>),` to `buildSentryOptions`.

Run: `bun run test -- --run src/lib` → PASS.

- [ ] **Step 3: The monitoring runbook (alert rules and uptime, set by the Owner in Sentry)**

`docs/runbooks/monitoring.md`:

```markdown
# Monitoring runbook (spec §5 Operations)

Sentry org `dev-daly`, region `https://de.sentry.io`. Discord server: the Owner's, with channels
`#errors`, `#uptime`, `#platform`, `#deploys`. Every Sentry alert notifies **email and Discord**.

## Sentry alert rules (Alerts → Create Alert → Issues)

| Rule | When | Then |
|---|---|---|
| New issue | A new issue is created | Email: the Owner; Discord: `#errors` |
| Regression | The issue changes state from resolved to unresolved | Email: the Owner; Discord: `#errors` |
| Error spike | Number of events in an issue is more than 50 in 1 hour | Email: the Owner; Discord: `#errors` |

Environment: `production` for all three (a second copy with `preview` is optional).

## Uptime monitor (Alerts → Create Alert → Uptime)

- URL `https://tapnshow.vercel.app/api/health`, method GET, interval 1 minute, expect 200.
- Notify: email (the Owner) and Discord `#uptime`.
- It also keeps production active (one database read a minute through `healthcheck()`).

## After 2026-10-17 (end of the Business trial)

The free Developer plan lists "alerts via email"; third-party integrations are a Team feature.
On 2026-10-18, open each rule (Alerts → the rule → Edit) and press **Send Test Notification**, then
check the email and `#errors` / `#uptime`. If nothing
arrives in Discord, email keeps working; record it in spec §15.

## Logs

Sentry → Explore → Logs, environment `production`. Lines arrive already scrubbed (spec §11).
```

- [ ] **Step 4: Source maps on Vercel (`SENTRY_AUTH_TOKEN`)**

`vercel env ls 2>&1 | grep -c SENTRY_AUTH_TOKEN`. If `0`: AskUserQuestion "Production stack traces need `SENTRY_AUTH_TOKEN` on Vercel (Production and Preview) to upload source maps. Add it now? You paste the token in your terminal with `! vercel env add SENTRY_AUTH_TOKEN production` and the same for preview; back it up in `.env.local`." Never write an env value without that answer.

- [ ] **Step 5: Ask the Owner to create the rules, then verify them**

AskUserQuestion with the runbook's two tables (rules + uptime) as the steps. After the Owner says done, verify with the Sentry tools (`mcp__plugin_sentry_sentry__search_sentry_tools` for the alert-rule and uptime listing, then call them for org `dev-daly`): three issue alert rules each with an email and a Discord action, one uptime monitor at 1 minute. Record the result in the ledger.

- [ ] **Step 6: Chain, commit, PR, merge**

Commit: `feat(observability): scrubbed server logs to Sentry Logs, beforeSendLog, monitoring runbook`. On the preview deployment of this PR, open any page and check Sentry → Logs shows lines from `environment: preview` with no token in them.
### Task 7: The Discord embed builder and sender, `#deploys`, the keep-alive

**Issue labels:** `type:task`, `area:observability`, `area:infra`. **Branch:** `feat/<issue>-discord`. **Migration:** `supabase migration new m9_keep_alive`.

**Files:**
- Create: `src/lib/discord/embed.ts`, `src/lib/discord/embed.test.ts`, `src/lib/discord/send.ts`, `src/lib/discord/send.test.ts`
- Create: `scripts/discord-notify.ts`, `scripts/discord-notify.test.ts`, `scripts/keep-alive.ts`, `scripts/keep-alive.test.ts`
- Create: `.github/workflows/notify.yml`, `.github/workflows/keep-alive.yml`
- Create: `supabase/migrations/<ts>_m9_keep_alive.sql`; Modify: `src/server/db/function-security.db.test.ts`
- Modify: `docs/runbooks/monitoring.md` (Discord webhooks, the two workflows)

**Interfaces:**
- Produces (Task 8 and Task 17 use them):
  - `DiscordEvent = { tone: "success" | "failure" | "attention" | "info"; title: string; url?: string; description?: string; fields?: ReadonlyArray<{ name: string; value: string }>; source: string; at: Date }`
  - `discordMessage(event: DiscordEvent): DiscordMessage` (one embed, mentions off, every part within Discord's limits)
  - `postToDiscord(webhookUrl: string, message: DiscordMessage, deps?: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<{ ok: boolean; status: number }>`
  - CLI `bun scripts/discord-notify.ts --webhook-env <NAME> --tone <tone> --title <text> [--url <url>] [--description <text>] [--field "<name>=<value>"]… --source <text>`: exits 0 without posting when the env var is empty (forks, missing secret), exits 1 when Discord refuses.
  - SQL `public.keep_alive() returns timestamptz` (executable by `anon`).
- Secrets the Owner adds (asked first, values pasted by the Owner): GitHub `DISCORD_DEPLOYS_WEBHOOK`, `DISCORD_UPTIME_WEBHOOK`; GitHub variables `SUPABASE_PROD_URL`, `SUPABASE_PROD_PUBLISHABLE_KEY`, `SUPABASE_PREVIEW_URL`, `SUPABASE_PREVIEW_PUBLISHABLE_KEY` (public values: the publishable keys are already in every browser).

**Rulings (copy into the ledger):**
- The keep-alive calls `public.keep_alive()` (returns `now()`, executable by `anon`) instead of reading a table: `anon` has no table grants (spec §11), and granting one just to see zero rows would widen what `anon` can reach. A function call is still a real database query through the Data API.
- New workflow files can only be dispatched once they are on `main`, and a local run would put a webhook URL into a shell command (and the chat transcript). So the scripts are unit-tested before merging, and the real posts are checked right after the merge: the merge's own production deploy, and one `gh workflow run keep-alive.yml` (spec §12 said "on a branch before merge").
- Every value from an event payload reaches the scripts through `env:`, never inlined into `run:` (GitHub's script-injection guidance).

- [ ] **Step 1: Failing tests for the builder and the sender**

`src/lib/discord/embed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DISCORD_COLORS, DISCORD_LIMITS, discordMessage } from "./embed";

const at = new Date("2026-10-15T14:13:00Z");

describe("discordMessage", () => {
  it("builds one embed with the tone's colour, a linked title, inline fields and a footer", () => {
    expect(
      discordMessage({
        tone: "success",
        title: "Production deploy succeeded",
        url: "https://tapnshow.vercel.app",
        description: "docs(spec): M8 done (#324)",
        fields: [{ name: "Commit", value: "`a618827`" }],
        source: "deploys",
        at,
      }),
    ).toEqual({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          color: DISCORD_COLORS.success,
          title: "Production deploy succeeded",
          url: "https://tapnshow.vercel.app",
          description: "docs(spec): M8 done (#324)",
          fields: [{ name: "Commit", value: "`a618827`", inline: true }],
          footer: { text: "deploys" },
          timestamp: "2026-10-15T14:13:00.000Z",
        },
      ],
    });
  });

  it("trims every part to Discord's limits (Discord refuses a message over any of them)", () => {
    const long = "x".repeat(10_000);
    const message = discordMessage({
      tone: "failure",
      title: long,
      description: long,
      fields: Array.from({ length: 40 }, (_, index) => ({ name: `${index}${long}`, value: long })),
      source: long,
      at,
    });
    const [embed] = message.embeds;
    expect(embed.title.length).toBeLessThanOrEqual(DISCORD_LIMITS.title);
    expect(embed.description?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.description);
    expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.fields);
    for (const field of embed.fields ?? []) {
      expect(field.name.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldName);
      expect(field.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldValue);
    }
    const total =
      embed.title.length +
      (embed.description?.length ?? 0) +
      embed.footer.text.length +
      (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
    expect(total).toBeLessThanOrEqual(DISCORD_LIMITS.total);
    expect(embed.title.endsWith("…")).toBe(true);
  });

  it("never lets text mention anyone", () => {
    const message = discordMessage({ tone: "info", title: "@everyone hi", source: "x", at });
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("drops empty fields and keeps an empty description out", () => {
    const [embed] = discordMessage({
      tone: "attention",
      title: "t",
      description: " ",
      fields: [{ name: "Run", value: "" }],
      source: "s",
      at,
    }).embeds;
    expect(embed.description).toBeUndefined();
    expect(embed.fields).toBeUndefined();
  });
});
```

`src/lib/discord/send.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { discordMessage } from "./embed";
import { postToDiscord } from "./send";

const message = discordMessage({ tone: "info", title: "t", source: "s", at: new Date(0) });
const url = "https://discord.com/api/webhooks/1/abc";

describe("postToDiscord", () => {
  it("posts JSON with ?wait=true so a refused message is noticed", async () => {
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("{}", { status: 200 }),
    );
    await expect(postToDiscord(url, message, { fetch })).resolves.toEqual({ ok: true, status: 200 });
    const [target, init] = fetch.mock.calls[0];
    expect(target).toBe(`${url}?wait=true`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(message);
  });

  it("waits Discord's retry_after once on 429, then tries again", async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(postToDiscord(url, message, { fetch, sleep })).resolves.toEqual({ ok: true, status: 200 });
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it("gives up after the one retry and on any other error status", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 400 }));
    await expect(postToDiscord(url, message, { fetch })).resolves.toEqual({ ok: false, status: 400 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("caps a long retry_after at 10 s", async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 900 }), { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(postToDiscord(url, message, { fetch, sleep })).resolves.toEqual({ ok: false, status: 429 });
    expect(sleep).toHaveBeenCalledWith(10_000);
  });
});
```

Run: `bun run test -- --run src/lib/discord` → FAIL.

- [ ] **Step 2: Implement the builder and the sender**

`src/lib/discord/embed.ts`:

```ts
/** What happened, as the embed's colour (spec §5: green ok, red failed, amber needs a look, purple info). */
export type DiscordTone = "success" | "failure" | "attention" | "info";

/** Embed colours (Discord takes an integer). */
export const DISCORD_COLORS: Record<DiscordTone, number> = {
  success: 0x23a55a,
  failure: 0xf23f43,
  attention: 0xf0b232,
  info: 0xc4b5fd,
};

/**
 * Discord's embed limits (docs.discord.com/developers/resources/message, checked 2026-10-15):
 * over any of them Discord refuses the whole message.
 */
export const DISCORD_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  total: 6000,
} as const;

/** One event to post: counts, ids and workspace names only, never a person's name or email. */
export type DiscordEvent = {
  tone: DiscordTone;
  title: string;
  url?: string;
  description?: string;
  fields?: ReadonlyArray<{ name: string; value: string }>;
  source: string;
  at: Date;
};

type Field = { name: string; value: string; inline: true };

/** A webhook message with one embed. */
export type DiscordMessage = {
  allowed_mentions: { parse: [] };
  embeds: [
    {
      color: number;
      title: string;
      url?: string;
      description?: string;
      fields?: Field[];
      footer: { text: string };
      timestamp: string;
    },
  ];
};

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * The one embed for an event (spec §5): every part trimmed to Discord's limits, fields inline,
 * empty parts left out, and mentions always off.
 */
export function discordMessage(event: DiscordEvent): DiscordMessage {
  const title = clip(event.title, DISCORD_LIMITS.title);
  const footer = clip(event.source, 200);
  let budget = DISCORD_LIMITS.total - title.length - footer.length;
  const fields: Field[] = [];
  for (const field of (event.fields ?? []).slice(0, DISCORD_LIMITS.fields)) {
    const name = clip(field.name, DISCORD_LIMITS.fieldName);
    const value = clip(field.value, DISCORD_LIMITS.fieldValue);
    if (!name || !value || name.length + value.length > budget) {
      continue;
    }
    budget -= name.length + value.length;
    fields.push({ name, value, inline: true });
  }
  const description = clip(event.description ?? "", Math.min(DISCORD_LIMITS.description, budget));
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: DISCORD_COLORS[event.tone],
        title,
        ...(event.url ? { url: event.url } : {}),
        ...(description ? { description } : {}),
        ...(fields.length ? { fields } : {}),
        footer: { text: footer },
        timestamp: event.at.toISOString(),
      },
    ],
  };
}
```

`src/lib/discord/send.ts`:

```ts
import type { DiscordMessage } from "./embed";

/** Longest wait honoured from a 429's `retry_after` before the one retry. */
export const DISCORD_RETRY_CAP_MS = 10_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function retryAfterMs(response: Response): Promise<number> {
  try {
    const body: { retry_after?: number } = await response.json();
    return Math.min(Math.ceil((body.retry_after ?? 1) * 1000), DISCORD_RETRY_CAP_MS);
  } catch {
    return 1000;
  }
}

/**
 * Posts one message to a Discord webhook with `?wait=true` (Discord answers only once it saved
 * the message, so a refusal is visible), retrying once after a 429's `retry_after`. Never throws
 * for an HTTP status; a network error propagates.
 */
export async function postToDiscord(
  webhookUrl: string,
  message: DiscordMessage,
  deps: { fetch?: (input: string, init: RequestInit) => Promise<Response>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: boolean; status: number }> {
  const send = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? wait;
  const post = () =>
    send(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  let response = await post();
  if (response.status === 429) {
    await sleep(await retryAfterMs(response));
    response = await post();
  }
  return { ok: response.ok, status: response.status };
}
```

Run: `bun run test -- --run src/lib/discord` → PASS.

- [ ] **Step 3: The notify script (red, then green)**

`scripts/discord-notify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseNotifyArgs } from "./discord-notify";

describe("parseNotifyArgs", () => {
  it("reads the event and the webhook's env name", () => {
    expect(
      parseNotifyArgs([
        "--webhook-env", "DISCORD_DEPLOYS_WEBHOOK",
        "--tone", "failure",
        "--title", "CI failed on main",
        "--url", "https://github.com/x/y/actions/runs/1",
        "--field", "Commit=`c4c7ca7`",
        "--field", "Failed job=db",
        "--source", "main",
      ]),
    ).toEqual({
      webhookEnv: "DISCORD_DEPLOYS_WEBHOOK",
      event: {
        tone: "failure",
        title: "CI failed on main",
        url: "https://github.com/x/y/actions/runs/1",
        fields: [
          { name: "Commit", value: "`c4c7ca7`" },
          { name: "Failed job", value: "db" },
        ],
        source: "main",
      },
    });
  });

  it("refuses an unknown tone or a missing title", () => {
    expect(() => parseNotifyArgs(["--webhook-env", "X", "--tone", "loud", "--title", "t", "--source", "s"])).toThrow(/tone/);
    expect(() => parseNotifyArgs(["--webhook-env", "X", "--tone", "info", "--source", "s"])).toThrow(/title/);
  });
});
```

`scripts/discord-notify.ts`:

```ts
import { parseArgs } from "node:util";
import { discordMessage, type DiscordEvent, type DiscordTone } from "../src/lib/discord/embed";
import { postToDiscord } from "../src/lib/discord/send";

const TONES: readonly DiscordTone[] = ["success", "failure", "attention", "info"];

/** The CLI's arguments as an event (without its time) and the env var holding the webhook URL. */
export function parseNotifyArgs(argv: string[]): {
  webhookEnv: string;
  event: Omit<DiscordEvent, "at">;
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      "webhook-env": { type: "string" },
      tone: { type: "string" },
      title: { type: "string" },
      url: { type: "string" },
      description: { type: "string" },
      field: { type: "string", multiple: true },
      source: { type: "string" },
    },
  });
  const tone = TONES.find((candidate) => candidate === values.tone);
  if (!tone) {
    throw new Error(`--tone must be one of ${TONES.join(", ")}`);
  }
  if (!values.title || !values.source || !values["webhook-env"]) {
    throw new Error("--title, --source and --webhook-env are required");
  }
  const fields = (values.field ?? []).map((field) => {
    const at = field.indexOf("=");
    return { name: field.slice(0, at), value: field.slice(at + 1) };
  });
  return {
    webhookEnv: values["webhook-env"],
    event: {
      tone,
      title: values.title,
      source: values.source,
      ...(values.url ? { url: values.url } : {}),
      ...(values.description ? { description: values.description } : {}),
      ...(fields.length ? { fields } : {}),
    },
  };
}

if (import.meta.main) {
  const { webhookEnv, event } = parseNotifyArgs(process.argv.slice(2));
  const webhook = process.env[webhookEnv];
  if (!webhook) {
    process.stdout.write(`${webhookEnv} is not set; nothing posted.\n`);
    process.exit(0);
  }
  const result = await postToDiscord(webhook, discordMessage({ ...event, at: new Date() }));
  if (!result.ok) {
    process.stderr.write(`Discord refused the message (${result.status}).\n`);
    process.exit(1);
  }
}
```

Run: `bun run test -- --run scripts/discord-notify` → PASS.

- [ ] **Step 4: `public.keep_alive()` and the keep-alive script**

`supabase/migrations/<ts>_m9_keep_alive.sql`:

```sql
-- M9 (spec §5 Operations): the keep-alive workflow's signed-out read. A real query through the Data
-- API that reveals nothing (the database's clock). anon has no table grants, so no table is used.
create function public.keep_alive()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select pg_catalog.now() $$;
revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
```

`src/server/db/function-security.db.test.ts`, add (today `anon` can execute no public function at all, checked 2026-10-15):

```ts
  it("lets anon execute exactly one public function: keep_alive", () => {
    const rows = queryLocalSql(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`,
      names,
    );
    expect(rows.map((row) => row.name)).toEqual(["keep_alive"]);
  });
```

`scripts/keep-alive.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { pingProject, weeklyReport } from "./keep-alive";

describe("pingProject", () => {
  it("calls keep_alive with the public key and reports the answer", async () => {
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify("2026-10-15T05:17:00+00:00"), { status: 200 }),
    );
    await expect(pingProject({ name: "Production", url: "https://p.supabase.co", key: "sb_publishable_x" }, fetch)).resolves.toEqual({ name: "Production", ok: true, status: 200 });
    const [target, init] = fetch.mock.calls[0];
    expect(target).toBe("https://p.supabase.co/rest/v1/rpc/keep_alive");
    expect(new Headers(init.headers).get("apikey")).toBe("sb_publishable_x");
  });

  it("reports a failure, including a network error", async () => {
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(pingProject({ name: "Preview", url: "https://q.supabase.co", key: "k" }, fetch)).resolves.toEqual({ name: "Preview", ok: false, status: 0 });
  });
});

describe("weeklyReport", () => {
  it("is due on Mondays at the morning run only", () => {
    expect(weeklyReport(new Date("2026-10-19T05:17:00Z"))).toBe(true);
    expect(weeklyReport(new Date("2026-10-19T17:17:00Z"))).toBe(false);
    expect(weeklyReport(new Date("2026-10-20T05:17:00Z"))).toBe(false);
  });
});
```

`scripts/keep-alive.ts`:

```ts
import { discordMessage } from "../src/lib/discord/embed";
import { postToDiscord } from "../src/lib/discord/send";

type Project = { name: string; url: string; key: string };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** One signed-out call to `public.keep_alive()` (spec §5: keeps a free project from pausing). */
export async function pingProject(
  project: Project,
  send: Fetch = fetch,
): Promise<{ name: string; ok: boolean; status: number }> {
  try {
    const response = await send(`${project.url}/rest/v1/rpc/keep_alive`, {
      method: "POST",
      headers: { apikey: project.key, "Content-Type": "application/json" },
      body: "{}",
    });
    return { name: project.name, ok: response.ok, status: response.status };
  } catch {
    return { name: project.name, ok: false, status: 0 };
  }
}

/** The weekly "still alive" post goes with Monday's morning run (UTC, before noon). */
export function weeklyReport(now: Date): boolean {
  return now.getUTCDay() === 1 && now.getUTCHours() < 12;
}

if (import.meta.main) {
  const projects: Project[] = [
    { name: "Production", url: process.env.SUPABASE_PROD_URL ?? "", key: process.env.SUPABASE_PROD_PUBLISHABLE_KEY ?? "" },
    { name: "Preview", url: process.env.SUPABASE_PREVIEW_URL ?? "", key: process.env.SUPABASE_PREVIEW_PUBLISHABLE_KEY ?? "" },
  ];
  const results = await Promise.all(projects.map((project) => pingProject(project)));
  const failed = results.filter((result) => !result.ok);
  const webhook = process.env.DISCORD_UPTIME_WEBHOOK;
  const now = new Date();
  if (webhook && (failed.length > 0 || weeklyReport(now))) {
    await postToDiscord(
      webhook,
      discordMessage({
        tone: failed.length > 0 ? "failure" : "info",
        title: failed.length > 0 ? "Keep-alive: a database did not answer" : "Weekly check: everything answered",
        ...(process.env.RUN_URL ? { url: process.env.RUN_URL } : {}),
        fields: results.map((result) => ({ name: `${result.name} database`, value: result.ok ? "OK" : `No answer (${result.status})` })),
        source: "keep-alive",
        at: now,
      }),
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
```

Run: `bun run test -- --run scripts` → PASS. Apply the migration (`supabase db reset --local </dev/null && bun run db:types && bun run test:db -- src/server/db/function-security && supabase db advisors --local </dev/null`).

- [ ] **Step 5: The workflows**

`.github/workflows/notify.yml`:

```yaml
name: Notify
# Spec §5: production deploys and CI failures on main, to Discord #deploys. Previews and PR runs are
# not posted. Event values reach the script through env, never inlined into a command.
on:
  deployment_status:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
permissions:
  contents: read
  actions: read
jobs:
  deploy:
    if: >-
      github.event_name == 'deployment_status' &&
      github.event.deployment.environment == 'Production' &&
      contains(fromJSON('["success","failure","error"]'), github.event.deployment_status.state)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.deployment.sha }}
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - name: Post to #deploys
        env:
          DISCORD_DEPLOYS_WEBHOOK: ${{ secrets.DISCORD_DEPLOYS_WEBHOOK }}
          STATE: ${{ github.event.deployment_status.state }}
          SHA: ${{ github.event.deployment.sha }}
          SITE: ${{ github.event.deployment_status.environment_url }}
        run: |
          subject=$(git log -1 --format=%s "$SHA")
          if [ "$STATE" = success ]; then tone=success; title="Production deploy succeeded"; else tone=failure; title="Production deploy failed"; fi
          bun scripts/discord-notify.ts --webhook-env DISCORD_DEPLOYS_WEBHOOK --tone "$tone" \
            --title "$title" --url "https://tapnshow.vercel.app" --description "$subject" \
            --field "Commit=\`${SHA:0:7}\`" --field "Deployment=$SITE" --source "production"
  ci:
    if: >-
      github.event_name == 'workflow_run' &&
      github.event.workflow_run.conclusion == 'failure' &&
      github.event.workflow_run.event == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - name: Post to #deploys
        env:
          DISCORD_DEPLOYS_WEBHOOK: ${{ secrets.DISCORD_DEPLOYS_WEBHOOK }}
          GH_TOKEN: ${{ github.token }}
          RUN_ID: ${{ github.event.workflow_run.id }}
          RUN_URL: ${{ github.event.workflow_run.html_url }}
          TITLE: ${{ github.event.workflow_run.display_title }}
          SHA: ${{ github.event.workflow_run.head_sha }}
        run: |
          jobs=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${RUN_ID}/jobs" --jq '[.jobs[] | select(.conclusion == "failure") | .name] | join(", ")')
          bun scripts/discord-notify.ts --webhook-env DISCORD_DEPLOYS_WEBHOOK --tone failure \
            --title "CI failed on main" --url "$RUN_URL" --description "$TITLE" \
            --field "Commit=\`${SHA:0:7}\`" --field "Failed job=${jobs:-unknown}" --source "main"
```

`.github/workflows/keep-alive.yml`:

```yaml
name: Keep-alive
# Spec §5: one signed-out call per Supabase project twice a day (a free project pauses after a week
# without activity); posts to #uptime on failure and every Monday morning. GitHub disables scheduled
# workflows after 60 days without repository activity (spec §15).
on:
  schedule:
    - cron: "17 5,17 * * *"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - run: bun scripts/keep-alive.ts
        env:
          SUPABASE_PROD_URL: ${{ vars.SUPABASE_PROD_URL }}
          SUPABASE_PROD_PUBLISHABLE_KEY: ${{ vars.SUPABASE_PROD_PUBLISHABLE_KEY }}
          SUPABASE_PREVIEW_URL: ${{ vars.SUPABASE_PREVIEW_URL }}
          SUPABASE_PREVIEW_PUBLISHABLE_KEY: ${{ vars.SUPABASE_PREVIEW_PUBLISHABLE_KEY }}
          DISCORD_UPTIME_WEBHOOK: ${{ secrets.DISCORD_UPTIME_WEBHOOK }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

Check the actions' versions against `ci.yml` (`actions/checkout@v7`, `oven-sh/setup-bun@v2`, bun 1.3.11) and keep them identical.

- [ ] **Step 6: Webhooks and variables (the Owner's part), then a real post**

Add to `docs/runbooks/monitoring.md`:

```markdown
## Discord webhooks (one per channel)

Discord → Server Settings → Integrations → Webhooks → New Webhook → pick the channel → Copy
Webhook URL. The URL is a secret: paste it only into the commands below, never into chat or issues.

| Channel | Where the URL goes |
|---|---|
| `#deploys` | `gh secret set DISCORD_DEPLOYS_WEBHOOK` (paste when asked) |
| `#uptime` | `gh secret set DISCORD_UPTIME_WEBHOOK` |
| `#platform` | Vercel `DISCORD_PLATFORM_WEBHOOK` (Production, server-only), added in Task 17 |
| `#errors` | none: Sentry's own Discord integration |

Back each one up in `.env.local` (commented OTHER SECRETS block).

## GitHub variables for the keep-alive (public values)

`gh variable set SUPABASE_PROD_URL`, `SUPABASE_PROD_PUBLISHABLE_KEY`, `SUPABASE_PREVIEW_URL`,
`SUPABASE_PREVIEW_PUBLISHABLE_KEY` (the URLs and publishable keys from `.env.local`; both keys are
already in every browser that opens the app).

## Workflows

- `notify.yml`: production deploys (Vercel's GitHub deployments) and CI failures on main → `#deploys`.
- `keep-alive.yml`: 05:17 and 17:17 UTC; `#uptime` on failure and on Monday mornings.
  Run by hand: `gh workflow run keep-alive.yml`.
```

AskUserQuestion: "To post to Discord I need you to create two webhooks (`#deploys`, `#uptime`) and set them with `! gh secret set DISCORD_DEPLOYS_WEBHOOK` / `! gh secret set DISCORD_UPTIME_WEBHOOK` (you paste the URL; it never enters the chat). May I also set the four keep-alive variables from `.env.local` with `gh variable set`?" Do nothing until answered.

No local test post: running the script locally would need the webhook URL in a shell command, which ends up in the chat transcript. The first real posts come right after the merge (Step 7).

- [ ] **Step 7: Chain, commit, PR, merge, hosted push, run once**

Commit: `feat(ops): Discord embeds, production deploy and CI-failure posts, Supabase keep-alive`. After merging: `bash .superpowers/scripts/hosted-push.sh`; `gh workflow run keep-alive.yml` and check `#uptime` (a Monday-only post won't appear on other days: check the run log says both databases answered); the merge itself deploys production, so `#deploys` should show "Production deploy succeeded" within minutes. Record both in the ledger.
### Task 8: Nightly encrypted backups with a restore check, and the restore runbook

**Issue labels:** `type:task`, `area:infra`, `area:db`. **Branch:** `feat/<issue>-backups`.

**Files:**
- Create: `.github/workflows/backup.yml`, `.github/backup-recipient.txt` (the `age` public key)
- Create: `scripts/backup-counts.sql`, `scripts/compare-counts.ts`, `scripts/compare-counts.test.ts`
- Create: `docs/runbooks/restore.md`; Modify: `docs/runbooks/monitoring.md` (the backup line)

**Interfaces:**
- Consumes: `scripts/discord-notify.ts` (Task 7) for the failure post to `#uptime`.
- Produces: `compareCounts(before: string, after: string): string[]` (differences, empty when the restore matches); a nightly artifact `tapnshow-backup-<YYYY-MM-DD>` holding one file `backup.tar.gz.age`, kept 30 days.
- Secrets: GitHub `SUPABASE_PROD_DB_URL` (the Session pooler string with the database password; the Owner adds it, asked first). The `age` private key lives in `~/.config/tapnshow/backup-age.key` and in `.env.local` (commented), never in GitHub.

**Rulings (copy into the ledger):**
- The restore check runs **in the same nightly job, before encryption**, into a throwaway local Supabase stack started in an empty folder: so GitHub never needs a decryption key, and every backup that is kept has been restored once. The spec's "weekly restore check" becomes nightly (stronger, same cost: public repositories have free Actions minutes).
- `vault.secrets` is left out of the data dump (the dispatcher URL and secret: encrypted with a key a restored project cannot read, and already backed up in `.env.local`).
- The artifact is encrypted because artifacts of a public repository can be downloaded by anyone signed in to GitHub.

- [ ] **Step 1: The count comparison (red, then green)**

`scripts/backup-counts.sql` (one `name|count` line per table; the dump and the restore run the same file, so the lists always match):

```sql
select 'auth.users|' || count(*) from auth.users
union all select 'public.workspaces|' || count(*) from public.workspaces
union all select 'public.workspace_roles|' || count(*) from public.workspace_roles
union all select 'public.contacts|' || count(*) from public.contacts
union all select 'public.lists|' || count(*) from public.lists
union all select 'public.meetings|' || count(*) from public.meetings
union all select 'public.meeting_invitees|' || count(*) from public.meeting_invitees
union all select 'public.responses|' || count(*) from public.responses
union all select 'public.response_history|' || count(*) from public.response_history
union all select 'public.attendance_marks|' || count(*) from public.attendance_marks
union all select 'public.google_connections|' || count(*) from public.google_connections
union all select 'public.outbox_jobs|' || count(*) from public.outbox_jobs
order by 1;
```

`scripts/compare-counts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareCounts } from "./compare-counts";

describe("compareCounts", () => {
  it("passes when every table has the same row count", () => {
    expect(compareCounts("public.contacts|30\npublic.lists|2\n", "public.contacts|30\npublic.lists|2")).toEqual([]);
  });

  it("names each table that differs or is missing", () => {
    expect(compareCounts("public.contacts|30\npublic.lists|2", "public.contacts|29")).toEqual([
      "public.contacts: 30 before, 29 after",
      "public.lists: 2 before, missing after",
    ]);
  });

  it("fails an empty dump (a broken query must not look like success)", () => {
    expect(compareCounts("", "")).toEqual(["no tables counted"]);
  });
});
```

`scripts/compare-counts.ts`:

```ts
import { readFileSync } from "node:fs";

function parse(text: string): Map<string, string> {
  return new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [table, count] = line.split("|");
        return [table, count] as const;
      }),
  );
}

/** Differences between the counts taken at dump time and after the restore (spec §5 backups). */
export function compareCounts(before: string, after: string): string[] {
  const expected = parse(before);
  if (expected.size === 0) {
    return ["no tables counted"];
  }
  const actual = parse(after);
  const problems: string[] = [];
  for (const [table, count] of expected) {
    const restored = actual.get(table);
    if (restored !== count) {
      problems.push(`${table}: ${count} before, ${restored === undefined ? "missing" : restored} after`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const [beforePath, afterPath] = process.argv.slice(2);
  const problems = compareCounts(readFileSync(beforePath, "utf8"), readFileSync(afterPath, "utf8"));
  if (problems.length > 0) {
    process.stderr.write(`Restore check failed:\n${problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("Restore check passed.\n");
}
```

Run: `bun run test -- --run scripts/compare-counts` → PASS (after the file exists; FAIL before).

- [ ] **Step 2: The key pair (the Owner's go-ahead first)**

AskUserQuestion: "Backups are encrypted with `age`. May I install `age` (`! sudo apt-get install -y age`, you run it) and create the key pair: the private key in `~/.config/tapnshow/backup-age.key` (and a commented copy in `.env.local`), the public key committed as `.github/backup-recipient.txt`?" Then:

```bash
mkdir -p ~/.config/tapnshow && chmod 700 ~/.config/tapnshow
age-keygen -o ~/.config/tapnshow/backup-age.key 2> /dev/null
chmod 600 ~/.config/tapnshow/backup-age.key
age-keygen -y ~/.config/tapnshow/backup-age.key > .github/backup-recipient.txt
grep -c '^age1' .github/backup-recipient.txt
```

Expected: `1`. Append the private key to `.env.local`'s OTHER SECRETS block as a commented line (`# BACKUP_AGE_KEY=AGE-SECRET-KEY-…`), never printing it to the terminal.

- [ ] **Step 3: The workflow**

`.github/workflows/backup.yml`:

```yaml
name: Backup
# Spec §5: nightly dump of production (roles, schema, data) through the IPv4 Session pooler,
# restored into a throwaway local Supabase stack and checked table by table, then encrypted with
# age to the Owner's public key and kept 30 days. Supabase Free has no automatic backups.
on:
  schedule:
    - cron: "10 3 * * *"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - uses: supabase/setup-cli@v3
        with:
          version: 2.119.0
      - run: sudo apt-get update -qq && sudo apt-get install -y -qq age
      - name: Dump production
        env:
          DB_URL: ${{ secrets.SUPABASE_PROD_DB_URL }}
        run: |
          mkdir -p dump
          supabase db dump --db-url "$DB_URL" -f dump/roles.sql --role-only
          supabase db dump --db-url "$DB_URL" -f dump/schema.sql
          supabase db dump --db-url "$DB_URL" -f dump/data.sql --use-copy --data-only \
            -x "storage.buckets_vectors" -x "storage.vector_indexes" -x "vault.secrets"
          psql "$DB_URL" -At -v ON_ERROR_STOP=1 -f scripts/backup-counts.sql > dump/counts.txt
      - name: Restore into a throwaway stack and compare
        run: |
          mkdir -p "$RUNNER_TEMP/restore" && cd "$RUNNER_TEMP/restore"
          supabase init --force >/dev/null
          supabase start -x studio,edge-runtime,logflare,vector,imgproxy,realtime,storage-api,supavisor,mailpit
          LOCAL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
          psql "$LOCAL" --single-transaction -v ON_ERROR_STOP=1 \
            -f "$GITHUB_WORKSPACE/dump/roles.sql" -f "$GITHUB_WORKSPACE/dump/schema.sql" \
            -c 'SET session_replication_role = replica' -f "$GITHUB_WORKSPACE/dump/data.sql"
          psql "$LOCAL" -At -v ON_ERROR_STOP=1 -f "$GITHUB_WORKSPACE/scripts/backup-counts.sql" > "$GITHUB_WORKSPACE/dump/restored.txt"
          cd "$GITHUB_WORKSPACE" && bun scripts/compare-counts.ts dump/counts.txt dump/restored.txt
      - name: Encrypt
        run: |
          tar -czf - -C dump roles.sql schema.sql data.sql counts.txt | age -R .github/backup-recipient.txt > backup.tar.gz.age
          rm -rf dump
      - uses: actions/upload-artifact@v7
        with:
          name: tapnshow-backup-${{ github.run_id }}
          path: backup.tar.gz.age
          retention-days: 30
          if-no-files-found: error
      - name: Post failures to #uptime
        if: failure()
        env:
          DISCORD_UPTIME_WEBHOOK: ${{ secrets.DISCORD_UPTIME_WEBHOOK }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          bun scripts/discord-notify.ts --webhook-env DISCORD_UPTIME_WEBHOOK --tone failure \
            --title "Nightly backup failed" --url "$RUN_URL" \
            --description "No backup was saved tonight. The last good one is in the run list." --source "backup"
```

Check two facts before the first run and fix the workflow, not the plan's intent, if either differs: the local stack's DB port in an empty `supabase init` folder (`supabase status` there; default 54322), and that the dump's `schema.sql` restores into a fresh stack (the first manual run shows it; a failing `create extension` means installing that extension in the throwaway stack first, recorded as a Ruling).

- [ ] **Step 4: The restore runbook**

`docs/runbooks/restore.md`:

```markdown
# Restore runbook (spec §5 backups)

Backups: GitHub → Actions → Backup → a run → Artifacts → `tapnshow-backup-<run id>` (30 days).
Each one was restored and checked table by table before it was kept.

## Decrypt

    unzip tapnshow-backup-<run id>.zip
    age -d -i ~/.config/tapnshow/backup-age.key backup.tar.gz.age | tar -xzf -

(the key's copy is in `.env.local`, OTHER SECRETS). This gives `roles.sql`, `schema.sql`,
`data.sql`, `counts.txt`.

## Restore into a new Supabase project

1. Create the project (Free), copy its **Session pooler** connection string.
2. `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql --dbname "<connection string>"`
3. Put the dispatcher secrets back into Vault (they are not in the backup):
   `tn_dispatch_url`, `tn_dispatch_secret` (values in `.env.local`).
4. Point Vercel's Supabase env vars at the new project (ask before any env write), redeploy, and
   run the auth config script (`bun run auth:config`) for the new project.
5. Compare `counts.txt` with the same queries on the new project (`scripts/backup-counts.sql`).

## Monthly drill

Download the latest artifact and decrypt it once a month (proves the key still works).
```

`docs/runbooks/monitoring.md`, Workflows list: add "`backup.yml`: 03:10 UTC; `#uptime` only on failure. Run by hand: `gh workflow run backup.yml`."

- [ ] **Step 5: The database secret (the Owner's), merge, first run**

AskUserQuestion: "The backup needs production's Session pooler connection string as a GitHub secret. Please copy it from Supabase → the production project → Connect → Session pooler (with the database password) and run `! gh secret set SUPABASE_PROD_DB_URL` (paste when asked). Back it up in `.env.local`." Then chain, commit (`feat(ops): nightly encrypted production backups, restored and checked before they are kept`), PR, merge, and `gh workflow run backup.yml`. Watch the run (`gh run watch`), expect "Restore check passed." and one artifact. Download it and decrypt it once (`age -d -i ~/.config/tapnshow/backup-age.key …`) to prove the round trip; record it in the ledger.
### Task 9: Vercel Web Analytics and Speed Insights, with no token ever leaving

**Issue labels:** `type:task`, `area:observability`, `area:frontend`. **Branch:** `feat/<issue>-analytics`.

**Files:**
- Modify: `package.json` (`@vercel/analytics` 2.0.1, `@vercel/speed-insights` 2.0.0)
- Modify: `src/lib/observability/scrub.ts`, `src/lib/observability/scrub.test.ts` (`routePatternUrl`)
- Create: `src/components/providers/page-analytics.tsx`, `src/components/providers/page-analytics.test.tsx`
- Create: `src/config/analytics.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `routePatternUrl(url: string): string` (`src/lib/observability/scrub.ts`): token segments become their route pattern (`/r/[token]`) and the query string and fragment are dropped; `SPEED_INSIGHTS_SAMPLE_RATE = 0.5`; `<PageAnalytics />`. Task 20 adds `/admin/join/` to the shared token pattern, and with it both `scrubUrl` and `routePatternUrl`.

**Packages (npm, checked 2026-10-15):** `@vercel/analytics` 2.0.1 (MIT, released 2026-03-12; `beforeSend(event: { type, url }) → event | null`), `@vercel/speed-insights` 2.0.0 (Apache-2.0, released 2026-03-10; `sampleRate`, `beforeSend`). The 2.1.0 lines are canaries only.

**Rulings (copy into the ledger):**
- The query string is dropped entirely, not just scrubbed: `/login?next=/r/<token>` and similar would otherwise carry a token in a parameter, and no query value is needed for page counts.
- Both scripts are injected by our own nonced bundle, so `'strict-dynamic'` admits them and they post to `/_vercel/…` on our origin (`connect-src 'self'`); the headers e2e and the console guard prove no CSP report.
- Turning Web Analytics and Speed Insights on in the Vercel dashboard (Project → Analytics / Speed Insights → Enable) is the Owner's click, asked in Step 4; nothing is recorded until then.

- [ ] **Step 1: Failing tests**

`src/lib/observability/scrub.test.ts`, add:

```ts
describe("routePatternUrl", () => {
  it.each([
    ["https://tapnshow.vercel.app/r/abcDEF123?choice=going", "https://tapnshow.vercel.app/r/[token]"],
    ["https://tapnshow.vercel.app/u/x1", "https://tapnshow.vercel.app/u/[token]"],
    ["https://tapnshow.vercel.app/report/x1#top", "https://tapnshow.vercel.app/report/[token]"],
    ["https://tapnshow.vercel.app/invite/x1", "https://tapnshow.vercel.app/invite/[token]"],
    ["https://tapnshow.vercel.app/login?next=%2Fr%2Fsecret", "https://tapnshow.vercel.app/login"],
    ["https://tapnshow.vercel.app/w/club-ab12/meetings", "https://tapnshow.vercel.app/w/club-ab12/meetings"],
  ])("%s → %s", (input, expected) => {
    expect(routePatternUrl(input)).toBe(expected);
  });
});
```

`src/components/providers/page-analytics.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ analytics: null as null | ((event: { type: "pageview"; url: string }) => object | null), speed: null as null | ((event: { type: "vital"; url: string }) => object | null), sampleRate: 0 }));
vi.mock("@vercel/analytics/next", () => ({
  Analytics: (props: { beforeSend: typeof seen.analytics }) => {
    seen.analytics = props.beforeSend;
    return null;
  },
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: (props: { beforeSend: typeof seen.speed; sampleRate: number }) => {
    seen.speed = props.beforeSend;
    seen.sampleRate = props.sampleRate;
    return null;
  },
}));

import { PageAnalytics } from "./page-analytics";

describe("PageAnalytics", () => {
  it("sends route patterns, never tokens, and samples half of the vitals", () => {
    render(<PageAnalytics />);
    expect(seen.analytics?.({ type: "pageview", url: "https://x.app/r/secret123?choice=late" })).toEqual({
      type: "pageview",
      url: "https://x.app/r/[token]",
    });
    expect(seen.speed?.({ type: "vital", url: "https://x.app/u/secret" })).toEqual({
      type: "vital",
      url: "https://x.app/u/[token]",
    });
    expect(seen.sampleRate).toBe(0.5);
  });
});
```

Run: `bun add @vercel/analytics@2.0.1 @vercel/speed-insights@2.0.0` then `bun run test -- --run src/lib/observability/scrub src/components/providers/page-analytics` → FAIL.

- [ ] **Step 2: Implement**

`src/lib/observability/scrub.ts`: keep `TOKEN_LINK` the one pattern, and add:

```ts
/**
 * A page URL as analytics may see it (spec §5): token segments become their route pattern
 * (`/r/[token]`), and the query string and fragment are dropped (a `next=` can carry a token).
 */
export function routePatternUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? url;
  return withoutQuery.replace(TOKEN_LINK, (_match, segment: string) => `/${segment.toLowerCase()}/[token]`);
}
```

`src/config/analytics.ts`:

```ts
/** Share of page loads that report Web Vitals (Speed Insights Hobby: 10k events per 30 days). */
export const SPEED_INSIGHTS_SAMPLE_RATE = 0.5;
```

`src/components/providers/page-analytics.tsx`:

```tsx
"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SPEED_INSIGHTS_SAMPLE_RATE } from "@/config/analytics";
import { routePatternUrl } from "@/lib/observability/scrub";

/**
 * Vercel Web Analytics (no cookies) and Speed Insights (spec §5). Every URL is reduced to its
 * route pattern first, so no personal-link token reaches Vercel.
 */
export function PageAnalytics() {
  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: routePatternUrl(event.url) })} />
      <SpeedInsights
        sampleRate={SPEED_INSIGHTS_SAMPLE_RATE}
        beforeSend={(event) => ({ ...event, url: routePatternUrl(event.url) })}
      />
    </>
  );
}
```

`src/app/layout.tsx`: render `<PageAnalytics />` right after `<Toaster />` inside `QueryProvider`. Run: `bun run test -- --run src/lib/observability src/components/providers` → PASS.

- [ ] **Step 3: No CSP report, no console noise**

`TZ=UTC bun run test:e2e e2e/headers.spec.ts e2e/smoke.spec.ts` (outside Vercel the scripts load in development mode from Vercel's debug script or not at all; either way the console guard must stay quiet). If a script logs a warning about running outside Vercel, render `PageAnalytics` only when `NEXT_PUBLIC_VERCEL_ENV` is set (a public env value already in `public-env.ts`) and record the ruling.

- [ ] **Step 4: The Owner enables them in Vercel**

AskUserQuestion: "Please turn on Web Analytics and Speed Insights in Vercel (project tapnshow → Analytics → Enable; Speed Insights → Enable). Hobby includes 50k analytics events a month (then pausing) and 10k Speed Insights events per 30 days; we sample half." After merging, open a few pages on production (including an answer link from the Owner's test workspace), then check the Analytics view lists `/r/[token]`, never a real token.

- [ ] **Step 5: Chain, commit, PR, merge**

Commit: `feat(observability): Vercel Web Analytics and Speed Insights with route-pattern URLs only`.
### Task 10: The theme choice in the user menu, and an icon on every Settings section

**Issue labels:** `type:task`, `area:frontend`, `area:design-system`. **Branch:** `feat/<issue>-theme-menu`.

**Files:**
- Create: `src/components/theme/theme-modes.ts`, `src/components/theme/theme-modes.test.ts`
- Modify: `src/components/theme/theme-toggle.tsx` (uses `theme-modes.ts`)
- Modify: `src/components/ui/dropdown-menu.tsx` (`DropdownMenuRadioGroup`, `DropdownMenuRadioItem`), `src/components/ui/dropdown-menu.test.tsx`
- Create: `src/components/theme/theme-menu-choice.tsx`, `src/components/theme/theme-menu-choice.test.tsx`
- Modify: `src/components/shell/user-menu.tsx`, `src/components/shell/user-menu.test.tsx`
- Create: `src/app/w/[slug]/settings/section-icon.tsx`, `src/app/w/[slug]/settings/section-icon.test.tsx`
- Modify: `src/app/w/[slug]/settings/general-section.tsx`, `meeting-defaults-section.tsx` (both `SettingsSection` calls), `people-section.tsx`, `danger-zone.tsx`
- Modify: `messages/en.json` (`Theme.menuLabel`, `Theme.choices`)

**Interfaces:**
- Produces: `THEME_MODES`, `ThemeMode`, `THEME_ICONS`, `isThemeMode(value: string | undefined): value is ThemeMode`; `ThemeMenuChoice()` (the menu's three radio items); `SectionIcon({ section }: { section: "general" | "defaults" | "people" | "danger" })`. Task 11's `PublicShell` keeps the round `ThemeToggle`; Task 19 adds the **Admin** item to `UserMenu`.

**Ruling (copy into the ledger):** choosing a theme keeps the menu open (`event.preventDefault()` in `onSelect`), so the person sees the change and can pick again; Escape or a click outside closes it.

- [ ] **Step 1: Failing tests**

`src/components/theme/theme-modes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isThemeMode, THEME_ICONS, THEME_MODES } from "./theme-modes";

describe("theme modes", () => {
  it("lists System, Light, Dark in that order, each with an icon", () => {
    expect(THEME_MODES).toEqual(["system", "light", "dark"]);
    expect(Object.keys(THEME_ICONS)).toEqual(["system", "light", "dark"]);
  });

  it("recognises only the three modes", () => {
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("sepia")).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});
```

`src/components/theme/theme-menu-choice.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { renderWithProviders } from "@/test/render";
import { ThemeMenuChoice } from "./theme-menu-choice";

describe("ThemeMenuChoice", () => {
  it("offers System, Light and Dark as radio items and keeps the menu open on a choice", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ThemeMenuChoice />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });
});
```

`src/components/shell/user-menu.test.tsx`: the "lists My invites, Account and Sign out" test still passes unchanged (radio items have role `menuitemradio`, not `menuitem`); add:

```tsx
  it("has the theme choice between Account and Sign out", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });
```

`src/app/w/[slug]/settings/section-icon.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionIcon } from "./section-icon";

describe("SectionIcon (colour means state)", () => {
  it.each([
    ["general", "primary"],
    ["defaults", "primary"],
    ["people", "primary"],
    ["danger", "danger"],
  ] as const)("%s → %s tile", (section, tone) => {
    const { container } = render(<SectionIcon section={section} />);
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", tone);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
```

Run: `bun run test -- --run src/components/theme src/components/shell/user-menu section-icon` → FAIL.

- [ ] **Step 2: Implement**

`messages/en.json`, `Theme` gains `"menuLabel": "Theme"` and `"choices": { "system": "System", "light": "Light", "dark": "Dark" }`.

`src/components/theme/theme-modes.ts`:

```ts
import { DesktopIcon, MoonIcon, SunIcon, type Icon } from "@phosphor-icons/react";

/** The colour themes, in the order every switch shows them (spec §10 Theme). */
export const THEME_MODES = ["system", "light", "dark"] as const;

/** One colour theme (`next-themes` value). */
export type ThemeMode = (typeof THEME_MODES)[number];

/** The icon of each theme, shared by the round switch and the menu. */
export const THEME_ICONS: Record<ThemeMode, Icon> = {
  system: DesktopIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/** Whether `next-themes`' stored value is one of ours (it may be anything a browser kept). */
export function isThemeMode(value: string | undefined): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value);
}
```

`src/components/theme/theme-toggle.tsx`: delete its local `ORDER`, `Mode`, `ICONS` and `isMode`; import `THEME_MODES`, `THEME_ICONS`, `isThemeMode`, `type ThemeMode` and use them (`THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length]`). Its test passes unchanged.

`src/components/ui/dropdown-menu.tsx`, add:

```tsx
/** Radix radio group inside a menu (one choice among a few). */
export function DropdownMenuRadioGroup(props: ComponentProps<typeof MenuPrimitive.RadioGroup>) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

/**
 * One radio option inside a menu: 44 px tall, the chosen one filled like a segmented control
 * (no native radio, Owner rule).
 */
export function DropdownMenuRadioItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-control px-2 text-xs font-bold outline-hidden select-none data-highlighted:outline-2 data-highlighted:outline-outline data-[state=checked]:bg-fill-primary data-[state=checked]:text-on-fill [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}
```

`src/components/theme/theme-menu-choice.tsx`:

```tsx
"use client";

import { CircleHalf } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useIsClient } from "@/lib/use-is-client";
import { isThemeMode, THEME_ICONS, THEME_MODES } from "./theme-modes";

/**
 * "Theme" in the user menu (spec §10): System, Light, Dark as one segmented row. Choosing keeps
 * the menu open so the change is visible.
 */
export function ThemeMenuChoice() {
  const t = useTranslations("Theme");
  const { theme, setTheme } = useTheme();
  const mounted = useIsClient();
  const current = mounted && isThemeMode(theme) ? theme : "system";
  return (
    <div className="px-1.5 pt-1 pb-1.5">
      <p className="flex items-center gap-2 px-1.5 pb-1 text-xs font-bold text-muted-ink">
        <CircleHalf weight="bold" aria-hidden className="size-4" />
        <span id="theme-menu-label">{t("menuLabel")}</span>
      </p>
      <DropdownMenuRadioGroup
        aria-labelledby="theme-menu-label"
        value={current}
        onValueChange={(value) => {
          if (isThemeMode(value)) {
            setTheme(value);
          }
        }}
        className="flex gap-1 rounded-control border-[length:var(--tn-border-width)] border-outline p-1"
      >
        {THEME_MODES.map((mode) => {
          const Glyph = THEME_ICONS[mode];
          return (
            <DropdownMenuRadioItem key={mode} value={mode} onSelect={(event) => event.preventDefault()}>
              <Glyph weight="bold" aria-hidden />
              {t(`choices.${mode}`)}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </div>
  );
}
```

(Radix renders the group with `role="group"`; `aria-labelledby` names it "Theme". If the test's `getByRole("group", { name: "Theme" })` doesn't find it, look at the rendered markup and fix the labelling, not the test.)

`src/components/shell/user-menu.tsx`: after the Account item, add `<DropdownMenuSeparator />`, `<ThemeMenuChoice />`, `<DropdownMenuSeparator />`, then Sign out. Update the JSDoc: "Account menu: My invites, Account, the theme choice, Sign out."

`src/app/w/[slug]/settings/section-icon.tsx`:

```tsx
import { CalendarDots, GearSix, UsersThree, WarningOctagon, type Icon } from "@phosphor-icons/react";
import { Sticker, type StickerTone } from "@/components/ui/sticker";

const ICONS: Record<"general" | "defaults" | "people" | "danger", { glyph: Icon; tone: StickerTone }> = {
  general: { glyph: GearSix, tone: "primary" },
  defaults: { glyph: CalendarDots, tone: "primary" },
  people: { glyph: UsersThree, tone: "primary" },
  danger: { glyph: WarningOctagon, tone: "danger" },
};

/**
 * The fixed icon of a Settings section (spec §10, colour means state): calm sections share the
 * purple tile and the Danger zone is red; Sending and Google Sheets pick their tones from their
 * state themselves, so a yellow or green tile always means something.
 */
export function SectionIcon({ section }: { section: keyof typeof ICONS }) {
  const { glyph: Glyph, tone } = ICONS[section];
  return (
    <Sticker tone={tone}>
      <Glyph weight="bold" />
    </Sticker>
  );
}
```

Pass `icon={<SectionIcon section="general" />}` in `general-section.tsx`, `icon={<SectionIcon section="defaults" />}` in **both** `SettingsSection` calls of `meeting-defaults-section.tsx`, `icon={<SectionIcon section="people" />}` in `people-section.tsx`, `icon={<SectionIcon section="danger" />}` in `danger-zone.tsx`.

Run: `bun run test -- --run src/components src/app/w` → PASS.

- [ ] **Step 3: Screenshots and the Owner's look**

Screenshot the open user menu (in a workspace and on `/invites`) and `/w/<slug>/settings` with every section folded and with General open, at 390 light, 320 dark and 1024; check at 320 px that the three theme choices fit on one row without clipping. Send them and ask "Looks right?" before merging.

- [ ] **Step 4: Chain, commit, PR, merge**

Commit: `feat(ui): System / Light / Dark in the user menu; an icon on every Settings section`.
### Task 11: The public shell, `/privacy` and `/terms`, `robots.txt` and the sitemap

**Issue labels:** `type:task`, `area:frontend`, `documentation`. **Branch:** `feat/<issue>-legal`.

**Files:**
- Create: `src/components/public/public-shell.tsx`, `src/components/public/public-header.tsx`, `src/components/public/public-footer.tsx`, `src/components/public/public-footer.test.tsx`, `src/components/brand/brand-mark.tsx`
- Create: `src/config/legal.ts`, `src/config/legal.test.ts`
- Create: `src/content/legal/types.ts`, `src/content/legal/privacy.ts`, `src/content/legal/terms.ts`, `src/content/legal/content.test.ts`
- Create: `src/lib/markdown/legal.ts`, `src/lib/markdown/legal.test.ts`
- Create: `src/components/legal/legal-page.tsx`, `src/components/legal/legal-page.test.tsx`
- Create: `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/robots.test.ts`
- Modify: `src/app/not-found.tsx`, `src/components/errors/not-found-view.tsx` (+ test), `src/app/login/page.tsx`
- Modify: `messages/en.json` (`Public`, `Legal`)
- Create: `e2e/legal.spec.ts`

**Interfaces:**
- Consumes: `isSessionCookieName` (Task 2), `ThemeToggle` (Task 10), `getServerEnv().SMTP_FROM` (the platform sender address).
- Produces:
  - `PublicShell({ children, showSignIn? })` (async server component: header with the brand, the round theme switch and Sign in / Open TapNShow; footer); Task 12's landing uses it.
  - `LEGAL_LINKS = { privacy: "/privacy", terms: "/terms" } as const` and `contactHref(address: string): string`; Task 13 uses both on the token pages, `/account` and email footers.
  - `LegalDocument = { title: string; updated: string; summary: readonly string[]; sections: ReadonlyArray<{ id: string; title: string; body: string }> }`; `renderLegalHtml(markdown: string): string`.
  - `BrandMark({ size? })` (the app icon until the new logo; Task 12 and the admin shell use it).

**Rulings (copy into the ledger):**
- `NotFoundView` becomes a card only (no `<main>`), and `not-found.tsx` puts it inside `PublicShell`; `ErrorView` keeps `PublicPage` because `error.tsx` is a client component and can't render the async shell.
- The Contact link is `mailto:` the platform sender address from the server setting `SMTP_FROM`, so the address is never written into the public repo (spec §7.18).
- The legal texts are drafted with the skills, then **checked against official sources before the Owner sees them**; every legal obligation the check finds that the product or the Owner doesn't meet yet is raised with the Owner (Step 4), never papered over in the text.

- [ ] **Step 1: Failing tests for the links, the renderer, the content shape and the footer**

`src/config/legal.test.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contactHref, LEGAL_LINKS } from "./legal";

describe("LEGAL_LINKS", () => {
  it.each(Object.entries(LEGAL_LINKS))("%s points at a page that exists (%s)", (_name, path) => {
    expect(existsSync(join(process.cwd(), "src/app", path, "page.tsx"))).toBe(true);
  });

  it("builds the contact mail link", () => {
    expect(contactHref("team@example.com")).toBe("mailto:team@example.com");
  });
});
```

`src/lib/markdown/legal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderLegalHtml } from "./legal";

describe("renderLegalHtml", () => {
  it("renders paragraphs, lists, emphasis and our own links", () => {
    const html = renderLegalHtml("We **never** sell data.\n\n- one\n- two\n\nSee [Terms](/terms).");
    expect(html).toContain("<strong>never</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('<a href="/terms">Terms</a>');
  });

  it("escapes raw HTML and opens outside links in a new tab", () => {
    const html = renderLegalHtml('<script>x</script> [Google](https://policies.google.com)');
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="https://policies.google.com" target="_blank" rel="noopener noreferrer"');
  });
});
```

`src/content/legal/content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { privacyPolicy } from "./privacy";
import { terms } from "./terms";

describe.each([
  ["privacy", privacyPolicy],
  ["terms", terms],
])("%s", (_name, document) => {
  it("has five 'In short' bullets, a valid date and unique section ids", () => {
    expect(document.summary).toHaveLength(5);
    expect(Number.isNaN(Date.parse(document.updated))).toBe(false);
    const ids = document.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("never names GDG ISSAT and ends with Contact", () => {
    expect(JSON.stringify(document)).not.toMatch(/gdg|issat/i);
    expect(document.sections.at(-1)?.id).toBe("contact");
  });
});

describe("privacy policy", () => {
  it("carries Google's Limited Use statement word for word", () => {
    const text = JSON.stringify(privacyPolicy);
    expect(text).toContain(
      "TapNShow's use and transfer to any other app of information received from Google APIs will adhere to [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
    );
  });
});
```

`src/components/public/public-footer.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { PublicFooter } from "./public-footer";

describe("PublicFooter", () => {
  it("links Privacy, Terms and Contact and names the maker", () => {
    renderWithProviders(<PublicFooter contact="mailto:team@example.com" />);
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "mailto:team@example.com");
    expect(screen.getByText("Made by Mohamed Ali Chouikh")).toBeInTheDocument();
  });
});
```

`src/components/legal/legal-page.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LegalPage } from "./legal-page";

const document = {
  title: "Privacy Policy",
  updated: "2026-10-20",
  summary: ["a", "b", "c", "d", "e"],
  sections: [
    { id: "who", title: "Who we are", body: "TapNShow is run by…" },
    { id: "contact", title: "Contact", body: "Write to us." },
  ],
};

describe("LegalPage", () => {
  it("shows the date, the In short card, a jump list that matches the sections, numbered", () => {
    renderWithProviders(<LegalPage document={document} />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByText("Last updated 20 October 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In short" })).toBeInTheDocument();
    const jump = screen.getByRole("navigation", { name: "On this page" });
    expect(Array.from(jump.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(["#who", "#contact"]);
    expect(screen.getByRole("heading", { level: 2, name: "1. Who we are" })).toHaveAttribute("id", "who");
    expect(screen.getByText(/not a lawyer's review/i)).toBeInTheDocument();
  });
});
```

`src/app/robots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("robots and sitemap (spec §7.18)", () => {
  it("lists only the public pages", () => {
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).toEqual(["/", "/privacy", "/terms"]);
    const rules = robots().rules;
    expect(rules).toEqual({ userAgent: "*", allow: ["/$", "/privacy", "/terms"], disallow: "/" });
    expect(robots().sitemap).toBe("http://localhost:3000/sitemap.xml");
  });
});
```

Run: `bun run test -- --run src/config/legal src/lib/markdown/legal src/content/legal src/components/public src/components/legal src/app/robots` → FAIL.

- [ ] **Step 2: Messages, links, renderer, brand mark**

`messages/en.json`, new namespaces:

```json
  "Public": {
    "home": "TapNShow home",
    "signIn": "Sign in",
    "openApp": "Open TapNShow",
    "privacy": "Privacy",
    "terms": "Terms",
    "contact": "Contact",
    "madeBy": "Made by Mohamed Ali Chouikh",
    "footerLabel": "TapNShow links"
  },
  "Legal": {
    "updated": "Last updated {date}",
    "inShort": "In short",
    "onThisPage": "On this page",
    "notLawyer": "This page was written carefully but is not a lawyer's review."
  },
```

`src/config/legal.ts`:

```ts
/** The legal pages (spec §7.18). Every link to them uses these paths; a test checks each exists. */
export const LEGAL_LINKS = { privacy: "/privacy", terms: "/terms" } as const;

/** The Contact link: the platform sender address (server setting `SMTP_FROM`, never in the repo). */
export function contactHref(address: string): string {
  return `mailto:${address}`;
}
```

`src/lib/markdown/legal.ts`:

```ts
import MarkdownIt from "markdown-it";

/**
 * Renderer for the legal pages' own Markdown (written in the repo, not by users): paragraphs,
 * lists, emphasis and links; raw HTML escaped. Outside links open in a new tab.
 */
const markdown = new MarkdownIt("zero", { html: false, linkify: false, breaks: false }).enable([
  "paragraph",
  "list",
  "emphasis",
  "link",
  "escape",
]);

const SAFE_LINK = /^(https?:|mailto:|\/|#)/i;
markdown.validateLink = (url: string) => SAFE_LINK.test(url.trim());

const renderLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = tokens[index].attrGet("href") ?? "";
  if (/^https?:/i.test(href)) {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
  }
  return renderLinkOpen ? renderLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
};

/** HTML for one legal section's body. */
export function renderLegalHtml(source: string): string {
  return markdown.render(source).trim();
}
```

(If markdown-it's "zero" preset names the paragraph rule differently, check `markdown.block.ruler.getRules("")` and fix the list, keeping the test.)

`src/components/brand/brand-mark.tsx`:

```tsx
import Image from "next/image";

/** The app's mark (the app icon, spec §10 PWA) until the new logo replaces the icon files. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return <Image src="/icons/icon-192.png" alt="" width={size} height={size} unoptimized className="shrink-0" />;
}
```

- [ ] **Step 3: The shell, the footer, the legal page component, the routes**

`src/components/public/public-footer.tsx`:

```tsx
import Link from "next/link";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/config/app";
import { LEGAL_LINKS } from "@/config/legal";

/** Footer of every public page (spec §7.18): Privacy, Terms, Contact, the maker. */
export function PublicFooter({ contact }: { contact: string }) {
  const t = useTranslations("Public");
  return (
    <footer className="border-t-[length:var(--tn-border-width)] border-outline bg-ink text-surface">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm">
        <p className="font-display text-base">{APP_NAME}</p>
        <nav aria-label={t("footerLabel")} className="flex flex-wrap gap-x-5 gap-y-2">
          <Link className="underline underline-offset-4" href={LEGAL_LINKS.privacy}>{t("privacy")}</Link>
          <Link className="underline underline-offset-4" href={LEGAL_LINKS.terms}>{t("terms")}</Link>
          <a className="underline underline-offset-4" href={contact}>{t("contact")}</a>
        </nav>
        <p className="opacity-80">{t("madeBy")}</p>
      </div>
    </footer>
  );
}
```

(Check the dark token pair: `bg-ink text-surface` must stay readable in dark mode, where `ink` is light. If it inverts badly, use the same fixed pair the landing mockup used, `bg-[var(--tn-…)]` from `tokens.css`, and record it; the design-token contrast test covers token pairs only.)

`src/components/public/public-header.tsx` (client: the theme switch is a client component):

```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/config/app";

/** Top bar of the public pages: brand, the round theme switch, Sign in or Open TapNShow. */
export function PublicHeader({ signedIn, showSignIn }: { signedIn: boolean; showSignIn: boolean }) {
  const t = useTranslations("Public");
  return (
    <header className="sticky top-0 z-30 border-b-[length:var(--tn-border-width)] border-outline bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
        <Link href="/" aria-label={t("home")} className="flex min-h-11 items-center gap-2 font-display text-lg">
          <BrandMark />
          <span>{APP_NAME}</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {showSignIn ? (
            <Button asChild tone={signedIn ? "primary" : "surface"}>
              <Link href={signedIn ? "/welcome" : "/login"}>{signedIn ? t("openApp") : t("signIn")}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
```

`src/components/public/public-shell.tsx`:

```tsx
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getServerEnv } from "@/config/env";
import { contactHref } from "@/config/legal";
import { isSessionCookieName } from "@/server/http/auth-cookie";
import { PublicFooter } from "./public-footer";
import { PublicHeader } from "./public-header";

/**
 * The frame of the public pages (spec §7.18): landing, Privacy, Terms, sign-in, not-found. Knows
 * "signed in" from the session cookie only (no database call).
 */
export async function PublicShell({ children, showSignIn = true }: { children: ReactNode; showSignIn?: boolean }) {
  const signedIn = (await cookies()).getAll().some((cookie) => isSessionCookieName(cookie.name));
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicHeader signedIn={signedIn} showSignIn={showSignIn} />
      <main className="flex-1">{children}</main>
      <PublicFooter contact={contactHref(getServerEnv().SMTP_FROM)} />
    </div>
  );
}
```

`src/content/legal/types.ts`:

```ts
/** A legal page's content (spec §7.18): the date, five plain bullets, numbered sections. */
export type LegalDocument = {
  title: string;
  /** ISO date (YYYY-MM-DD) of the last change; shown as "Last updated …". */
  updated: string;
  summary: readonly string[];
  sections: ReadonlyArray<{ id: string; title: string; body: string }>;
};
```

`src/components/legal/legal-page.tsx`:

```tsx
import { Lightbulb } from "@phosphor-icons/react/dist/ssr";
import { useFormatter, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import type { LegalDocument } from "@/content/legal/types";
import { renderLegalHtml } from "@/lib/markdown/legal";

/**
 * One legal page (spec §7.18): title and date, the In short card, a jump list built from the same
 * sections it renders (so they cannot drift), numbered sections, the not-a-lawyer note.
 */
export function LegalPage({ document }: { document: LegalDocument }) {
  const t = useTranslations("Legal");
  const format = useFormatter();
  const date = format.dateTime(new Date(`${document.updated}T12:00:00Z`), { day: "numeric", month: "long", year: "numeric" });
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl">{document.title}</h1>
        <p className="text-muted-ink">{t("updated", { date })}</p>
      </header>
      <Card as="section" aria-labelledby="in-short" className="bg-fill-info text-on-fill">
        <h2 id="in-short" className="flex items-center gap-2 font-bold">
          <Lightbulb weight="bold" aria-hidden className="size-5" />
          {t("inShort")}
        </h2>
        <ul className="mt-2 list-disc pl-5">
          {document.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
      <nav aria-label={t("onThisPage")} className="flex flex-col">
        <p className="pb-1 text-xs font-bold tracking-wide text-muted-ink uppercase">{t("onThisPage")}</p>
        {document.sections.map((section, index) => (
          <a key={section.id} href={`#${section.id}`} className="min-h-11 content-center border-b border-dashed border-outline/30 font-bold">
            {index + 1}. {section.title}
          </a>
        ))}
      </nav>
      {document.sections.map((section, index) => (
        <section key={section.id} aria-labelledby={section.id} className="scroll-mt-20">
          <h2 id={section.id} className="font-display text-xl">
            {index + 1}. {section.title}
          </h2>
          <div className="legal-body mt-2 flex flex-col gap-3" dangerouslySetInnerHTML={{ __html: renderLegalHtml(section.body) }} />
        </section>
      ))}
      <p className="text-sm text-muted-ink">{t("notLawyer")}</p>
    </article>
  );
}
```

(`dangerouslySetInnerHTML` is safe here: the Markdown is the repo's own text, rendered with raw HTML escaped. Add `.legal-body ul { list-style: disc; padding-left: 1.25rem }` and `.legal-body a { text-decoration: underline }` to `src/app/globals.css`.)

`src/app/privacy/page.tsx` (and `terms/page.tsx` the same with `terms`):

```tsx
import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PublicShell } from "@/components/public/public-shell";
import { APP_NAME } from "@/config/app";
import { privacyPolicy } from "@/content/legal/privacy";

export const metadata: Metadata = {
  title: `${privacyPolicy.title} · ${APP_NAME}`,
  description: privacyPolicy.summary[0],
  alternates: { canonical: "/privacy" },
};

/** `/privacy` (spec §7.18): public, its own address (Google's consent screen links it). */
export default function PrivacyPage() {
  return (
    <PublicShell>
      <LegalPage document={privacyPolicy} />
    </PublicShell>
  );
}
```

`src/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/public-env";

/** Only the landing and the legal pages are for search engines (spec §7.18). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/$", "/privacy", "/terms"], disallow: "/" },
    sitemap: `${publicEnv.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
  };
}
```

`src/app/sitemap.ts`:

```ts
import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/public-env";
import { LEGAL_LINKS } from "@/config/legal";

/** The three public pages (spec §7.18). */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", LEGAL_LINKS.privacy, LEGAL_LINKS.terms].map((path) => ({
    url: `${publicEnv.NEXT_PUBLIC_APP_URL}${path === "/" ? "" : path}`,
  }));
}
```

(The landing's URL is the bare origin; the test reads `new URL(...).pathname`, which is `/` for both forms.)

`src/components/errors/not-found-view.tsx`: replace `<PublicPage>` with `<Card as="section" className="mx-auto my-10 flex max-w-md flex-col gap-4">`; `src/app/not-found.tsx` keeps computing `signedIn` from `cookies()` and returns `<PublicShell><NotFoundView signedIn={signedIn} /></PublicShell>` (`cookies()` is read once per request and cached, so the shell's own read costs nothing). `src/app/login/page.tsx`: `<PublicShell showSignIn={false}><div className="mx-auto flex max-w-md flex-col justify-center p-4 py-10"><Suspense><LoginScreen /></Suspense></div></PublicShell>`.

- [ ] **Step 4: Draft the texts with the skills, check them against official sources, show the Owner**

1. Gather the facts, each from its source (write them into the ledger):
   - Supabase region of the production project (`supabase projects list` → region column), Vercel (functions region in the project settings), Sentry (`de.sentry.io`: EU), Google (sending via Gmail, the one sheet via Drive).
   - What TapNShow stores (spec §6): accounts (email, display name, avatar URL only if from Google), workspaces, contacts (name, email, lists), meetings, answers with reasons and comments, check-ins, push subscriptions, logs (scrubbed), Analytics (no cookies, route patterns only).
   - Retention (spec §8 Housekeeping, §11 Account deletion): jobs and send log 30 days, rate-limit events 2 days, push rows 90 days idle, reasons erased on account deletion, workspace deletion hard-deletes.
   - Who sees what (spec §11 Visibility).
2. Invoke the `privacy-policy` skill with those facts and the decisions in spec §7.18 (operator: Mohamed Ali Chouikh, an individual in Tunisia; contact the platform address; workspaces decide whom they invite and TapNShow processes for them; 16+; the Limited Use statement exactly as in the content test). Then the `terms-of-service-generator` skill (16+, acceptable use: no emailing people who never joined the group, reports can suspend sending; the service as is; features and limits can change; free without a "forever" promise; Tunisian law).
3. Check against official sources, citing each (URL and date) in the PR: Tunisia's Organic Law No. 2004-63 on personal data protection and the INPDP's requirements (for example, any prior declaration or authorisation it requires of a controller), GDPR Article 3(2) (non-EU controllers offering services to people in the EU), Article 8 (16 as the default age of consent), Article 13/14 (what people must be told, including people a group emails who never signed up), Article 27 (an EU representative for non-EU controllers), and Google's API Services User Data Policy.
4. **Raise every obligation the check finds that isn't met yet** (for example an INPDP declaration or an Article 27 representative) with the Owner in an AskUserQuestion, with the source and the options; the pages describe the truth, never an intention as a fact.
5. Write `src/content/legal/privacy.ts` and `terms.ts` as `LegalDocument`s (`export const privacyPolicy: LegalDocument = { title: "Privacy Policy", updated: "<the merge date>", summary: [5 bullets], sections: [... , { id: "contact", title: "Contact", body: "…" }] }`). Plain words, short sentences, no GDG ISSAT. The Contact section says to use the Contact link at the bottom of the page: the address itself is not in the repo.
6. Send the Owner both texts (a scratchpad Markdown export of each, `SendUserFile`) and ask for approval before merging.

- [ ] **Step 5: e2e, screenshots, chain, merge**

`e2e/legal.spec.ts`:

```ts
import { expect, test } from "./helpers/test";

for (const [path, title] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"]] as const) {
  test(`${path} is public, jump links work, footer links are there`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const jump = page.getByRole("navigation", { name: "On this page" }).getByRole("link").last();
    await jump.click();
    await expect(page).toHaveURL(/#contact$/);
    const footer = page.getByRole("navigation", { name: "TapNShow links" });
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Contact" })).toHaveAttribute("href", /^mailto:/);
  });
}

test("robots.txt and the sitemap list only the public pages", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap.match(/<loc>/g)).toHaveLength(3);
});
```

(Use the terms page's real `title` from `terms.ts`.) Screenshots of `/privacy`, `/terms`, `/login` and the not-found page at 390 light, 320 dark and 1024; "Looks right?" before merging. Chain; commit `feat: public shell, Privacy and Terms, robots.txt and sitemap`.
### Task 12: The landing page

**Issue labels:** `type:task`, `area:frontend`, `area:i18n`. **Branch:** `feat/<issue>-landing`.

**Files:**
- Modify: `src/app/page.tsx`, `src/app/page.test.tsx`
- Create: `src/components/landing/landing-hero.tsx`, `invite-preview.tsx`, `how-it-works.tsx`, `features.tsx`, `privacy-strip.tsx`, `landing-faq.tsx`, `final-call.tsx`, `src/components/landing/landing.test.tsx`
- Create: `src/app/opengraph-image.tsx`
- Modify: `src/config/app.ts` (the description, if the copy changes it), `messages/en.json` (`Landing`; remove the unused `Home`)
- Create: `e2e/landing.spec.ts`

**Interfaces:**
- Consumes: `PublicShell`, `BrandMark` (Task 11), `Button`, `Card`, `Sticker`, `Accordion` from `radix-ui`, the `AnswerPage.choice.*` labels.
- Produces: the public homepage Google's brand verification reviews (spec §9 M9).

**Rulings (copy into the ledger):**
- The product card is a static preview (`InvitePreview`) built from the answer page's own labels (`AnswerPage.choice.*`) and colour tokens, not the interactive `ChoiceCards` (which needs a token, a form and a mutation).
- `Home.title` (the placeholder's only string) is removed with the placeholder.

- [ ] **Step 1: Messages (the first draft of the copy)**

`messages/en.json`: delete `Home`; add:

```json
  "Landing": {
    "metaTitle": "TapNShow · Know who's coming before the meeting starts",
    "metaDescription": "Meeting invites from your group's own Gmail. Members answer in one tap, no app and no account. See who's going, late or away, live. Free.",
    "eyebrow": "Free for groups that meet",
    "title": "Know who's coming before the meeting starts.",
    "lead": "Send meeting invites from your group's own Gmail. Members answer in one tap, with no app and no account. You see who's going, who's late and who can't come, live.",
    "getStarted": "Get started",
    "seeHow": "See how it works",
    "preview": {
      "label": "An invite as members see it",
      "from": "Robotics Club invites you",
      "title": "Weekly meetup",
      "when": "Thursday 18:00 · Main Library, Room B12"
    },
    "how": {
      "title": "How it works",
      "steps": {
        "connect": { "title": "Connect your Gmail", "body": "Invites come from your group's address, not from us." },
        "invite": { "title": "Pick who to invite", "body": "Import your members from a sheet or a CSV file, once." },
        "watch": { "title": "Watch the answers come in", "body": "Live counts, reasons for being late or away, and a check-in at the door." }
      }
    },
    "features": {
      "title": "Everything a group needs",
      "gmail": { "title": "From your Gmail", "body": "Members see your group's name, not an unknown sender." },
      "oneTap": { "title": "One-tap answers", "body": "Straight from the email, on any phone." },
      "live": { "title": "Live results", "body": "Going, late, can't come, no answer yet." },
      "checkIn": { "title": "Door check-in", "body": "Who said yes, and who actually came." },
      "reminders": { "title": "Reminders", "body": "By email, and on members' phones if they want." },
      "sheet": { "title": "Google Sheet", "body": "A live copy of every answer for your committee." }
    },
    "privacy": {
      "title": "We send email. We never read it.",
      "body": "TapNShow asks Google only for permission to send email and to keep the one sheet it creates. It never sees your inbox or your other files."
    },
    "faq": {
      "title": "Questions",
      "free": { "q": "Is it free?", "a": "Yes. Gmail's own daily sending limits apply to every group's address." },
      "account": { "q": "Do members need an account?", "a": "No. Members answer from the link in their email. They can make an account later to see all their invites in one place." },
      "who": { "q": "Who sees the answers?", "a": "Your group's organizers and the committee members you add. Members never see each other's answers." },
      "groups": { "q": "Which groups is it for?", "a": "Student clubs, associations, volunteer teams, communities: any group that meets." }
    },
    "final": { "title": "Run your next meeting with TapNShow" }
  },
```

Then invoke the copywriting skill on the `Landing` strings (audience: organizers of groups that meet regularly; tone: plain, warm, short; never "GDG ISSAT"; no promise beyond what the product does; "Free" without "forever"), apply its edits to `messages/en.json`, and keep the same keys.

- [ ] **Step 2: Failing tests**

`src/components/landing/landing.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { FinalCall } from "./final-call";
import { Features } from "./features";
import { HowItWorks } from "./how-it-works";
import { LandingFaq } from "./landing-faq";
import { LandingHero } from "./landing-hero";
import { PrivacyStrip } from "./privacy-strip";

describe("landing sections", () => {
  it("hero: the promise, Get started to sign-in, See how to the steps, the invite preview", () => {
    renderWithProviders(<LandingHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Know who's coming");
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
    const preview = screen.getByRole("figure", { name: "An invite as members see it" });
    expect(preview).toHaveTextContent("I'm going");
    expect(preview).toHaveTextContent("I'll be late");
    expect(preview).toHaveTextContent("I can't come");
  });

  it("three steps, six features, the privacy promise, the final call", () => {
    renderWithProviders(
      <>
        <HowItWorks />
        <Features />
        <PrivacyStrip />
        <FinalCall />
      </>,
    );
    expect(screen.getByRole("heading", { name: "How it works" }).closest("section")).toHaveAttribute("id", "how-it-works");
    expect(screen.getAllByRole("listitem")).toHaveLength(3 + 6);
    expect(screen.getByRole("heading", { name: "We send email. We never read it." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/login");
  });

  it("FAQ answers open one at a time", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LandingFaq />);
    const free = screen.getByRole("button", { name: "Is it free?" });
    expect(free).toHaveAttribute("aria-expanded", "false");
    await user.click(free);
    expect(free).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Who sees the answers?" }));
    expect(free).toHaveAttribute("aria-expanded", "false");
  });
});
```

`src/app/page.test.tsx` (replaces the placeholder test): mock `@/components/public/public-shell` to render its children (`PublicShell: ({ children }) => <>{children}</>`), render `<HomePage />` and assert one `h1` and the six section landmarks (hero, how, features, privacy, faq, final) are present; and `expect(JSON.stringify(messages.Landing)).not.toMatch(/gdg|issat/i)`.

Run: `bun run test -- --run src/components/landing src/app/page` → FAIL.

- [ ] **Step 3: Implement**

`src/components/landing/invite-preview.tsx`:

```tsx
import { CheckCircle, Clock, XCircle, type Icon } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CHOICES: ReadonlyArray<{ key: "attending" | "late" | "absent"; glyph: Icon; fill: string }> = [
  { key: "attending", glyph: CheckCircle, fill: "bg-fill-success text-on-fill" },
  { key: "late", glyph: Clock, fill: "" },
  { key: "absent", glyph: XCircle, fill: "" },
];

/** A still picture of the invite members get (spec §7.18): the answer page's own labels. */
export function InvitePreview() {
  const t = useTranslations("Landing.preview");
  const tChoice = useTranslations("AnswerPage.choice");
  return (
    <figure aria-label={t("label")} className="m-0">
      <Card className="flex flex-col gap-2 -rotate-1">
        <p className="text-sm text-muted-ink">{t("from")}</p>
        <p className="font-display text-2xl">{t("title")}</p>
        <p className="text-sm text-muted-ink">{t("when")}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {CHOICES.map(({ key, glyph: Glyph, fill }) => (
            <li
              key={key}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-control border-[length:var(--tn-border-width)] border-outline px-3 font-bold",
                fill,
              )}
            >
              <Glyph weight="bold" aria-hidden className="size-5" />
              {tChoice(key)}
            </li>
          ))}
        </ul>
      </Card>
    </figure>
  );
}
```

`src/components/landing/landing-hero.tsx`:

```tsx
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InvitePreview } from "./invite-preview";

/** The first screen (layout A): the promise on the left, the invite on the right from md up. */
export function LandingHero() {
  const t = useTranslations("Landing");
  return (
    <section aria-labelledby="landing-title" className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 md:grid-cols-2 md:py-16">
      <div className="flex flex-col gap-4">
        <p className="w-fit rounded-full border-2 border-outline bg-fill-warning px-3 py-1 text-sm font-bold text-on-fill">{t("eyebrow")}</p>
        <h1 id="landing-title" className="font-display text-4xl leading-tight md:text-5xl">{t("title")}</h1>
        <p className="text-lg text-muted-ink">{t("lead")}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild tone="primary">
            <Link href="/login">{t("getStarted")}</Link>
          </Button>
          <Button asChild>
            <a href="#how-it-works">{t("seeHow")}</a>
          </Button>
        </div>
      </div>
      <InvitePreview />
    </section>
  );
}
```

`how-it-works.tsx`, `features.tsx`, `privacy-strip.tsx`, `final-call.tsx` follow the same pattern (server components, `useTranslations("Landing")`):
- `HowItWorks`: `<section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 …">`, an `h2` "How it works", an `<ol>` of the three steps (`connect`, `invite`, `watch`) each with a numbered warning-tone circle and `title` / `body`.
- `Features`: `h2` "Everything a group needs", a `<ul className="grid grid-cols-2 gap-3 md:grid-cols-3">` of the six features, each a small `Card` with a `Sticker` (`gmail`: `EnvelopeSimple` primary, `oneTap`: `HandTap` success, `live`: `ChartBar` warning, `checkIn`: `QrCode` info, `reminders`: `BellRinging` danger, `sheet`: `Table` neutral; icons from `@phosphor-icons/react/dist/ssr`).
- `PrivacyStrip`: a full-width band `bg-fill-info text-on-fill` with a `ShieldCheck` sticker, the `h2` and the body.
- `FinalCall`: centred `h2` and the primary **Get started** link to `/login`.

`landing-faq.tsx` (client, Radix Accordion, single + collapsible):

```tsx
"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Accordion } from "radix-ui";

const QUESTIONS = ["free", "account", "who", "groups"] as const;

/** The FAQ (spec §7.18): one answer open at a time. */
export function LandingFaq() {
  const t = useTranslations("Landing.faq");
  return (
    <section aria-labelledby="faq-title" className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-10">
      <h2 id="faq-title" className="font-display text-2xl">{t("title")}</h2>
      <Accordion.Root type="single" collapsible className="flex flex-col gap-2">
        {QUESTIONS.map((key) => (
          <Accordion.Item key={key} value={key} className="rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface">
            <Accordion.Header>
              <Accordion.Trigger className="group flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left font-bold">
                {t(`${key}.q`)}
                <CaretDown weight="bold" aria-hidden className="size-5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="px-3 pb-3 text-muted-ink">{t(`${key}.a`)}</Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  );
}
```

`src/app/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Features } from "@/components/landing/features";
import { FinalCall } from "@/components/landing/final-call";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingHero } from "@/components/landing/landing-hero";
import { PrivacyStrip } from "@/components/landing/privacy-strip";
import { PublicShell } from "@/components/public/public-shell";

/** Title, description and the share card (spec §7.18). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: "/" },
    openGraph: { title: t("metaTitle"), description: t("metaDescription"), type: "website" },
  };
}

/**
 * The landing (spec §7.18, layout A) for organizers of other groups, shown to everyone with no
 * redirect: Google's reviewers arrive signed out, and the installed app opens `/invites`.
 */
export default function HomePage() {
  return (
    <PublicShell>
      <LandingHero />
      <HowItWorks />
      <Features />
      <PrivacyStrip />
      <LandingFaq />
      <FinalCall />
    </PublicShell>
  );
}
```

`src/app/opengraph-image.tsx` (the share card; redone with the new logo):

```tsx
import { ImageResponse } from "next/og";
import { APP_NAME } from "@/config/app";
import { palette } from "@/design/tokens";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${APP_NAME}: know who's coming before the meeting starts`;

/** The link preview image (spec §7.18). Text only until the new logo exists. */
export default function OpengraphImage() {
  const { background, ink, primary } = palette.light;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background, color: ink }}>
        <div style={{ fontSize: 40, fontWeight: 700, background: primary, padding: "8px 20px", borderRadius: 16, border: `6px solid ${ink}`, alignSelf: "flex-start" }}>{APP_NAME}</div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 40, lineHeight: 1.1 }}>Know who's coming before the meeting starts.</div>
      </div>
    ),
    size,
  );
}
```

(The share-card sentence matches `Landing.title`; `ImageResponse` can't use next-intl, so keep the two in step by hand and say so in a comment.) If the copy changed `APP_DESCRIPTION`'s meaning, update `src/config/app.ts` (manifest and metadata) to the new one-liner.

Run: `bun run test -- --run src/components/landing src/app` → PASS.

- [ ] **Step 4: e2e, Lighthouse, screenshots**

`e2e/landing.spec.ts`:

```ts
import { expect, test } from "./helpers/test";

test("the landing sells, answers questions and leads to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Know who's coming");
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Is it free?" }).click();
  await expect(page.getByText(/Gmail's own daily sending limits/)).toBeVisible();
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeInViewport();
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});
```

Lighthouse (mobile), on a production build with the local stack (`bun scripts/with-local-supabase.ts bun run build && bun scripts/with-local-supabase.ts bun run start -p 3000` in the background):

```bash
CHROME_PATH=$(bun -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath())') \
  bunx lighthouse@13.5.0 http://localhost:3000/ --quiet --chrome-flags="--headless=new" \
  --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=/tmp/lh-landing.json
bun -e 'const r = await Bun.file("/tmp/lh-landing.json").json(); for (const [k, c] of Object.entries(r.categories)) process.stdout.write(`${k} ${Math.round(c.score * 100)}\n`); process.stdout.write(`LCP ${r.audits["largest-contentful-paint"].displayValue} CLS ${r.audits["cumulative-layout-shift"].displayValue}\n`)'
```

Expected: every category ≥ 95, LCP < 2.5 s, CLS 0. Repeat for `/privacy` and `/terms`. Fix what Lighthouse names (image sizes, contrast, tap targets, meta) and re-run; record the four scores per page in the ledger. (Local scores are a floor check; the production check in Task 21 repeats them on Vercel.)

Screenshots of `/` at 390 light, 320 dark and 1024 (full page), signed out and signed in (header button). "Looks right?" before merging.

- [ ] **Step 5: Chain, commit, PR, merge**

Commit: `feat: the landing page for organizers of other groups`.
### Task 13: Privacy and Terms wherever data is involved: sign-in, token pages, `/account`, every email

**Issue labels:** `type:task`, `area:frontend`, `area:email`. **Branch:** `feat/<issue>-legal-links`.

**Files:**
- Modify: `src/config/legal.ts`, `src/config/legal.test.ts` (`PRIVACY_POLICY_URL`)
- Modify: `src/app/login/login-screen.tsx`, `src/app/login/login-screen.test.tsx`
- Modify: `src/components/public/public-page.tsx`; Create: `src/components/public/legal-line.tsx`, `src/components/public/legal-line.test.tsx`
- Modify: `src/app/r/[token]/page.tsx`, `src/app/u/[token]/page.tsx`, `src/app/report/[token]/page.tsx`, `src/app/invite/[token]/page.tsx`
- Create: `src/components/account/legal-links-row.tsx`; Modify: `src/app/account/page.tsx`
- Modify: `src/emails/email-layout.tsx` (every email's footer gets the link, including the meeting emails' own footer), and the email tests whose expected text includes the footer
- Modify: `messages/en.json` (`Auth.agreement`, `Public.sentWith`, `Email.privacy`)

**Interfaces:**
- Consumes: `LEGAL_LINKS`, `contactHref` (Task 11), `SUPABASE_PROJECTS.prod.siteUrl` (`src/config/supabase-projects.ts`).
- Produces: `PRIVACY_POLICY_URL` (absolute, production: emails link the one canonical policy, also from previews and auth templates), `LegalLine()` ("Sent with TapNShow · Privacy · Terms"), `PublicPage({ children, legalLine? })`, `LegalLinksRow({ contact })`.

**Rulings (copy into the ledger):**
- Emails link production's `/privacy` from every environment (`PRIVACY_POLICY_URL`): the policy is the same everywhere, and a preview's address would die with the preview.
- The sign-in code email's footer changes too, so the auth templates are pushed again to both Supabase projects with `bun run auth:config` after the merge: a hosted configuration write, asked first.

- [ ] **Step 1: Failing tests**

`src/config/legal.test.ts`, add:

```ts
  it("points emails at production's privacy page", () => {
    expect(PRIVACY_POLICY_URL).toBe("https://tapnshow.vercel.app/privacy");
  });
```

`src/components/public/legal-line.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LegalLine } from "./legal-line";

describe("LegalLine", () => {
  it("says who sent the page and links Privacy and Terms", () => {
    renderWithProviders(<LegalLine />);
    expect(screen.getByText(/Sent with TapNShow/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});
```

`src/app/login/login-screen.test.tsx`, add:

```tsx
  it("states the agreement and the age under the sign-in options", () => {
    renderLogin();
    const line = screen.getByText(/By continuing you agree to the/);
    expect(line).toHaveTextContent("By continuing you agree to the Terms and Privacy Policy and confirm you're 16 or older.");
    expect(within(line).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(within(line).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });
```

(use the file's existing render helper in place of `renderLogin`, and import `within`).

`src/emails/meeting-invite-email.test.tsx` and `src/emails/sign-in-code-email.test.tsx`, add one case each:

```ts
  it("links the privacy policy in the footer (spec §7.18)", async () => {
    const email = await render…(/* the file's fixture */);
    expect(email.html).toContain('href="https://tapnshow.vercel.app/privacy"');
    expect(email.text).toContain("Privacy: https://tapnshow.vercel.app/privacy");
  });
```

(use each file's own render function and fixture; check how the plain-text version renders a `Link` (`toPlainText` shows `text [url]` or `text: url`) and assert that exact form).

Run: `bun run test -- --run src/config/legal src/components/public src/app/login src/emails` → FAIL.

- [ ] **Step 2: Implement**

`messages/en.json`: `Auth.agreement`: `"By continuing you agree to the <terms>Terms</terms> and <privacy>Privacy Policy</privacy> and confirm you're 16 or older."`; `Public.sentWith`: `"Sent with {appName}"`; `Email.privacy`: `"Privacy"`.

`src/config/legal.ts`, add:

```ts
import { SUPABASE_PROJECTS } from "./supabase-projects";

/** The privacy policy's one public address, linked from every email (spec §7.18). */
export const PRIVACY_POLICY_URL = `${SUPABASE_PROJECTS.prod.siteUrl}${LEGAL_LINKS.privacy}`;
```

`src/components/public/legal-line.tsx`:

```tsx
import Link from "next/link";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/config/app";
import { LEGAL_LINKS } from "@/config/legal";

/** Under the token pages' card (spec §7.18): the people a group emails never signed up. */
export function LegalLine() {
  const t = useTranslations("Public");
  return (
    <p className="text-center text-sm text-muted-ink">
      {t("sentWith", { appName: APP_NAME })} ·{" "}
      <Link className="underline underline-offset-4" href={LEGAL_LINKS.privacy}>{t("privacy")}</Link> ·{" "}
      <Link className="underline underline-offset-4" href={LEGAL_LINKS.terms}>{t("terms")}</Link>
    </p>
  );
}
```

`src/components/public/public-page.tsx`: add `legalLine = false` to the props and render `{legalLine ? <LegalLine /> : null}` under the `Card`, inside `<main>`. `src/app/r/[token]/page.tsx`, `u/[token]/page.tsx`, `report/[token]/page.tsx`: `<PublicPage legalLine>`. `src/app/invite/[token]/page.tsx`: add `<LegalLine />` after `<InviteAcceptance />` in its `<main>` (with `gap-4` on the `main`).

`src/app/login/login-screen.tsx`: below the email form card and the Google button (both steps of the screen), add:

```tsx
        <p className="text-center text-sm text-muted-ink">
          {t.rich("agreement", {
            terms: (chunks) => (
              <Link className="underline underline-offset-4" href={LEGAL_LINKS.terms}>
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link className="underline underline-offset-4" href={LEGAL_LINKS.privacy}>
                {chunks}
              </Link>
            ),
          })}
        </p>
```

`src/components/account/legal-links-row.tsx`:

```tsx
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LEGAL_LINKS } from "@/config/legal";

/** Privacy · Terms · Contact at the end of `/account` (spec §7.18). */
export function LegalLinksRow({ contact }: { contact: string }) {
  const t = useTranslations("Public");
  return (
    <nav aria-label={t("footerLabel")} className="flex flex-wrap justify-center gap-x-5 gap-y-2 py-4 text-sm">
      <Link className="underline underline-offset-4" href={LEGAL_LINKS.privacy}>{t("privacy")}</Link>
      <Link className="underline underline-offset-4" href={LEGAL_LINKS.terms}>{t("terms")}</Link>
      <a className="underline underline-offset-4" href={contact}>{t("contact")}</a>
    </nav>
  );
}
```

`src/app/account/page.tsx`: render `<LegalLinksRow contact={contactHref(getServerEnv().SMTP_FROM)} />` after `<AccountView />`.

`src/emails/email-layout.tsx`: the default footer becomes `{tr("footer", { appName: APP_NAME })} <Link href={PRIVACY_POLICY_URL} style={{ color: t.muted, textDecoration: "underline" }}>{tr("privacy")}</Link>`, and a `footer` passed by a caller gets the same link appended after it (`{footer}{" · "}<Link …>`), so every email carries it.

Update the email tests' expected footer text to the new strings (only the footer lines change). Run: `bun run test -- --run src/emails src/server/dispatch src/components src/app` → PASS.

- [ ] **Step 3: e2e, screenshots, the auth templates**

Add to `e2e/legal.spec.ts`:

```ts
test("the sign-in page states the agreement and the age", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText(/confirm you're 16 or older/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

test("a token page carries the legal line", async ({ page }) => {
  await page.goto("/u/not-a-real-token");
  await expect(page.getByText(/Sent with TapNShow/)).toBeVisible();
});
```

Screenshots: `/login` (both steps), an answer page (seeded invite), `/account`, at 390 light, 320 dark and 1024; "Looks right?" before merging. After merging: AskUserQuestion "The sign-in code email now links the privacy policy. May I push the auth templates to both Supabase projects (`bun run auth:config`)?" and run it only on a yes; then send a code to the Owner's test address and check the footer.

- [ ] **Step 4: Chain, commit, PR, merge**

Commit: `feat: Privacy and Terms on sign-in, token pages, account and every email`.
### Task 14: DB: platform admins, admin invites, the platform event log, the owner script

**Issue labels:** `type:task`, `area:db`, `area:auth`. **Branch:** `feat/<issue>-platform-admins`. **Migration:** `supabase migration new m9_platform_admins`.

**Files:**
- Create: `supabase/migrations/<ts>_m9_platform_admins.sql`, `src/server/db/m9-platform-admins.db.test.ts`, `src/test/db/platform.ts`
- Create: `scripts/set-platform-owner.ts`, `scripts/set-platform-owner.test.ts`, `docs/runbooks/platform-admin.md`
- Modify: `src/server/db/function-security.db.test.ts`, `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors.platform_owner`)

**Interfaces:**
- Produces (SQL):
  - Types `public.platform_role` (`owner` | `admin`), `public.platform_event_kind`.
  - Tables `public.platform_admins`, `public.platform_admin_invites`, `public.platform_events` (spec §6 M9).
  - Helpers (no grants): `private.platform_role_of(uuid)`, `private.record_platform_event(kind, workspace, actor, facts) → bigint`.
  - Allowed for `authenticated` (private body + `public` invoker wrapper, each wrapper spending its limit first): `my_platform_role() → text` (null for everyone else), `admin_admins() → jsonb`, `admin_invite(p_email, p_token_hash) → jsonb {id, expires_at}`, `admin_invite_renew(p_invite, p_token_hash) → jsonb {id, email, expires_at}`, `admin_invite_revoke(p_invite) → void`, `admin_remove(p_user) → void`, `consume_admin_invite_email() → boolean`, `admin_invite_preview(p_token_hash) → table(status text, masked_email text)`, `accept_admin_invite(p_token_hash) → void`.
  - `public.set_platform_owner(p_email text, p_replace boolean) → text` (`set` | `unchanged`), executable by nobody through the Data API (the script runs it as `postgres`).
  - `public.delete_account` refuses the platform owner (`tn:platform_owner`).
- Produces (TS): the script `bun scripts/set-platform-owner.ts --email <address> --project local|preview|production [--replace]`; `ownerSql(email, replace)`; error code `platform_owner` (409).
- Task 15 adds the suspension kinds' events, Task 16 the readers of `platform_events`, Task 17 drains it.

**Rulings (copy into the ledger):**
- `abuse_reports.invitee_id` is already `on delete set null` (M6 migration `20261009235635_m6_edit_cancel.sql:1019-1021`, checked 2026-10-15), so reports already survive deleting a cancelled meeting: no change, and the spec line saying M9 changes it is corrected in this plan's PR. `reviewed_at` / `reviewed_by` are added in Task 16 with the reports reader.
- Not-an-admin and not-the-owner both raise `tn:not_found` (the admin area never reveals it exists, spec §7.19).
- The owner script runs SQL as `postgres`: locally through `supabase db query --local`, on hosted projects through the Management API's `database/query` endpoint with the same access token `auth:config` uses. So `set_platform_owner` needs no grant at all, and no service-role key is read from `.env.local`.
- Admin and invite emails in `platform_events.facts` are stored masked (`private.mask_email`), so the log and `#platform` never carry a full address.

- [ ] **Step 1: The failing DB tests**

`src/test/db/platform.ts`:

```ts
import type { TestUser } from "./clients";
import { runLocalSql } from "./sql";

/** Makes `user` the platform owner or an admin directly (test setup; the product uses the script and invites). */
export function makePlatformAdmin(user: TestUser, role: "owner" | "admin" = "admin"): void {
  runLocalSql(
    `insert into public.platform_admins (user_id, role) values ('${user.id}', '${role}')
     on conflict (user_id) do update set role = excluded.role`,
  );
}

/** Removes every platform admin (each test file starts from none). */
export function clearPlatformAdmins(): void {
  runLocalSql("delete from public.platform_admins; delete from public.platform_admin_invites;");
}
```

`src/server/db/m9-platform-admins.db.test.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser } from "@/test/db/clients";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { queryLocalSql } from "@/test/db/sql";

const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const text = z.array(z.object({ result: z.string() })).length(1);

beforeEach(() => clearPlatformAdmins());

describe("set_platform_owner (the script's function)", () => {
  it("needs an existing verified account", async () => {
    expect(() =>
      queryLocalSql(`select public.set_platform_owner('nobody-${crypto.randomUUID()}@example.test', false) as result`, text),
    ).toThrow(/tn:not_found/);
  });

  it("sets the owner once, says unchanged the second time, refuses a second owner without replace", async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    expect(queryLocalSql(`select public.set_platform_owner('${first.email}', false) as result`, text)[0].result).toBe("set");
    expect(queryLocalSql(`select public.set_platform_owner('${first.email.toUpperCase()}', false) as result`, text)[0].result).toBe("unchanged");
    expect(() => queryLocalSql(`select public.set_platform_owner('${second.email}', false) as result`, text)).toThrow(/tn:conflict/);
    expect(queryLocalSql(`select public.set_platform_owner('${second.email}', true) as result`, text)[0].result).toBe("set");
    const roles = queryLocalSql(
      `select role::text as result from public.platform_admins where user_id = '${first.id}'`,
      text,
    );
    expect(roles[0].result).toBe("admin");
    const events = queryLocalSql(
      `select count(*)::text as result from public.platform_events where kind = 'owner_set'`,
      text,
    );
    expect(events[0].result).toBe("2");
  });

  it("is not callable through the Data API by anyone", async () => {
    const user = await createTestUser();
    const { error } = await user.client.rpc("set_platform_owner", { p_email: user.email, p_replace: false });
    expect(error).not.toBeNull();
  });
});

describe("admins and their invites", () => {
  it("only the owner invites; an admin and a stranger get not_found", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const stranger = await createTestUser();
    makePlatformAdmin(owner, "owner");
    makePlatformAdmin(admin, "admin");
    const ok = await owner.client.rpc("admin_invite", { p_email: "NEW@Example.test ", p_token_hash: tokenHash() });
    expect(ok.error).toBeNull();
    for (const user of [admin, stranger]) {
      const refused = await user.client.rpc("admin_invite", { p_email: "x@example.test", p_token_hash: tokenHash() });
      expect(refused.error?.message).toBe("tn:not_found");
    }
  });

  it("accepting needs the invited verified email; then the person is an admin", async () => {
    const owner = await createTestUser();
    const invited = await createTestUser();
    const other = await createTestUser();
    makePlatformAdmin(owner, "owner");
    const hash = tokenHash();
    await owner.client.rpc("admin_invite", { p_email: invited.email, p_token_hash: hash });
    const wrong = await other.client.rpc("admin_invite_preview", { p_token_hash: hash });
    expect(wrong.data?.[0]?.status).toBe("wrong_account");
    expect((await other.client.rpc("accept_admin_invite", { p_token_hash: hash })).error?.message).toBe("tn:invite_wrong_account");
    expect((await invited.client.rpc("accept_admin_invite", { p_token_hash: hash })).error).toBeNull();
    expect((await invited.client.rpc("my_platform_role")).data).toBe("admin");
    const again = await invited.client.rpc("admin_invite_preview", { p_token_hash: hash });
    expect(again.data?.[0]?.status).toBe("used");
  });

  it("revoked and renewed invites behave like workspace invites", async () => {
    const owner = await createTestUser();
    makePlatformAdmin(owner, "owner");
    const hash = tokenHash();
    const created = await owner.client.rpc("admin_invite", { p_email: "r@example.test", p_token_hash: hash });
    const id = (created.data as { id: string }).id;
    const renewedHash = tokenHash();
    expect((await owner.client.rpc("admin_invite_renew", { p_invite: id, p_token_hash: renewedHash })).error).toBeNull();
    expect((await owner.client.rpc("admin_invite_preview", { p_token_hash: hash })).data?.[0]?.status).toBe("not_found");
    expect((await owner.client.rpc("admin_invite_revoke", { p_invite: id })).error).toBeNull();
    expect((await owner.client.rpc("admin_invite_preview", { p_token_hash: renewedHash })).data?.[0]?.status).toBe("revoked");
  });

  it("the owner removes an admin, never the owner; the log masks emails", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    makePlatformAdmin(owner, "owner");
    makePlatformAdmin(admin, "admin");
    expect((await owner.client.rpc("admin_remove", { p_user: owner.id })).error?.message).toBe("tn:forbidden");
    expect((await owner.client.rpc("admin_remove", { p_user: admin.id })).error).toBeNull();
    expect((await admin.client.rpc("my_platform_role")).data).toBeNull();
    const facts = queryLocalSql(
      `select facts::text as result from public.platform_events where kind = 'admin_removed' order by id desc limit 1`,
      text,
    );
    expect(facts[0].result).toContain("•••@");
    expect(facts[0].result).not.toContain(admin.email);
  });

  it("an admin's account deletion removes them; the owner's is refused", async () => {
    const owner = await createTestUser();
    makePlatformAdmin(owner, "owner");
    const refused = await owner.client.rpc("delete_account", { p_confirm: "confirm" });
    expect(refused.error?.message).toBe("tn:platform_owner");
  });

  it("lists admins and open invites for admins only, emails masked", async () => {
    const owner = await createTestUser();
    makePlatformAdmin(owner, "owner");
    await owner.client.rpc("admin_invite", { p_email: "list@example.test", p_token_hash: tokenHash() });
    const { data } = await owner.client.rpc("admin_admins");
    const body = data as { admins: Array<{ role: string; email: string }>; invites: Array<{ email: string }> };
    expect(body.admins.map((admin) => admin.role)).toEqual(["owner"]);
    expect(body.invites[0]?.email).toBe("l•••@example.test");
  });
});
```

Add `"admin_admins", "admin_invite", "admin_invite_preview", "admin_invite_renew", "admin_invite_revoke", "admin_remove", "accept_admin_invite", "consume_admin_invite_email", "my_platform_role", "refuse_platform_owner_deletion"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted).

Run: `bun run test:db -- src/server/db/m9-platform-admins` → FAIL (no tables).

- [ ] **Step 2: The migration**

`supabase/migrations/<ts>_m9_platform_admins.sql`:

```sql
-- M9 (spec §6, §7.19): platform admins, their email-bound invites, and the append-only platform
-- event log that is also the outbox for #platform and Owner emails (drained in Task 17).
create type public.platform_role as enum ('owner', 'admin');
create type public.platform_event_kind as enum (
  'auto_suspended', 'suspended', 'lifted', 'report', 'report_reviewed', 'admin_invited',
  'admin_joined', 'admin_removed', 'invite_revoked', 'owner_set', 'platform_email_cap', 'worker_failing'
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null default 'admin',
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now()
);
create unique index platform_admins_one_owner on public.platform_admins (role) where role = 'owner';
alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from anon, authenticated;

create table public.platform_admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254),
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create unique index platform_admin_invites_one_open on public.platform_admin_invites (email)
  where accepted_at is null and revoked_at is null;
alter table public.platform_admin_invites enable row level security;
revoke all on table public.platform_admin_invites from anon, authenticated;

create table public.platform_events (
  id bigint generated always as identity primary key,
  kind public.platform_event_kind not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  workspace_name text,
  actor_id uuid references auth.users (id) on delete set null,
  facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  notified_at timestamptz,
  notify_attempts integer not null default 0,
  locked_until timestamptz
);
create index platform_events_log_idx on public.platform_events (created_at desc, id desc);
create index platform_events_unsent_idx on public.platform_events (id) where notified_at is null;
alter table public.platform_events enable row level security;
revoke all on table public.platform_events from anon, authenticated;

insert into private.app_limits (name, value) values
  ('admin_writes_per_user_per_hour', 300),
  ('admin_invites_per_user_per_hour', 50),
  ('admin_invite_accepts_per_user_per_hour', 30),
  ('admin_invite_previews_per_user_per_hour', 120),
  ('platform_notify_attempts_max', 5);
```

Then `private.hit_user_rate_limit`: copy **Task 3's** body (`<ts>_m9_write_limits.sql`) and add four `when` lines:

```sql
    when 'admin_write' then 'admin_writes_per_user_per_hour'
    when 'admin_invite' then 'admin_invites_per_user_per_hour'
    when 'admin_invite_accept' then 'admin_invite_accepts_per_user_per_hour'
    when 'admin_invite_preview' then 'admin_invite_previews_per_user_per_hour'
```

The helpers and bodies:

```sql
create function private.platform_role_of(p_user uuid)
returns public.platform_role
language sql
stable
security definer
set search_path = ''
as $$ select a.role from public.platform_admins a where a.user_id = p_user $$;
revoke execute on function private.platform_role_of(uuid) from public, anon, authenticated;

-- Not an admin and not the owner both look like "nothing here" (spec §7.19).
create function private.require_platform_role(p_owner_only boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.platform_role := private.platform_role_of(auth.uid());
begin
  if v_role is null or (p_owner_only and v_role <> 'owner') then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function private.require_platform_role(boolean) from public, anon, authenticated;

-- One log line (and outbox row for #platform). Keeps the workspace's name, so the line survives
-- the workspace being deleted.
create function private.record_platform_event(
  p_kind public.platform_event_kind, p_workspace uuid, p_actor uuid, p_facts jsonb
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_events (kind, workspace_id, workspace_name, actor_id, facts)
  values (p_kind, p_workspace, (select w.name from public.workspaces w where w.id = p_workspace), p_actor, coalesce(p_facts, '{}'::jsonb))
  returning id
$$;
revoke execute on function private.record_platform_event(public.platform_event_kind, uuid, uuid, jsonb) from public, anon, authenticated;

create function private.my_platform_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select private.platform_role_of(auth.uid())::text $$;

create function private.admin_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  return pg_catalog.jsonb_build_object(
    'admins', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'user_id', a.user_id, 'role', a.role, 'name', p.display_name,
          'email', private.mask_email(lower(u.email)), 'since', a.created_at)
        order by (a.role = 'owner') desc, a.created_at)
      from public.platform_admins a
      join auth.users u on u.id = a.user_id
      left join public.profiles p on p.user_id = a.user_id), '[]'::jsonb),
    'invites', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', i.id, 'email', private.mask_email(i.email), 'expires_at', i.expires_at)
        order by i.created_at desc)
      from public.platform_admin_invites i
      where i.accepted_at is null and i.revoked_at is null), '[]'::jsonb)
  );
end;
$$;

create function private.admin_invite(p_email text, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_expires timestamptz := pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'));
begin
  perform private.require_platform_role(true);
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.platform_admins a join auth.users u on u.id = a.user_id where lower(u.email) = v_email) then
    raise exception 'tn:already_member' using errcode = 'P0001';
  end if;
  update public.platform_admin_invites set revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where email = v_email and accepted_at is null and revoked_at is null;
  insert into public.platform_admin_invites (email, token_hash, invited_by, expires_at)
  values (v_email, p_token_hash, auth.uid(), v_expires)
  returning id into v_id;
  perform private.record_platform_event('admin_invited', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_email)));
  return pg_catalog.jsonb_build_object('id', v_id, 'expires_at', v_expires);
end;
$$;

create function private.admin_invite_renew(p_invite uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.platform_admin_invites;
begin
  perform private.require_platform_role(true);
  update public.platform_admin_invites
  set token_hash = p_token_hash, updated_at = pg_catalog.now(),
    expires_at = pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'))
  where id = p_invite and accepted_at is null and revoked_at is null
  returning * into v_invite;
  if v_invite.id is null then
    raise exception 'tn:invite_closed' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('id', v_invite.id, 'email', v_invite.email, 'expires_at', v_invite.expires_at);
end;
$$;

create function private.admin_invite_revoke(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  perform private.require_platform_role(true);
  update public.platform_admin_invites set revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_invite and accepted_at is null and revoked_at is null
  returning email into v_email;
  if v_email is null then
    raise exception 'tn:invite_closed' using errcode = 'P0001';
  end if;
  perform private.record_platform_event('invite_revoked', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_email)));
end;
$$;

create function private.admin_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.platform_role;
  v_email text;
begin
  perform private.require_platform_role(true);
  select a.role, lower(u.email) into v_role, v_email
  from public.platform_admins a join auth.users u on u.id = a.user_id where a.user_id = p_user;
  if v_role is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_role = 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  delete from public.platform_admins where user_id = p_user;
  perform private.record_platform_event('admin_removed', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_email)));
end;
$$;

-- The platform's daily email budget, spent per admin invite email (as for workspace invites).
create function private.consume_admin_invite_email()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(true);
  return private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours');
end;
$$;

create function private.admin_invite_status(p_invite public.platform_admin_invites)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_confirmed_at timestamptz;
begin
  if p_invite.revoked_at is not null then
    return 'revoked';
  end if;
  if private.platform_role_of(auth.uid()) is not null then
    return 'already_admin';
  end if;
  if p_invite.accepted_at is not null then
    return 'used';
  end if;
  if p_invite.expires_at <= pg_catalog.now() then
    return 'expired';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed_at from auth.users u where u.id = auth.uid();
  if v_confirmed_at is null or v_email is distinct from p_invite.email then
    return 'wrong_account';
  end if;
  return 'ready';
end;
$$;
revoke execute on function private.admin_invite_status(public.platform_admin_invites) from public, anon, authenticated;

create function private.admin_invite_preview(p_token_hash text)
returns table (status text, masked_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invite public.platform_admin_invites;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.platform_admin_invites i where i.token_hash = p_token_hash;
  if v_invite.id is null then
    return query select 'not_found'::text, null::text;
    return;
  end if;
  return query select private.admin_invite_status(v_invite), private.mask_email(v_invite.email);
end;
$$;

create function private.accept_admin_invite(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.platform_admin_invites;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.platform_admin_invites i where i.token_hash = p_token_hash for update;
  if v_invite.id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  v_status := private.admin_invite_status(v_invite);
  if v_status = 'already_admin' then
    raise exception 'tn:invite_already_member' using errcode = 'P0001';
  end if;
  if v_status <> 'ready' then
    raise exception '%', 'tn:invite_' || v_status using errcode = 'P0001';
  end if;
  insert into public.platform_admins (user_id, role, added_by) values (auth.uid(), 'admin', v_invite.invited_by);
  update public.platform_admin_invites set accepted_at = pg_catalog.now(), accepted_by = auth.uid(), updated_at = pg_catalog.now()
  where id = v_invite.id;
  perform private.record_platform_event('admin_joined', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_invite.email)));
end;
$$;

-- The owner is set by scripts/set-platform-owner.ts only (never the UI, never a migration: the
-- repo is public). Exactly one owner; --replace turns the old one into an admin.
create function public.set_platform_owner(p_email text, p_replace boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_current uuid;
begin
  select u.id into v_user from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null;
  if v_user is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  select a.user_id into v_current from public.platform_admins a where a.role = 'owner' for update;
  if v_current = v_user then
    return 'unchanged';
  end if;
  if v_current is not null then
    if not coalesce(p_replace, false) then
      raise exception 'tn:conflict' using errcode = 'P0001';
    end if;
    update public.platform_admins set role = 'admin' where user_id = v_current;
  end if;
  insert into public.platform_admins (user_id, role) values (v_user, 'owner')
  on conflict (user_id) do update set role = 'owner';
  perform private.record_platform_event('owner_set', null, null,
    pg_catalog.jsonb_build_object('replaced', v_current is not null));
  return 'set';
end;
$$;
revoke execute on function public.set_platform_owner(text, boolean) from public, anon, authenticated, service_role;

create function private.refuse_platform_owner_deletion()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.platform_role_of(auth.uid()) = 'owner' then
    raise exception 'tn:platform_owner' using errcode = 'P0001';
  end if;
end;
$$;

-- Wrappers: the limit first, then the body.
create function public.my_platform_role() returns text language sql stable security invoker set search_path = ''
as $$ select private.my_platform_role() $$;
create function public.admin_admins() returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_admins() $$;
create function public.admin_invite(p_email text, p_token_hash text) returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite'); select private.admin_invite(p_email, p_token_hash) $$;
create function public.admin_invite_renew(p_invite uuid, p_token_hash text) returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite'); select private.admin_invite_renew(p_invite, p_token_hash) $$;
create function public.admin_invite_revoke(p_invite uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_invite_revoke(p_invite) $$;
create function public.admin_remove(p_user uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_remove(p_user) $$;
create function public.consume_admin_invite_email() returns boolean language sql security invoker set search_path = ''
as $$ select private.consume_admin_invite_email() $$;
create function public.admin_invite_preview(p_token_hash text) returns table (status text, masked_email text)
language sql volatile security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite_preview'); select * from private.admin_invite_preview(p_token_hash) $$;
create function public.accept_admin_invite(p_token_hash text) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite_accept'); select private.accept_admin_invite(p_token_hash) $$;

create or replace function public.delete_account(p_confirm text) returns jsonb language sql security invoker set search_path = ''
as $$ select private.refuse_platform_owner_deletion(); select private.delete_account(p_confirm) $$;

revoke execute on function
  private.my_platform_role(), private.admin_admins(), private.admin_invite(text, text),
  private.admin_invite_renew(uuid, text), private.admin_invite_revoke(uuid), private.admin_remove(uuid),
  private.consume_admin_invite_email(), private.admin_invite_preview(text), private.accept_admin_invite(text),
  private.refuse_platform_owner_deletion(),
  public.my_platform_role(), public.admin_admins(), public.admin_invite(text, text),
  public.admin_invite_renew(uuid, text), public.admin_invite_revoke(uuid), public.admin_remove(uuid),
  public.consume_admin_invite_email(), public.admin_invite_preview(text), public.accept_admin_invite(text)
from public, anon;
grant execute on function
  private.my_platform_role(), private.admin_admins(), private.admin_invite(text, text),
  private.admin_invite_renew(uuid, text), private.admin_invite_revoke(uuid), private.admin_remove(uuid),
  private.consume_admin_invite_email(), private.admin_invite_preview(text), private.accept_admin_invite(text),
  private.refuse_platform_owner_deletion(),
  public.my_platform_role(), public.admin_admins(), public.admin_invite(text, text),
  public.admin_invite_renew(uuid, text), public.admin_invite_revoke(uuid), public.admin_remove(uuid),
  public.consume_admin_invite_email(), public.admin_invite_preview(text), public.accept_admin_invite(text)
to authenticated;
```

(`public.delete_account` returns `jsonb` today, checked 2026-10-15; `create or replace` keeps its grants.) Add `platform_owner` to `API_ERROR_CODES` / `API_ERROR_STATUS` (409) and `messages/en.json` `ApiErrors.platform_owner`: "You run TapNShow's admin area. Hand that role to someone else before deleting your account."

Apply (`supabase db reset --local </dev/null && bun run db:types && supabase db advisors --local </dev/null`), run the Step 1 tests → PASS, then the whole `test:db`.

- [ ] **Step 3: The owner script**

`scripts/set-platform-owner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { maskEmail, ownerSql, parseOwnerArgs } from "./set-platform-owner";

describe("set-platform-owner", () => {
  it("parses the email, the project and --replace", () => {
    expect(parseOwnerArgs(["--email", "Me@Example.com", "--project", "production", "--replace"])).toEqual({
      email: "me@example.com",
      project: "production",
      replace: true,
    });
  });

  it("refuses a malformed email, an unknown project, and an email that could break out of the literal", () => {
    expect(() => parseOwnerArgs(["--email", "nope", "--project", "local"])).toThrow(/email/);
    expect(() => parseOwnerArgs(["--email", "a@b.co", "--project", "staging"])).toThrow(/project/);
    expect(() => parseOwnerArgs(["--email", "a$tn$@b.co", "--project", "local"])).toThrow(/email/);
  });

  it("builds one dollar-quoted call", () => {
    expect(ownerSql("me@example.com", false)).toBe("select public.set_platform_owner($tn$me@example.com$tn$, false) as result");
  });

  it("masks the address in what it prints", () => {
    expect(maskEmail("mohamed@gmail.com")).toBe("m•••@gmail.com");
  });
});
```

`scripts/set-platform-owner.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { SUPABASE_PROJECTS } from "../src/config/supabase-projects";

const PROJECTS = ["local", "preview", "production"] as const;
type Project = (typeof PROJECTS)[number];

/** The script's arguments (spec §7.19): the address is validated before it reaches any SQL. */
export function parseOwnerArgs(argv: string[]): { email: string; project: Project; replace: boolean } {
  const { values } = parseArgs({
    args: argv,
    options: { email: { type: "string" }, project: { type: "string" }, replace: { type: "boolean", default: false } },
  });
  const email = z.email().safeParse((values.email ?? "").trim().toLowerCase());
  if (!email.success || email.data.includes("$")) {
    throw new Error("--email must be a valid address");
  }
  const project = PROJECTS.find((candidate) => candidate === values.project);
  if (!project) {
    throw new Error(`--project must be one of ${PROJECTS.join(", ")}`);
  }
  return { email: email.data, project, replace: values.replace ?? false };
}

/** The one statement the script runs (the address is dollar-quoted; `$` is refused above). */
export function ownerSql(email: string, replace: boolean): string {
  return `select public.set_platform_owner($tn$${email}$tn$, ${replace}) as result`;
}

/** What the script prints instead of the address (the same shape as `private.mask_email`). */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

async function runHosted(ref: string, sql: string): Promise<string> {
  const token =
    process.env.SUPABASE_ACCESS_TOKEN ?? readFileSync(join(homedir(), ".supabase", "access-token"), "utf8").trim();
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(/tn:[a-z_]+/.exec(text)?.[0] ?? `HTTP ${response.status}`);
  }
  return z.array(z.object({ result: z.string() })).parse(JSON.parse(text))[0].result;
}

function runLocal(sql: string): string {
  const output = execFileSync("supabase", ["db", "query", "--local", "--output-format", "json", "--agent", "no", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return z.array(z.object({ result: z.string() })).parse(JSON.parse(output))[0].result;
}

const MESSAGES: Record<string, string> = {
  "tn:not_found": "No verified account has that address. Sign in to TapNShow with it once, then run this again.",
  "tn:conflict": "There is already a platform owner. Run again with --replace to hand the role over (the old owner stays an admin).",
};

if (import.meta.main) {
  const { email, project, replace } = parseOwnerArgs(process.argv.slice(2));
  const sql = ownerSql(email, replace);
  try {
    const result =
      project === "local"
        ? runLocal(sql)
        : await runHosted(SUPABASE_PROJECTS[project === "production" ? "prod" : "preview"].ref, sql);
    process.stdout.write(
      result === "unchanged"
        ? `${maskEmail(email)} is already the platform owner (${project}).\n`
        : `Platform owner set: ${maskEmail(email)} (${project}).\n`,
    );
  } catch (error) {
    const code = error instanceof Error ? (/tn:[a-z_]+/.exec(error.message)?.[0] ?? error.message) : String(error);
    process.stderr.write(`${MESSAGES[code] ?? `Failed: ${code}`}\n`);
    process.exit(1);
  }
}
```

(Check the Management API's response shape for `database/query` on the first hosted run: it returns the rows as a JSON array; if it wraps them, adjust the parse and its test, never the SQL.) `docs/runbooks/platform-admin.md`:

```markdown
# Platform admin runbook (spec §7.19)

## Set the platform owner (once per project; asked first on production)

1. Sign in to TapNShow once with the address (the account must exist and be verified).
2. `bun scripts/set-platform-owner.ts --email <address> --project local|preview|production`
3. It prints the address masked. Running it again changes nothing. Another owner already set:
   add `--replace` (the old owner becomes an admin). Every change is in the Log tab and `#platform`.

The address is never written in the repo, a migration or an issue.

## Add an admin

Admin area → Admins → Add an admin (platform owner only). The invite is email-bound, lasts 7 days,
and needs the invited, verified address to accept.
```

Run: `bun run test -- --run scripts/set-platform-owner` → PASS; locally `bun scripts/set-platform-owner.ts --email <a local test user> --project local` → "Platform owner set: …".

- [ ] **Step 4: Chain, commit, PR, merge, hosted push**

Commit: `feat(db): platform admins, email-bound admin invites, the platform event log and the owner script`. After merging: `bash .superpowers/scripts/hosted-push.sh`. Setting the owner on preview/production waits for Task 21 (asked then).
### Task 15: DB: sending suspensions, the automatic rule, refusing sends, pausing the queue

**Issue labels:** `type:task`, `area:db`, `area:pipeline`. **Branch:** `feat/<issue>-suspension`. **Migration:** `supabase migration new m9_suspension`.

**Files:**
- Create: `supabase/migrations/<ts>_m9_suspension.sql`, `src/server/db/m9-suspension.db.test.ts`, `src/test/db/reports.ts`
- Modify: `src/server/db/function-security.db.test.ts`, `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors.sending_suspended`)

**Interfaces:**
- Consumes: `record_platform_event`, `require_platform_role` (Task 14), `require_user_limit` (Task 3), `makePlatformAdmin` (Task 14).
- Produces:
  - Type `public.suspension_reason` (`auto_reports` | `platform_admin`); table `public.workspace_sending_suspensions` (members of the workspace may SELECT their own rows, RLS).
  - Limits: `suspension_window_days` 7, `suspension_reports_min` 3, `suspension_report_rate_min_bp` 200.
  - `private.workspace_suspended(uuid) → boolean`, `private.open_suspension(workspace, reason, actor, facts) → boolean`, `private.lift_suspension(workspace, actor) → boolean`, `private.assert_meeting_can_send(meeting)`.
  - Wrappers (admin): `public.admin_suspend(p_workspace uuid) → void`, `public.admin_lift(p_workspace uuid) → void`.
  - `public.dispatch_reserve` keeps its signature; it now pauses a suspended workspace's job and answers `{"kind":"gone"}`.
  - `public.record_worker_failure(p_lane text) → void` (service role; at most one event per lane per hour).
  - Error code `sending_suspended` (409).
- Task 16 reads the suspensions; Task 17 shows the banner and drains the events; Task 18's routes call the admin wrappers.

**Rulings (copy into the ledger):**
- `dispatch_reserve` (152 lines) is not copied: the existing function is renamed into `private.dispatch_reserve_unchecked` and a thin `public.dispatch_reserve` checks the suspension first. The check runs right before every send, so a suspension stops the queue within one email, and no claim, resume or fan-out path needs changing: anything resumed or fanned out while suspended is paused again at its reserve.
- An edit of a sent meeting is refused only when it would email someone: the wrapper asks the body for a dry run first (the body already computes who an edit emails).
- A refused send spends no rate-limit unit (the suspension check runs before the limit).
- Reports keep counting while suspended (they are logged and posted), but a second suspension can't open on top of an open one (unique open row + advisory lock per workspace).

- [ ] **Step 1: Test helpers and the failing DB tests**

`src/test/db/reports.ts`:

```ts
import { runLocalSql } from "./sql";

/**
 * Simulates `count` people the workspace emailed in the last week: one finished invite job and its
 * send_log row each (the rule counts distinct people in send_log, spec §7.12).
 */
export function seedEmailedPeople(workspaceId: string, meetingId: string, count: number): void {
  runLocalSql(`
    with people as (
      insert into public.contacts (workspace_id, email, full_name)
      select '${workspaceId}', 'p' || g || '-' || gen_random_uuid() || '@example.test', 'P ' || g
      from generate_series(1, ${count}) g
      returning id
    ), invitees as (
      insert into public.meeting_invitees (workspace_id, meeting_id, contact_id, email_status, sent_at)
      select '${workspaceId}', '${meetingId}', p.id, 'sent', now() from people p
      returning id
    ), jobs as (
      insert into public.outbox_jobs (kind, workspace_id, invitee_id, payload, idempotency_key, status)
      select 'invite', '${workspaceId}', i.id, '{}'::jsonb, 'invite:' || i.id, 'done' from invitees i
      returning id
    )
    insert into public.send_log (google_sub, workspace_id, job_id, sent_at)
    select 'sub-test', '${workspaceId}', j.id, now() from jobs j;
  `);
}

/** One "Not my group" report against the workspace, `ago` before now (as token_unsubscribe writes it). */
export function seedReport(workspaceId: string, ago = "0 minutes"): void {
  runLocalSql(
    `insert into public.abuse_reports (workspace_id, reported_at) values ('${workspaceId}', now() - interval '${ago}')`,
  );
}
```

(Check `meeting_invitees` and `outbox_jobs` required columns against `src/server/db/database.types.ts` and the existing `src/test/db/outbox.ts` / `invitees.ts` helpers; reuse those helpers if they already insert these rows, and adapt the columns, not the meaning.)

`src/server/db/m9-suspension.db.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { seedEmailedPeople, seedReport } from "@/test/db/reports";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const count = z.array(z.object({ n: z.number() })).length(1);
const openSuspensions = (workspaceId: string) =>
  queryLocalSql(
    `select count(*)::int as n from public.workspace_sending_suspensions where workspace_id = '${workspaceId}' and lifted_at is null`,
    count,
  )[0].n;

async function workspaceWithPeople(people: number) {
  const owner = await createTestUser();
  const workspace = await createWorkspaceAs(owner, "Suspension Club");
  const meetingId = await seedMeeting(workspace.id, { status: "scheduled", created_by: owner.id });
  seedEmailedPeople(workspace.id, meetingId, people);
  return { owner, workspace, meetingId };
}

beforeEach(() => clearPlatformAdmins());

describe("automatic suspension (spec §7.12)", () => {
  it("needs both 3 reports and 2% of the people emailed in 7 days", async () => {
    const big = await workspaceWithPeople(200);
    for (let i = 0; i < 3; i += 1) seedReport(big.workspace.id);
    expect(openSuspensions(big.workspace.id)).toBe(0); // 3 / 200 = 1.5%
    seedReport(big.workspace.id);
    expect(openSuspensions(big.workspace.id)).toBe(1); // 4 / 200 = 2%, exactly the threshold
  });

  it("two reports are never enough, whatever the rate", async () => {
    const small = await workspaceWithPeople(5);
    seedReport(small.workspace.id);
    seedReport(small.workspace.id);
    expect(openSuspensions(small.workspace.id)).toBe(0);
  });

  it("ignores reports older than the window and before the last lift", async () => {
    const { workspace } = await workspaceWithPeople(10);
    seedReport(workspace.id, "8 days");
    seedReport(workspace.id, "8 days");
    seedReport(workspace.id);
    expect(openSuspensions(workspace.id)).toBe(0);
    seedReport(workspace.id);
    seedReport(workspace.id);
    expect(openSuspensions(workspace.id)).toBe(1);
    runLocalSql(`select private.lift_suspension('${workspace.id}', null)`);
    seedReport(workspace.id);
    expect(openSuspensions(workspace.id)).toBe(0);
  });

  it("opens one suspension when reports arrive at once", async () => {
    const { workspace } = await workspaceWithPeople(10);
    seedReport(workspace.id);
    seedReport(workspace.id);
    await Promise.all([
      adminClient().from("abuse_reports").insert({ workspace_id: workspace.id }),
      adminClient().from("abuse_reports").insert({ workspace_id: workspace.id }),
    ]);
    expect(openSuspensions(workspace.id)).toBe(1);
  });

  it("logs every report and the suspension, with counts only", async () => {
    const { workspace } = await workspaceWithPeople(10);
    for (let i = 0; i < 3; i += 1) seedReport(workspace.id);
    const events = queryLocalSql(
      `select kind::text as kind, facts::text as facts, workspace_name from public.platform_events where workspace_id = '${workspace.id}' order by id`,
      z.array(z.object({ kind: z.string(), facts: z.string(), workspace_name: z.string() })),
    );
    expect(events.map((event) => event.kind)).toEqual(["report", "report", "report", "auto_suspended"]);
    expect(JSON.parse(events[3].facts)).toEqual({ reports: 3, people: 10 });
    expect(events[3].workspace_name).toBe("Suspension Club");
  });
});

describe("what a suspension does", () => {
  it("pauses the queue at reserve time and resumes it on lift", async () => {
    const { workspace } = await workspaceWithPeople(1);
    runLocalSql(`select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`);
    const job = queryLocalSql(
      `insert into public.outbox_jobs (kind, workspace_id, invitee_id, payload, idempotency_key, status, locked_until)
       select 'reminder', '${workspace.id}', i.id, '{}'::jsonb, 'r:' || gen_random_uuid(), 'processing', now() + interval '1 minute'
       from public.meeting_invitees i where i.workspace_id = '${workspace.id}' limit 1
       returning id::text as id`,
      z.array(z.object({ id: z.string() })).length(1),
    )[0];
    const { data } = await adminClient().rpc("dispatch_reserve", { p_job: job.id });
    expect(data).toEqual({ kind: "gone" });
    const paused = queryLocalSql(
      `select status::text as status, last_error from public.outbox_jobs where id = '${job.id}'`,
      z.array(z.object({ status: z.string(), last_error: z.string() })).length(1),
    )[0];
    expect(paused).toEqual({ status: "paused", last_error: "suspended" });
    runLocalSql(`select private.lift_suspension('${workspace.id}', null)`);
    const resumed = queryLocalSql(
      `select status::text as status from public.outbox_jobs where id = '${job.id}'`,
      z.array(z.object({ status: z.string() })).length(1),
    )[0];
    expect(resumed.status).toBe("pending");
  });

  it("refuses organizers' sends and nudges in plain words, but not members' answers", async () => {
    const { owner, workspace, meetingId } = await workspaceWithPeople(1);
    runLocalSql(`select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`);
    expect((await owner.client.rpc("send_meeting", { p_meeting: meetingId })).error?.message).toBe("tn:sending_suspended");
    expect((await owner.client.rpc("nudge_meeting", { p_meeting: meetingId })).error?.message).toBe("tn:sending_suspended");
  });

  it("lets members of the workspace see that it is suspended, and no one else", async () => {
    const { owner, workspace } = await workspaceWithPeople(1);
    const stranger = await createTestUser();
    runLocalSql(`select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`);
    const mine = await owner.client.from("workspace_sending_suspensions").select("workspace_id").is("lifted_at", null);
    expect(mine.data).toHaveLength(1);
    const theirs = await stranger.client.from("workspace_sending_suspensions").select("workspace_id");
    expect(theirs.data).toEqual([]);
  });
});

describe("admin suspend and lift", () => {
  it("only platform admins; a second suspend is a conflict; each action is logged with its actor", async () => {
    const { owner, workspace } = await workspaceWithPeople(1);
    const admin = await createTestUser();
    makePlatformAdmin(admin);
    expect((await owner.client.rpc("admin_suspend", { p_workspace: workspace.id })).error?.message).toBe("tn:not_found");
    expect((await admin.client.rpc("admin_suspend", { p_workspace: workspace.id })).error).toBeNull();
    expect((await admin.client.rpc("admin_suspend", { p_workspace: workspace.id })).error?.message).toBe("tn:conflict");
    expect((await admin.client.rpc("admin_lift", { p_workspace: workspace.id })).error).toBeNull();
    const kinds = queryLocalSql(
      `select kind::text as kind, actor_id::text as actor from public.platform_events where workspace_id = '${workspace.id}' and kind in ('suspended', 'lifted') order by id`,
      z.array(z.object({ kind: z.string(), actor: z.string() })),
    );
    expect(kinds).toEqual([
      { kind: "suspended", actor: admin.id },
      { kind: "lifted", actor: admin.id },
    ]);
  });
});

describe("platform events from the system", () => {
  it("notes the platform email cap once a day", async () => {
    runLocalSql(`
      delete from private.rate_limit_events where key = 'invite_email:platform';
      delete from public.platform_events where kind = 'platform_email_cap';
      update private.app_limits set value = 2 where name = 'invite_email_platform_per_day';
      select private.hit_rate_limit('invite_email:platform', 2, interval '24 hours');
      select private.hit_rate_limit('invite_email:platform', 2, interval '24 hours');
      select private.hit_rate_limit('invite_email:platform', 2, interval '24 hours');
      update private.app_limits set value = 100 where name = 'invite_email_platform_per_day';`);
    expect(
      queryLocalSql(`select count(*)::int as n from public.platform_events where kind = 'platform_email_cap'`, count)[0].n,
    ).toBe(1);
  });

  it("records a failing worker lane at most once an hour", async () => {
    runLocalSql(`delete from public.platform_events where kind = 'worker_failing'`);
    await adminClient().rpc("record_worker_failure", { p_lane: "emails" });
    await adminClient().rpc("record_worker_failure", { p_lane: "emails" });
    await adminClient().rpc("record_worker_failure", { p_lane: "sheets" });
    expect(
      queryLocalSql(`select count(*)::int as n from public.platform_events where kind = 'worker_failing'`, count)[0].n,
    ).toBe(2);
  });
});
```

(`seedMeeting(workspaceId, overrides)` is the existing helper in `src/test/db/meetings.ts`; it returns the meeting id.) Add `"admin_lift", "admin_suspend", "assert_meeting_can_send"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`.

Run: `bun run test:db -- src/server/db/m9-suspension` → FAIL.

- [ ] **Step 2: The migration**

`supabase/migrations/<ts>_m9_suspension.sql`:

```sql
-- M9 (spec §6, §7.12, §8): a workspace's sending can be suspended, automatically on reports or by a
-- platform admin. A suspension pauses the workspace's queued emails (at their reserve), refuses new
-- sends by organizers, and is logged in platform_events (#platform, the Owner's email).
create type public.suspension_reason as enum ('auto_reports', 'platform_admin');

create table public.workspace_sending_suspensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reason public.suspension_reason not null,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  lifted_at timestamptz,
  lifted_by uuid references auth.users (id) on delete set null
);
create unique index workspace_sending_suspensions_one_open
  on public.workspace_sending_suspensions (workspace_id) where lifted_at is null;
create index workspace_sending_suspensions_history_idx
  on public.workspace_sending_suspensions (workspace_id, created_at desc);
alter table public.workspace_sending_suspensions enable row level security;
revoke all on table public.workspace_sending_suspensions from anon, authenticated;
-- Members see that (and since when) their workspace is suspended; who suspended it stays internal.
grant select (id, workspace_id, reason, created_at, lifted_at) on table public.workspace_sending_suspensions to authenticated;
create policy workspace_sending_suspensions_select_member on public.workspace_sending_suspensions
  for select to authenticated using (private.is_member(workspace_id));

-- The rule counts distinct people emailed per workspace in a window.
create index send_log_workspace_time_idx on public.send_log (workspace_id, sent_at);

insert into private.app_limits (name, value) values
  ('suspension_window_days', 7),
  ('suspension_reports_min', 3),
  ('suspension_report_rate_min_bp', 200);

create function private.workspace_suspended(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_sending_suspensions s where s.workspace_id = p_workspace and s.lifted_at is null)
$$;
revoke execute on function private.workspace_suspended(uuid) from public, anon, authenticated;
grant execute on function private.workspace_suspended(uuid) to service_role;

create function private.open_suspension(
  p_workspace uuid, p_reason public.suspension_reason, p_actor uuid, p_facts jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.workspace_sending_suspensions (workspace_id, reason, created_by)
  values (p_workspace, p_reason, p_actor)
  on conflict (workspace_id) where lifted_at is null do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  update public.outbox_jobs j set status = 'paused', last_error = 'suspended', locked_until = null
  where j.workspace_id = p_workspace and j.status = 'pending' and j.invitee_id is not null;
  perform private.record_platform_event(
    case p_reason when 'auto_reports' then 'auto_suspended'::public.platform_event_kind else 'suspended'::public.platform_event_kind end,
    p_workspace, p_actor, p_facts);
  return true;
end;
$$;
revoke execute on function private.open_suspension(uuid, public.suspension_reason, uuid, jsonb) from public, anon, authenticated;

create function private.lift_suspension(p_workspace uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workspace_sending_suspensions set lifted_at = pg_catalog.now(), lifted_by = p_actor
  where workspace_id = p_workspace and lifted_at is null;
  if not found then
    return false;
  end if;
  -- Resumed jobs go through the normal path: a meeting that started meanwhile fails at its
  -- reserve as today ("meeting started"), so nothing late goes out.
  update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
  where j.workspace_id = p_workspace and j.status = 'paused' and j.last_error = 'suspended';
  perform private.record_platform_event('lifted', p_workspace, p_actor, '{}'::jsonb);
  return true;
end;
$$;
revoke execute on function private.lift_suspension(uuid, uuid) from public, anon, authenticated;

-- After each "Not my group" report (spec §7.12). Counts only; the advisory lock per workspace makes
-- simultaneous reports take turns, and the unique open row keeps it to one suspension.
create function private.check_auto_suspension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := pg_catalog.make_interval(days => private.app_limit('suspension_window_days'));
  v_since timestamptz;
  v_reports integer;
  v_people integer;
  v_facts jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('suspension:' || new.workspace_id::text));
  select greatest(pg_catalog.now() - v_window, coalesce(max(s.lifted_at), '-infinity'::timestamptz)) into v_since
  from public.workspace_sending_suspensions s where s.workspace_id = new.workspace_id;
  select count(*) into v_reports from public.abuse_reports r
  where r.workspace_id = new.workspace_id and r.reported_at > v_since;
  select count(distinct i.contact_id) into v_people
  from public.send_log l
  join public.outbox_jobs j on j.id = l.job_id
  join public.meeting_invitees i on i.id = j.invitee_id
  where l.workspace_id = new.workspace_id and l.sent_at > pg_catalog.now() - v_window;
  v_facts := pg_catalog.jsonb_build_object('reports', v_reports, 'people', v_people);
  perform private.record_platform_event('report', new.workspace_id, null, v_facts);
  if v_reports >= private.app_limit('suspension_reports_min')
     and v_reports * 10000 >= private.app_limit('suspension_report_rate_min_bp') * greatest(v_people, 1) then
    perform private.open_suspension(new.workspace_id, 'auto_reports', null, v_facts);
  end if;
  return null;
end;
$$;
revoke execute on function private.check_auto_suspension() from public, anon, authenticated;
create trigger abuse_reports_auto_suspension after insert on public.abuse_reports
  for each row execute function private.check_auto_suspension();

-- Every send passes here right before Gmail: a suspended workspace's job pauses ("gone" to the
-- dispatcher, which moves on). The body is unchanged, only renamed.
alter function public.dispatch_reserve(uuid, text) rename to dispatch_reserve_unchecked;
alter function public.dispatch_reserve_unchecked(uuid, text) set schema private;
create function public.dispatch_reserve(p_job uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.outbox_jobs j set status = 'paused', last_error = 'suspended', locked_until = null
  where j.id = p_job and j.status = 'processing' and private.workspace_suspended(j.workspace_id);
  if found then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;
  return private.dispatch_reserve_unchecked(p_job, p_token_hash);
end;
$$;
revoke execute on function public.dispatch_reserve(uuid, text) from public, anon, authenticated;
grant execute on function public.dispatch_reserve(uuid, text) to service_role;

create function private.assert_meeting_can_send(p_meeting uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.meetings m
    join public.workspace_sending_suspensions s on s.workspace_id = m.workspace_id and s.lifted_at is null
    where m.id = p_meeting
  ) then
    raise exception 'tn:sending_suspended' using errcode = 'P0001';
  end if;
end;
$$;

-- Copied from Task 3 (<ts>_m9_write_limits.sql); the suspension check comes before the limit.
create or replace function public.send_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.assert_meeting_can_send(p_meeting); select private.require_user_limit('meeting_send'); select private.send_meeting(p_meeting) $$;
create or replace function public.nudge_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.assert_meeting_can_send(p_meeting); select private.require_user_limit('meeting_nudge'); select private.nudge_meeting(p_meeting) $$;

-- An edit is refused only when it would email someone (the body's dry run says how many).
create or replace function public.edit_sent_meeting(p_meeting uuid, p_fields jsonb, p_notify boolean, p_dry_run boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_preview jsonb;
begin
  if not coalesce(p_dry_run, false) and private.workspace_suspended((select m.workspace_id from public.meetings m where m.id = p_meeting)) then
    v_preview := private.edit_sent_meeting(p_meeting, p_fields, p_notify, true);
    if coalesce((v_preview ->> 'emails')::integer, 0) + coalesce((v_preview ->> 'calendar_only')::integer, 0) > 0 then
      raise exception 'tn:sending_suspended' using errcode = 'P0001';
    end if;
  end if;
  return private.edit_sent_meeting(p_meeting, p_fields, p_notify, p_dry_run);
end;
$$;

-- The platform's daily email cap reached: one event a day (spec §7.19 Needs attention).
create function private.note_platform_email_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer := private.app_limit('invite_email_platform_per_day');
begin
  if (select count(*) from private.rate_limit_events e
      where e.key = 'invite_email:platform' and e.occurred_at > pg_catalog.now() - interval '24 hours') >= v_cap
     and not exists (select 1 from public.platform_events p
      where p.kind = 'platform_email_cap' and p.created_at > pg_catalog.now() - interval '24 hours') then
    perform private.record_platform_event('platform_email_cap', null, null, pg_catalog.jsonb_build_object('cap', v_cap));
  end if;
  return null;
end;
$$;
revoke execute on function private.note_platform_email_cap() from public, anon, authenticated;
create trigger rate_limit_events_platform_cap after insert on private.rate_limit_events
  for each row when (new.key = 'invite_email:platform') execute function private.note_platform_email_cap();

-- A worker lane crashed (the internal route's after() work): at most one event per lane per hour.
create function private.record_worker_failure(p_lane text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lane not in ('emails', 'sheets', 'push', 'platform') then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('worker_failing:' || p_lane));
  if not exists (select 1 from public.platform_events e
      where e.kind = 'worker_failing' and e.facts ->> 'lane' = p_lane and e.created_at > pg_catalog.now() - interval '1 hour') then
    perform private.record_platform_event('worker_failing', null, null, pg_catalog.jsonb_build_object('lane', p_lane));
  end if;
end;
$$;
create function public.record_worker_failure(p_lane text) returns void language sql security invoker set search_path = ''
as $$ select private.record_worker_failure(p_lane) $$;
revoke execute on function private.record_worker_failure(text), public.record_worker_failure(text) from public, anon, authenticated;
grant execute on function private.record_worker_failure(text), public.record_worker_failure(text) to service_role;

-- Platform admins suspend and lift by hand (confirm dialogs in the UI).
create function private.admin_suspend(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  if not exists (select 1 from public.workspaces w where w.id = p_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('suspension:' || p_workspace::text));
  if not private.open_suspension(p_workspace, 'platform_admin', auth.uid(), '{}'::jsonb) then
    raise exception 'tn:conflict' using errcode = 'P0001';
  end if;
end;
$$;
create function private.admin_lift(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('suspension:' || p_workspace::text));
  if not private.lift_suspension(p_workspace, auth.uid()) then
    raise exception 'tn:conflict' using errcode = 'P0001';
  end if;
end;
$$;
create function public.admin_suspend(p_workspace uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_suspend(p_workspace) $$;
create function public.admin_lift(p_workspace uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_lift(p_workspace) $$;
revoke execute on function private.admin_suspend(uuid), private.admin_lift(uuid), private.assert_meeting_can_send(uuid),
  public.admin_suspend(uuid), public.admin_lift(uuid) from public, anon;
grant execute on function private.admin_suspend(uuid), private.admin_lift(uuid), private.assert_meeting_can_send(uuid),
  public.admin_suspend(uuid), public.admin_lift(uuid) to authenticated;
```

Then `private.workers_due()`: copy its body from `20261014160152_m8_push.sql` and add, after the push clause:

```sql
    -- A platform event waits for #platform or the Owner's email (spec §8 M9).
    or exists (
      select 1 from public.platform_events e
      where e.notified_at is null and (e.locked_until is null or e.locked_until < pg_catalog.now()))
```

`src/shared/api/errors.ts`: add `"sending_suspended"` (409); `messages/en.json` `ApiErrors.sending_suspended`: "Sending is paused while TapNShow reviews reports about this workspace."

Apply, regenerate types, advisors; run the Step 1 tests and then the whole `test:db` (the dispatcher DB tests prove `dispatch_reserve` is unchanged for workspaces that aren't suspended).

- [ ] **Step 3: Chain, commit, PR, merge, hosted push**

Commit: `feat(db): sending suspensions — the automatic rule, admin suspend and lift, sends refused, the queue paused at reserve`. After merging: `bash .superpowers/scripts/hosted-push.sh`.
### Task 16: DB: the daily rollup, push counters, and the admin area's read functions

**Issue labels:** `type:task`, `area:db`. **Branch:** `feat/<issue>-admin-reads`. **Migration:** `supabase migration new m9_admin_reads`.

**Files:**
- Create: `supabase/migrations/<ts>_m9_admin_reads.sql`, `src/server/db/m9-admin-reads.db.test.ts`, `src/server/db/m9-admin-reads-plans.db.test.ts`
- Modify: `src/server/db/function-security.db.test.ts`

**Interfaces:**
- Consumes: `require_platform_role`, `record_platform_event` (Task 14), the suspensions (Task 15), `withLimit`, `makePlatformAdmin`, `seedEmailedPeople`, `seedReport`.
- Produces (all `private` definer bodies behind `public` invoker wrappers granted to `authenticated`, each refusing non-admins with `tn:not_found`). JSON keys are snake_case; Task 18's Zod schemas parse exactly these:
  - `admin_overview(p_days integer) → jsonb`:
    `{ attention: { new_reports, open_suspensions: [{ workspace_id, workspace_name, reason, created_at }], platform_email_used, platform_email_cap }, current: Figures, previous: Figures, weekly: [{ week, meetings }], health: { queue_waiting, queue_oldest, sheets_paused, sheets_total, senders_broken } }`
    where `Figures = { workspaces_total, workspaces_new, active_workspaces, meetings_sent, emails_sent, emails_failed, answers_rate_bp, accounts_total, accounts_new, pushes_sent, pushes_failed }`.
  - `admin_workspaces(p_search text, p_filter text, p_sort text, p_after_value text, p_after_id uuid, p_limit integer) → jsonb` `{ items: [WorkspaceRow] }` with `WorkspaceRow = { id, name, slug, created_at, owner_email, team, contacts, meetings_30d, emails_30d, failed_30d, reports_7d, people_7d, suspended, sender, sheet, sort_value }` (`p_filter`: `all` | `suspended` | `reported` | `no_sender`; `p_sort`: `newest` | `reports` | `emails`; `sender`: `none` | `active` | `broken`; `sheet`: `off` | `on` | `paused`; `owner_email` masked).
  - `admin_workspace(p_workspace uuid) → jsonb` `{ id, name, slug, created_at, owner_name, owner_email, team: { owner, admin, viewer }, contacts, sender, sheet, suspended, last_30: { meetings_sent, emails_sent, emails_failed, reports, unsubscribes }, reports_7d, people_7d, suspensions: [{ id, reason, created_at, created_by_name, lifted_at, lifted_by_name }] }` (`owner_email` in full: the detail page's **Copy Owner email**).
  - `admin_reports(p_after_at timestamptz, p_after_id uuid, p_limit integer) → jsonb` `{ items: [{ id, workspace_id, workspace_name, reported_at, reviewed_at, reviewed_by_name, reports_7d, people_7d }] }`.
  - `admin_mark_reviewed(p_report uuid) → void` (logs `report_reviewed`).
  - `admin_log(p_filter text, p_after_id bigint, p_limit integer) → jsonb` `{ items: [{ id, kind, workspace_id, workspace_name, actor_name, facts, created_at }] }` (`p_filter`: `all` | `suspensions` | `admins`).
- Table `public.platform_daily` and `private.rollup_platform_daily()`; `abuse_reports.reviewed_at`, `reviewed_by`.
- The paged readers accept `p_limit` up to 101: routes ask for one row more than the page (`PAGE_SIZE_MAX` 100 + 1) to know whether there is a next page (`toPage`).

**Rulings (copy into the ledger):**
- `platform_daily` keeps only what the database deletes after 30 days: emails sent and failed, people emailed, pushes sent and failed. Meetings sent, reports, unsubscribes, accounts and answers live in tables that are never purged and are counted directly (the spec listed them in the rollup too: YAGNI).
- The rollup recomputes **the last 29 full days** on every run (an idempotent upsert): a missed housekeeping run is filled by the next one, and nothing older than the 30-day purge is ever recomputed from partial data.
- A deleted workspace's rollup rows go with it (`on delete cascade`), like the rest of its data (spec §7.11); platform trends then exclude it.
- Days are UTC days. The weekly chart is the last 12 ISO weeks.
- `admin_workspaces` computes each workspace's figures with one grouped aggregate per table, then filters, sorts and pages by keyset (`sort_value`, `id`). Its plan test seeds 200 workspaces with 200 contacts and 100 emails each (40k contacts, 20k sends), a realistic first year; the spec's "200 × 2,000" would need 400k contacts per test run.

- [ ] **Step 1: The failing DB tests (behaviour)**

`src/server/db/m9-admin-reads.db.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { seedEmailedPeople, seedReport } from "@/test/db/reports";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

beforeEach(() => clearPlatformAdmins());

async function adminAndWorkspace(name: string, people: number) {
  const admin = await createTestUser();
  makePlatformAdmin(admin);
  const owner = await createTestUser({ fullName: "Owner Person" });
  const workspace = await createWorkspaceAs(owner, name);
  const meetingId = await seedMeeting(workspace.id, { status: "scheduled", created_by: owner.id });
  seedEmailedPeople(workspace.id, meetingId, people);
  return { admin, owner, workspace };
}

describe("admin reads are for platform admins only", () => {
  it.each([
    ["admin_overview", { p_days: 30 }],
    ["admin_workspaces", { p_search: null, p_filter: "all", p_sort: "newest", p_after_value: null, p_after_id: null, p_limit: 25 }],
    ["admin_reports", { p_after_at: null, p_after_id: null, p_limit: 25 }],
    ["admin_log", { p_filter: "all", p_after_id: null, p_limit: 25 }],
  ] as const)("%s refuses a workspace Owner with not_found", async (fn, args) => {
    const owner = await createTestUser();
    const { error } = await owner.client.rpc(fn, args);
    expect(error?.message).toBe("tn:not_found");
  });
});

describe("admin_workspaces", () => {
  it("lists health per workspace, never contact names or emails, masked Owner email", async () => {
    const { admin, owner, workspace } = await adminAndWorkspace("Health Club", 10);
    seedReport(workspace.id);
    const { data, error } = await admin.client.rpc("admin_workspaces", {
      p_search: "health", p_filter: "reported", p_sort: "reports", p_after_value: null, p_after_id: null, p_limit: 25,
    });
    expect(error).toBeNull();
    const row = (data as { items: Array<Record<string, string | number | boolean>> }).items.find((item) => item.id === workspace.id);
    expect(row).toMatchObject({ name: "Health Club", team: 1, emails_30d: 10, reports_7d: 1, people_7d: 10, suspended: false, sender: "none", sheet: "off" });
    expect(String(row?.owner_email)).toMatch(/^.•••@example\.test$/);
    expect(JSON.stringify(data)).not.toMatch(/p\d+-.*@example\.test/);
    expect(owner.email).not.toBe(row?.owner_email);
  });

  it("pages by keyset with no duplicates or gaps", async () => {
    const admin = await createTestUser();
    makePlatformAdmin(admin);
    const owner = await createTestUser();
    for (let i = 0; i < 5; i += 1) await createWorkspaceAs(owner, `Paging ${i}`);
    const seen: string[] = [];
    let after: { value: string | null; id: string | null } = { value: null, id: null };
    for (let page = 0; page < 10; page += 1) {
      const { data } = await admin.client.rpc("admin_workspaces", {
        p_search: "paging", p_filter: "all", p_sort: "newest", p_after_value: after.value, p_after_id: after.id, p_limit: 2,
      });
      const items = (data as { items: Array<{ id: string; sort_value: string }> }).items;
      if (items.length === 0) break;
      seen.push(...items.map((item) => item.id));
      const last = items.at(-1)!;
      after = { value: last.sort_value, id: last.id };
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});

describe("admin_workspace, reports and the log", () => {
  it("shows the full Owner email for copying, the 30-day figures and the suspension history", async () => {
    const { admin, owner, workspace } = await adminAndWorkspace("Detail Club", 4);
    await admin.client.rpc("admin_suspend", { p_workspace: workspace.id });
    await admin.client.rpc("admin_lift", { p_workspace: workspace.id });
    const { data } = await admin.client.rpc("admin_workspace", { p_workspace: workspace.id });
    const detail = data as Record<string, unknown> & { suspensions: Array<{ reason: string; lifted_at: string | null }> };
    expect(detail.owner_email).toBe(owner.email);
    expect(detail.last_30).toMatchObject({ emails_sent: 4 });
    expect(detail.suspensions).toHaveLength(1);
    expect(detail.suspensions[0].reason).toBe("platform_admin");
    expect(detail.suspensions[0].lifted_at).not.toBeNull();
  });

  it("marks a report reviewed once, logged with the reviewer", async () => {
    const { admin, workspace } = await adminAndWorkspace("Report Club", 3);
    seedReport(workspace.id);
    const { data } = await admin.client.rpc("admin_reports", { p_after_at: null, p_after_id: null, p_limit: 25 });
    const report = (data as { items: Array<{ id: string; workspace_id: string; reviewed_at: string | null }> }).items.find(
      (item) => item.workspace_id === workspace.id,
    )!;
    expect(report.reviewed_at).toBeNull();
    expect((await admin.client.rpc("admin_mark_reviewed", { p_report: report.id })).error).toBeNull();
    expect((await admin.client.rpc("admin_mark_reviewed", { p_report: report.id })).error).toBeNull();
    const reviewed = queryLocalSql(
      `select count(*)::int as n from public.platform_events where kind = 'report_reviewed' and workspace_id = '${workspace.id}'`,
      z.array(z.object({ n: z.number() })).length(1),
    );
    expect(reviewed[0].n).toBe(1);
  });

  it("filters the log and names the actor", async () => {
    const { admin, workspace } = await adminAndWorkspace("Log Club", 1);
    await admin.client.rpc("admin_suspend", { p_workspace: workspace.id });
    const { data } = await admin.client.rpc("admin_log", { p_filter: "suspensions", p_after_id: null, p_limit: 25 });
    const items = (data as { items: Array<{ kind: string; workspace_name: string }> }).items;
    expect(items.every((item) => ["auto_suspended", "suspended", "lifted"].includes(item.kind))).toBe(true);
    expect(items[0]).toMatchObject({ kind: "suspended", workspace_name: "Log Club" });
  });
});

describe("edges (Review Focus 3 and 4)", () => {
  it("never counts an email twice across midnight UTC (rolled yesterday + live today)", async () => {
    const { admin, workspace } = await adminAndWorkspace("Midnight Club", 2);
    runLocalSql(`
      with rows as (select id, row_number() over (order by id) as n from public.send_log where workspace_id = '${workspace.id}')
      update public.send_log l set sent_at = case when r.n = 1
          then date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '1 minute'
          else date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 minute' end
      from rows r where r.id = l.id;
      select private.rollup_platform_daily();`);
    const { data } = await admin.client.rpc("admin_workspace", { p_workspace: workspace.id });
    expect((data as { last_30: { emails_sent: number } }).last_30.emails_sent).toBe(2);
  });

  it("keeps a deleted workspace's events in the log by name, and its page is not found", async () => {
    const { admin, owner, workspace } = await adminAndWorkspace("Gone Club", 1);
    await admin.client.rpc("admin_suspend", { p_workspace: workspace.id });
    const deleted = await owner.client.rpc("delete_workspace", { p_workspace: workspace.id, p_confirm_name: "Gone Club" });
    expect(deleted.error).toBeNull();
    const { data } = await admin.client.rpc("admin_log", { p_filter: "suspensions", p_after_id: null, p_limit: 25 });
    const item = (data as { items: Array<{ workspace_id: string | null; workspace_name: string }> }).items.find(
      (entry) => entry.workspace_name === "Gone Club",
    );
    expect(item?.workspace_id).toBeNull();
    expect((await admin.client.rpc("admin_workspace", { p_workspace: workspace.id })).error?.message).toBe("tn:not_found");
  });
});

describe("rollup and overview", () => {
  it("rolls up the last 29 days idempotently and keeps the push counters", async () => {
    const { admin, workspace } = await adminAndWorkspace("Rollup Club", 3);
    runLocalSql(`update public.send_log set sent_at = now() - interval '2 days' where workspace_id = '${workspace.id}'`);
    runLocalSql(`insert into public.platform_daily (day, workspace_id, pushes_sent) values ((now() - interval '2 days')::date, '${workspace.id}', 7)`);
    runLocalSql(`select private.rollup_platform_daily(); select private.rollup_platform_daily();`);
    const row = queryLocalSql(
      `select emails_sent, people_emailed, pushes_sent from public.platform_daily where workspace_id = '${workspace.id}' and day = (now() - interval '2 days')::date`,
      z.array(z.object({ emails_sent: z.number(), people_emailed: z.number(), pushes_sent: z.number() })).length(1),
    );
    expect(row[0]).toEqual({ emails_sent: 3, people_emailed: 3, pushes_sent: 7 });
    const { data } = await admin.client.rpc("admin_overview", { p_days: 7 });
    const overview = data as { current: { emails_sent: number; pushes_sent: number }; weekly: unknown[] };
    expect(overview.current.emails_sent).toBeGreaterThanOrEqual(3);
    expect(overview.weekly).toHaveLength(12);
  });
});
```

Add `"admin_mark_reviewed", "admin_log", "admin_overview", "admin_reports", "admin_workspace", "admin_workspaces"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`.

Run: `bun run test:db -- src/server/db/m9-admin-reads` → FAIL.

- [ ] **Step 2: The migration**

`supabase/migrations/<ts>_m9_admin_reads.sql`:

```sql
-- M9 (spec §6 platform_daily, §7.19, §8 Daily rollup): what the admin area reads.

alter table public.abuse_reports
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users (id) on delete set null;
create index abuse_reports_page_idx on public.abuse_reports (reported_at desc, id desc);
create index meetings_sent_at_idx on public.meetings (sent_at) where sent_at is not null;
create index outbox_jobs_failed_idx on public.outbox_jobs (updated_at) where status = 'failed';

-- Counts the database would otherwise lose after 30 days (send_log, finished jobs, push rows).
create table public.platform_daily (
  day date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  emails_sent integer not null default 0,
  emails_failed integer not null default 0,
  people_emailed integer not null default 0,
  pushes_sent integer not null default 0,
  pushes_failed integer not null default 0,
  primary key (day, workspace_id)
);
create index platform_daily_workspace_idx on public.platform_daily (workspace_id, day);
alter table public.platform_daily enable row level security;
revoke all on table public.platform_daily from anon, authenticated;

-- Recomputes the email columns of the last 29 full UTC days (idempotent; push columns untouched).
create function private.rollup_platform_daily()
returns void
language sql
security definer
set search_path = ''
as $$
  with sends as (
    select (l.sent_at at time zone 'UTC')::date as day, l.workspace_id, count(*) as sent,
      count(distinct i.contact_id) as people
    from public.send_log l
    left join public.outbox_jobs j on j.id = l.job_id
    left join public.meeting_invitees i on i.id = j.invitee_id
    where l.workspace_id is not null
      and l.sent_at >= ((pg_catalog.now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC'
      and l.sent_at < ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'
    group by 1, 2
  ), failures as (
    select (j.updated_at at time zone 'UTC')::date as day, j.workspace_id, count(*) as failed
    from public.outbox_jobs j
    where j.status = 'failed' and j.invitee_id is not null
      and j.updated_at >= ((pg_catalog.now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC'
      and j.updated_at < ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'
    group by 1, 2
  )
  insert into public.platform_daily (day, workspace_id, emails_sent, emails_failed, people_emailed)
  select coalesce(s.day, f.day), coalesce(s.workspace_id, f.workspace_id), coalesce(s.sent, 0), coalesce(f.failed, 0), coalesce(s.people, 0)
  from sends s full join failures f on f.day = s.day and f.workspace_id = s.workspace_id
  where exists (select 1 from public.workspaces w where w.id = coalesce(s.workspace_id, f.workspace_id))
  on conflict (day, workspace_id) do update
    set emails_sent = excluded.emails_sent, emails_failed = excluded.emails_failed, people_emailed = excluded.people_emailed
$$;
revoke execute on function private.rollup_platform_daily() from public, anon, authenticated;

-- One push counted on today's row of its workspace (push rows are deleted once handled). Only a
-- delivery this run still holds is counted, so a lost lease never counts twice.
create function private.count_push(p_delivery uuid, p_run uuid, p_sent boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_daily (day, workspace_id, pushes_sent, pushes_failed)
  select (pg_catalog.now() at time zone 'UTC')::date, i.workspace_id, case when p_sent then 1 else 0 end, case when p_sent then 0 else 1 end
  from public.push_deliveries d join public.meeting_invitees i on i.id = d.invitee_id
  where d.id = p_delivery and d.run_id = p_run
  on conflict (day, workspace_id) do update
    set pushes_sent = public.platform_daily.pushes_sent + excluded.pushes_sent,
        pushes_failed = public.platform_daily.pushes_failed + excluded.pushes_failed
$$;
revoke execute on function private.count_push(uuid, uuid, boolean) from public, anon, authenticated;

-- Copied from 20261014160152_m8_push.sql; each counts its delivery first (spec §8 Daily rollup).
create or replace function private.push_done(p_delivery uuid, p_run uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription uuid;
begin
  perform private.count_push(p_delivery, p_run, true);
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
  returning d.subscription_id into v_subscription;
  if v_subscription is null then
    return false;
  end if;
  update public.push_subscriptions set last_success_at = pg_catalog.now() where id = v_subscription;
  return true;
end;
$$;

create or replace function private.push_drop(p_delivery uuid, p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.count_push(p_delivery, p_run, false);
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
$$;
```


`private.housekeeping()`: copy its body from `20261014221206_m8_review_fixes.sql` and add as its **first** statement:

```sql
  -- Before the 30-day purge below (spec §8 Daily rollup).
  perform private.rollup_platform_daily();
```

The readers:

```sql
create function private.admin_figures(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC' as start),
  rolled as (
    select coalesce(sum(d.emails_sent), 0) as sent, coalesce(sum(d.emails_failed), 0) as failed,
      coalesce(sum(d.pushes_sent), 0) as pushes_sent, coalesce(sum(d.pushes_failed), 0) as pushes_failed
    from public.platform_daily d
    where d.day >= (p_from at time zone 'UTC')::date and d.day <= (p_to at time zone 'UTC')::date
  ),
  live as (
    select
      (select count(*) from public.send_log l, today t where l.sent_at >= greatest(p_from, t.start) and l.sent_at < p_to) as sent,
      (select count(*) from public.outbox_jobs j, today t where j.status = 'failed' and j.invitee_id is not null
         and j.updated_at >= greatest(p_from, t.start) and j.updated_at < p_to) as failed
  ),
  answered as (
    select count(*) as invited, count(r.id) filter (where r.responded_at <= m.starts_at) as answered
    from public.meetings m
    join public.meeting_invitees i on i.meeting_id = m.id and i.email_status = 'sent'
    left join public.responses r on r.invitee_id = i.id
    where m.response_mode <> 'announcement' and m.status = 'scheduled'
      and m.starts_at >= p_from and m.starts_at < least(p_to, pg_catalog.now())
  )
  select pg_catalog.jsonb_build_object(
    'workspaces_total', (select count(*) from public.workspaces w where w.created_at < p_to),
    'workspaces_new', (select count(*) from public.workspaces w where w.created_at >= p_from and w.created_at < p_to),
    'active_workspaces', (select count(distinct m.workspace_id) from public.meetings m where m.sent_at >= p_from and m.sent_at < p_to),
    'meetings_sent', (select count(*) from public.meetings m where m.sent_at >= p_from and m.sent_at < p_to),
    'emails_sent', (select rolled.sent from rolled) + (select live.sent from live),
    'emails_failed', (select rolled.failed from rolled) + (select live.failed from live),
    'answers_rate_bp', (select case when a.invited = 0 then null else (a.answered * 10000 / a.invited) end from answered a),
    'accounts_total', (select count(*) from auth.users u where u.created_at < p_to),
    'accounts_new', (select count(*) from auth.users u where u.created_at >= p_from and u.created_at < p_to),
    'pushes_sent', (select rolled.pushes_sent from rolled),
    'pushes_failed', (select rolled.pushes_failed from rolled)
  )
$$;
revoke execute on function private.admin_figures(timestamptz, timestamptz) from public, anon, authenticated;

create function private.admin_overview(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to timestamptz := pg_catalog.now();
  v_span interval;
begin
  perform private.require_platform_role(false);
  if p_days not in (7, 30, 90) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  v_span := pg_catalog.make_interval(days => p_days);
  return pg_catalog.jsonb_build_object(
    'attention', pg_catalog.jsonb_build_object(
      'new_reports', (select count(*) from public.abuse_reports r where r.reviewed_at is null),
      'open_suspensions', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'workspace_id', s.workspace_id, 'workspace_name', w.name, 'reason', s.reason, 'created_at', s.created_at)
          order by s.created_at desc)
        from public.workspace_sending_suspensions s join public.workspaces w on w.id = s.workspace_id
        where s.lifted_at is null), '[]'::jsonb),
      'platform_email_used', (select count(*) from private.rate_limit_events e
        where e.key = 'invite_email:platform' and e.occurred_at > v_to - interval '24 hours'),
      'platform_email_cap', private.app_limit('invite_email_platform_per_day')
    ),
    'current', private.admin_figures(v_to - v_span, v_to),
    'previous', private.admin_figures(v_to - 2 * v_span, v_to - v_span),
    'weekly', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('week', g.week, 'meetings', coalesce(c.meetings, 0)) order by g.week)
      from pg_catalog.generate_series(
          pg_catalog.date_trunc('week', v_to at time zone 'UTC') - interval '11 weeks',
          pg_catalog.date_trunc('week', v_to at time zone 'UTC'), interval '1 week') as g(week)
      left join (
        select pg_catalog.date_trunc('week', m.sent_at at time zone 'UTC') as week, count(*) as meetings
        from public.meetings m
        where m.sent_at >= (pg_catalog.date_trunc('week', v_to at time zone 'UTC') - interval '11 weeks') at time zone 'UTC'
        group by 1
      ) c on c.week = g.week
    ),
    'health', pg_catalog.jsonb_build_object(
      'queue_waiting', (select count(*) from public.outbox_jobs j where j.status = 'pending' and j.run_after <= v_to),
      'queue_oldest', (select min(j.run_after) from public.outbox_jobs j where j.status = 'pending' and j.run_after <= v_to),
      'sheets_paused', (select count(*) from public.sheet_syncs s where s.status = 'paused'),
      'sheets_total', (select count(*) from public.sheet_syncs s),
      'senders_broken', (select count(*) from public.workspaces w join public.google_connections c on c.id = w.sender_connection_id where c.status = 'broken')
    )
  );
end;
$$;

create function private.admin_workspace_rows()
returns table (
  id uuid, name text, slug text, created_at timestamptz, owner_email text, owner_name text, team integer,
  contacts integer, meetings_30d integer, emails_30d integer, failed_30d integer, reports_7d integer,
  people_7d integer, suspended boolean, sender text, sheet text, has_sender boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with window_7 as (select pg_catalog.now() - pg_catalog.make_interval(days => private.app_limit('suspension_window_days')) as since),
  owners as (
    select r.workspace_id, lower(u.email) as email, p.display_name
    from public.workspace_roles r join auth.users u on u.id = r.user_id left join public.profiles p on p.user_id = r.user_id
    where r.role = 'owner'
  ),
  team as (select r.workspace_id, count(*)::integer as n from public.workspace_roles r group by 1),
  people as (select c.workspace_id, count(*)::integer as n from public.contacts c where not c.is_adhoc group by 1),
  meetings as (select m.workspace_id, count(*)::integer as n from public.meetings m
    where m.sent_at >= pg_catalog.now() - interval '30 days' group by 1),
  emails as (select d.workspace_id, sum(d.emails_sent)::integer as sent, sum(d.emails_failed)::integer as failed
    from public.platform_daily d where d.day >= (pg_catalog.now() at time zone 'UTC')::date - 30 group by 1),
  emails_today as (select l.workspace_id, count(*)::integer as sent from public.send_log l
    where l.sent_at >= ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC' group by 1),
  reports as (select r.workspace_id, count(*)::integer as n from public.abuse_reports r, window_7 w where r.reported_at > w.since group by 1),
  emailed as (
    select l.workspace_id, count(distinct i.contact_id)::integer as n
    from public.send_log l join public.outbox_jobs j on j.id = l.job_id join public.meeting_invitees i on i.id = j.invitee_id, window_7 w
    where l.sent_at > w.since group by 1
  )
  select w.id, w.name, w.slug, w.created_at, o.email, o.display_name, coalesce(t.n, 0), coalesce(pp.n, 0), coalesce(mt.n, 0),
    coalesce(e.sent, 0) + coalesce(et.sent, 0), coalesce(e.failed, 0), coalesce(rp.n, 0), coalesce(em.n, 0),
    private.workspace_suspended(w.id),
    case when c.id is null then 'none' when c.status = 'active' then 'active' else 'broken' end,
    case when s.workspace_id is null then 'off' when s.status = 'paused' then 'paused' else 'on' end,
    w.sender_connection_id is not null
  from public.workspaces w
  left join owners o on o.workspace_id = w.id
  left join team t on t.workspace_id = w.id
  left join people pp on pp.workspace_id = w.id
  left join meetings mt on mt.workspace_id = w.id
  left join emails e on e.workspace_id = w.id
  left join emails_today et on et.workspace_id = w.id
  left join reports rp on rp.workspace_id = w.id
  left join emailed em on em.workspace_id = w.id
  left join public.google_connections c on c.id = w.sender_connection_id
  left join public.sheet_syncs s on s.workspace_id = w.id
$$;
revoke execute on function private.admin_workspace_rows() from public, anon, authenticated;

create function private.admin_workspaces(
  p_search text, p_filter text, p_sort text, p_after_value text, p_after_id uuid, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  perform private.require_platform_role(false);
  if p_filter not in ('all', 'suspended', 'reported', 'no_sender') or p_sort not in ('newest', 'reports', 'emails')
     or p_limit not between 1 and 101 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', x.id, 'name', x.name, 'slug', x.slug, 'created_at', x.created_at,
        'owner_email', private.mask_email(x.owner_email), 'team', x.team, 'contacts', x.contacts,
        'meetings_30d', x.meetings_30d, 'emails_30d', x.emails_30d, 'failed_30d', x.failed_30d,
        'reports_7d', x.reports_7d, 'people_7d', x.people_7d, 'suspended', x.suspended,
        'sender', x.sender, 'sheet', x.sheet, 'sort_value', x.sort_value)
      order by x.ord)
    from (
      select r.*, row_number() over (order by
          case when p_sort = 'newest' then r.created_at end desc,
          case when p_sort = 'reports' then r.reports_7d end desc,
          case when p_sort = 'emails' then r.emails_30d end desc,
          r.id desc) as ord,
        case p_sort when 'newest' then r.created_at::text when 'reports' then r.reports_7d::text else r.emails_30d::text end as sort_value
      from private.admin_workspace_rows() r
      where (v_search is null or position(v_search in lower(r.name)) > 0 or position(v_search in coalesce(r.owner_email, '')) > 0)
        and (p_filter = 'all'
          or (p_filter = 'suspended' and r.suspended)
          or (p_filter = 'reported' and r.reports_7d > 0)
          or (p_filter = 'no_sender' and not r.has_sender))
        and (p_after_id is null or (
          case p_sort
            when 'newest' then (r.created_at, r.id) < (p_after_value::timestamptz, p_after_id)
            when 'reports' then (r.reports_7d, r.id) < (p_after_value::integer, p_after_id)
            else (r.emails_30d, r.id) < (p_after_value::integer, p_after_id)
          end))
      order by ord
      limit p_limit
    ) x), '[]'::jsonb));
end;
$$;

create function private.admin_workspace(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  perform private.require_platform_role(false);
  select * into v_row from private.admin_workspace_rows() r where r.id = p_workspace;
  if v_row.id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'slug', v_row.slug, 'created_at', v_row.created_at,
    'owner_name', v_row.owner_name, 'owner_email', v_row.owner_email,
    'team', (select pg_catalog.jsonb_build_object(
        'owner', count(*) filter (where r.role = 'owner'), 'admin', count(*) filter (where r.role = 'admin'),
        'viewer', count(*) filter (where r.role = 'viewer'))
      from public.workspace_roles r where r.workspace_id = p_workspace),
    'contacts', v_row.contacts, 'sender', v_row.sender, 'sheet', v_row.sheet, 'suspended', v_row.suspended,
    'last_30', pg_catalog.jsonb_build_object(
      'meetings_sent', v_row.meetings_30d, 'emails_sent', v_row.emails_30d, 'emails_failed', v_row.failed_30d,
      'reports', (select count(*) from public.abuse_reports r where r.workspace_id = p_workspace and r.reported_at > pg_catalog.now() - interval '30 days'),
      'unsubscribes', (select count(*) from public.contacts c where c.workspace_id = p_workspace and c.unsubscribed_at > pg_catalog.now() - interval '30 days')),
    'reports_7d', v_row.reports_7d, 'people_7d', v_row.people_7d,
    'suspensions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', s.id, 'reason', s.reason, 'created_at', s.created_at, 'created_by_name', cp.display_name,
          'lifted_at', s.lifted_at, 'lifted_by_name', lp.display_name)
        order by s.created_at desc)
      from (select * from public.workspace_sending_suspensions x where x.workspace_id = p_workspace order by x.created_at desc limit 20) s
      left join public.profiles cp on cp.user_id = s.created_by
      left join public.profiles lp on lp.user_id = s.lifted_by), '[]'::jsonb)
  );
end;
$$;

create function private.admin_reports(p_after_at timestamptz, p_after_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  if p_limit not between 1 and 101 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('items', coalesce((
    with page as (
      select r.* from public.abuse_reports r
      where p_after_id is null or (r.reported_at, r.id) < (p_after_at, p_after_id)
      order by r.reported_at desc, r.id desc
      limit p_limit
    ), stats as (
      select x.id as workspace_id, x.reports_7d, x.people_7d from private.admin_workspace_rows() x
      where x.id in (select page.workspace_id from page)
    )
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'workspace_id', p.workspace_id, 'workspace_name', w.name, 'reported_at', p.reported_at,
        'reviewed_at', p.reviewed_at, 'reviewed_by_name', rp.display_name,
        'reports_7d', coalesce(s.reports_7d, 0), 'people_7d', coalesce(s.people_7d, 0))
      order by p.reported_at desc, p.id desc)
    from page p
    join public.workspaces w on w.id = p.workspace_id
    left join stats s on s.workspace_id = p.workspace_id
    left join public.profiles rp on rp.user_id = p.reviewed_by), '[]'::jsonb));
end;
$$;

create function private.admin_mark_reviewed(p_report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  perform private.require_platform_role(false);
  update public.abuse_reports set reviewed_at = pg_catalog.now(), reviewed_by = auth.uid()
  where id = p_report and reviewed_at is null
  returning workspace_id into v_workspace;
  if v_workspace is not null then
    perform private.record_platform_event('report_reviewed', v_workspace, auth.uid(), '{}'::jsonb);
  end if;
end;
$$;

create function private.admin_log(p_filter text, p_after_id bigint, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  if p_filter not in ('all', 'suspensions', 'admins') or p_limit not between 1 and 101 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'workspace_id', e.workspace_id, 'workspace_name', e.workspace_name,
        'actor_name', coalesce(p.display_name, case when e.actor_id is null then null else private.mask_email(lower(u.email)) end),
        'facts', e.facts, 'created_at', e.created_at)
      order by e.id desc)
    from (
      select * from public.platform_events x
      where (p_after_id is null or x.id < p_after_id)
        and (p_filter = 'all'
          or (p_filter = 'suspensions' and x.kind in ('auto_suspended', 'suspended', 'lifted'))
          or (p_filter = 'admins' and x.kind in ('admin_invited', 'admin_joined', 'admin_removed', 'invite_revoked', 'owner_set')))
      order by x.id desc
      limit p_limit
    ) e
    left join public.profiles p on p.user_id = e.actor_id
    left join auth.users u on u.id = e.actor_id), '[]'::jsonb));
end;
$$;

create function public.admin_overview(p_days integer) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_overview(p_days) $$;
create function public.admin_workspaces(p_search text, p_filter text, p_sort text, p_after_value text, p_after_id uuid, p_limit integer)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_workspaces(p_search, p_filter, p_sort, p_after_value, p_after_id, p_limit) $$;
create function public.admin_workspace(p_workspace uuid) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_workspace(p_workspace) $$;
create function public.admin_reports(p_after_at timestamptz, p_after_id uuid, p_limit integer) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_reports(p_after_at, p_after_id, p_limit) $$;
create function public.admin_mark_reviewed(p_report uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_mark_reviewed(p_report) $$;
create function public.admin_log(p_filter text, p_after_id bigint, p_limit integer) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_log(p_filter, p_after_id, p_limit) $$;

revoke execute on function
  private.admin_overview(integer), private.admin_workspaces(text, text, text, text, uuid, integer),
  private.admin_workspace(uuid), private.admin_reports(timestamptz, uuid, integer), private.admin_mark_reviewed(uuid),
  private.admin_log(text, bigint, integer),
  public.admin_overview(integer), public.admin_workspaces(text, text, text, text, uuid, integer),
  public.admin_workspace(uuid), public.admin_reports(timestamptz, uuid, integer), public.admin_mark_reviewed(uuid),
  public.admin_log(text, bigint, integer)
from public, anon;
grant execute on function
  private.admin_overview(integer), private.admin_workspaces(text, text, text, text, uuid, integer),
  private.admin_workspace(uuid), private.admin_reports(timestamptz, uuid, integer), private.admin_mark_reviewed(uuid),
  private.admin_log(text, bigint, integer),
  public.admin_overview(integer), public.admin_workspaces(text, text, text, text, uuid, integer),
  public.admin_workspace(uuid), public.admin_reports(timestamptz, uuid, integer), public.admin_mark_reviewed(uuid),
  public.admin_log(text, bigint, integer)
to authenticated;
```

(The functions read `auth.users`; they are `SECURITY DEFINER` in `private` like every other admin body, and return only masked addresses except `admin_workspace`'s Owner email.) Apply, regenerate types, advisors, run the Step 1 tests → PASS.

- [ ] **Step 3: Plans at volume**

`src/server/db/m9-admin-reads-plans.db.test.ts`: seed with one SQL statement (generate_series) 200 workspaces, each with an owner seat, 200 contacts, one sent meeting with 100 invitees, 100 finished invite jobs with their `send_log` rows (spread over the last 20 days), 2 reports; run `analyze`; then for each reader run `explain (format json)` on the private body's main query (copy the `select` of `admin_workspace_rows()` and of `admin_figures` with literal arguments) and assert: no `Seq Scan` on `send_log`, `outbox_jobs` or `abuse_reports` (the new indexes are used) and the whole `admin_workspaces` call returns in under 500 ms (`clock_timestamp()` before and after, measured in SQL). Follow the existing pattern in `src/test/db/plans.ts` for seeding and plan inspection; run once with fresh statistics and once after `delete from pg_statistic` for those tables (stale), as M5–M8 did. Record the timings in the ledger.

- [ ] **Step 4: Chain, commit, PR, merge, hosted push**

Commit: `feat(db): platform daily rollup, push counters and the admin area's read functions`. After merging: `bash .superpowers/scripts/hosted-push.sh`.
### Task 17: The platform-events lane (`#platform` and Owner emails) and what organizers see when sending is suspended

**Issue labels:** `type:task`, `area:pipeline`, `area:observability`, `area:frontend`. **Branch:** `feat/<issue>-platform-lane`. **Migration:** `supabase migration new m9_platform_lane`.

**Files:**
- Create: `supabase/migrations/<ts>_m9_platform_lane.sql`, `src/server/db/m9-platform-lane.db.test.ts`
- Create: `src/lib/discord/platform-events.ts`, `src/lib/discord/platform-events.test.ts`
- Create: `src/server/platform/run-platform-events.ts`, `src/server/platform/run-platform-events.test.ts`, `src/server/platform/platform-deps.ts`, `src/server/queries/platform.ts`
- Create: `src/config/platform.ts`
- Modify: `src/server/workers/schedule-workers.ts` (+ test), `src/app/api/r/[token]/report/route.ts`, `src/config/env.ts` (`DISCORD_PLATFORM_WEBHOOK`, optional, server-only), `src/config/secrets.ts`
- Modify: `src/emails/owner-alert-email.tsx` (+ test), `src/server/email/owner-alert.ts` (+ test), `messages/en.json` (`Email.sendingSuspended`, `Email.sendingResumed`, `MeetingPage.pausedSuspended`, `Shell.suspended*`)
- Modify: `src/shared/api/workspaces.ts`, `src/app/api/workspaces/[slug]/route.ts` (+ test), `src/hooks/use-workspace.ts`, `src/server/queries/workspaces.ts`
- Create: `src/components/shell/suspended-banner.tsx`, `src/components/shell/suspended-banner.test.tsx`; Modify: `src/components/shell/workspace-shell.tsx`, `src/app/w/[slug]/meetings/[id]/send-progress.tsx` (+ test), `src/app/w/[slug]/meetings/[id]/page.tsx`

**Interfaces:**
- Consumes: `platform_events` (Tasks 14–16), `discordMessage` / `postToDiscord` (Task 7), `sendOwnerAlert`, `contactHref` (Task 11), `record_worker_failure` (Task 15).
- Produces:
  - SQL (service role only): `platform_events_claim(p_limit integer, p_lease_seconds integer) → jsonb` (`[{ id, kind, workspace_id, workspace_name, workspace_slug, facts, created_at, actor_role, emailed_at, attempts }]`), `platform_event_owner_target(p_event bigint) → jsonb | null` (spends the platform budget once per event, stamps `emailed_at`), `platform_event_done(p_event bigint)`, `platform_event_failed(p_event bigint) → integer` (attempts; stamped done at `platform_notify_attempts_max`).
  - `platformEventMessage(event: PlatformEvent, appUrl: string): DiscordEvent` (one embed per kind; counts, ids and workspace names only).
  - `runPlatformEvents(deps: PlatformDeps, options: { budgetMs: number; batchSize: number; leaseSeconds: number }): Promise<{ posted: number; emailed: number; failed: number }>`.
  - Worker type `"emails" | "sheets" | "platform"`; `scheduleWorkers()` runs all three by default and records `worker_failing` for a crashed lane.
  - `WorkspaceResponse = WorkspaceDetails & { sendingSuspension: { since: string; contact: string } | null }` from `GET /api/workspaces/[slug]` (only that route reads the suspension: `loadWorkspaceContext` stays one query lighter for every other route).
  - Owner alert kinds `sendingSuspended`, `sendingResumed` (link: the workspace's Home).

**Rulings (copy into the ledger):**
- An Owner email is sent at most once per event (`emailed_at`, stamped when the budget is spent, before sending): a Discord failure retries the post, never the email. Over the platform's daily cap the email is skipped and logged; the admin area still shows the suspension.
- Without `DISCORD_PLATFORM_WEBHOOK` (local, CI, previews) an event is marked done without posting: the log in the admin area is the record.
- Who acted is posted as a role ("an admin", "the platform owner"), never a name.
- The banner shows to Owners and Admins only (Viewers can't send), and the meeting page's progress caption says sending is paused for review instead of "Connect Gmail".

- [ ] **Step 1: The SQL (red DB test first)**

`src/server/db/m9-platform-lane.db.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser } from "@/test/db/clients";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const claimRow = z.object({ id: z.number(), kind: z.string(), workspace_slug: z.string().nullable(), attempts: z.number() });

beforeEach(() => runLocalSql("delete from public.platform_events"));

describe("platform events lane", () => {
  it("claims each event once while leased, and the done one never comes back", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Lane Club");
    runLocalSql(`select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`);
    const admin = adminClient();
    const first = z.array(claimRow).parse((await admin.rpc("platform_events_claim", { p_limit: 10, p_lease_seconds: 60 })).data);
    expect(first.map((event) => event.kind)).toEqual(["suspended"]);
    expect(first[0].workspace_slug).toBe(workspace.slug);
    const second = (await admin.rpc("platform_events_claim", { p_limit: 10, p_lease_seconds: 60 })).data;
    expect(second).toEqual([]);
    await admin.rpc("platform_event_done", { p_event: first[0].id });
    runLocalSql("update public.platform_events set locked_until = now() - interval '1 second'");
    expect((await admin.rpc("platform_events_claim", { p_limit: 10, p_lease_seconds: 60 })).data).toEqual([]);
  });

  it("spends the Owner email budget once per event", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Email Once");
    runLocalSql(`select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`);
    const [event] = z.array(claimRow).parse((await adminClient().rpc("platform_events_claim", { p_limit: 1, p_lease_seconds: 60 })).data);
    const target = (await adminClient().rpc("platform_event_owner_target", { p_event: event.id })).data as { email: string } | null;
    expect(target?.email).toBe(owner.email);
    expect((await adminClient().rpc("platform_event_owner_target", { p_event: event.id })).data).toBeNull();
  });

  it("gives up after the attempts cap", async () => {
    runLocalSql(`select private.record_platform_event('worker_failing', null, null, '{"lane":"emails"}')`);
    const [event] = z.array(claimRow).parse((await adminClient().rpc("platform_events_claim", { p_limit: 1, p_lease_seconds: 60 })).data);
    for (let i = 0; i < 5; i += 1) {
      await adminClient().rpc("platform_event_failed", { p_event: event.id });
    }
    const done = queryLocalSql(
      `select (notified_at is not null) as done from public.platform_events where id = ${event.id}`,
      z.array(z.object({ done: z.boolean() })).length(1),
    );
    expect(done[0].done).toBe(true);
  });

  it("is executable by the service role only", async () => {
    const user = await createTestUser();
    expect((await user.client.rpc("platform_events_claim", { p_limit: 1, p_lease_seconds: 60 })).error).not.toBeNull();
  });
});
```

`supabase/migrations/<ts>_m9_platform_lane.sql`:

```sql
-- M9 (spec §8 Platform events): the dispatcher's third lane drains platform_events into #platform
-- and the Owner's email. Service role only.
alter table public.platform_events add column emailed_at timestamptz;

create function private.platform_events_claim(p_limit integer, p_lease_seconds integer)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select e.id from public.platform_events e
    where e.notified_at is null and (e.locked_until is null or e.locked_until < pg_catalog.now())
    order by e.id
    limit p_limit
    for update skip locked
  ), leased as (
    update public.platform_events e set locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked where e.id = picked.id
    returning e.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', l.id, 'kind', l.kind, 'workspace_id', l.workspace_id, 'workspace_name', l.workspace_name,
      'workspace_slug', w.slug, 'facts', l.facts, 'created_at', l.created_at,
      'actor_role', private.platform_role_of(l.actor_id), 'emailed_at', l.emailed_at, 'attempts', l.notify_attempts)
    order by l.id), '[]'::jsonb)
  from leased l left join public.workspaces w on w.id = l.workspace_id
$$;

-- The Owner's address for a suspension email, once per event, inside the platform's daily budget.
create function private.platform_event_owner_target(p_event bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  update public.platform_events set emailed_at = pg_catalog.now()
  where id = p_event and emailed_at is null and kind in ('auto_suspended', 'suspended', 'lifted') and workspace_id is not null
  returning workspace_id into v_workspace;
  if v_workspace is null then
    return null;
  end if;
  return private.owner_alert_target(v_workspace);
end;
$$;

create function private.platform_event_done(p_event bigint)
returns void
language sql
security definer
set search_path = ''
as $$ update public.platform_events set notified_at = pg_catalog.now(), locked_until = null where id = p_event $$;

create function private.platform_event_failed(p_event bigint)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.platform_events
  set notify_attempts = notify_attempts + 1,
    locked_until = pg_catalog.now() + pg_catalog.make_interval(mins => least(notify_attempts + 1, 30)),
    notified_at = case when notify_attempts + 1 >= private.app_limit('platform_notify_attempts_max') then pg_catalog.now() end
  where id = p_event
  returning notify_attempts
$$;

create function public.platform_events_claim(p_limit integer, p_lease_seconds integer) returns jsonb language sql security invoker set search_path = ''
as $$ select private.platform_events_claim(p_limit, p_lease_seconds) $$;
create function public.platform_event_owner_target(p_event bigint) returns jsonb language sql security invoker set search_path = ''
as $$ select private.platform_event_owner_target(p_event) $$;
create function public.platform_event_done(p_event bigint) returns void language sql security invoker set search_path = ''
as $$ select private.platform_event_done(p_event) $$;
create function public.platform_event_failed(p_event bigint) returns integer language sql security invoker set search_path = ''
as $$ select private.platform_event_failed(p_event) $$;

revoke execute on function
  private.platform_events_claim(integer, integer), private.platform_event_owner_target(bigint),
  private.platform_event_done(bigint), private.platform_event_failed(bigint),
  public.platform_events_claim(integer, integer), public.platform_event_owner_target(bigint),
  public.platform_event_done(bigint), public.platform_event_failed(bigint)
from public, anon, authenticated;
grant execute on function
  private.platform_events_claim(integer, integer), private.platform_event_owner_target(bigint),
  private.platform_event_done(bigint), private.platform_event_failed(bigint),
  public.platform_events_claim(integer, integer), public.platform_event_owner_target(bigint),
  public.platform_event_done(bigint), public.platform_event_failed(bigint)
to service_role;
```

(The `notified_at` case keeps `null` below the cap: `case … end` without `else` is null.) Apply, types, advisors, run the test → PASS.

- [ ] **Step 2: The message per kind (pure, tested)**

`src/lib/discord/platform-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { platformEventMessage, type PlatformEvent } from "./platform-events";

const base: PlatformEvent = {
  id: 1, kind: "auto_suspended", workspaceId: "w1", workspaceName: "Robotics Club", workspaceSlug: "robotics-ab12",
  facts: { reports: 3, people: 74 }, createdAt: "2026-10-15T09:12:00Z", actorRole: null, emailedAt: null, attempts: 0,
};

describe("platformEventMessage", () => {
  it("an automatic suspension: amber, the rate, a link to the workspace in Admin", () => {
    const event = platformEventMessage(base, "https://tapnshow.vercel.app");
    expect(event).toMatchObject({
      tone: "attention",
      title: "Sending suspended automatically",
      url: "https://tapnshow.vercel.app/admin/workspaces/w1",
      source: "platform",
    });
    expect(event.fields).toEqual([
      { name: "Workspace", value: "Robotics Club" },
      { name: "Reports (7 days)", value: "3 of 74 people · 4.1%" },
    ]);
  });

  it("names who acted by role, never by name", () => {
    const event = platformEventMessage({ ...base, kind: "lifted", actorRole: "owner", facts: {} }, "https://x.app");
    expect(event.fields).toContainEqual({ name: "By", value: "the platform owner" });
    expect(JSON.stringify(event)).not.toMatch(/@/);
  });

  it("covers every kind with a title", () => {
    for (const kind of ["auto_suspended", "suspended", "lifted", "report", "report_reviewed", "admin_invited", "admin_joined", "admin_removed", "invite_revoked", "owner_set", "platform_email_cap", "worker_failing"] as const) {
      expect(platformEventMessage({ ...base, kind, facts: { lane: "emails", cap: 100 } }, "https://x.app").title.length).toBeGreaterThan(0);
    }
  });
});
```

`src/lib/discord/platform-events.ts`:

```ts
import type { DiscordEvent } from "./embed";

/** The platform event kinds (`public.platform_event_kind`). */
export type PlatformEventKind =
  | "auto_suspended" | "suspended" | "lifted" | "report" | "report_reviewed" | "admin_invited"
  | "admin_joined" | "admin_removed" | "invite_revoked" | "owner_set" | "platform_email_cap" | "worker_failing";

/** One claimed event (camelCase of `platform_events_claim`). */
export type PlatformEvent = {
  id: number;
  kind: PlatformEventKind;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceSlug: string | null;
  facts: Record<string, string | number | boolean>;
  createdAt: string;
  actorRole: "owner" | "admin" | null;
  emailedAt: string | null;
  attempts: number;
};

const TITLES: Record<PlatformEventKind, [DiscordEvent["tone"], string]> = {
  auto_suspended: ["attention", "Sending suspended automatically"],
  suspended: ["attention", "Sending suspended by an admin"],
  lifted: ["info", "Suspension lifted"],
  report: ["attention", "New report: Not my group"],
  report_reviewed: ["info", "Report reviewed"],
  admin_invited: ["info", "Admin invited"],
  admin_joined: ["success", "New admin joined"],
  admin_removed: ["info", "Admin removed"],
  invite_revoked: ["info", "Admin invite revoked"],
  owner_set: ["info", "Platform owner set"],
  platform_email_cap: ["attention", "Platform email limit reached for today"],
  worker_failing: ["failure", "A background worker is failing"],
};

const DESCRIPTIONS: Partial<Record<PlatformEventKind, string>> = {
  auto_suspended: "A workspace passed the report limit. Its queued emails are paused until an admin looks.",
  platform_email_cap: "Team invite emails and notices to Owners wait until tomorrow. Copy link still works.",
  worker_failing: "See Sentry for the error. It is posted at most once an hour.",
};

function rate(reports: number, people: number): string {
  const percent = people > 0 ? Math.round((reports / people) * 1000) / 10 : 100;
  return `${reports} of ${people} people · ${percent}%`;
}

/** The `#platform` embed of one event (spec §5): counts, ids and workspace names only. */
export function platformEventMessage(event: PlatformEvent, appUrl: string): DiscordEvent {
  const [tone, title] = TITLES[event.kind];
  const fields: Array<{ name: string; value: string }> = [];
  if (event.workspaceName) {
    fields.push({ name: "Workspace", value: event.workspaceName });
  }
  const { reports, people, lane, cap } = event.facts;
  if (typeof reports === "number" && typeof people === "number") {
    fields.push({ name: "Reports (7 days)", value: rate(reports, people) });
  }
  if (event.actorRole) {
    fields.push({ name: "By", value: event.actorRole === "owner" ? "the platform owner" : "an admin" });
  }
  if (typeof lane === "string") {
    fields.push({ name: "Worker", value: lane });
  }
  if (typeof cap === "number") {
    fields.push({ name: "Limit", value: `${cap} a day` });
  }
  const url = event.workspaceId ? `${appUrl}/admin/workspaces/${event.workspaceId}` : `${appUrl}/admin/log`;
  return { tone, title, url, description: DESCRIPTIONS[event.kind], fields, source: "platform", at: new Date(event.createdAt) };
}
```

Run: `bun run test -- --run src/lib/discord` → PASS.

- [ ] **Step 3: The lane, its deps, the Owner emails, the scheduling**

`src/config/platform.ts`:

```ts
/** The platform-events lane (spec §8 M9). Lease and budget stay inside the route's 60 s maxDuration. */
export const PLATFORM_BUDGET_MS = 40_000;
/** Events claimed per round. */
export const PLATFORM_BATCH = 10;
/** How long a claimed event stays leased (twice the route's maxDuration). */
export const PLATFORM_LEASE_SECONDS = 120;
```

`src/server/queries/platform.ts` (Zod-parsed RPC wrappers): `claimPlatformEvents(client, limit, leaseSeconds): Promise<PlatformEvent[]>` (maps snake_case to `PlatformEvent`), `platformEventOwnerTarget(client, id): Promise<{ email: string; workspaceName: string; workspaceSlug: string } | null>`, `platformEventDone(client, id)`, `platformEventFailed(client, id): Promise<number>`, `recordWorkerFailure(client, lane)`. Each throws on a database error, as `src/server/queries/push.ts` does.

`src/server/platform/run-platform-events.test.ts` (with fakes, the `run-push.test.ts` pattern): (1) an `auto_suspended` event posts one embed and emails the Owner once, then is done; (2) a Discord 500 marks it failed, sends no second email on the retry (the second claim has `emailedAt` set and the target returns null); (3) no webhook → done without posting; (4) the budget stops claiming; (5) a throwing mailer still posts and marks done (the email is logged as failed).

`src/server/platform/run-platform-events.ts`:

```ts
import "server-only";
import { platformEventMessage, type PlatformEvent } from "@/lib/discord/platform-events";
import { discordMessage, type DiscordMessage } from "@/lib/discord/embed";
import { logger } from "@/lib/logger";
import type { OwnerAlertInput } from "@/server/email/owner-alert";

/** What the lane needs (real ones in platform-deps.ts; fakes in tests). */
export type PlatformDeps = {
  appUrl: string;
  webhook: string | undefined;
  now: () => number;
  store: {
    claim: (limit: number, leaseSeconds: number) => Promise<PlatformEvent[]>;
    ownerTarget: (id: number) => Promise<{ email: string; workspaceName: string; workspaceSlug: string } | null>;
    done: (id: number) => Promise<void>;
    failed: (id: number) => Promise<number>;
  };
  post: (webhook: string, message: DiscordMessage) => Promise<{ ok: boolean; status: number }>;
  alertOwner: (to: string, alert: OwnerAlertInput) => Promise<void>;
};

const OWNER_KINDS = new Set(["auto_suspended", "suspended", "lifted"]);

/**
 * Drains platform_events (spec §8 M9): each event posts one #platform embed and, for a suspension
 * or a lift, emails the workspace's Owner once. A failed post is retried by later runs; the action
 * itself has already committed.
 */
export async function runPlatformEvents(
  deps: PlatformDeps,
  options: { budgetMs: number; batchSize: number; leaseSeconds: number },
): Promise<{ posted: number; emailed: number; failed: number }> {
  const started = deps.now();
  const summary = { posted: 0, emailed: 0, failed: 0 };
  while (deps.now() - started < options.budgetMs) {
    const events = await deps.store.claim(options.batchSize, options.leaseSeconds);
    if (events.length === 0) {
      break;
    }
    for (const event of events) {
      if (OWNER_KINDS.has(event.kind) && !event.emailedAt) {
        const target = await deps.store.ownerTarget(event.id);
        if (target) {
          try {
            await deps.alertOwner(target.email, {
              kind: event.kind === "lifted" ? "sendingResumed" : "sendingSuspended",
              workspaceName: target.workspaceName,
              workspaceSlug: target.workspaceSlug,
            });
            summary.emailed += 1;
          } catch (error) {
            logger.error({ err: error, eventId: event.id }, "platform owner email failed");
          }
        }
      }
      if (!deps.webhook) {
        await deps.store.done(event.id);
        continue;
      }
      const result = await deps.post(deps.webhook, discordMessage(platformEventMessage(event, deps.appUrl)));
      if (result.ok) {
        summary.posted += 1;
        await deps.store.done(event.id);
      } else {
        summary.failed += 1;
        const attempts = await deps.store.failed(event.id);
        logger.warn({ eventId: event.id, status: result.status, attempts }, "platform event post failed");
      }
    }
  }
  logger.info({ summary }, "platform events run finished");
  return summary;
}
```

`src/server/platform/platform-deps.ts`: builds `PlatformDeps` from the admin client (`createSupabaseAdminClient`), `getServerEnv().DISCORD_PLATFORM_WEBHOOK`, `publicEnv.NEXT_PUBLIC_APP_URL`, `postToDiscord`, and `alertOwner = (to, alert) => sendOwnerAlert(createSystemMailer(), appUrl, to, alert)`, as `src/server/push/push-deps.ts` does.

`src/server/email/owner-alert.ts`: `OwnerAlertInput` gains `{ kind: "sendingSuspended" | "sendingResumed"; workspaceName: string; workspaceSlug: string }`; their link is the workspace's Home (`${appUrl}/w/${slug}`), not Settings. `src/emails/owner-alert-email.tsx`: the two kinds use the same layout, copy from `Email.sendingSuspended` / `Email.sendingResumed`:

```json
    "sendingSuspended": {
      "subject": "Meeting emails from {workspace} are paused",
      "preview": "{appName} paused {workspace}'s meeting emails while it looks at reports.",
      "heading": "Meeting emails from {workspace} are paused",
      "body": "People told {appName} they never joined {workspace}. While we look at it, the meeting emails waiting to go out are paused and new ones can't be sent. Nothing is deleted. If you think this is a mistake, reply to this email.",
      "button": "Open {workspace}",
      "fallback": "If the button doesn't work, copy this link:"
    },
    "sendingResumed": {
      "subject": "Meeting emails from {workspace} can go out again",
      "preview": "{workspace} can send meeting emails again.",
      "heading": "{workspace} can send again",
      "body": "We looked at the reports. The paused meeting emails are going out now, except for meetings that have already started.",
      "button": "Open {workspace}",
      "fallback": "If the button doesn't work, copy this link:"
    },
```

(`button` takes `{workspace}`: pass `values` to `tr(\`${kind}.button\`, values)` for these kinds.) Tests for both kinds in `owner-alert.test.ts` (the Home link) and `owner-alert-email.test.tsx` (subject, body, no technical words).

`src/server/workers/schedule-workers.ts`: `Worker = "emails" | "sheets" | "platform"`; the default becomes `["emails", "sheets", "platform"]`; add the lane:

```ts
    if (which.includes("platform")) {
      lanes.push("platform");
      runs.push(
        Promise.resolve().then(() =>
          runPlatformEvents(createPlatformDeps(), {
            budgetMs: PLATFORM_BUDGET_MS,
            batchSize: PLATFORM_BATCH,
            leaseSeconds: PLATFORM_LEASE_SECONDS,
          }),
        ),
      );
    }
```

keep a `lanes: string[]` array parallel to `runs` (push `"emails"`, `"push"`, `"sheets"` next to their runs), and in the results loop record a crashed lane once:

```ts
    const results = await Promise.allSettled(runs);
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        logger.error({ err: result.reason, lane: lanes[index] }, "worker run failed");
        await recordWorkerFailure(createSupabaseAdminClient(), lanes[index]).catch((error: Error) =>
          logger.error({ err: error }, "could not record the failing worker"),
        );
      }
    }
```

Its test gains: "a crashed lane is recorded once, by name". `src/app/api/r/[token]/report/route.ts`: after a successful report, `scheduleWorkers(["platform"])` (the alert goes out within seconds, not at the next minute). `src/config/env.ts`: `DISCORD_PLATFORM_WEBHOOK: z.url().optional()` (server-only); add it to `src/config/secrets.ts`'s list of secret names so the scrubber and the startup check treat it as a secret.

Run: `bun run test -- --run src/server src/lib/discord src/emails src/app/api/r` → PASS.

- [ ] **Step 4: What organizers see**

`src/shared/api/workspaces.ts`:

```ts
/** `GET /api/workspaces/[slug]`: the workspace plus, while sending is suspended, since when and whom to write to. */
export const workspaceResponseSchema = workspaceDetailsSchema.extend({
  sendingSuspension: z.object({ since: z.iso.datetime({ offset: true }), contact: z.string() }).nullable(),
});
/** What the workspace hook holds. */
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
```

`src/server/queries/workspaces.ts`: `getSendingSuspension(client, workspaceId): Promise<{ since: string } | null>` (`from("workspace_sending_suspensions").select("created_at").eq("workspace_id", id).is("lifted_at", null).maybeSingle()`, RLS lets members read). The GET route returns `{ ...context.workspace, sendingSuspension: suspension ? { since: suspension.since, contact: contactHref(getServerEnv().SMTP_FROM) } : null }`. `src/hooks/use-workspace.ts` parses with `workspaceResponseSchema`; the components that took `WorkspaceDetails` keep it (the response type extends it).

`src/components/shell/suspended-banner.tsx`:

```tsx
"use client";

import { PauseCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";

/** Owners and Admins of a suspended workspace (spec §7.12): plain words and how to reach us. */
export function SuspendedBanner({ contact }: { contact: string }) {
  const t = useTranslations("Shell");
  return (
    <div role="status" className="flex items-start gap-3 rounded-card border-[length:var(--tn-border-width)] border-outline bg-fill-warning p-3 text-on-fill shadow-brutal-sm">
      <Sticker tone="surface">
        <PauseCircle weight="bold" />
      </Sticker>
      <p className="text-sm">
        <span className="font-bold">{t("suspendedTitle")}</span> {t("suspendedBody")}{" "}
        <a className="font-bold underline underline-offset-4" href={contact}>{t("suspendedContact")}</a>
      </p>
    </div>
  );
}
```

Messages (`Shell`): `"suspendedTitle": "Sending is paused."`, `"suspendedBody": "TapNShow is reviewing reports about this workspace. Emails waiting to go out will be sent once it's sorted, and nothing is deleted."`, `"suspendedContact": "Contact us"`. `MeetingPage.pausedSuspended`: "Sending is paused while TapNShow reviews reports about this workspace."

`src/components/shell/workspace-shell.tsx`: at the top of `<main>`, `{workspace.data.sendingSuspension && workspace.data.myRole !== "viewer" ? <SuspendedBanner contact={workspace.data.sendingSuspension.contact} /> : null}` (with `mb-4`). `send-progress.tsx`: a `suspended` prop; when true the caption is `t("pausedSuspended")` and the connect button is hidden; the meeting page passes `suspended={Boolean(workspace.data?.sendingSuspension)}`. Tests: the banner (text, contact link), the shell shows it for an Admin and not for a Viewer, the progress caption.

- [ ] **Step 5: e2e, screenshots, the webhook, chain, merge**

e2e (in a new `e2e/m9-admin.spec.ts`, extended by Tasks 19–20): seed a workspace with a sent meeting to 10 people (the existing seed helpers), post 3 reports through `/api/r/<token>/report` for 3 of them, then as the Owner: the banner shows on Home, and Send on a new meeting's Review answers with the plain message. Screenshots of the banner and the meeting page caption (390 light, 320 dark, 1024); "Looks right?" before merging.

AskUserQuestion: "For `#platform` I need the channel's webhook on Vercel: please create it (runbook) and add it with `! vercel env add DISCORD_PLATFORM_WEBHOOK production` (you paste it; it never enters the chat), and back it up in `.env.local`." Then chain (with DB), commit `feat(platform): #platform posts and Owner emails for suspensions; organizers see sending is paused`, PR, merge, hosted push.
### Task 18: The admin API: schemas, queries, routes, hooks, and `platformRole` on `/api/me`

**Issue labels:** `type:task`, `area:api`. **Branch:** `feat/<issue>-admin-api`.

**Files:**
- Create: `src/config/admin.ts`, `src/shared/api/admin.ts`, `src/shared/api/admin.test.ts`
- Create: `src/server/queries/admin.ts`, `src/server/http/admin-context.ts`, `src/server/http/admin-context.test.ts`
- Create: `src/server/admin/deliver-admin-invite.ts`, `src/server/admin/deliver-admin-invite.test.ts`, `src/emails/admin-invite-email.tsx`, `src/emails/admin-invite-email.test.tsx`
- Create routes (each with a `route.test.ts`): `src/app/api/admin/overview/route.ts`, `admin/workspaces/route.ts`, `admin/workspaces/[id]/route.ts`, `admin/workspaces/[id]/suspension/route.ts`, `admin/reports/route.ts`, `admin/reports/[id]/reviewed/route.ts`, `admin/admins/route.ts`, `admin/admins/[userId]/route.ts`, `admin/invites/route.ts`, `admin/invites/[id]/route.ts`, `admin/invites/[id]/renew/route.ts`, `admin/invites/accept/route.ts`, `admin/invites/preview/route.ts`, `admin/log/route.ts`
- Create: `src/hooks/use-admin.ts`, `src/hooks/use-admin.test.tsx`
- Modify: `src/server/http/route-registry.ts` (every new route), `src/shared/api/me.ts`, `src/server/queries/profile.ts` (+ its DB test), `src/test/fixtures/me.ts`, `src/lib/observability/scrub.ts` (+ test: `/admin/join/<token>`), `messages/en.json` (`Email.adminInvite`)

**Interfaces:**
- Consumes: every SQL function of Tasks 14–16, `generateToken` / `sha256Hex` (`src/server/crypto/tokens.ts`), `readPageParams` / `toPage`, `usePagedList`, `apiRequest`, `createSystemMailer`.
- Produces:
  - `ADMIN_PAGE_SIZE = 25`.
  - Schemas (camelCase; parsing the SQL's snake_case happens in `src/server/queries/admin.ts`): `adminOverviewSchema`, `adminWorkspaceRowSchema`, `adminWorkspacesPageSchema`, `adminWorkspaceSchema`, `adminReportRowSchema`, `adminReportsPageSchema`, `adminAdminsSchema`, `adminLogItemSchema`, `adminLogPageSchema`, `adminInviteBodySchema` (`{ email, delivery: "email" | "link" }`), `adminInviteResultSchema` (`{ status: "sent" | "link" | "email_limit" | "email_failed"; link?: string }`), `adminInviteTokenBodySchema` (`{ token }`), `adminInvitePreviewSchema` (`{ status, maskedEmail }`), and the query enums `ADMIN_WORKSPACE_FILTERS`, `ADMIN_WORKSPACE_SORTS`, `ADMIN_LOG_FILTERS`, `ADMIN_OVERVIEW_DAYS = [7, 30, 90]`.
  - `loadAdminContext(): Promise<{ ok: true; supabase; user; role: "owner" | "admin" } | { ok: false; response }>`: 401 signed out, **404** for everyone who isn't a platform admin.
  - `MeResponse.platformRole: "owner" | "admin" | null` (Task 19's user menu shows **Admin** from it).
  - Hooks: `useAdminOverview(days)`, `useAdminWorkspaces({ q, filter, sort })`, `useAdminWorkspace(id)`, `useAdminReports()`, `useAdminAdmins()`, `useAdminLog(filter)`, and mutations `useSuspendWorkspace(id)`, `useLiftSuspension(id)`, `useMarkReviewed()`, `useInviteAdmin()`, `useRenewAdminInvite()`, `useRevokeAdminInvite()`, `useRemoveAdmin()`, `useAdminInvitePreview(token)`, `useAcceptAdminInvite()`; each mutation invalidates `ADMIN_QUERY_KEY`.

**Rulings (copy into the ledger):**
- Admin reads are signed-in reads behind the WAF guard (`SIGNED_IN_READ`); every admin write spends `admin_write` / `admin_invite` in its wrapper, and the invite accept/preview spend their own.
- The admin invite email reuses the workspace invite's layout but has its own words (`Email.adminInvite`): the workspace one names a workspace and a role, which an admin invite doesn't have.
- `/admin/join/<token>` joins the scrubbed token links (`TOKEN_LINK`), so logs, Sentry and analytics never carry it.

- [ ] **Step 1: Schemas and config (red test first)**

`src/shared/api/admin.test.ts` (the parse round trips the route tests rely on):

```ts
import { describe, expect, it } from "vitest";
import { adminInviteBodySchema, adminOverviewSchema, adminWorkspaceRowSchema } from "./admin";

describe("admin schemas", () => {
  it("accepts an invite body, normalizing the email", () => {
    expect(adminInviteBodySchema.parse({ email: " New@Example.com ", delivery: "email" })).toEqual({
      email: "new@example.com",
      delivery: "email",
    });
    expect(adminInviteBodySchema.safeParse({ email: "nope", delivery: "email" }).success).toBe(false);
  });

  it("parses a workspace row and an overview", () => {
    expect(
      adminWorkspaceRowSchema.parse({
        id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Robotics Club", slug: "robotics-ab12",
        createdAt: "2026-10-02T10:00:00+00:00", ownerEmail: "a•••@gmail.com", team: 6, contacts: 74,
        meetings30d: 6, emails30d: 402, failed30d: 16, reports7d: 3, people7d: 74, suspended: true,
        sender: "active", sheet: "off",
      }).sender,
    ).toBe("active");
    expect(adminOverviewSchema.shape.current).toBeDefined();
  });
});
```

`src/config/admin.ts`:

```ts
/** Rows per page in every admin list (spec §7.19: 25 at a time). */
export const ADMIN_PAGE_SIZE = 25;
```

`src/shared/api/admin.ts`:

```ts
import { z } from "zod";

/** The overview's period switch (days). */
export const ADMIN_OVERVIEW_DAYS = [7, 30, 90] as const;
/** Workspaces list filters and sorts (spec §7.19). */
export const ADMIN_WORKSPACE_FILTERS = ["all", "suspended", "reported", "no_sender"] as const;
export const ADMIN_WORKSPACE_SORTS = ["newest", "reports", "emails"] as const;
/** Log filters. */
export const ADMIN_LOG_FILTERS = ["all", "suspensions", "admins"] as const;

const instant = z.iso.datetime({ offset: true });

const figuresSchema = z.object({
  workspacesTotal: z.number(), workspacesNew: z.number(), activeWorkspaces: z.number(), meetingsSent: z.number(),
  emailsSent: z.number(), emailsFailed: z.number(), answersRateBp: z.number().nullable(), accountsTotal: z.number(),
  accountsNew: z.number(), pushesSent: z.number(), pushesFailed: z.number(),
});
/** Platform figures for one period. */
export type AdminFigures = z.infer<typeof figuresSchema>;

/** `GET /api/admin/overview?days=` */
export const adminOverviewSchema = z.object({
  attention: z.object({
    newReports: z.number(),
    openSuspensions: z.array(z.object({ workspaceId: z.uuid(), workspaceName: z.string(), reason: z.enum(["auto_reports", "platform_admin"]), createdAt: instant })),
    platformEmailUsed: z.number(),
    platformEmailCap: z.number(),
  }),
  current: figuresSchema,
  previous: figuresSchema,
  weekly: z.array(z.object({ week: z.string(), meetings: z.number() })),
  health: z.object({
    queueWaiting: z.number(), queueOldest: instant.nullable(), sheetsPaused: z.number(), sheetsTotal: z.number(), sendersBroken: z.number(),
  }),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

/** One row of `GET /api/admin/workspaces`. */
export const adminWorkspaceRowSchema = z.object({
  id: z.uuid(), name: z.string(), slug: z.string(), createdAt: instant, ownerEmail: z.string().nullable(),
  team: z.number(), contacts: z.number(), meetings30d: z.number(), emails30d: z.number(), failed30d: z.number(),
  reports7d: z.number(), people7d: z.number(), suspended: z.boolean(),
  sender: z.enum(["none", "active", "broken"]), sheet: z.enum(["off", "on", "paused"]),
});
export type AdminWorkspaceRow = z.infer<typeof adminWorkspaceRowSchema>;
export const adminWorkspacesPageSchema = z.object({ items: z.array(adminWorkspaceRowSchema), nextCursor: z.string().nullable() });

/** `GET /api/admin/workspaces/[id]` */
export const adminWorkspaceSchema = z.object({
  id: z.uuid(), name: z.string(), slug: z.string(), createdAt: instant, ownerName: z.string().nullable(),
  ownerEmail: z.string().nullable(), team: z.object({ owner: z.number(), admin: z.number(), viewer: z.number() }),
  contacts: z.number(), sender: z.enum(["none", "active", "broken"]), sheet: z.enum(["off", "on", "paused"]), suspended: z.boolean(),
  last30: z.object({ meetingsSent: z.number(), emailsSent: z.number(), emailsFailed: z.number(), reports: z.number(), unsubscribes: z.number() }),
  reports7d: z.number(), people7d: z.number(),
  suspensions: z.array(z.object({
    id: z.uuid(), reason: z.enum(["auto_reports", "platform_admin"]), createdAt: instant, createdByName: z.string().nullable(),
    liftedAt: instant.nullable(), liftedByName: z.string().nullable(),
  })),
});
export type AdminWorkspace = z.infer<typeof adminWorkspaceSchema>;

/** One row of `GET /api/admin/reports`. */
export const adminReportRowSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), workspaceName: z.string(), reportedAt: instant, reviewedAt: instant.nullable(),
  reviewedByName: z.string().nullable(), reports7d: z.number(), people7d: z.number(),
});
export type AdminReportRow = z.infer<typeof adminReportRowSchema>;
export const adminReportsPageSchema = z.object({ items: z.array(adminReportRowSchema), nextCursor: z.string().nullable() });

/** `GET /api/admin/admins` (emails masked). */
export const adminAdminsSchema = z.object({
  admins: z.array(z.object({ userId: z.uuid(), role: z.enum(["owner", "admin"]), name: z.string().nullable(), email: z.string(), since: instant })),
  invites: z.array(z.object({ id: z.uuid(), email: z.string(), expiresAt: instant })),
});
export type AdminAdmins = z.infer<typeof adminAdminsSchema>;

/** One row of `GET /api/admin/log`. */
export const adminLogItemSchema = z.object({
  id: z.number(),
  kind: z.enum(["auto_suspended", "suspended", "lifted", "report", "report_reviewed", "admin_invited", "admin_joined", "admin_removed", "invite_revoked", "owner_set", "platform_email_cap", "worker_failing"]),
  workspaceId: z.uuid().nullable(), workspaceName: z.string().nullable(), actorName: z.string().nullable(),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])), createdAt: instant,
});
export type AdminLogItem = z.infer<typeof adminLogItemSchema>;
export const adminLogPageSchema = z.object({ items: z.array(adminLogItemSchema), nextCursor: z.string().nullable() });

/** `POST /api/admin/invites` and `…/renew` (the owner picks email or a copied link). */
export const adminInviteBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  delivery: z.enum(["email", "link"]),
});
export const adminRenewBodySchema = z.object({ delivery: z.enum(["email", "link"]) });
export const adminInviteResultSchema = z.object({
  status: z.enum(["sent", "link", "email_limit", "email_failed"]),
  link: z.string().optional(),
});
export type AdminInviteResult = z.infer<typeof adminInviteResultSchema>;

/** `POST /api/admin/invites/preview` and `…/accept` */
export const adminInviteTokenBodySchema = z.object({ token: z.string().min(16).max(128) });
export const adminInvitePreviewSchema = z.object({
  status: z.enum(["ready", "wrong_account", "expired", "revoked", "used", "already_admin", "not_found"]),
  maskedEmail: z.string().nullable(),
});
export type AdminInvitePreview = z.infer<typeof adminInvitePreviewSchema>;
```

Run: `bun run test -- --run src/shared/api/admin` → PASS.

- [ ] **Step 2: Queries and the admin context**

`src/server/queries/admin.ts` holds one function per RPC, each `(client, …args) → Promise<{ data; error }>` with Zod parsing of the snake_case JSON into the camelCase schemas above (a `snakeToCamel` mapper per shape, written out field by field, no generic key rewriting), e.g.:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import type { AdminWorkspaceRow } from "@/shared/api/admin";

type Client = SupabaseClient<Database>;

const workspaceRow = z.object({
  id: z.uuid(), name: z.string(), slug: z.string(), created_at: z.string(), owner_email: z.string().nullable(),
  team: z.number(), contacts: z.number(), meetings_30d: z.number(), emails_30d: z.number(), failed_30d: z.number(),
  reports_7d: z.number(), people_7d: z.number(), suspended: z.boolean(),
  sender: z.enum(["none", "active", "broken"]), sheet: z.enum(["off", "on", "paused"]), sort_value: z.string(),
});

/** One page of workspaces (`limit + 1` rows, so the route knows if more exist). */
export async function adminWorkspaces(
  client: Client,
  input: { q: string | null; filter: string; sort: string; after: [string, string] | null; limit: number },
): Promise<{ data: Array<AdminWorkspaceRow & { sortValue: string }> | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await client.rpc("admin_workspaces", {
    p_search: sqlNullable(input.q),
    p_filter: input.filter,
    p_sort: input.sort,
    p_after_value: sqlNullable(input.after?.[0] ?? null),
    p_after_id: sqlNullable(input.after?.[1] ?? null),
    p_limit: input.limit + 1,
  });
  if (error) {
    return { data: null, error };
  }
  const rows = z.object({ items: z.array(workspaceRow) }).parse(data).items;
  return {
    data: rows.map((row) => ({
      id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at, ownerEmail: row.owner_email,
      team: row.team, contacts: row.contacts, meetings30d: row.meetings_30d, emails30d: row.emails_30d,
      failed30d: row.failed_30d, reports7d: row.reports_7d, people7d: row.people_7d, suspended: row.suspended,
      sender: row.sender, sheet: row.sheet, sortValue: row.sort_value,
    })),
    error: null,
  };
}
```

and in the same shape: `adminOverview(client, days)`, `adminWorkspace(client, id)`, `adminReports(client, after, limit)`, `adminMarkReviewed(client, id)`, `adminAdmins(client)`, `adminInvite(client, email, tokenHash)`, `adminInviteRenew(client, id, tokenHash)`, `adminInviteRevoke(client, id)`, `adminRemove(client, userId)`, `consumeAdminInviteEmail(client)`, `adminInvitePreview(client, tokenHash)`, `acceptAdminInvite(client, tokenHash)`, `adminLog(client, filter, afterId, limit)`, `suspendWorkspace(client, id)`, `liftSuspension(client, id)`, `myPlatformRole(client)`. `sqlNullable` is the existing helper in `src/server/db/rpc-args.ts` (PostgREST resolves by argument names; nulls must be sent explicitly).

`src/server/http/admin-context.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database } from "@/server/db/database.types";
import { myPlatformRole } from "@/server/queries/admin";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { apiError } from "./errors";
import { requireUser, type AuthedUser } from "./require-user";

/** Everything an `/api/admin/**` handler needs, or the response to return. */
export type AdminContext =
  | { ok: true; supabase: SupabaseClient<Database>; user: AuthedUser; role: "owner" | "admin" }
  | { ok: false; response: NextResponse };

/**
 * Session + platform role (spec §7.19): signed out → 401; signed in but not a platform admin → 404,
 * so the admin area never reveals it exists. The database functions check the role again.
 */
export async function loadAdminContext(): Promise<AdminContext> {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return { ok: false, response: apiError("unauthenticated") };
  }
  const role = await myPlatformRole(supabase);
  return role ? { ok: true, supabase, user, role } : { ok: false, response: apiError("not_found") };
}
```

`admin-context.test.ts`: signed out → 401; a member with no platform role → 404; an admin → ok with `role: "admin"` (mock the two queries as `workspace-context.test.ts` does).

- [ ] **Step 3: The routes (one example in full, then each one's exact contract)**

`src/app/api/admin/workspaces/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadAdminContext } from "@/server/http/admin-context";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { readPageParams, toPage } from "@/server/http/pagination";
import { adminWorkspaces } from "@/server/queries/admin";
import { ADMIN_WORKSPACE_FILTERS, ADMIN_WORKSPACE_SORTS, adminWorkspaceRowSchema } from "@/shared/api/admin";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(ADMIN_WORKSPACE_FILTERS).default("all"),
  sort: z.enum(ADMIN_WORKSPACE_SORTS).default("newest"),
});
const cursorSchema = z.tuple([z.string().max(64), z.uuid()]);

/** `GET /api/admin/workspaces?q=&filter=&sort=&cursor=&limit=` (spec §10 Admin API). */
export async function GET(request: Request): Promise<NextResponse> {
  const search = new URL(request.url).searchParams;
  const query = querySchema.safeParse({
    q: search.get("q") ?? undefined,
    filter: search.get("filter") ?? undefined,
    sort: search.get("sort") ?? undefined,
  });
  if (!query.success) {
    return apiError("invalid_input");
  }
  const page = readPageParams(request, cursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await adminWorkspaces(context.supabase, {
    q: query.data.q || null,
    filter: query.data.filter,
    sort: query.data.sort,
    after: page.after,
    limit: page.limit,
  });
  if (error || !data) {
    return fromDatabaseError(error ?? { message: "no data" });
  }
  const result = toPage(data, page.limit, (row) => [row.sortValue, row.id]);
  // The schema drops sortValue: the cursor carries it, the rows don't need it.
  return NextResponse.json({ ...result, items: result.items.map((row) => adminWorkspaceRowSchema.parse(row)) });
}
```

The hooks always send `limit=25` (`ADMIN_PAGE_SIZE`); a missing `limit` falls back to `PAGE_SIZE_DEFAULT` like every paged route. Every other route follows the same order (parse query/body → Origin check on writes (`rejectCrossOrigin`) → `loadAdminContext()` → one query → `fromDatabaseError` or JSON):

| Route | Method | In | Query fn | Out |
|---|---|---|---|---|
| `admin/overview` | GET | `?days=7\|30\|90` (default 30) | `adminOverview` | `AdminOverview` |
| `admin/workspaces/[id]` | GET | `id` uuid | `adminWorkspace` | `AdminWorkspace` |
| `admin/workspaces/[id]/suspension` | POST / DELETE | `id` | `suspendWorkspace` / `liftSuspension` | `{ ok: true }`; then `scheduleWorkers(["platform"])` |
| `admin/reports` | GET | `?cursor=` (`[reportedAt, id]`) | `adminReports` | `{ items, nextCursor }` |
| `admin/reports/[id]/reviewed` | POST | `id` | `adminMarkReviewed` | `{ ok: true }` |
| `admin/admins` | GET | — | `adminAdmins` | `AdminAdmins` |
| `admin/admins/[userId]` | DELETE | `userId` (owner only) | `adminRemove` | `{ ok: true }`; `scheduleWorkers(["platform"])` |
| `admin/invites` | POST | `adminInviteBodySchema` (owner only) | `generateToken()` → `adminInvite(email, sha256Hex(token))` → `deliverAdminInvite` | `AdminInviteResult` |
| `admin/invites/[id]` | DELETE | `id` (owner only) | `adminInviteRevoke` | `{ ok: true }` |
| `admin/invites/[id]/renew` | POST | `adminRenewBodySchema` | new token → `adminInviteRenew` → `deliverAdminInvite` | `AdminInviteResult` |
| `admin/invites/preview` | POST | `adminInviteTokenBodySchema` (any signed-in person: **not** `loadAdminContext`, just `requireUser`) | `adminInvitePreview(sha256Hex(token))` | `AdminInvitePreview` |
| `admin/invites/accept` | POST | `adminInviteTokenBodySchema` (signed in, `requireUser`) | `acceptAdminInvite(sha256Hex(token))` | `{ ok: true }`; `scheduleWorkers(["platform"])` |
| `admin/log` | GET | `?filter=&cursor=` (`[id]`) | `adminLog` | `{ items, nextCursor }` |

Owner-only routes check `context.role === "owner"` and answer `not_found` otherwise (the database refuses too). Each route's test covers: 401 signed out, 404 for a non-admin, 400 for a bad query or body, 403 `invalid_origin` on a cross-origin write, the happy path's JSON, and a `tn:…` error mapped (e.g. `tn:conflict` on a second suspend → 409).

`src/server/admin/deliver-admin-invite.ts` (mirrors `deliverInviteOutcome`, same failure rules: budget spent per attempt, a failed send leaves the invite valid):

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { renderAdminInviteEmail } from "@/emails/admin-invite-email";
import { logger } from "@/lib/logger";
import type { Database } from "@/server/db/database.types";
import { createSystemMailer, type SystemEmail } from "@/server/email/system-mailer";
import { consumeAdminInviteEmail } from "@/server/queries/admin";
import type { AdminInviteResult } from "@/shared/api/admin";

/** Hands one fresh admin invite token to its person: the link, or an email within the platform budget. */
export async function deliverAdminInvite(input: {
  supabase: SupabaseClient<Database>;
  token: string;
  email: string;
  expiresAt: string;
  delivery: "email" | "link";
  origin: string;
  inviterName: string;
  mailer?: { send: (email: SystemEmail) => Promise<void> };
}): Promise<AdminInviteResult> {
  const link = `${input.origin}/admin/join/${input.token}`;
  if (input.delivery === "link") {
    return { status: "link", link };
  }
  const budget = await consumeAdminInviteEmail(input.supabase);
  if (budget.error) {
    throw new Error(budget.error.message);
  }
  if (budget.data !== true) {
    return { status: "email_limit" };
  }
  try {
    const content = await renderAdminInviteEmail({
      inviterName: input.inviterName,
      link,
      expiresInDays: differenceInCalendarDays(parseISO(input.expiresAt), new Date()),
    });
    await (input.mailer ?? createSystemMailer()).send({ to: input.email, ...content });
  } catch (error) {
    logger.error({ err: error }, "admin invite email failed");
    return { status: "email_failed" };
  }
  return { status: "sent" };
}
```

The `origin` is built the way the workspace invite route builds it (`NEXT_PUBLIC_APP_URL` or the deployment URL, never a request header: spec §9). `src/emails/admin-invite-email.tsx`: `EmailLayout` + one paragraph + the button + the fallback link, copy from `Email.adminInvite` (`subject`: "{inviter} invited you to help run {appName}", `heading`: "Help run {appName}", `body`: "{inviter} added you as an admin of {appName}. You'll see how the platform is doing, look at reports from people who say they never joined a group, and pause a group's emails when needed. The invite works for {days, plural, one {# day} other {# days}} and only for this address.", `button`: "Accept the invite", `fallback`: "If the button doesn't work, copy this link:"). Its test: subject, the link, no technical words.

Add every route to `ROUTES` (`route-registry.test.ts` fails until you do): reads `{ limits: [SIGNED_IN_READ], list: … }` (`overview`, `workspaces/[id]`, `admins` → `SINGLE`; `workspaces`, `reports`, `log` → `PAGED`); writes `user("admin_write", "public.admin_suspend")` / `"public.admin_lift"` / `"public.admin_mark_reviewed"` / `"public.admin_remove"` / `"public.admin_invite_revoke"`, `user("admin_invite", "public.admin_invite")` / `"public.admin_invite_renew"`, `user("admin_invite_preview", "public.admin_invite_preview")`, `user("admin_invite_accept", "public.accept_admin_invite")`. The DB half of the registry test checks each against the functions of Tasks 14–16.

- [ ] **Step 4: `platformRole` on `/api/me`, the token pattern, the hooks**

`src/shared/api/me.ts`: `platformRole: z.enum(["owner", "admin"]).nullable()` in `meResponseSchema`. `src/server/queries/profile.ts`: a third call in `getMe`'s `Promise.all`, `client.rpc("my_platform_role")`, mapped to `platformRole` (`null` unless `"owner"` / `"admin"`); its DB test: a platform admin gets `"admin"`, anyone else `null`. `src/test/fixtures/me.ts`: `platformRole: null`.

`src/lib/observability/scrub.ts`: `TOKEN_LINK` becomes `/(?:\/|%2f)(r|u|report|invite|admin(?:\/|%2f)join)(?:\/|%2f)(?!\[|%5b)[^/?#&\s"'\\]+/gi` and both replacers normalise the segment (`admin%2fjoin` → `admin/join`); `scrub.test.ts` and the analytics `routePatternUrl` test gain `/admin/join/<token>` → `/admin/join/[REDACTED]` / `/admin/join/[token]`. `src/config/security-headers.ts`: add `"/admin/join/:token*"` to `tokenPageHeaders` (no referrer) and its test.

`src/hooks/use-admin.ts`: `ADMIN_QUERY_KEY = ["admin"] as const`; reads with `useQuery` (`["admin", "overview", days]`, `["admin", "workspace", id]`, `["admin", "admins"]`) and `usePagedList` for the three lists with `limit: ADMIN_PAGE_SIZE`; mutations with `useMutation` + `apiRequest({ method, body, schema })` that invalidate `ADMIN_QUERY_KEY` on success. `use-admin.test.tsx` (the `use-my-invites` test pattern with a stubbed `fetch`): the workspaces list requests `?q=&filter=&sort=&limit=25`, a suspend posts to `/api/admin/workspaces/<id>/suspension` and refetches the workspace.

Run: `bun run test -- --run src/shared src/server src/app/api/admin src/hooks src/lib/observability src/config` and `bun run test:db -- src/server/db/m9-write-limits src/server/queries` → PASS.

- [ ] **Step 5: Chain, commit, PR, merge**

Commit: `feat(api): the platform admin API and platformRole on /api/me`.
### Task 19: Admin UI (1): the admin shell, Overview, Workspaces and one workspace

**Issue labels:** `type:task`, `area:frontend`. **Branch:** `feat/<issue>-admin-ui`.

**Files:**
- Modify: `src/components/shell/bottom-bar.tsx` (extract the plain item), Create: `src/components/shell/nav-link.tsx`
- Create: `src/components/admin/admin-nav.ts`, `admin-nav.test.ts`, `admin-shell.tsx`, `admin-shell.test.tsx`
- Create: `src/app/admin/(area)/layout.tsx`, `src/app/admin/(area)/page.tsx`, `src/app/admin/(area)/workspaces/page.tsx`, `src/app/admin/(area)/workspaces/[id]/page.tsx`
- Create: `src/components/admin/attention-list.tsx`, `figure-tiles.tsx`, `weekly-chart.tsx`, `system-health.tsx`, `workspace-row.tsx`, `workspace-table.tsx`, `workspace-facts.tsx`, `suspension-actions.tsx`, `suspension-history.tsx`, and a test per component (`*.test.tsx`)
- Create: `src/lib/admin/format.ts`, `format.test.ts` (rates and trends)
- Modify: `src/components/shell/user-menu.tsx` (+ test: **Admin** for platform admins), `src/server/supabase/proxy-session.ts` (+ test: `/admin` needs a session), `messages/en.json` (`Admin`)
- Modify: `e2e/m9-admin.spec.ts`, `e2e/helpers/admin.ts` (`makePlatformAdmin`)

**Interfaces:**
- Consumes: the hooks of Task 18, `NotFoundView` (Task 2), `ConfirmDialog`, `SegmentedControl`, `Chip`, `CHIP_ROW_CLASS`, `Select`, `Input`, `ShowMore`, `Sticker`, `Card`, `copyText` (`src/lib/clipboard.ts`), `BrandMark` (Task 11).
- Produces: `ADMIN_NAV` (5 items: overview, workspaces, reports, admins, log), `AdminShell({ children })`, `NavLink`, `percentFromBasisPoints(bp: number | null): number | null`, `trend(current: number, previous: number): { change: number | null; tone: "up" | "down" | "flat" }` (`change` null = new), `reportPercent(reports: number, people: number): number`; every word around those numbers comes from `messages/en.json`. Task 20 adds the last three tabs' pages.

**Rulings (copy into the ledger):**
- The admin pages live in the route group `src/app/admin/(area)/` (no change to their URLs), so `/admin/join/[token]` (Task 20) sits outside the admin shell: the person accepting an invite isn't an admin yet.
- Who may see `/admin` is decided by `GET /api/me`'s `platformRole` in the client shell, and the not-found view is shown to everyone else; the API answers 404 to them for every call (spec §7.19). The page's HTTP status is 200 for them: the route's existence is not a secret in a public repository, the data is, and no admin data is ever sent to a non-admin. Reading the role in a server layout would be the RSC data read the Owner ruled out.
- The weekly chart is plain CSS bars with the numbers in a visually hidden table (accessible, no chart library).

- [ ] **Step 1: Failing unit tests for the nav, the formats and the shell**

`src/components/admin/admin-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, activeAdminItem } from "./admin-nav";

describe("admin nav", () => {
  it("has the five tabs in order", () => {
    expect(ADMIN_NAV.map((item) => item.key)).toEqual(["overview", "workspaces", "reports", "admins", "log"]);
  });

  it.each([
    ["/admin", "overview"],
    ["/admin/workspaces", "workspaces"],
    ["/admin/workspaces/6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "workspaces"],
    ["/admin/log", "log"],
  ])("%s → %s", (path, key) => {
    expect(activeAdminItem(path)).toBe(key);
  });
});
```

`src/lib/admin/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { percentFromBasisPoints, reportPercent, trend } from "./format";

describe("admin number formats", () => {
  it("turns basis points into a percent with up to two decimals", () => {
    expect(percentFromBasisPoints(9860)).toBe(98.6);
    expect(percentFromBasisPoints(null)).toBeNull();
  });

  it("gives the report rate with one decimal (the mockups' 4.1%)", () => {
    expect(reportPercent(3, 74)).toBe(4.1);
    expect(reportPercent(2, 0)).toBe(100);
  });

  it("compares with the previous period", () => {
    expect(trend(214, 181)).toEqual({ change: 18, tone: "up" });
    expect(trend(10, 20)).toEqual({ change: -50, tone: "down" });
    expect(trend(5, 5)).toEqual({ change: 0, tone: "flat" });
    expect(trend(4, 0)).toEqual({ change: null, tone: "up" });
    expect(trend(0, 0)).toEqual({ change: 0, tone: "flat" });
  });
});
```

`src/components/admin/admin-shell.test.tsx` (mock `useMe` as other shell tests do): a platform admin sees the nav (`navigation` named "Admin") and the children; a member without a platform role sees "We can't find that page" and **not** the children; while `/api/me` loads, a skeleton and no children.

Also (Review Focus 5): when an admin query answers 404 while the page is open (the person was removed meanwhile), the shell refetches `/api/me` and shows the not-found view instead of an error card: in `admin-shell.test.tsx`, stub `/api/admin/overview` → 404 and `/api/me` → `platformRole: null` on its second call, and expect "We can't find that page". Implement it with a `QueryCache`-free approach: the admin hooks' `onError` (404 → `queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })`).

`src/components/shell/user-menu.test.tsx`: with `{ ...meFixture, platformRole: "admin" }` the menu lists **Admin** (link to `/admin`) before Sign out; with `platformRole: null` it doesn't.

Run: `bun run test -- --run src/components/admin src/lib/admin src/components/shell` → FAIL.

- [ ] **Step 2: Messages**

`messages/en.json`, new namespace `Admin` (all strings of Tasks 19–20; plain words, no technical text):

```json
  "Admin": {
    "title": "Platform",
    "backToApp": "App",
    "nav": { "label": "Admin", "overview": "Overview", "workspaces": "Workspaces", "reports": "Reports", "admins": "Admins", "log": "Log" },
    "period": { "label": "Period", "7": "7 days", "30": "30 days", "90": "90 days" },
    "attention": {
      "title": "Needs attention · {count}",
      "none": "Nothing needs you right now.",
      "reports": "{count, plural, one {# new report} other {# new reports}}",
      "reportsBody": "People said they never joined these groups.",
      "suspended": "{name} is suspended",
      "suspendedAuto": "Automatically, {time}",
      "suspendedAdmin": "By an admin, {time}",
      "email": "Platform email: {used} of {cap} today",
      "emailBody": "Team invite emails and notices to Owners. Copy link still works when it's full."
    },
    "figures": {
      "workspaces": "Workspaces", "workspacesNew": "{count} new",
      "active": "Active", "activeHint": "sent a meeting",
      "meetings": "Meetings sent",
      "emails": "Emails delivered", "emailsRate": "{rate} delivered",
      "answers": "Answer rate", "answersHint": "answered before the start",
      "accounts": "Accounts", "accountsNew": "{count} new",
      "pushes": "Phone notifications", "pushesRate": "{rate} delivered"
    },
    "weekly": { "title": "Meetings sent per week", "week": "Week of {date}", "meetings": "Meetings" },
    "health": {
      "title": "System health",
      "queue": "Email queue", "queueValue": "{count} waiting · oldest {age}", "queueEmpty": "Nothing waiting",
      "sheets": "Google Sheets", "sheetsValue": "{paused} paused of {total}",
      "senders": "Senders needing reconnect"
    },
    "workspaces": {
      "title": "Workspaces",
      "search": "Search by name or Owner email",
      "filters": { "all": "All", "suspended": "Suspended", "reported": "Reported", "no_sender": "No sender" },
      "sort": { "label": "Sort", "newest": "Newest", "reports": "Most reports", "emails": "Most emails" },
      "empty": "No workspace matches.",
      "row": "{people} people · {meetings} meetings · {rate} delivered",
      "end": "That's every workspace.",
      "status": { "suspended": "Suspended", "sending": "Sending", "noSender": "No sender", "broken": "Needs reconnect", "sheetOn": "Sheet on", "sheetPaused": "Sheet paused" }
    },
    "workspace": {
      "back": "Workspaces",
      "suspendedAuto": "Sending suspended automatically",
      "suspendedAdmin": "Sending suspended by an admin",
      "suspendedRate": "{rate} in the last 7 days",
      "suspend": "Suspend sending",
      "lift": "Lift suspension",
      "suspendTitle": "Suspend sending for {name}?",
      "suspendBody": "Queued emails pause and new sends are refused. The Owner gets an email.",
      "liftTitle": "Lift the suspension of {name}?",
      "liftBody": "Paused emails go out again, except for meetings that have started. The Owner gets an email.",
      "copyOwner": "Copy Owner email",
      "copied": "Owner email copied",
      "copyFailed": "Couldn't copy. Select the address instead.",
      "facts": "Workspace",
      "created": "Created", "owner": "Owner", "team": "Team", "teamValue": "{owner} Owner · {admin} Admins · {viewer} Viewers",
      "people": "People", "sender": "Sender Gmail", "sheet": "Google Sheet",
      "sender_none": "Not connected", "sender_active": "Connected", "sender_broken": "Needs reconnecting",
      "sheet_off": "Off", "sheet_on": "On", "sheet_paused": "Paused",
      "last30": "Last 30 days",
      "meetingsSent": "Meetings sent", "emailsSent": "Emails", "emailsFailed": "{count} failed", "reports": "Reports", "unsubscribes": "Unsubscribes",
      "history": "Suspension history", "historyEmpty": "Never suspended.",
      "historyAuto": "{date} · automatic", "historyBy": "{date} · by {name}", "historyByAdmin": "{date} · by an admin",
      "historyActive": "active", "historyLifted": "lifted {date}"
    }
  },
```

(Task 20 appends `reports`, `admins`, `log` and `join` keys to the same namespace.)

- [ ] **Step 3: Nav, shell, formats**

`src/components/shell/nav-link.tsx` (the plain bottom-bar item, moved out of `bottom-bar.tsx`, which now uses it for every item but the center "+"):

```tsx
"use client";

import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** One bottom-bar destination: icon over a short label, 44 px tall, filled when current. */
export function NavLink({ href, label, glyph: Glyph, active }: { href: string; label: string; glyph: Icon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 min-w-14 flex-col items-center gap-0.5 rounded-control px-2 py-1 text-xs font-bold",
        active ? "bg-fill-primary text-on-fill" : "text-ink",
      )}
    >
      <Glyph weight="bold" aria-hidden className="size-6" />
      {label}
    </Link>
  );
}
```

(Move exactly the markup `bottom-bar.tsx` already renders for a plain item; its tests stay green.)

`src/components/admin/admin-nav.ts`:

```ts
import { Buildings, Flag, Gauge, ListBullets, UsersThree, type Icon } from "@phosphor-icons/react";

/** One admin tab (spec §7.19). */
export type AdminNavItem = { key: "overview" | "workspaces" | "reports" | "admins" | "log"; href: string; glyph: Icon };

/** The five tabs, in order. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: "overview", href: "/admin", glyph: Gauge },
  { key: "workspaces", href: "/admin/workspaces", glyph: Buildings },
  { key: "reports", href: "/admin/reports", glyph: Flag },
  { key: "admins", href: "/admin/admins", glyph: UsersThree },
  { key: "log", href: "/admin/log", glyph: ListBullets },
];

/** The tab a path belongs to (Overview only for `/admin` itself). */
export function activeAdminItem(pathname: string): AdminNavItem["key"] {
  const match = ADMIN_NAV.slice(1).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return match?.key ?? "overview";
}
```

`src/components/admin/admin-shell.tsx`:

```tsx
"use client";

import { ArrowLeft, ShieldStar } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { NotFoundView } from "@/components/errors/not-found-view";
import { NavLink } from "@/components/shell/nav-link";
import { UserMenu } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, activeAdminItem } from "./admin-nav";

/**
 * The admin area's frame (spec §7.19): a header, the five tabs as a bottom bar on phones and a side
 * menu from md up. Anyone without a platform role sees the not-found view instead.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations("Admin");
  const pathname = usePathname();
  const me = useMe();
  if (!me.data) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }
  if (!me.data.platformRole) {
    return <NotFoundView signedIn />;
  }
  const active = activeAdminItem(pathname);
  const nav = (vertical: boolean) => (
    <ul className={cn(vertical ? "flex flex-col gap-1" : "mx-auto flex max-w-md items-end justify-around px-2 py-2")}>
      {ADMIN_NAV.map((item) => (
        <li key={item.key}>
          <NavLink href={item.href} label={t(`nav.${item.key}`)} glyph={item.glyph} active={item.key === active} />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="min-h-dvh pb-28 md:pb-0">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b-[length:var(--tn-border-width)] border-outline bg-surface px-4 py-2">
        <Sticker tone="danger">
          <ShieldStar weight="bold" />
        </Sticker>
        <p className="flex-1 font-display text-lg">{t("title")}</p>
        <Button asChild>
          <Link href="/welcome">
            <ArrowLeft weight="bold" aria-hidden className="size-4" />
            {t("backToApp")}
          </Link>
        </Button>
        <UserMenu me={me.data} />
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 p-4">
        <nav aria-label={t("nav.label")} className="sticky top-20 hidden h-fit w-48 shrink-0 md:block">
          {nav(true)}
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <nav aria-label={t("nav.label")} className="fixed inset-x-0 bottom-0 z-40 border-t-[length:var(--tn-border-width)] border-outline bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav(false)}
      </nav>
    </div>
  );
}
```

(Two `nav` landmarks share the label but only one is visible at a time (`hidden` / `md:hidden` remove the other from the accessibility tree); the shell test queries the visible one.) `src/app/admin/(area)/layout.tsx`: `export default function AdminLayout({ children }: LayoutProps<"/admin">) { return <AdminShell>{children}</AdminShell>; }` with `export const metadata = { robots: { index: false, follow: false } }`.

`src/server/supabase/proxy-session.ts`: add `"/admin"` to `requiresSession`'s roots (and the test table: `/admin` true, `/admin/join/x` true).

`src/components/shell/user-menu.tsx`: when `me.platformRole`, an item `<DropdownMenuItem asChild><Link href="/admin"><ShieldStar weight="bold" aria-hidden />{t("admin")}</Link></DropdownMenuItem>` after Account (`Shell.admin`: "Admin").

`src/lib/admin/format.ts`:

```ts
/** Basis points (1/100 of a percent, as the SQL returns rates) as a percent; null stays null. */
export function percentFromBasisPoints(bp: number | null): number | null {
  return bp === null ? null : Math.round(bp) / 100;
}

/** Reports as a share of the people emailed, one decimal (100 when nobody was emailed). */
export function reportPercent(reports: number, people: number): number {
  return people > 0 ? Math.round((reports / people) * 1000) / 10 : 100;
}

/** This period against the previous one of the same length; `change` is null when it is new. */
export function trend(current: number, previous: number): { change: number | null; tone: "up" | "down" | "flat" } {
  if (previous === 0) {
    return current > 0 ? { change: null, tone: "up" } : { change: 0, tone: "flat" };
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return { change, tone: change > 0 ? "up" : change < 0 ? "down" : "flat" };
}
```

The words go in `Admin`: add `"rate": "{reports} of {people} people · {percent}%"`, `"noReports": "No reports"`, `"trendUp": "+{change}%"`, `"trendDown": "−{change}%"`, `"trendFlat": "same as before"`, `"trendNew": "new"` and `"percent": "{value}%"`; components format numbers with `useFormatter().number`.

- [ ] **Step 4: Overview (`/admin`)**

`src/app/admin/(area)/page.tsx` (client): `const [days, setDays] = useState<7 | 30 | 90>(30)`, `useAdminOverview(days)`; renders, top to bottom: `AttentionList` (always first; "Nothing needs you right now." when empty), a `SegmentedControl` for the period (`Admin.period`), `FigureTiles` (`current` vs `previous`: Workspaces with "N new", Active, Meetings sent with the trend, Emails delivered with the delivered rate `(sent - failed) / sent`, Answer rate, Accounts with "N new", Phone notifications with their rate), `WeeklyChart`, `SystemHealth`. Loading: skeletons in the same layout. Errors: the shared error card.

Components (each with a test asserting its visible text for a fixture and its empty or zero state):
- `attention-list.tsx`: one row per new-reports count (links to `/admin/reports`), per open suspension (links to `/admin/workspaces/<id>`; amber sticker; "Automatically, 2 hours ago" with `date-fns` `formatDistanceToNow`), and the platform email line (info sticker) when used ≥ 80% of the cap.
- `figure-tiles.tsx`: a two-column grid (three from md up) of `Card`s: label, big number (`useFormatter().number`), a small line (trend in `text-success` / `text-danger` / muted, or the hint).
- `weekly-chart.tsx`: 12 bars `div`s with `style={{ height: `${(meetings / max) * 100}%` }}` (max ≥ 1) and a `<table className="sr-only">` with "Week of {date}" / count rows; `aria-hidden` on the bars.
- `system-health.tsx`: a `Card` with a definition list: Email queue ("12 waiting · oldest 2 min" or "Nothing waiting"), Google Sheets ("2 paused of 19"), Senders needing reconnect.

- [ ] **Step 5: Workspaces (`/admin/workspaces`) and one workspace (`/admin/workspaces/[id]`)**

`src/app/admin/(area)/workspaces/page.tsx` (client): the search `Input` (debounced 300 ms with a `useEffect` timer; trimmed), filter `Chip`s in a `CHIP_ROW_CLASS` row (`All`, `Suspended`, `Reported`, `No sender`), the sort `Select`, then `useAdminWorkspaces({ q, filter, sort })` rows: `WorkspaceRow` cards on phones (`md:hidden`), `WorkspaceTable` from md up (name, Owner, people, meetings, emails, reports, status), each row a link to the detail page; `ShowMore` at the foot with "That's every workspace."; "No workspace matches." when empty. The query string keeps `q`, `filter`, `sort` (`useSearchParams` + `router.replace`, so Back keeps the view; wrap in `Suspense`).

`WorkspaceRow` pills: Suspended (danger), "N reports · x%" (warning when > 0), Sending / No sender / Needs reconnect, Sheet on / Sheet paused; the second line `Admin.workspaces.row`.

`src/app/admin/(area)/workspaces/[id]/page.tsx` (client): `useAdminWorkspace(id)`; back link "Workspaces"; when suspended, a danger banner ("Sending suspended automatically" / "…by an admin", the 7-day rate); `SuspensionActions`: **Suspend sending** (danger tone) or **Lift suspension** (primary), each through `ConfirmDialog` with the `Admin.workspace.*Title/*Body` copy, pending state, toast on success, the API error's plain message on failure; **Copy Owner email** (`copyText`; toast "Owner email copied" or "Couldn't copy…"); `WorkspaceFacts` (created, Owner name and masked email, team, people, sender, sheet); the last-30-days tiles; `SuspensionHistory` (newest first: "15 Oct · automatic — active", "3 Oct · by Sami — lifted 4 Oct"; the actor's display name, or "an admin" when unknown).

The Owner email is shown masked on the page (`a•••@gmail.com`, built with the same rule as `private.mask_email`: first letter, `•••@`, domain) and copied in full; the full address never renders.

Run: `bun run test -- --run src/components/admin src/app/admin src/lib/admin src/components/shell src/server/supabase` → PASS.

- [ ] **Step 6: e2e, screenshots, chain, merge**

`e2e/m9-admin.spec.ts`, add (seed a platform admin with SQL through the existing e2e seed helper that runs SQL, the way `e2e/helpers/seed.ts` seeds members):

`e2e/helpers/admin.ts`, add:

```ts
/** Makes the account with `email` a platform admin (e2e setup; the product uses invites). */
export async function makePlatformAdmin(email: string): Promise<void> {
  const { data, error } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw error;
  }
  const user = data.users.find((candidate) => candidate.email === email);
  if (!user) {
    throw new Error(`no account for ${email}`);
  }
  const insert = await adminClient().from("platform_admins").insert({ user_id: user.id, role: "admin" });
  if (insert.error) {
    throw insert.error;
  }
}
```

`e2e/m9-admin.spec.ts` (created in Task 17), add these two tests, merging the imports:

```ts
import { makePlatformAdmin } from "./helpers/admin";
import { signInWithCode, signUpWithWorkspace, uniqueEmail } from "./helpers/sign-in";
import { expect, test } from "./helpers/test";

test("a platform admin sees the overview and suspends then lifts a workspace", async ({ page, browser }) => {
  const stamp = crypto.randomUUID().slice(0, 6);
  const ownerPage = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(ownerPage, `Seeded Club ${stamp}`);
  const adminEmail = uniqueEmail("e2e-admin");
  await signInWithCode(page, adminEmail, { startPath: "/login", name: "Admin Person" });
  await makePlatformAdmin(adminEmail);
  await page.goto("/admin");
  await expect(page.getByText(/Needs attention|Nothing needs you right now/)).toBeVisible();
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Workspaces" }).click();
  await page.getByRole("textbox", { name: "Search by name or Owner email" }).fill(`Seeded Club ${stamp}`);
  await page.getByRole("link", { name: new RegExp(`Seeded Club ${stamp}`) }).first().click();
  await page.getByRole("button", { name: "Suspend sending" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suspend sending" }).click();
  await expect(page.getByText("Sending suspended by an admin")).toBeVisible();
  await page.getByRole("button", { name: "Lift suspension" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Lift suspension" }).click();
  await expect(page.getByRole("button", { name: "Suspend sending" })).toBeVisible();
});

test("anyone else sees the not-found view at /admin", async ({ page }) => {
  await signInWithCode(page, uniqueEmail("e2e-member"), { startPath: "/login", name: "Member" });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
});
```

 Screenshots of Overview (data and empty), Workspaces (phone cards and the desktop table), one workspace (suspended and not), both confirm dialogs, at 390 light, 320 dark and 1024; "Looks right?" before merging. Chain; commit `feat(admin): admin shell, Overview, Workspaces and the workspace page with suspend and lift`.
### Task 20: Admin UI (2): Reports, Admins and invites, the Log, and `/admin/join/[token]`

**Issue labels:** `type:task`, `area:frontend`. **Branch:** `feat/<issue>-admin-ui-2`.

**Files:**
- Create: `src/components/invites/invite-cards.tsx`, `src/components/invites/invite-cards.test.tsx`; Modify: `src/app/invite/[token]/invite-acceptance.tsx` (uses them; its tests stay green)
- Create: `src/app/admin/(area)/reports/page.tsx`, `src/app/admin/(area)/admins/page.tsx`, `src/app/admin/(area)/log/page.tsx`, `src/app/admin/join/[token]/page.tsx`, `src/app/admin/join/[token]/admin-join.tsx`, `admin-join.test.tsx`
- Create: `src/components/admin/report-row.tsx`, `admin-list.tsx`, `invite-admin-dialog.tsx`, `waiting-invites.tsx`, `log-row.tsx`, and a test per component
- Modify: `messages/en.json` (`Admin.reports`, `Admin.admins`, `Admin.log`, `Admin.join`)
- Modify: `e2e/m9-admin.spec.ts`

**Interfaces:**
- Consumes: Task 18's hooks (`useAdminReports`, `useMarkReviewed`, `useAdminAdmins`, `useInviteAdmin`, `useRenewAdminInvite`, `useRevokeAdminInvite`, `useRemoveAdmin`, `useAdminLog`, `useAdminInvitePreview`, `useAcceptAdminInvite`), `AdminShell` (Task 19), `ConfirmDialog`, `copyText`, `ShowMore`, `Chip`, `SegmentedControl`, `DropdownMenu`.
- Produces: `InviteSignInCard`, `InviteWrongAccountCard`, `InviteClosedCard` (shared by both invite pages); `logSentence(item: AdminLogItem, t): string` inside `log-row.tsx`.

**Ruling (copy into the ledger):** both invite pages share their sign-in, wrong-account and closed-state cards and their words (`InvitePage.wrongTitle`, `wrongBody`, `switchAccount`, `expired`, `revoked`, `used`, `notFound`); only the ready and already-admin states have words of their own.

- [ ] **Step 1: Messages**

Append to `Admin` in `messages/en.json`:

```json
    "reports": {
      "title": "Reports",
      "row": "{rate} · {when}",
      "reviewed": "Reviewed by {name}",
      "reviewedNoName": "Reviewed",
      "markReviewed": "Mark reviewed",
      "openWorkspace": "Open workspace",
      "empty": "No reports. People haven't told us about any group they didn't join.",
      "end": "That's every report."
    },
    "admins": {
      "title": "Platform admins",
      "owner": "Platform owner",
      "ownerHint": "Set at setup · can't be removed",
      "admin": "Admin",
      "since": "{email} · since {date}",
      "you": "You",
      "remove": "Remove",
      "removeTitle": "Remove {name} as an admin?",
      "removeBody": "They lose access to this area at once. Their account stays.",
      "waiting": "Invites waiting",
      "expires": "Expires {when}",
      "copyLink": "Copy link",
      "linkCopied": "Invite link copied",
      "resend": "Resend",
      "resent": "Invite sent again",
      "revoke": "Revoke",
      "revokeTitle": "Revoke the invite for {email}?",
      "revokeBody": "The link stops working. You can invite them again later.",
      "add": "Add an admin",
      "addHelp": "They can see this dashboard, handle reports and suspend or lift sending. They can't add admins.",
      "email": "Their email",
      "delivery": "How to send it",
      "byEmail": "Email it",
      "byLink": "Copy a link",
      "send": "Send invite",
      "makeLink": "Make the link",
      "sent": "Invite sent to {email}",
      "linkReady": "Copy this link and send it to them. It works for 7 days, only for that address.",
      "emailLimit": "TapNShow sent all its emails for today. Copy the link instead.",
      "emailFailed": "The email didn't go out. Copy the link instead."
    },
    "log": {
      "title": "Admin log",
      "filters": { "all": "Everything", "suspensions": "Suspensions", "admins": "Admins" },
      "empty": "Nothing logged yet.",
      "end": "That's the whole log.",
      "system": "TapNShow",
      "kinds": {
        "auto_suspended": "Sending suspended automatically · {workspace}",
        "suspended": "{actor} suspended sending · {workspace}",
        "lifted": "{actor} lifted the suspension · {workspace}",
        "report": "New report · {workspace}",
        "report_reviewed": "{actor} reviewed a report · {workspace}",
        "admin_invited": "{actor} invited {email} as an admin",
        "admin_joined": "{email} joined as an admin",
        "admin_removed": "{actor} removed {email} as an admin",
        "invite_revoked": "{actor} revoked the invite for {email}",
        "owner_set": "The platform owner was set",
        "platform_email_cap": "The platform email limit was reached for the day",
        "worker_failing": "A background worker failed ({lane})"
      }
    },
    "join": {
      "readyTitle": "Help run TapNShow",
      "readyBody": "You're invited as a platform admin.",
      "accept": "Accept the invite",
      "already": "You're already a platform admin.",
      "open": "Open the admin area"
    }
```

- [ ] **Step 2: Failing tests**

`src/components/invites/invite-cards.test.tsx`: `InviteWrongAccountCard` shows "This invite is for a•••@gmail.com" and calls `onSwitch` on **Switch account**; `InviteClosedCard` shows its message; `InviteSignInCard` links to its `href`.

`src/app/admin/join/[token]/admin-join.test.tsx` (stub `fetch` per state): ready → **Accept the invite** posts `/api/admin/invites/accept` with `{ token }` and then navigates to `/admin`; `wrong_account` → the shared card; `already_admin` → "You're already a platform admin." with a link to `/admin`; `expired` / `revoked` / `used` / `not_found` → the shared closed messages; 401 → the sign-in card with `/login?next=/admin/join/<token>`.

`report-row.test.tsx`: the rate line ("3 of 74 people · 4.1% · 2 hours ago"), **Mark reviewed** calls the mutation, a reviewed row shows "Reviewed by Sami" and no button.
`admin-list.test.tsx`: the owner first with "Platform owner"; for the owner viewer, each admin row has a "…" menu with **Remove** → confirm dialog naming the person → the mutation; for an admin viewer, no menu.
`invite-admin-dialog.test.tsx`: an invalid email keeps **Send invite** disabled; "Email it" → "Invite sent to l•••@example.com"; "Copy a link" → the link and a copy button; `email_limit` → the plain fallback line and the link offer.
`waiting-invites.test.tsx`: **Copy link** renews with `delivery: "link"` and copies the new link (stub `copyText`), **Resend** renews with `delivery: "email"`, **Revoke** confirms first.
`log-row.test.tsx`: one sentence per kind from `Admin.log.kinds`, the actor's name or "TapNShow" for system events, the masked email from `facts.email`, never a full address.

Run: `bun run test -- --run src/components/invites src/components/admin src/app/admin` → FAIL.

- [ ] **Step 3: Implement**

`src/components/invites/invite-cards.tsx`: move the three cards out of `invite-acceptance.tsx` unchanged in look (the `signedOut` card, the `wrong_account` card, the final closed-state card) as:

```tsx
export function InviteSignInCard({ href }: { href: string }) { /* the signedOut card, InvitePage.signInTitle/Body/signIn */ }
export function InviteWrongAccountCard({ email, pending, onSwitch }: { email: string; pending: boolean; onSwitch: () => void }) { /* wrongTitle, wrongBody, switchAccount */ }
export function InviteClosedCard({ message }: { message: string }) { /* neutral sticker + the bold line */ }
```

(each body is the exact JSX now in `invite-acceptance.tsx`, lines 62–74, 107–126 and 145–151); `invite-acceptance.tsx` renders them. Its existing tests must pass unchanged.

`src/app/admin/join/[token]/page.tsx`: `<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4"><AdminJoin /><LegalLine /></main>`. `admin-join.tsx`: the `invite-acceptance.tsx` flow with `useAdminInvitePreview(token)` (`onUnauthenticated` → sign-in card with `loginPathFor(\`/admin/join/${token}\`)`) and `useAcceptAdminInvite()` (on success: invalidate `ME_QUERY_KEY`, `router.push("/admin")`); states: `ready` (success sticker, `Admin.join.readyTitle/readyBody`, **Accept the invite**, the API error under it in plain words), `wrong_account` (shared card, switch account signs out to the login with `next`), `already_admin` (`Admin.join.already` + link **Open the admin area**), else the shared closed card with `InvitePage.expired` / `revoked` / `used` / `notFound`.

`src/app/admin/(area)/reports/page.tsx`: `useAdminReports()` → `ReportRow`s (workspace name linking to `/admin/workspaces/<id>`, the rate line with `reportPercent`, relative time, reviewed state or **Mark reviewed**), `ShowMore`, the empty line.

`src/app/admin/(area)/admins/page.tsx`: `useAdminAdmins()` and `useMe()` (who is looking): `AdminList` (owner first; "You" for the viewer's own row; the "…" menu with **Remove** only when the viewer is the owner and the row isn't the owner), then, for the owner only: `WaitingInvites` and an **Add an admin** button opening `InviteAdminDialog` (email `Input` validated with the shared schema, the delivery `SegmentedControl` "Email it" / "Copy a link", submit → result line; a returned link shows with a **Copy link** button using `copyText` and a toast). Admins who aren't the owner see the list only, with `Admin.admins.addHelp` hidden.

`src/app/admin/(area)/log/page.tsx`: filter `Chip`s (`Everything`, `Suspensions`, `Admins`) in `CHIP_ROW_CLASS`, `useAdminLog(filter)` → `LogRow`s (the sentence, the workspace as a link when it still exists, the time `format(createdAt, "d MMM HH:mm")`), `ShowMore`, the empty line.

Run: `bun run test -- --run src/components src/app` → PASS.

- [ ] **Step 4: e2e, screenshots, chain, merge**

`e2e/m9-admin.spec.ts`, add:

```ts
test("the platform owner invites an admin by link, who joins; a wrong account can't", async ({ page, browser }) => {
  const ownerEmail = uniqueEmail("e2e-powner");
  await signInWithCode(page, ownerEmail, { startPath: "/login", name: "Platform Owner" });
  await makePlatformAdmin(ownerEmail, "owner");
  await page.goto("/admin/admins");
  await page.getByRole("button", { name: "Add an admin" }).click();
  const invitedEmail = uniqueEmail("e2e-newadmin");
  await page.getByLabel("Their email").fill(invitedEmail);
  await page.getByRole("radio", { name: "Copy a link" }).click();
  await page.getByRole("button", { name: "Make the link" }).click();
  const link = await page.getByRole("textbox", { name: /link/i }).inputValue();
  expect(link).toMatch(/\/admin\/join\//);

  const strangerPage = await (await browser.newContext()).newPage();
  await signInWithCode(strangerPage, uniqueEmail("e2e-stranger"), { startPath: "/login", name: "Stranger" });
  await strangerPage.goto(link);
  await expect(strangerPage.getByRole("heading", { name: /This invite is for/ })).toBeVisible();

  const invitedPage = await (await browser.newContext()).newPage();
  // /admin/* needs a session, so the proxy sends a signed-out visitor to /login?next=… first.
  await invitedPage.goto(link);
  await expect(invitedPage).toHaveURL(/\/login\?next=/);
  await signInWithCode(invitedPage, invitedEmail, { name: "New Admin" });
  await invitedPage.getByRole("button", { name: "Accept the invite" }).click();
  await expect(invitedPage).toHaveURL(/\/admin$/);

  await page.goto("/admin/log");
  await expect(page.getByText(/joined as an admin/)).toBeVisible();
});
```

(`makePlatformAdmin(email, role)` gains the `role` argument, default `"admin"`; the role radios are the `SegmentedControl`'s; the link is shown in a read-only `Input` labelled "Invite link"; match the selectors to what you built.) The reports page: seed 1 report through `/api/r/<token>/report` (the Task 17 test's seed) and **Mark reviewed** it. Screenshots of Reports, Admins (owner view and admin view), the invite dialog (both results), Log, and the join page's states, at 390 light, 320 dark and 1024; "Looks right?" before merging. Chain; commit `feat(admin): Reports, Admins with email-bound invites, the Log, and the join page`.
### Task 21: Launch: the WAF rule, the CSP enforced, the verification runbook, the final review and the production check

**Issue labels:** `type:task`, `area:infra`, `documentation`. **Branch:** `chore/<issue>-launch`.

**Files:**
- Create: `scripts/probe-rate-limit.ts`, `scripts/probe-rate-limit.test.ts`
- Modify: `src/lib/api-client.ts`, `src/lib/api-client.test.ts` (a WAF 429 is `rate_limited`)
- Modify: `src/config/security-headers.ts` (+ test, + `e2e/headers.spec.ts`: `CSP_HEADER` enforced)
- Create: `docs/runbooks/google-verification.md`; Modify: `docs/runbooks/monitoring.md` (WAF rule, CSP switch)
- Modify: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§14 M9 row "Done …", §15)

**Interfaces:**
- Consumes: everything in Tasks 1–20.
- Produces: `probeRateLimit({ url, total, concurrency, fetch? }): Promise<{ statuses: Record<number, number>; retryAfter: string | null }>`; `CSP_HEADER = "Content-Security-Policy"`.

**Rulings (copy into the ledger):** none planned; every finding of the final review or the production check is a ledger line, a fix PR, or an Owner decision.

- [ ] **Step 1: Before enforcing (three clean days)**

Count CSP reports in Sentry for `environment:production` and `environment:preview` since Task 5 merged (`mcp__plugin_sentry_sentry__search_issues` or `search_errors` with the CSP/security event type). The bar (spec §11): e2e clean on every page and at least 3 days of report-only on both with **zero** reports. Every report found is fixed at its root first (ledger line each); the 3 days restart after the last fix.

- [ ] **Step 2: Enforce the CSP**

`src/config/security-headers.ts`: `export const CSP_HEADER = "Content-Security-Policy" as const;` and its JSDoc: "Enforced since <date> (spec §11 M9). To go back to report-only, set this back to `\"Content-Security-Policy-Report-Only\"` (runbook)." Update the unit test's expectation and `e2e/headers.spec.ts`'s `CSP` constant to `"content-security-policy"`. Run the whole e2e (`run_in_background`): an enforced policy that blocks anything now fails the stories, not just reports. Add to `docs/runbooks/monitoring.md`:

```markdown
## The CSP

Enforced (`CSP_HEADER` in `src/config/security-headers.ts`). If a page breaks because of it in
production: set `CSP_HEADER` back to `"Content-Security-Policy-Report-Only"`, merge (one line),
read the reports in Sentry, fix the cause, then enforce again.
```

- [ ] **Step 3: The WAF rule (outer guard)**

1. Read Vercel's current WAF docs (Firewall → Custom Rules, rate limiting) and the Hobby plan limits, and the `vercel-firewall` skill if the plugin lists it; record in the ledger: how many custom rules Hobby allows, whether a rate-limit rule can be written as code (`vercel.json` / `vercel.ts` / `vercel firewall rules …` CLI, which needs a newer CLI than the installed 62.2.0) or only in the dashboard, and the window and key choices.
2. The rule: path starts with `/api/` **and** is not `/api/health` and does not start with `/api/internal/`; plus `/monitoring` if the conditions allow an OR; key: IP; limit: 600 requests per 60 s; action: rate limit (429). If the rule can live in the repo, add it there (the change is then reviewed and versioned); otherwise write the dashboard steps into `docs/runbooks/monitoring.md` and AskUserQuestion the Owner to create it (a production configuration change: asked first in any case).
3. Shared Wi-Fi check (Review Focus 1): before choosing 600, count the API calls one member makes to open an invite and answer (`page.on("request")` in the answer e2e, `/api/` only) and one organizer makes to open a meeting page for a minute (its 10 s polling included); record both. A campus of 100 members answering within one minute must stay under the limit with room to spare; raise the limit (in steps of 300) until it does, and write the numbers and the chosen limit into the runbook.

`scripts/probe-rate-limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { probeRateLimit } from "./probe-rate-limit";

describe("probeRateLimit", () => {
  it("counts statuses and keeps the first Retry-After", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return calls > 3
        ? new Response("", { status: 429, headers: { "retry-after": "42" } })
        : new Response("{}", { status: 200 });
    };
    const result = await probeRateLimit({ url: "https://x.app/api/me", total: 5, concurrency: 2, fetch });
    expect(result.statuses).toEqual({ 200: 3, 429: 2 });
    expect(result.retryAfter).toBe("42");
  });
});
```

`scripts/probe-rate-limit.ts`:

```ts
type Fetch = (input: string) => Promise<Response>;

/** Fires `total` GETs at `url`, `concurrency` at a time, and tallies the answers (spec §11 WAF check). */
export async function probeRateLimit(input: {
  url: string;
  total: number;
  concurrency: number;
  fetch?: Fetch;
}): Promise<{ statuses: Record<number, number>; retryAfter: string | null }> {
  const send = input.fetch ?? ((url: string) => fetch(url));
  const statuses: Record<number, number> = {};
  let retryAfter: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < input.total) {
      next += 1;
      const response = await send(input.url);
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      retryAfter ??= response.headers.get("retry-after");
    }
  };
  await Promise.all(Array.from({ length: input.concurrency }, worker));
  return { statuses, retryAfter };
}

if (import.meta.main) {
  const [url, total = "700"] = process.argv.slice(2);
  if (!url) {
    process.stderr.write("usage: bun scripts/probe-rate-limit.ts <preview url>/api/me [total]\n");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(await probeRateLimit({ url, total: Number(total), concurrency: 20 }))}\n`);
}
```

Run it once against a **preview** deployment's `/api/me` (an unauthenticated 401 is still a counted request) with `total` = the limit + 100 and check that 429s appear with a `Retry-After`; against `/api/health` it must never 429. Record both in the ledger. (Never against production.) The WAF's 429 has no JSON error body, and `apiRequest` (`src/lib/api-client.ts`) turns any unparsable error body into `internal` ("Something went wrong"), checked 2026-10-15. Fix it so a WAF refusal reads "Too many attempts. Wait a bit and try again.":

```ts
  throw parsed.success
    ? new ApiClientError(parsed.data.error.code, response.status, parsed.data.error.details)
    : new ApiClientError(response.status === 429 ? "rate_limited" : "internal", response.status);
```

with a test in `src/lib/api-client.test.ts`: a 429 with an HTML body throws `ApiClientError` with code `rate_limited`; a 500 with an HTML body stays `internal`.

- [ ] **Step 4: The Google verification runbook**

`docs/runbooks/google-verification.md` (from the Google pages checked 2026-10-15 and spec §9 M9; re-check each link the day it is used):

```markdown
# Google verification runbook (spec §9 M9)

Order (Owner, 2026-10-15): M9 engineering → the new logo, uploaded in Google Cloud → this →
the promo video. Branding can't change while verification is in progress.

## Before submitting (I check, you confirm)

- [ ] https://tapnshow.vercel.app/ is the landing (not a login page), links /privacy and /terms.
- [ ] /privacy has the Limited Use sentence and says what Gmail and Drive access are for.
- [ ] Search Console still shows the property verified (`NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` set in Production).
- [ ] Google Auth Platform → Branding: app name TapNShow, the new logo, support email = the platform address,
      home page, privacy and terms links = the three pages above, authorized domain tapnshow.vercel.app.
- [ ] Data access: scopes `openid`, `email`, `profile`, `…/auth/gmail.send`, `…/auth/drive.file`; nothing else.

## Steps

1. Branding → **Verify branding** → when it passes, **Publish branding** (automated, minutes).
2. Verification Center → Data access → **Add or remove scopes** (as above) → justification:
   > TapNShow sends meeting invitations, updates, cancellations and reminders from the group's own
   > Gmail address, so members receive them from a sender they know and replies reach the group.
   > `gmail.send` is the narrowest Gmail scope that sends: TapNShow never reads, lists, modifies or
   > deletes mail, so `gmail.readonly`, `gmail.compose` and `gmail.modify` would grant more than it uses.
3. Demo video: link the unlisted YouTube video (script below).
4. Submit; answer Google's questions from the Owner's inbox. Google says sensitive-scope review
   "typically takes 3-5 business days".

## Demo video script (English; one take is fine)

1. Open https://tapnshow.vercel.app, show the landing and the privacy page's Google section (10 s).
2. Sign in, open a test workspace → Settings → Sending → **Connect Gmail**.
3. Google's consent screen: show the app name, then the address bar (the `client_id` is in the URL),
   then the permission "Send email on your behalf". Continue.
4. Back in TapNShow: "Sending from <test address>".
5. Create a meeting to the Owner's own test addresses only → Review → Send → the progress reaches sent.
6. Open the test inbox: the invite from the group's address; tap "I'm going"; show the answer in TapNShow.
7. (Sheets uses `drive.file`, non-sensitive: not needed in the video.)
```

- [ ] **Step 5: The final review (fresh reviewer)**

Dispatch one fresh reviewer (most capable model) on the whole M9 range (`git diff <commit before Task 1>..main`) with: the spec's M9 sections, this plan's Global Constraints and Review Focus, and the instruction to grade Critical / Important / Minor with a failing scenario for each. Fix every Critical and Important in a PR before the production check; Minors go to one follow-up issue under #11 (or are fixed now when trivial). Ledger lines for each.

- [ ] **Step 6: The production check (with the Owner)**

On production, with the Owner's test workspaces and test inboxes only (never the club's):
1. Lighthouse mobile on `/`, `/privacy`, `/terms` (Task 12's command against `https://tapnshow.vercel.app`): every category ≥ 95, LCP < 2.5 s.
2. Every public and app page at 390 light, 320 dark and 1024: no console error, no CSP report.
3. `curl -sI` on `/`, `/u/x`, `/api/health`, `/serwist/sw.js`: CSP (enforced), nosniff, referrer policies, `X-Robots-Tag` where expected, HSTS (Vercel's).
4. Sentry: a test notification from each alert rule reaches email and `#errors`; the uptime monitor is green; Logs show production lines with no token.
5. Discord: `#deploys` has this deploy; `gh workflow run keep-alive.yml` and `gh workflow run backup.yml` both pass (restore check passed, one artifact; decrypt it locally once); `#uptime` silent unless Monday.
6. Analytics and Speed Insights: events arrive; URLs show `/r/[token]`, never a token.
7. Platform owner: AskUserQuestion first, then `bun scripts/set-platform-owner.ts --email <the Owner's address> --project production` (the Owner runs it or confirms me running it); `/admin` opens; invite a second admin (the Owner's other test address) by link, accept, then remove; suspend and lift the Owner's **test** workspace by hand (the Owner gets both emails; `#platform` gets both posts). Automatic suspension is shown on preview with seeded test data (Task 15's DB test plus one manual run on preview), never on production.
8. The rest: a 429 from the WAF on preview (Step 3), both error pages, the API JSON 404, the seat cap message (preview, with `withLimit`-style SQL lowering the limit for one test account), `/design` not found.

Record the evidence (numbers, dates, what was seen) in the ledger, then write the spec §14 M9 row's "Done <date>: …" in the same style as M8's (a docs PR), add the open items to §15 (the Sentry Discord check after 2026-10-17, the GitHub 60-day schedule rule, the logo / video / promo work), and close the M9 issues. Epic #11 stays open until the Owner's verification submission is in, then is closed with a comment.

---

## Self-review (done while writing; re-run after any amendment)

**1. Spec coverage** (spec M9 sections → tasks):
- §3 Platform admin / owner → 14 (roles, script), 19–20 (UI). §4 Tenancy (seats, 16+) → 4, 11, 13. Pagination registry → 4. Visual style (theme) → 10. Public pages → 2, 11, 12, 13. Platform admin → 14–20. Operations → 5, 6, 7, 8, 9, 17.
- §5 Operations: tunnel → 5; Logs, alert rules, uptime, `SENTRY_AUTH_TOKEN` → 6; Discord builder, `#deploys`, keep-alive → 7; backups → 8; Analytics → 9; `#platform` → 17.
- §6 tables → 14, 15, 16, 17. §7.12 rule and effects → 15, 17. §7.18 → 2, 11, 12, 13 (and `/design` → 1). §7.19 → 14, 18, 19, 20.
- §8 platform events → 17; daily rollup → 16; suspension at reserve → 15 (the spec's "claim and reserve both check it" becomes "reserve checks it": amended).
- §9 verification → 21. §10 routes, registries, theme, Settings icons, Admin API → 3, 4, 10, 18, 19, 20.
- §11 rate limiting → 3, 21; headers → 5, 21; secrets → 6, 7, 8, 17; accepted advisor warning → every DB task's advisor run.
- §12 M9 tests and zero warnings → every task, and 1. §14 / §15 → 21.

**2. Placeholder scan:** no "TBD"/"TODO"/"fill in". Steps that depend on a fact only the implementation can see say what to check and which way to go (e.g. Task 8's first-run checks, Task 21's WAF configuration source), never "handle it".

**3. Type and name consistency:** `ROUTES` / `LimitRule` / `ListRule` (3, 4, 18); `withLimit` (3, 4); `createInviteAs` (4); `makePlatformAdmin` (DB helper takes a `TestUser`, 14–16; the e2e helper takes an email, 19–20: different modules, same meaning); `record_platform_event`, `open_suspension`, `lift_suspension` (14–17); `PlatformEvent` (`src/lib/discord/platform-events.ts`, used by `src/server/queries/platform.ts`, 17); `OwnerAlertInput` kinds `sendingSuspended` / `sendingResumed` (17); `scheduleWorkers(["platform"])` (17, 18); `ADMIN_PAGE_SIZE` (18–20); `TOKEN_LINK` with `admin/join` (18); `CSP_HEADER` (5, 21); `PublicShell`, `LEGAL_LINKS`, `contactHref`, `PRIVACY_POLICY_URL` (11–13, 17); `isSessionCookieName` (2, 11); `NotFoundView` (2, 11, 19); SQL JSON keys of Task 16 ↔ Task 18's schemas (snake_case mapped field by field in `src/server/queries/admin.ts`).

**4. Review Focus:** five lines above, each pinned in its owning task (3, 5, 16, 19, 14/21).
