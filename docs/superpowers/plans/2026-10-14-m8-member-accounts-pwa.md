# TapNShow M8 (Member accounts & PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member signs in with the email their invites come to and lands on `/invites`, which shows every group's invites: Upcoming with a "Needs your answer" filter, and Past with their check-ins. Answering opens the existing answer page. Every email a member gets also arrives as a phone notification on their devices (Web Push), the app installs from the browser, and the last-loaded invites stay readable offline. `/account` holds the name, the reminders switch, **Download my answers** and **Delete my account**. Meeting emails and the answer page point members to all this.

**Architecture:**
- Invites are matched to accounts by **verified email when read**. One SQL rule, `private.contacts_of(user)`, is the only place a contact email meets an auth email; its twin `private.push_enqueue` names it. `contacts.user_id` is dropped.
- Member reads are `private` definer functions acting on `auth.uid()` only, behind `public` invoker wrappers, with keyset pages.
- Pushes are a **durable queue**:
  - `dispatch_finish`, the one place an email is recorded as sent, inserts one `push_deliveries` row per device of the recipient in the same transaction;
  - a push lane started together with the email worker drains it: it claims with a lease, drops stale rows in SQL (cancelled, started, already answered), sends with `web-push` (VAPID, RFC 8291), and classifies every result (sent, gone, retry with backoff, drop);
  - the lane keeps polling while the email worker runs, so a push follows its email within seconds.
- The service worker is Serwist's Turbopack integration (`src/app/sw.ts`). It precaches the shell, serves `/invites`, `/account` and `GET /api/me/invites` network-first, and shows every push.
- Account deletion is one `private.delete_account` transaction:
  - it refuses while the person owns a workspace;
  - it leaves every workspace and erases reasons and comments in responses and history;
  - it pauses the sending and sheets that used the person's Google accounts, with Owner emails;
  - it releases the connections with the shared-grant guard.

  Then the route revokes the tokens and deletes the auth user through the admin API.

**Tech Stack:**
- Next.js 16.3.8 (App Router, `after()`, metadata routes), React 19.2.8, TypeScript 5, bun 1.3.11.
- `@supabase/supabase-js` 2.117.2, Supabase CLI 2.119.0 (local ports 44320–44329), Postgres 17.
- `zod` 4, `@tanstack/react-query` 5.104, `next-intl` 4, `date-fns` 4 + `@date-fns/tz` 1.5, `react-email` 6.11, `motion` 14.
- Vitest 5, Playwright 1.63.
- **New dependencies** (checked on npm and GitHub advisories 2026-10-14):
  - `web-push` 3.6.7 (MPL-2.0; no advisories; repo active 2026-10-12) and `@types/web-push` 3.6.4 (dev);
  - `@serwist/turbopack` 9.5.13 (MIT, released 2026-10-04, the option Next 16's PWA guide points to);
  - `serwist` 9.5.13 (MIT) and `esbuild` (dev, Serwist builds the worker with it);
  - `http_ece` 1.2.0 (dev, e2e only: the fake push service decrypts what it receives; the same version `web-push` uses).

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md`. Read these sections before starting:
- §3: the Member (with account) row.
- §4: Reminders, Member accounts (M8).
- §6: `contacts`, `push_subscriptions`, `push_deliveries`, `outbox_jobs`, Access pattern (M8), Identity rules.
- §7.4.
- §8: Push worker (M8), Housekeeping.
- §10: Routes, PWA (M8), Members API (M8).
- §11: Account deletion (M8), Push privacy (M8), Rate limiting, Secrets.
- §12: M8 tests.
- §14: M8 row.
- §15: VAPID keys, Backlog.

Design approved 2026-10-14 (#297). Epic #10.

## Global Constraints

- **Earlier plans still apply.** Everything in the Global Constraints of the M0+M1, M2, M3, M4, M5, M6 and M7 plans still applies:
  - free only; bun;
  - **no Server Actions** and no RSC data reads: every read and write goes through `src/app/api/**/route.ts` + TanStack Query;
  - no emojis anywhere (UI, emails, notifications);
  - no `any` and no `unknown`: the ESLint rule bans the keyword, including `as unknown as`;
  - no `console.*`; JSDoc on every export; imports at the top of the file only;
  - no hardcoded values: limits go in `private.app_limits`, client tuning in `src/config/*`, and each client constant names its DB twin in its JSDoc;
  - SQL only in `supabase/migrations/*` and `src/server/queries/*`;
  - every UI, email and notification string through next-intl (`messages/en.json`);
  - Soft Neobrutalism; Expressive motion with a reduced-motion fallback; WCAG 2.2 AA; ≥ 44 px tap targets;
  - one branch + PR per task with the repo template; CI green including `db`; squash merge; the commit trailer from the session's attribution reminder.
- **Owner rules (memories):**
  - no native form controls (Switch, Chip, SegmentedControl, Dialog from `src/components/ui/`);
  - an "Are you sure?" dialog naming the consequence before Delete my account (type **confirm**); every type-to-confirm dialog has a **copy button** next to the word (the workspace delete dialog too);
  - **no technical text for users**: never "push", "subscription", "service worker", "token", "API", "cache". Say "reminders", "notifications", "this phone", "saved on this phone";
  - padded menus (`p-1.5`, `collisionPadding` 16); dialogs centred at 1024 px; chip rows use `CHIP_ROW_CLASS`; no horizontal scroll at 320 px;
  - **engineering bar** (2026-10-14): judge every choice by robustness, tests, performance and scale, never by how little code it takes. List the edge cases, then pin each with a test.
- **DRY rules for M8 (one place each, twin named on both sides):**
  - **Matching:** `private.contacts_of(p_user)` is the only "contact email = verified auth email" rule. `private.push_enqueue` uses the same comparison in the other direction (contact → users), and each names the other in a SQL comment. TS has no copy.
  - **Member reads:** `private.my_invitees()` (built on `contacts_of(auth.uid())`) feeds `my_invites`, `my_invite`, `my_answers`, `my_account` and `delete_account`.
  - **Stale push rule:** inside `push_claim` only. It reuses `private.reminder_eligible`, which is the reminders' rule.
  - **Push words:** `pushMessage()` (`src/lib/push/message.ts`) is the only builder of a notification's title and body. The service worker only shows what it receives, plus one fallback string from `messages/en.json`.
  - **Device cleanup:** `clearDeviceData()` (`src/lib/device/clear.ts`) is the only thing sign-out and account deletion call. It turns off this device's reminders on the server, unsubscribes, deletes TapNShow's caches and clears `tn.*` storage.
  - **Device storage:** `readDeviceValue` / `writeDeviceValue` (`src/lib/device/storage.ts`), keys prefixed `tn.`. No component touches `localStorage` itself.
  - **Paged fetch-all:** `fetchAllPages` moves out of `src/hooks/use-results.ts` into `src/lib/api/fetch-all-pages.ts` (Task 5); both exports use it.
  - **Owner alert caps:** `private.owner_alert_target(workspace)` (Task 4) holds the "one platform email per day per workspace, inside the platform cap" rule. `sheet_pause` is rewritten to use it, so pausing a sheet and deleting an account share it.
  - **Remove what is unused, in the task that makes it unused:**
    - `contacts.user_id` and `contacts_user_id_idx` go in Task 1;
    - `ProfileDialog` (`src/components/shell/profile-dialog.tsx` and its test) goes in Task 5, once the Account page holds the name;
    - the private `fetchAll` in `use-results.ts` goes in Task 5;
    - `src/app/favicon.ico` (Next's default) goes in Task 8, replaced by the app icon.

    A grep in each task's last step proves no reference is left.
- **Function security (spec §11):**
  - New member functions are `private` definer bodies granted to `authenticated`, behind `public` invoker wrappers: `my_invites`, `my_invite`, `my_answers`, `my_account`, `delete_account`, `push_subscribe`, `push_unsubscribe`. Each is added to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted) in `src/server/db/function-security.db.test.ts` in the same PR.
  - Worker and token functions are executable by `service_role` only: `token_viewer`, `push_claim`, `push_done`, `push_retry`, `push_drop`, `push_gone`.
  - Helpers get `revoke execute … from public, anon, authenticated`: `contacts_of`, `my_invitees`, `push_enqueue`, `owner_alert_target`. Add `grant … to service_role` only where an invoker function run by the service role calls them.
  - Run `supabase db advisors --local </dev/null` after every migration. Expected: nothing beyond the pre-existing `auth_leaked_password_protection` WARN.
- **Changing an existing function:** copy the latest body from **the newest migration that defines it** (`grep -ln "function <schema>.<name>(" supabase/migrations/* | sort | tail -1`) and change only what the task says. Latest bodies at the start of M8:

| Function | Newest migration |
|---|---|
| `private.hit_user_rate_limit` | `20261011134035_m7_minors_hardening.sql` |
| `public.dispatch_finish` | `20261011124719_m7_minors_edits.sql` |
| `private.workers_due` | `20261011183115_m7_followups.sql` |
| `private.housekeeping`, `private.sheet_pause` | `20261011094523_m7_sheet_worker.sql` |
| `private.release_connection` | `20261011164257_m7_final_review.sql` |
| `private.token_invitee` | `20261011114847_m7_minors_answers.sql` |

  A signature or return-type change is `drop function … (old args)` + `create function` + re-grant, because grants are per signature. After each M8 migration merges, the next task copies from **that** migration.
- **PostgREST resolves functions by argument names.** Pass SQL null with `sqlNullable()` (`src/server/db/rpc-args.ts`). A new optional argument needs `default null` in SQL.
- **New error code (Task 4):** `owns_workspaces` (409) "You own a workspace. Give it to an Admin or delete it first." It goes in `API_ERROR_CODES`, `API_ERROR_STATUS` and `messages/en.json` `ApiErrors`. Ownership checks never return a different code from "not yours" for invites: an invite that isn't the caller's is `not_found`.
- **New limits (`private.app_limits`):**
  - Task 1: `invite_links_per_user_per_hour` 600, `answer_downloads_per_user_per_hour` 600 (one per page), `account_deletions_per_user_per_hour` 5, `push_subscribes_per_user_per_hour` 30. All four rate-limit actions are wired into `hit_user_rate_limit` in Task 1, so no later migration rewrites it.
  - Task 6: `push_devices_per_user_max` 10, `push_attempts_max` 5, `push_retry_max_minutes` 30, `push_subscription_idle_days` 90.
- **New client config:**
  - `src/config/push.ts` (Task 7): budget, timeouts, batch, concurrency, lease, TTLs, payload cap.
  - `src/config/members.ts` (Task 3): the Not-now days, the device storage keys.
- **Env:**
  - Task 7, server: `VAPID_PRIVATE_KEY` (secret) and `VAPID_SUBJECT` (`mailto:` or `https:`).
  - Task 7, public: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
  - Reminders are **available only when all three are set** (`pushConfigured(env)` on the server, `remindersAvailable()` on the client). Previews and CI without keys simply hide the reminder UI and skip the push lane.
  - e2e sets test keys in `playwright.config.ts` `webServer.env` (the `.env.local` lesson).
- **Rollout order (binding, see Execution Order):**
  - Task 6 (enqueue) can merge before Task 7 (sender). Until the push lane exists, no subscription can exist (the subscribe route ships with Task 7), so nothing is enqueued.
  - The reminders UI (Task 8) merges after the worker (Task 7).
  - VAPID keys reach Vercel only with the Owner's go-ahead (Task 10).
- **Sends during development:** a fake Gmail and a fake push service in tests and e2e. The production check (Task 10) uses the Owner's test workspaces, test inboxes and the Owner's own phones only. Never the club workspace without an explicit AskUserQuestion go-ahead in that session.
- **UI verification:**
  - Take Playwright screenshots through `.superpowers/scripts/screens/pw.config.ts` (`bun run test:e2e -c .superpowers/scripts/screens/pw.config.ts <spec>`; specs import `./shots`) at **390 px light, 320 px dark and 1024 px** for every new or changed screen and dialog.
  - Look at them, send them to the Owner (`SendUserFile`) and ask "Looks right?" (AskUserQuestion) **before merging**.
  - `toBeVisible()` passes at opacity 0, so look at the image.
- **Local stack:**
  - `supabase start` (API 44321, DB 44322, Studio 44323, Mailpit 44324/44325). Run the CLI with `</dev/null`.
  - If `test:db` fails with a ZodError on `API_URL`, run `supabase stop </dev/null && supabase start </dev/null`.
  - The local DB is shared by every branch; `supabase db reset --local </dev/null` aligns it with the branch.
  - Run multi-statement SQL by hand with `psql postgresql://postgres:postgres@127.0.0.1:44322/postgres -v ON_ERROR_STOP=1 -f file`.
  - Stop any `next start`/`next dev` before `bun run test:e2e` (`ss -ltnp | grep :3000`, kill by PID; never `pkill -f`).
  - Start the app by hand only with `bun scripts/with-local-supabase.ts bun run start -p 3000` (plain `bun run start` reads `.env.local`, which points at preview).
  - Regenerate types with `bun run db:types` after each migration.
  - Escape `[slug]`/`[id]`/`[token]` in vitest filters, or filter by a substring without brackets.
  - The `meetings_validate_timezone` trigger costs about 24 ms per inserted meeting. Plan tests seed at most 60 meetings per workspace.
- **Before every commit, chained with `&&`, never `;`, never piped into `tail`. Redirect to a log and grep it:**
  - `bunx prettier --write <touched files, not .sql> && bun run format:check && bun run lint && bun run typecheck && bun run test`;
  - add `supabase db reset --local </dev/null && bun run db:types && bun run test:db && supabase db advisors --local </dev/null` for DB work;
  - add `TZ=UTC bun run test:e2e` when a flow changes (run it with `run_in_background`).
  - Scripted edits: assert the old text exists, and re-read the file after Prettier.
  - Run `typecheck` before trusting a green vitest run.
- **Merging and hosted migrations (owner-approved):**
  - Open the PR (body from `.github/pull_request_template.md`, written to a file, `--body-file`; `Closes #<task issue>` and `Part of #10`; labels `type:task` plus the task's `area:*`). Then run `bash .superpowers/scripts/merge-when-green.sh <pr>` with `run_in_background`.
  - Verify that `gh pr view <pr> --json state` is `MERGED`.
  - **Right after a PR with a migration merges, run `bash .superpowers/scripts/hosted-push.sh`.** Record the advisor output in the ledger.
  - Migrations land in timestamp order: Tasks 1 → 4 → 6. Create each migration file (`supabase migration new <name>`) only when its task starts.
- **Rulings.** Every deviation from this plan becomes a ledger line `Task N: Ruling: <what> — <why> — <cost if wrong>` in `.superpowers/sdd/2026-10-14-m8-member-accounts-pwa/progress.md`.

## Review Focus

1. **A shared phone.** Person A turned reminders on, signs out, and person B signs in on the same browser. Expected:
   - B never sees A's notifications or A's offline invites;
   - when B turns reminders on, the same browser endpoint moves to B.
   - Pinned in Task 6 (`push_subscribe` with an endpoint owned by another user moves it, and the old owner's deliveries for it are deleted) and Task 8 (`clearDeviceData` runs before the sign-out request: server unsubscribe, `PushSubscription.unsubscribe()`, `caches.delete` for every `tn-` cache, `tn.*` storage cleared; unit tests with fakes, plus the e2e sign-out check).
2. **A notification that's out of date by the time it's sent.** For example, a "Please answer" reminder whose push waits behind a 429 while the member answers, or the meeting is cancelled or starts. Expected: no stale notification.
   - Pinned in Task 6 (`push_claim` deletes unleased due rows for a cancelled or started meeting, except `cancel` kinds, and pending-reminder rows whose answer no longer passes `reminder_eligible`, and returns `dropped`; DB tests for each case).
3. **Deleting an account whose Gmail sends for a workspace, whose Drive holds a sheet, and whose Google account another TapNShow user is also connected to.** Expected:
   - sending pauses, and that workspace's Owner gets one plain email;
   - the sheet pauses `access_lost` with the existing alert;
   - the other person's connection keeps working (no revoke);
   - their reasons are gone from responses **and** history, and the sheet years are marked.
   - Pinned in Task 4 (DB tests per effect, including the shared `google_sub` case returning nothing to revoke).
4. **Email edge cases in matching.** Expected:
   - an unconfirmed auth email matches nothing;
   - a contact whose email an organizer corrects moves to the new address's account;
   - an ad-hoc contact still matches;
   - an invite whose email never went out (no `token_hash`) is not listed, and its link can't be fetched.
   - Pinned in Task 1 (DB tests for each).
5. **Offline after time passes.** The member opens `/invites` on the bus without a network an hour later. Expected:
   - the cached list shows with "Showing your invites from <time the server produced it>", not the time the cache was read;
   - cards say "Connect to answer";
   - nothing crashes when the cache is empty ("Connect to see your invites").
   - Pinned in Task 2 (`asOf` set by the server on every page) and Task 8 (offline banner from `asOf`; e2e `context.setOffline(true)` + reload).

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge #297 (spec) and this plan; create the task issues (Tracking) | — |
| 1 | Task 1: DB: matching rule, member reads, `token_viewer`, M8 rate limits, drop `contacts.user_id` | 0 |
| 2 | Task 2: Member invites API: schemas, queries, routes, `viewer` on the answer page, hooks | 1 |
| 3 | Task 3: `/invites` UI, `/invites/[id]`, member header, landing by role, protected paths | 2 |
| 4 | Task 4: DB + route: `delete_account`, owner alerts, `DELETE /api/me` | 1 |
| 5 | Task 5: `/account`: name, Download my answers, delete flow, copy button, avatar menu | 2, 3, 4 |
| 6 | Task 6: DB: push tables, subscribe/unsubscribe, enqueue in `dispatch_finish`, claim and results, wake-up, housekeeping | 4 |
| 7 | Task 7: Push lane (TS): `web-push`, VAPID env, message builder, classifier, `runPush`, subscription routes | 6 |
| 8 | Task 8: PWA: Serwist worker, manifest and icons, offline, install, reminders UI, `clearDeviceData` | 3, 5, 7 |
| 9 | Task 9: Discovery: email footer line, sign-in card and "Back to my invites" on the answer page | 2, 3 |
| 10 | Task 10: Rollout: e2e story with a fake push service, VAPID keys, final review, production check, evidence | 1–9 |

**Why this order:**
- Tasks 1 → 4 → 6 are the migration chain.
- Task 2 needs Task 1's functions. The UI tasks (3, 5, 8, 9) each sit on their API.
- The worker (Task 7) ships the subscribe route, so no subscription can exist before the lane that drains its queue.
- The reminders UI (Task 8) comes after both.
- Task 9 is independent of push and can run any time after Task 3.

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–10 with the agent-task template, labels `type:task` + the area labels named in each task, and milestone `M8 Member accounts & PWA`. Add each as a sub-issue of epic #10:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/10/sub_issues -F sub_issue_id="$id"
```
  `gh issue create` once returned a GraphQL error without creating the issue. Check with `gh issue list --search "<title>"` before retrying.
- [ ] Rewrite epic #10's body: outcome, scope and completion criteria from spec §4/§14. Tick "Plan written for M8".
- [ ] Ledger: create `.superpowers/sdd/2026-10-14-m8-member-accounts-pwa/progress.md` with `bash ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/sdd-workspace docs/superpowers/plans/2026-10-14-m8-member-accounts-pwa.md`. One line per task and every `Ruling:`.
  - Per task: `task-start` / `task-done` (`…/executing-plans/scripts/`).
  - Run `task-done` only on an up-to-date `main`, after verifying the merge.
- [ ] **Design rulings (2026-10-14)**, copied into the ledger:
  - scope = the five spec pieces + Download my answers;
  - landing by role;
  - read-time matching, dropping `contacts.user_id`;
  - push on every email, never instead of it; unsubscribe stops both;
  - deletion blocked while owning a workspace; type "confirm" with a copy button (both delete dialogs);
  - members see their check-ins;
  - answer through the existing `/r` page;
  - discovery card + email footer line;
  - `/invites` in date order with the All / Needs your answer chips;
  - the reminders card, iPhone guide and Account page as in the mockups;
  - push as a durable `push_deliveries` queue (not an outbox kind);
  - `web-push`; Serwist Turbopack;
  - app icon B.
- [ ] **Plan rulings (made while writing this plan; the spec is amended in the plan PR):**
  - the auth user is deleted through the admin API after `delete_account` commits (supported path; `delete_account` is idempotent, so a failed admin call is retried by deleting again);
  - `push_subscriptions` has no `device_label` and no `authenticated` SELECT (nothing shows a device list: YAGNI);
  - the member files are named `my-invites` (`src/shared/api/invites.ts` already holds the workspace Admin/Viewer invites);
  - `GET /api/me/invites` carries `asOf` (the offline banner needs the server's time);
  - the push lane keeps polling while the email worker runs, so a push follows its email within seconds instead of waiting for the next minute.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/<ts>_m8_member_reads.sql` | drop `contacts.user_id`, email index, `contacts_of`, `my_invitees`, `my_invites`, `my_invite`, `my_answers`, `my_account`, `token_viewer`, rate limits | 1 |
| `src/server/db/m8-member-reads.db.test.ts`, `src/test/db/members.ts` | matching and reads, plans at volume; seed helpers | 1 |
| `src/shared/api/my-invites.ts`, `src/server/queries/my-invites.ts` | schemas; RPC wrappers | 2, 5 |
| `src/app/api/me/invites/route.ts`, `invites/[id]/link/route.ts` | pages; one invite's answer link | 2 |
| `src/server/http/auth-cookie.ts`, `src/app/api/r/[token]/route.ts`, `src/shared/api/tokens.ts`, `src/server/queries/tokens.ts` | `viewer` | 2 |
| `src/hooks/use-my-invites.ts` | invites pages, the link | 2 |
| `src/lib/my-invites/describe.ts`, `group.ts` | a card's status pill; This week / Next week / Later | 3 |
| `src/lib/device/storage.ts`, `src/config/members.ts` | `tn.*` device values | 3 |
| `src/components/shell/member-shell.tsx`, `src/app/invites/**` | header; `/invites`; `/invites/[id]` | 3 |
| `src/lib/post-sign-in.ts`, `src/server/supabase/proxy-session.ts` | landing by role; protected paths | 3 |
| `supabase/migrations/<ts>_m8_account_deletion.sql`, `src/server/db/m8-account-deletion.db.test.ts` | `owner_alert_target`, `sheet_pause` reuse, `delete_account` | 4 |
| `src/server/account/delete-account.ts`, `src/app/api/me/route.ts` (DELETE), `src/emails/owner-alert-email.tsx` | after-commit work; the route; `senderRemoved` | 4 |
| `src/lib/api/fetch-all-pages.ts`, `src/lib/export/columns.ts`, `rows.ts` | shared fetch-all; `MEMBER_ANSWER_COLUMNS`, `memberAnswerRows` | 5 |
| `src/app/api/me/account/route.ts`, `src/app/api/me/answers/route.ts`, `src/shared/api/account.ts` | account summary; answer pages | 5 |
| `src/app/account/**`, `src/components/forms/display-name-form.tsx`, `confirm-name-dialog.tsx`, `src/components/shell/user-menu.tsx` | `/account`; name form; copy button; menu | 5 |
| `supabase/migrations/<ts>_m8_push.sql`, `src/server/db/m8-push.db.test.ts` | push tables and functions | 6 |
| `src/config/push.ts`, `src/config/env.ts`, `public-env.ts`, `secrets.ts` | push tuning; VAPID env | 7 |
| `src/lib/push/message.ts`, `src/server/push/classify.ts`, `run-push.ts`, `push-deps.ts`, `src/server/queries/push.ts` | words; results; the lane; deps; store | 7 |
| `src/server/workers/schedule-workers.ts` | the push lane next to the emails worker | 7 |
| `src/app/api/me/push-subscriptions/route.ts`, `src/shared/api/push.ts` | subscribe / unsubscribe | 7 |
| `src/app/sw.ts`, `src/app/serwist/[path]/route.ts`, `src/app/~offline/page.tsx`, `next.config.ts` | the service worker | 8 |
| `src/app/manifest.ts`, `src/lib/brand/app-icon.ts`, `src/app/icons/[file]/route.tsx`, `src/app/icon.svg` | install metadata and icons | 8 |
| `src/lib/push/sw-handlers.ts`, `src/lib/push/client.ts`, `src/lib/device/clear.ts` | worker handlers; browser subscribe; device cleanup | 8 |
| `src/hooks/use-reminders.ts`, `use-install-prompt.ts`, `use-online.ts` | reminders state; install; connectivity | 8 |
| `src/components/members/reminders-card.tsx`, `iphone-install-sheet.tsx`, `reminders-section.tsx`, `offline-banner.tsx` | reminders and offline UI | 8 |
| `src/emails/meeting-blocks.tsx`, `src/server/dispatch/run-dispatch.ts` | footer line | 9 |
| `src/app/r/[token]/answer-view.tsx`, `sign-in-card.tsx`, `back-to-invites.tsx` | discovery on the answer page | 9 |
| `e2e/global-setup.ts` (HTTPS fake push service), `e2e/helpers/push.ts`, `e2e/m8-members.spec.ts` | the M8 story | 10 |

---

### Task 1: DB: one matching rule, member reads, `token_viewer`, M8 rate limits

**Labels:** `type:task`, `area:db`, `area:auth`.

**Files:**
- Create: `supabase/migrations/<ts>_m8_member_reads.sql` (`supabase migration new m8_member_reads`), `src/server/db/m8-member-reads.db.test.ts`, `src/test/db/members.ts`
- Modify: `src/server/db/function-security.db.test.ts` (allow-list), `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Produces (SQL, all `security definer`, `search_path = ''`):
  - `private.contacts_of(p_user uuid) returns setof uuid`: **the** matching rule (helper, no grants).
  - `private.my_invitees() returns table (invitee_id uuid, workspace_id uuid, meeting_id uuid, contact_id uuid)`: the caller's invitees whose email went out (helper).
  - `public.my_invites(p_tab text, p_filter text, p_after_starts timestamptz, p_after_invitee uuid, p_limit integer) returns jsonb` → `{has_more, needs_count, as_of, items: [{invitee_id, workspace_name, title, starts_at, timezone, duration_minutes, status, response_mode, response_deadline, needs_answer, answer: {status, delay_minutes, reason, needs_reconfirmation} | null, mark: {actual, late_minutes} | null}]}`. Raises `tn:invalid_input`.
  - `public.my_invite(p_invitee uuid) returns uuid`: the id when it is the caller's. Raises `tn:not_found` or `tn:rate_limited` (`invite_link`).
  - `public.my_answers(p_after_starts timestamptz, p_after_invitee uuid, p_limit integer) returns jsonb` → `{has_more, items: [{invitee_id, workspace_name, title, starts_at, timezone, response_mode, status, answer: {status, delay_minutes, reason, comment, after_deadline, updated_at} | null, mark: {actual, late_minutes} | null}]}`, newest first. Rate limited (`answers_download`).
  - `public.my_account() returns jsonb` → `{owned: [{name, slug}], workspaces: int, answers_with_text: int}`.
  - `public.token_viewer(p_token_hash text, p_user uuid) returns text` (`'owner'` | `'other'`), `service_role` only.
  - `hit_user_rate_limit` actions `invite_link`, `answers_download`, `account_delete`, `push_subscribe`.

- [ ] **Step 1: Seed helpers for members**

`src/test/db/members.ts`:
```ts
import { adminClient } from "./clients";
import { seedMeeting } from "./meetings";

/** Inserts one contact with an exact email (service role). Returns its id. */
export async function seedContact(
  workspaceId: string,
  email: string,
  options: { fullName?: string; isAdhoc?: boolean } = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      email,
      full_name: options.fullName ?? "Member",
      is_adhoc: options.isAdhoc ?? false,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/**
 * A sent meeting with one invitee for `contactId` (service role). `sent: false` leaves the invite
 * unsent (no token hash), like an invite still queued.
 */
export async function seedInviteFor(
  workspaceId: string,
  contactId: string,
  meeting: Parameters<typeof seedMeeting>[1] = {},
  options: { sent?: boolean } = {},
): Promise<{ meetingId: string; inviteeId: string }> {
  const meetingId = await seedMeeting(workspaceId, {
    status: "scheduled",
    ...meeting,
  });
  const sent = options.sent ?? true;
  const { data, error } = await adminClient()
    .from("meeting_invitees")
    .insert({
      workspace_id: workspaceId,
      meeting_id: meetingId,
      contact_id: contactId,
      token_hash: sent
        ? crypto.randomUUID().replaceAll("-", "").repeat(2)
        : null,
      email_status: sent ? "sent" : "queued",
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return { meetingId, inviteeId: data.id };
}

/** Writes an answer and its history row directly (service role), as `submit_response` would. */
export async function seedAnswer(
  workspaceId: string,
  meetingId: string,
  inviteeId: string,
  answer: {
    status: "attending" | "late" | "absent" | "not_attending";
    delay_minutes?: number | null;
    reason?: string;
    comment?: string;
    needs_reconfirmation?: boolean;
  },
): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("responses")
    .insert({
      workspace_id: workspaceId,
      meeting_id: meetingId,
      invitee_id: inviteeId,
      status: answer.status,
      delay_minutes: answer.delay_minutes ?? null,
      reason: answer.reason ?? "",
      comment: answer.comment ?? "",
      needs_reconfirmation: answer.needs_reconfirmation ?? false,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  const history = await admin.from("response_history").insert({
    workspace_id: workspaceId,
    meeting_id: meetingId,
    invitee_id: inviteeId,
    response_id: data.id,
    status: answer.status,
    delay_minutes: answer.delay_minutes ?? null,
    reason: answer.reason ?? "",
    comment: answer.comment ?? "",
    after_deadline: false,
  });
  if (history.error) {
    throw history.error;
  }
  return data.id;
}

/** ISO instant `hours` from now (negative = in the past). */
export const hoursFromNow = (hours: number): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();
```

- [ ] **Step 2: Write the failing DB tests**

`src/server/db/m8-member-reads.db.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import {
  hoursFromNow,
  seedAnswer,
  seedContact,
  seedInviteFor,
} from "@/test/db/members";
import { overrideLimit } from "@/test/db/outbox";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import { seedContacts } from "@/test/db/roster";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const itemSchema = z.object({
  invitee_id: z.uuid(),
  workspace_name: z.string(),
  title: z.string(),
  starts_at: z.string(),
  needs_answer: z.boolean(),
  status: z.string(),
  answer: z
    .object({ status: z.string(), reason: z.string(), needs_reconfirmation: z.boolean() })
    .nullable(),
  mark: z.object({ actual: z.string(), late_minutes: z.number().nullable() }).nullable(),
});
const pageSchema = z.object({
  has_more: z.boolean(),
  needs_count: z.number().int(),
  as_of: z.string(),
  items: z.array(itemSchema),
});

async function invitesOf(
  user: TestUser,
  args: {
    tab?: "upcoming" | "past";
    filter?: "all" | "needs";
    after?: [string, string] | null;
    limit?: number;
  } = {},
) {
  const { data, error } = await user.client.rpc("my_invites", {
    p_tab: args.tab ?? "upcoming",
    p_filter: args.filter ?? "all",
    p_after_starts: args.after?.[0] ?? null,
    p_after_invitee: args.after?.[1] ?? null,
    p_limit: args.limit ?? 50,
  } as never);
  if (error) {
    throw error;
  }
  return pageSchema.parse(data);
}

let organizer: TestUser;
let member: TestUser;
let other: TestUser;
let clubA: TestWorkspace;
let clubB: TestWorkspace;

beforeAll(async () => {
  organizer = await createTestUser();
  member = await createTestUser();
  other = await createTestUser();
  clubA = await createWorkspaceAs(organizer, "Club A");
  clubB = await createWorkspaceAs(organizer, "Club B");
});

describe("matching invites to accounts (spec §6 Identity rules)", () => {
  it("lists sent invites to the verified email, across workspaces, ad-hoc included", async () => {
    const inA = await seedContact(clubA.id, member.email);
    const inB = await seedContact(clubB.id, member.email, { isAdhoc: true });
    const stranger = await seedContact(clubA.id, `x-${crypto.randomUUID()}@example.test`);
    const a = await seedInviteFor(clubA.id, inA, { title: "A sync", starts_at: hoursFromNow(48) });
    const b = await seedInviteFor(clubB.id, inB, { title: "B sync", starts_at: hoursFromNow(72) });
    await seedInviteFor(clubA.id, stranger, { starts_at: hoursFromNow(24) });
    await seedInviteFor(clubA.id, inA, { starts_at: hoursFromNow(30) }, { sent: false });

    const page = await invitesOf(member);
    expect(page.items.map((item) => item.invitee_id)).toEqual([a.inviteeId, b.inviteeId]);
    expect(page.items.map((item) => item.workspace_name)).toEqual(["Club A", "Club B"]);
  });

  it("matches an address typed in mixed case at sign-up (auth stores it lower-cased)", async () => {
    const mixed = await createTestUser({
      email: `Mixed.Case-${crypto.randomUUID().slice(0, 8)}@Example.Test`,
    });
    const contact = await seedContact(clubA.id, mixed.email.toLowerCase());
    const invite = await seedInviteFor(clubA.id, contact, { starts_at: hoursFromNow(5) });
    expect((await invitesOf(mixed)).items.map((item) => item.invitee_id)).toEqual([invite.inviteeId]);
  });

  it("matches nothing while the account's email is not confirmed", async () => {
    const pending = await createTestUser();
    const contact = await seedContact(clubA.id, pending.email);
    const invite = await seedInviteFor(clubA.id, contact, { starts_at: hoursFromNow(5) });
    runLocalSql(`update auth.users set email_confirmed_at = null where id = '${pending.id}'`);
    expect((await invitesOf(pending)).items).toEqual([]);
    await expectAppError(
      pending.client.rpc("my_invite", { p_invitee: invite.inviteeId } as never),
      "not_found",
    );
  });

  it("moves invites with the contact when an organizer corrects the email", async () => {
    const contact = await seedContact(clubB.id, `typo-${crypto.randomUUID()}@example.test`);
    const invite = await seedInviteFor(clubB.id, contact, { starts_at: hoursFromNow(6) });
    expect((await invitesOf(other)).items.map((item) => item.invitee_id)).not.toContain(invite.inviteeId);
    const { error } = await adminClient().from("contacts").update({ email: other.email }).eq("id", contact);
    expect(error).toBeNull();
    expect((await invitesOf(other)).items.map((item) => item.invitee_id)).toContain(invite.inviteeId);
  });
});

describe("my_invites", () => {
  let person: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    person = await createTestUser();
    const contact = await seedContact(clubA.id, person.email);
    const add = async (name: string, hours: number, meeting = {}) => {
      const invite = await seedInviteFor(clubA.id, contact, {
        title: name,
        starts_at: hoursFromNow(hours),
        ...meeting,
      });
      ids[name] = invite.inviteeId;
      return invite;
    };
    await add("unanswered", 10);
    const reconfirm = await add("reconfirm", 20);
    await seedAnswer(clubA.id, reconfirm.meetingId, reconfirm.inviteeId, {
      status: "attending",
      needs_reconfirmation: true,
    });
    const answered = await add("answered", 30);
    await seedAnswer(clubA.id, answered.meetingId, answered.inviteeId, { status: "attending" });
    await add("cancelled", 40, { status: "cancelled" });
    await add("announcement", 50, { response_mode: "announcement" });
    const past = await add("past", -30);
    await seedAnswer(clubA.id, past.meetingId, past.inviteeId, {
      status: "late",
      delay_minutes: 10,
      reason: "Bus",
    });
    const { error } = await adminClient().from("attendance_marks").insert({
      invitee_id: past.inviteeId,
      workspace_id: clubA.id,
      meeting_id: past.meetingId,
      actual: "late",
      late_minutes: 15,
    });
    expect(error).toBeNull();
  });

  it("flags what needs an answer and counts it", async () => {
    const page = await invitesOf(person);
    expect(page.needs_count).toBe(2);
    expect(
      Object.fromEntries(page.items.map((item) => [item.title, item.needs_answer])),
    ).toEqual({
      unanswered: true,
      reconfirm: true,
      answered: false,
      cancelled: false,
      announcement: false,
    });
    const needs = await invitesOf(person, { filter: "needs" });
    expect(needs.items.map((item) => item.title)).toEqual(["unanswered", "reconfirm"]);
  });

  it("shows past invites newest first with the answer and the check-in", async () => {
    const page = await invitesOf(person, { tab: "past" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].answer).toMatchObject({ status: "late", reason: "Bus" });
    expect(page.items[0].mark).toEqual({ actual: "late", late_minutes: 15 });
  });

  it("pages by start then id, with no duplicate when a later invite arrives between pages", async () => {
    const first = await invitesOf(person, { limit: 2 });
    expect(first.has_more).toBe(true);
    const last = first.items[1];
    const contact = await seedContact(clubB.id, person.email);
    const late = await seedInviteFor(clubB.id, contact, {
      title: "added later",
      starts_at: hoursFromNow(60),
    });
    const rest = await invitesOf(person, { after: [last.starts_at, last.invitee_id] });
    const all = [...first.items, ...rest.items].map((item) => item.invitee_id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.at(-1)).toBe(late.inviteeId);
  });

  it("refuses bad arguments", async () => {
    await expectAppError(
      person.client.rpc("my_invites", {
        p_tab: "past",
        p_filter: "needs",
        p_after_starts: null,
        p_after_invitee: null,
        p_limit: 10,
      } as never),
      "invalid_input",
    );
    await expectAppError(
      person.client.rpc("my_invites", {
        p_tab: "upcoming",
        p_filter: "all",
        p_after_starts: hoursFromNow(1),
        p_after_invitee: null,
        p_limit: 10,
      } as never),
      "invalid_input",
    );
  });

  it("my_invite returns only the caller's own invite and is rate limited", async () => {
    const { data } = await person.client.rpc("my_invite", { p_invitee: ids.unanswered } as never);
    expect(data).toBe(ids.unanswered);
    await expectAppError(
      other.client.rpc("my_invite", { p_invitee: ids.unanswered } as never),
      "not_found",
    );
    const restore = overrideLimit("invite_links_per_user_per_hour", 0);
    try {
      await expectAppError(
        person.client.rpc("my_invite", { p_invitee: ids.unanswered } as never),
        "rate_limited",
      );
    } finally {
      restore();
    }
  });

  it("my_answers returns every invite newest first with the full answer", async () => {
    const { data, error } = await person.client.rpc("my_answers", {
      p_after_starts: null,
      p_after_invitee: null,
      p_limit: 100,
    } as never);
    expect(error).toBeNull();
    const parsed = z
      .object({
        has_more: z.boolean(),
        items: z.array(
          z.object({
            title: z.string(),
            starts_at: z.string(),
            answer: z.object({ comment: z.string(), after_deadline: z.boolean(), updated_at: z.string() }).nullable(),
          }),
        ),
      })
      .parse(data);
    const starts = parsed.items.map((item) => item.starts_at);
    expect(starts).toEqual([...starts].sort().reverse());
    expect(parsed.items.map((item) => item.title)).toContain("past");
  });

  it("my_account names owned workspaces and counts answers with words", async () => {
    const { data } = await organizer.client.rpc("my_account");
    expect(
      z.object({ owned: z.array(z.object({ name: z.string(), slug: z.string() })), workspaces: z.number() }).parse(data),
    ).toMatchObject({ workspaces: 2 });
    const mine = z
      .object({ owned: z.array(z.object({ name: z.string() })), workspaces: z.number(), answers_with_text: z.number() })
      .parse((await person.client.rpc("my_account")).data);
    expect(mine).toEqual({ owned: [], workspaces: 0, answers_with_text: 1 });
  });
});

describe("token_viewer (answer page, spec §10)", () => {
  it("says owner only for the invite's own verified account, and is service-role only", async () => {
    const contact = await seedContact(clubA.id, member.email);
    const { inviteeId } = await seedInviteFor(clubA.id, contact, { starts_at: hoursFromNow(3) });
    const [{ hash }] = queryLocalSql(
      `select token_hash as hash from public.meeting_invitees where id = '${inviteeId}'`,
      z.array(z.object({ hash: z.string() })).length(1),
    );
    const admin = adminClient();
    expect((await admin.rpc("token_viewer", { p_token_hash: hash, p_user: member.id } as never)).data).toBe("owner");
    expect((await admin.rpc("token_viewer", { p_token_hash: hash, p_user: other.id } as never)).data).toBe("other");
    const denied = await member.client.rpc("token_viewer", { p_token_hash: hash, p_user: member.id } as never);
    expect(denied.error).not.toBeNull();
  });
});

describe("schema", () => {
  it("drops contacts.user_id and indexes contacts by email", () => {
    const columns = queryLocalSql(
      "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'user_id'",
      z.array(z.object({ name: z.string() })),
    );
    expect(columns).toEqual([]);
    const indexes = queryLocalSql(
      "select indexname as name from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'contacts_email_idx'",
      z.array(z.object({ name: z.string() })),
    );
    expect(indexes).toHaveLength(1);
  });
});

describe("plans at volume (3 workspaces × 2,000 contacts, 60 meetings each)", () => {
  it("reaches the person's invites through the email and contact indexes", async () => {
    const owner = await createTestUser();
    const person = await createTestUser();
    for (const name of ["Vol A", "Vol B", "Vol C"]) {
      const workspace = await createWorkspaceAs(owner, name);
      await seedContacts(workspace.id, 1_999, `vol-${workspace.slug}`);
      const contact = await seedContact(workspace.id, person.email);
      for (let n = 0; n < 60; n += 1) {
        await seedInviteFor(workspace.id, contact, { starts_at: hoursFromNow(n * 24 - 600) });
      }
    }
    runLocalSql("analyze public.contacts; analyze public.meeting_invitees; analyze public.meetings;");
    const plan = explainCall(
      "public.my_invites('upcoming', 'all', null, null, 50)",
      person.id,
      "authenticated",
      ["enable_seqscan = off"],
    );
    expect(planUsesIndex(plan, "contacts_email_idx")).toBe(true);
    expect(planUsesIndex(plan, "meeting_invitees_contact_ws_idx")).toBe(true);
  });
});
```

The volume test seeds 6,000 contacts and 180 meetings, about 10 s at roughly 24 ms per meeting. If its wall time passes 60 s, record a ruling and lower to 40 meetings per workspace.

- [ ] **Step 3: Run them to verify they fail**

Run: `supabase db reset --local </dev/null && bun run test:db src/server/db/m8-member-reads.db.test.ts`
Expected: FAIL. `my_invites` does not exist ("Could not find the function public.my_invites"), and the schema test still finds `user_id`.

- [ ] **Step 4: Write the migration**

`supabase/migrations/<ts>_m8_member_reads.sql`:
```sql
-- M8 member reads (spec §6 Identity rules and Access pattern (M8), §7.4, §10 Members API).
-- Invites are matched to accounts by verified email when read, so the never-filled link column
-- goes (owner, 2026-10-14: remove what is unused).

alter table public.contacts drop column user_id;  -- drops contacts_user_id_idx with it
create index contacts_email_idx on public.contacts (email);

insert into private.app_limits (name, value) values
  ('invite_links_per_user_per_hour', 600),
  ('answer_downloads_per_user_per_hour', 600),
  ('account_deletions_per_user_per_hour', 5),
  ('push_subscribes_per_user_per_hour', 30);

-- Latest body from 20261011134035_m7_minors_hardening.sql, plus the four M8 actions.
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
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- THE matching rule: a contact belongs to an account when its email equals the account's
-- confirmed email (spec §6). Auth stores emails lower-cased, like contacts, so the plain equality
-- uses contacts_email_idx. Twin, the other way round (contact → accounts): private.push_enqueue.
create function private.contacts_of(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from auth.users u
  join public.contacts c on c.email = u.email
  where u.id = p_user and u.email_confirmed_at is not null
$$;

-- The caller's invites whose email went out (only those have a working answer link).
create function private.my_invitees()
returns table (invitee_id uuid, workspace_id uuid, meeting_id uuid, contact_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.workspace_id, i.meeting_id, i.contact_id
  from public.meeting_invitees i
  where i.contact_id in (select private.contacts_of(auth.uid())) and i.token_hash is not null
$$;

-- One page of /invites (spec §7.4). Upcoming: start ascending; Past: start descending; keyset on
-- (starts_at, invitee_id). "Needs your answer": asks for answers, not cancelled, not started, and
-- no answer yet or to reconfirm. as_of is the server's time, shown when the page is read offline.
create function private.my_invites(
  p_tab text, p_filter text, p_after_starts timestamptz, p_after_invitee uuid, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_upcoming boolean := p_tab = 'upcoming';
  v_now timestamptz := pg_catalog.now();
begin
  if p_tab is null or p_tab not in ('upcoming', 'past')
    or p_filter is null or p_filter not in ('all', 'needs')
    or (p_filter = 'needs' and not v_upcoming)
    or p_limit is null or p_limit not between 1 and 100
    or ((p_after_starts is null) <> (p_after_invitee is null)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return (
    with mine as materialized (
      select x.invitee_id, w.name as workspace_name, m.title, m.starts_at, m.timezone, m.duration_minutes,
        m.status, m.response_mode, m.response_deadline,
        r.id is not null as answered, r.status as answer_status, r.delay_minutes, r.reason,
        coalesce(r.needs_reconfirmation, false) as needs_reconfirmation,
        am.actual, am.late_minutes,
        (m.response_mode <> 'announcement' and m.status = 'scheduled' and m.starts_at > v_now
          and (r.id is null or r.needs_reconfirmation)) as needs_answer
      from private.my_invitees() x
      join public.meetings m on m.id = x.meeting_id
      join public.workspaces w on w.id = x.workspace_id
      left join public.responses r on r.invitee_id = x.invitee_id
      left join public.attendance_marks am on am.invitee_id = x.invitee_id
      where m.starts_at is not null
    ), page as (
      select mine.* from mine
      where (case when v_upcoming then mine.starts_at > v_now else mine.starts_at <= v_now end)
        and (p_filter = 'all' or mine.needs_answer)
        and (p_after_invitee is null
          or (v_upcoming and (mine.starts_at, mine.invitee_id) > (p_after_starts, p_after_invitee))
          or (not v_upcoming and (mine.starts_at, mine.invitee_id) < (p_after_starts, p_after_invitee)))
      order by
        case when v_upcoming then mine.starts_at end, case when v_upcoming then mine.invitee_id end,
        case when not v_upcoming then mine.starts_at end desc, case when not v_upcoming then mine.invitee_id end desc
      limit p_limit + 1
    ), numbered as (
      select page.*, row_number() over (order by
        case when v_upcoming then page.starts_at end, case when v_upcoming then page.invitee_id end,
        case when not v_upcoming then page.starts_at end desc,
        case when not v_upcoming then page.invitee_id end desc) as n
      from page
    )
    select pg_catalog.jsonb_build_object(
      'has_more', (select count(*) > p_limit from page),
      'needs_count', (select count(*) from mine where mine.needs_answer),
      'as_of', v_now,
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'invitee_id', numbered.invitee_id, 'workspace_name', numbered.workspace_name,
          'title', numbered.title, 'starts_at', numbered.starts_at, 'timezone', numbered.timezone,
          'duration_minutes', numbered.duration_minutes, 'status', numbered.status,
          'response_mode', numbered.response_mode, 'response_deadline', numbered.response_deadline,
          'needs_answer', numbered.needs_answer,
          'answer', case when numbered.answered then pg_catalog.jsonb_build_object(
            'status', numbered.answer_status, 'delay_minutes', numbered.delay_minutes,
            'reason', numbered.reason, 'needs_reconfirmation', numbered.needs_reconfirmation) end,
          'mark', case when numbered.actual is not null then pg_catalog.jsonb_build_object(
            'actual', numbered.actual, 'late_minutes', numbered.late_minutes) end)
          order by numbered.n)
        from numbered where numbered.n <= p_limit), '[]'::jsonb)
    )
  );
end;
$$;

-- The invite /invites/[id] and a notification open, if it is the caller's (rate limited: the
-- route derives a personal link from it).
create function private.my_invite(p_invitee uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.hit_user_rate_limit('invite_link') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  select x.invitee_id into v_id from private.my_invitees() x where x.invitee_id = p_invitee;
  if v_id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- Download my answers (spec §7.4): every listed invite, newest first, one page per call.
create function private.my_answers(p_after_starts timestamptz, p_after_invitee uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
    or ((p_after_starts is null) <> (p_after_invitee is null)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('answers_download') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  return (
    with page as (
      select x.invitee_id, w.name as workspace_name, m.title, m.starts_at, m.timezone, m.response_mode,
        m.status, r.id as response_id, r.status as answer_status, r.delay_minutes, r.reason, r.comment,
        r.after_deadline, r.updated_at, am.actual, am.late_minutes
      from private.my_invitees() x
      join public.meetings m on m.id = x.meeting_id
      join public.workspaces w on w.id = x.workspace_id
      left join public.responses r on r.invitee_id = x.invitee_id
      left join public.attendance_marks am on am.invitee_id = x.invitee_id
      where m.starts_at is not null
        and (p_after_invitee is null or (m.starts_at, x.invitee_id) < (p_after_starts, p_after_invitee))
      order by m.starts_at desc, x.invitee_id desc
      limit p_limit + 1
    ), numbered as (
      select page.*, row_number() over (order by page.starts_at desc, page.invitee_id desc) as n from page
    )
    select pg_catalog.jsonb_build_object(
      'has_more', (select count(*) > p_limit from page),
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'invitee_id', numbered.invitee_id, 'workspace_name', numbered.workspace_name,
          'title', numbered.title, 'starts_at', numbered.starts_at, 'timezone', numbered.timezone,
          'response_mode', numbered.response_mode, 'status', numbered.status,
          'answer', case when numbered.response_id is not null then pg_catalog.jsonb_build_object(
            'status', numbered.answer_status, 'delay_minutes', numbered.delay_minutes,
            'reason', numbered.reason, 'comment', numbered.comment,
            'after_deadline', numbered.after_deadline, 'updated_at', numbered.updated_at) end,
          'mark', case when numbered.actual is not null then pg_catalog.jsonb_build_object(
            'actual', numbered.actual, 'late_minutes', numbered.late_minutes) end)
          order by numbered.n)
        from numbered where numbered.n <= p_limit), '[]'::jsonb)
    )
  );
end;
$$;

-- What /account and its delete dialog say (spec §7.4).
create function private.my_account()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'owned', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', w.name, 'slug', w.slug) order by w.name)
      from public.workspace_roles r join public.workspaces w on w.id = r.workspace_id
      where r.user_id = auth.uid() and r.role = 'owner'), '[]'::jsonb),
    'workspaces', (select count(*) from public.workspace_roles r where r.user_id = auth.uid()),
    'answers_with_text', (
      select count(*) from private.my_invitees() x
      join public.responses r on r.invitee_id = x.invitee_id
      where r.reason <> '' or r.comment <> '')
  )
$$;

-- The answer page's viewer (spec §10): 'owner' when the signed-in account (checked by the route
-- from the session) is the invite's own verified address.
create function private.token_viewer(p_token_hash text, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.meeting_invitees i
    where i.token_hash = p_token_hash and i.contact_id in (select private.contacts_of(p_user))
  ) then 'owner' else 'other' end
$$;

create function public.my_invites(
  p_tab text, p_filter text, p_after_starts timestamptz, p_after_invitee uuid, p_limit integer
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_invites(p_tab, p_filter, p_after_starts, p_after_invitee, p_limit) $$;
create function public.my_invite(p_invitee uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.my_invite(p_invitee) $$;
create function public.my_answers(p_after_starts timestamptz, p_after_invitee uuid, p_limit integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.my_answers(p_after_starts, p_after_invitee, p_limit) $$;
create function public.my_account()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_account() $$;
create function public.token_viewer(p_token_hash text, p_user uuid)
returns text language sql stable security invoker set search_path = ''
as $$ select private.token_viewer(p_token_hash, p_user) $$;

revoke execute on function private.contacts_of(uuid), private.my_invitees() from public, anon, authenticated;
grant execute on function
  private.my_invites(text, text, timestamptz, uuid, integer), private.my_invite(uuid),
  private.my_answers(timestamptz, uuid, integer), private.my_account()
to authenticated;
revoke execute on function
  private.my_invites(text, text, timestamptz, uuid, integer), private.my_invite(uuid),
  private.my_answers(timestamptz, uuid, integer), private.my_account(), private.token_viewer(text, uuid)
from public, anon;
revoke execute on function private.token_viewer(text, uuid) from authenticated;
grant execute on function private.token_viewer(text, uuid) to service_role;
revoke execute on function
  public.my_invites(text, text, timestamptz, uuid, integer), public.my_invite(uuid),
  public.my_answers(timestamptz, uuid, integer), public.my_account(), public.token_viewer(text, uuid)
from public, anon;
grant execute on function
  public.my_invites(text, text, timestamptz, uuid, integer), public.my_invite(uuid),
  public.my_answers(timestamptz, uuid, integer), public.my_account()
to authenticated;
revoke execute on function public.token_viewer(text, uuid) from authenticated;
grant execute on function public.token_viewer(text, uuid) to service_role;
```

Before `drop column`, prove nothing reads it: `grep -rnE "contacts?[a-z_]*\.user_id|\"user_id\"" src supabase/migrations | grep -i contact`. Expected: only `database.types.ts`, which is regenerated in Step 5. If a migration function reads `contacts.user_id`, stop and record a ruling.

- [ ] **Step 5: Allow-list, types, run**

Add `my_account`, `my_answers`, `my_invite`, `my_invites` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (keep it sorted). Then:
```bash
supabase db reset --local </dev/null && bun run db:types && bun run test:db && supabase db advisors --local </dev/null
```
Expected:
- every DB test passes, including `function-security.db.test.ts`;
- the advisors report only the pre-existing auth WARN.

**Mutation check of the plan guard:** run `psql postgresql://postgres:postgres@127.0.0.1:44322/postgres -c "drop index public.contacts_email_idx"`, re-run only the "plans at volume" test, and see it FAIL on `contacts_email_idx`. Then `supabase db reset --local </dev/null`.

- [ ] **Step 6: Typecheck, commit, PR, merge, hosted push**

```bash
bunx prettier --write src/test/db/members.ts src/server/db/m8-member-reads.db.test.ts src/server/db/function-security.db.test.ts && bun run format:check && bun run lint && bun run typecheck && bun run test
git checkout -b feat/<issue>-m8-member-reads
git add supabase/migrations src/server/db src/test/db
git commit -m "feat(db): match invites to accounts by verified email; member reads"
```
PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:db`, `area:auth`. Then `merge-when-green.sh` (background), confirm `MERGED`, and **run `bash .superpowers/scripts/hosted-push.sh`**. Record the advisors in the ledger.

---

### Task 2: Member invites API: schemas, queries, routes, the answer page's `viewer`, hooks

**Labels:** `type:task`, `area:api`, `area:auth`.

**Files:**
- Create: `src/shared/api/my-invites.ts` (+ `.test.ts`), `src/server/queries/my-invites.ts`, `src/app/api/me/invites/route.ts` (+ `.test.ts`), `src/app/api/me/invites/[id]/link/route.ts` (+ `.test.ts`), `src/server/http/auth-cookie.ts` (+ `.test.ts`), `src/server/http/token-viewer.ts` (+ `.test.ts`), `src/hooks/use-my-invites.ts` (+ `.test.tsx`)
- Modify: `src/shared/api/tokens.ts` (`viewer`), `src/app/api/r/[token]/route.ts` (+ its test), `src/config/security-headers.ts` (the link route sends no Referer)

**Interfaces:**
- Consumes: Task 1's `my_invites`, `my_invite`, `token_viewer`.
- Produces:
  - `myInvitesTabSchema` (`"upcoming" | "past"`), `myInvitesFilterSchema` (`"all" | "needs"`), `myInviteSchema`, `MyInvite`, `myInvitesPageSchema` (`{items, nextCursor, needsCount, asOf}`), `MyInvitesPage`, `myInviteLinkSchema` (`{path}`), from `src/shared/api/my-invites.ts`.
  - `getMyInvites(client, tab, filter, limit, after): Promise<Result<MyInvitesPage>>`, `getMyInviteId(client, id): Promise<Result<string>>`, `myInvitesCursorSchema` (`[iso, uuid]`), from `src/server/queries/my-invites.ts`.
  - `GET /api/me/invites?tab=&filter=&cursor=&limit=` and `GET /api/me/invites/[id]/link` → `{ path: "/r/<token>" }` (`Cache-Control: no-store`).
  - `tokenInfoSchema.viewer`: `"signed_out" | "owner" | "other"` (default `"signed_out"`). `TokenViewer` type.
  - `hasAuthCookie(request: Request): boolean`; `tokenViewer(request, admin, tokenHash): Promise<TokenViewer>`.
  - `useMyInvites(tab, filter)` → `usePagedList` result + `needsCount: number`, `asOf: string | null`; `MY_INVITES_QUERY_KEY = ["my-invites"]`; `fetchMyInviteLink(id): Promise<string>`.

- [ ] **Step 1: Write the failing schema and query-shape tests**

`src/shared/api/my-invites.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { myInviteLinkSchema, myInvitesQuerySchema } from "./my-invites";

describe("member invites schemas", () => {
  it("defaults to Upcoming, All and refuses the needs filter on Past", () => {
    expect(myInvitesQuerySchema.parse({})).toEqual({ tab: "upcoming", filter: "all" });
    expect(myInvitesQuerySchema.safeParse({ tab: "past", filter: "needs" }).success).toBe(false);
  });

  it("accepts only an answer-page path as a link", () => {
    expect(myInviteLinkSchema.safeParse({ path: `/r/${"a".repeat(43)}` }).success).toBe(true);
    expect(myInviteLinkSchema.safeParse({ path: "https://evil.example/r/x" }).success).toBe(false);
  });
});
```

`src/server/http/auth-cookie.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { hasAuthCookie } from "./auth-cookie";

const withCookie = (cookie?: string) =>
  new Request("http://localhost:3000/api/r/x", cookie ? { headers: { cookie } } : undefined);

describe("hasAuthCookie", () => {
  it("sees a Supabase session cookie, chunked or not", () => {
    expect(hasAuthCookie(withCookie("sb-abc-auth-token=x"))).toBe(true);
    expect(hasAuthCookie(withCookie("theme=dark; sb-abc-auth-token.0=x"))).toBe(true);
  });

  it("ignores requests without one", () => {
    expect(hasAuthCookie(withCookie())).toBe(false);
    expect(hasAuthCookie(withCookie("theme=dark; sb-abc-code-verifier=x"))).toBe(false);
  });
});
```

`src/server/http/token-viewer.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  rpc: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));

const signedIn = new Request("http://localhost:3000/api/r/x", {
  headers: { cookie: "sb-abc-auth-token=x" },
});
const admin = { rpc: mocks.rpc } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("tokenViewer", () => {
  it("skips the session check without an auth cookie", async () => {
    const { tokenViewer } = await import("./token-viewer");
    expect(await tokenViewer(new Request("http://localhost:3000/api/r/x"), admin, "h")).toBe("signed_out");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("asks the database whose invite it is", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "owner", error: null });
    const { tokenViewer } = await import("./token-viewer");
    expect(await tokenViewer(signedIn, admin, "h")).toBe("owner");
    expect(mocks.rpc).toHaveBeenCalledWith("token_viewer", { p_token_hash: "h", p_user: "u1" });
  });

  it("treats an expired session as signed out and a failed lookup as someone else", async () => {
    const { tokenViewer } = await import("./token-viewer");
    mocks.user = null;
    expect(await tokenViewer(signedIn, admin, "h")).toBe("signed_out");
    mocks.user = { id: "u1", email: null };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await tokenViewer(signedIn, admin, "h")).toBe("other");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test src/shared/api/my-invites.test.ts src/server/http/auth-cookie.test.ts src/server/http/token-viewer.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3: Write the schemas, the cookie check and the viewer**

`src/shared/api/my-invites.ts`:
```ts
import { z } from "zod";
import { responseModeSchema } from "./meeting-settings";
import { meetingStatusSchema } from "./meetings";
import { pageSchema } from "./pagination";
import { answerStatusSchema, markSchema } from "./responses";

/** `/invites` tabs (spec §7.4). */
export const myInvitesTabSchema = z.enum(["upcoming", "past"]);
/** An `/invites` tab. */
export type MyInvitesTab = z.infer<typeof myInvitesTabSchema>;

/** Upcoming's chips: everything, or only what needs the person's answer. */
export const myInvitesFilterSchema = z.enum(["all", "needs"]);
/** An Upcoming chip. */
export type MyInvitesFilter = z.infer<typeof myInvitesFilterSchema>;

/** `?tab=&filter=` of `GET /api/me/invites`; Past has no filter (nothing to answer there). */
export const myInvitesQuerySchema = z
  .object({
    tab: myInvitesTabSchema.default("upcoming"),
    filter: myInvitesFilterSchema.default("all"),
  })
  .refine((query) => query.tab === "upcoming" || query.filter === "all");

/** One invite card. Twin: `private.my_invites`. */
export const myInviteSchema = z.object({
  inviteeId: z.uuid(),
  workspaceName: z.string(),
  title: z.string(),
  startsAt: z.string(),
  timezone: z.string(),
  durationMinutes: z.number().int(),
  status: meetingStatusSchema,
  responseMode: responseModeSchema,
  responseDeadline: z.string().nullable(),
  needsAnswer: z.boolean(),
  answer: z
    .object({
      status: answerStatusSchema,
      delayMinutes: z.number().int().nullable(),
      reason: z.string(),
      needsReconfirmation: z.boolean(),
    })
    .nullable(),
  mark: z
    .object({
      actual: markSchema.shape.actual,
      lateMinutes: z.number().int().nullable(),
    })
    .nullable(),
});
/** One invite card. */
export type MyInvite = z.infer<typeof myInviteSchema>;

/**
 * `GET /api/me/invites`: one page, how many upcoming invites need an answer, and `asOf`, the
 * server's time when the page was made (shown when the page is read offline).
 */
export const myInvitesPageSchema = pageSchema(myInviteSchema).extend({
  needsCount: z.number().int(),
  asOf: z.string(),
});
/** One `/invites` page. */
export type MyInvitesPage = z.infer<typeof myInvitesPageSchema>;

/** `GET /api/me/invites/[id]/link`: the invite's answer page, relative to the app. */
export const myInviteLinkSchema = z.object({
  path: z.string().regex(/^\/r\/[A-Za-z0-9_-]{43}$/),
});
```

`src/server/http/auth-cookie.ts`:
```ts
import "server-only";

const SESSION_COOKIE = /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/;

/**
 * Whether the request carries a Supabase session cookie (`@supabase/ssr` names it
 * `sb-<ref>-auth-token`, split into `.0`, `.1` … when long). Public pages use it to skip the
 * session check for the many visitors who never signed in.
 */
export function hasAuthCookie(request: Request): boolean {
  return SESSION_COOKIE.test(request.headers.get("cookie") ?? "");
}
```

`src/server/http/token-viewer.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import type { Database } from "@/server/db/database.types";
import { hasAuthCookie } from "@/server/http/auth-cookie";
import { requireUser } from "@/server/http/require-user";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { type TokenViewer, tokenViewerSchema } from "@/shared/api/tokens";

/**
 * Who is looking at a personal link (spec §7.4): signed out, the invite's own verified account
 * ("Back to my invites"), or someone else. Never fails the page: a lookup error counts as "other".
 */
export async function tokenViewer(
  request: Request,
  admin: SupabaseClient<Database>,
  tokenHash: string,
): Promise<TokenViewer> {
  if (!hasAuthCookie(request)) {
    return "signed_out";
  }
  const user = await requireUser(await createSupabaseServerClient());
  if (!user) {
    return "signed_out";
  }
  const { data, error } = await admin.rpc("token_viewer", {
    p_token_hash: tokenHash,
    p_user: user.id,
  });
  if (error) {
    logger.warn({ code: error.code }, "token viewer lookup failed");
    return "other";
  }
  return tokenViewerSchema.parse(data);
}
```

In `src/shared/api/tokens.ts`, add above `tokenInfoSchema`:
```ts
/** Who opened a personal link (M8): signed out, the invite's own account, or someone else. */
export const tokenViewerSchema = z.enum(["signed_out", "owner", "other"]);
/** Who opened a personal link. */
export type TokenViewer = z.infer<typeof tokenViewerSchema>;
```
and inside `tokenInfoSchema` add `viewer: tokenViewerSchema.default("signed_out"),`. `dbInfoSchema` in `src/server/queries/tokens.ts` doesn't set it, so `lookupToken` keeps returning `"signed_out"` and the route overrides it.

`src/app/api/r/[token]/route.ts`: after the lookup succeeds,
```ts
  if (!data) {
    return apiError("not_found");
  }
  return NextResponse.json({
    ...data,
    viewer: await tokenViewer(request, context.client, context.tokenHash),
  });
```
Add a case to its route test: with `cookie: sb-x-auth-token=1` and `token_viewer` mocked to `"owner"`, the JSON has `viewer: "owner"`. Without a cookie, it has `"signed_out"` and no viewer lookup happens.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test src/shared/api/my-invites.test.ts src/server/http src/app/api/r`
Expected: PASS.

- [ ] **Step 5: Write the failing route tests**

`src/app/api/me/invites/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as { id: string; email: string | null } | null,
  getMyInvites: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/server/queries/my-invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/my-invites")>()),
  getMyInvites: mocks.getMyInvites,
}));

const get = (query = "") => new Request(`http://localhost:3000/api/me/invites${query}`);
const empty = { items: [], nextCursor: null, needsCount: 0, asOf: "2026-10-14T10:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("GET /api/me/invites", () => {
  it("is 401 without a session", async () => {
    mocks.user = null;
    const { GET } = await import("./route");
    expect((await GET(get())).status).toBe(401);
  });

  it("passes the tab, the filter, the page size and the cursor", async () => {
    mocks.getMyInvites.mockResolvedValueOnce({ data: empty, error: null });
    const { GET } = await import("./route");
    const cursor = Buffer.from(
      JSON.stringify(["2026-10-20T16:00:00.000Z", "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa"]),
    ).toString("base64url");
    const response = await GET(get(`?tab=upcoming&filter=needs&limit=20&cursor=${cursor}`));
    expect(await response.json()).toEqual(empty);
    expect(mocks.getMyInvites).toHaveBeenCalledWith({}, "upcoming", "needs", 20, [
      "2026-10-20T16:00:00.000Z",
      "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    ]);
  });

  it("refuses the needs filter on Past and a foreign cursor", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?tab=past&filter=needs"))).status).toBe(400);
    expect((await GET(get("?cursor=bm9wZQ"))).status).toBe(400);
  });
});
```

`src/app/api/me/invites/[id]/link/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as { id: string; email: string | null } | null,
  getMyInviteId: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/server/queries/my-invites", () => ({ getMyInviteId: mocks.getMyInviteId }));
vi.mock("@/config/secrets", () => ({ requireSecret: () => "s".repeat(43) }));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = new Request(`http://localhost:3000/api/me/invites/${ID}/link`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("GET /api/me/invites/[id]/link", () => {
  it("returns the derived answer page, never cached", async () => {
    mocks.getMyInviteId.mockResolvedValueOnce({ data: ID, error: null });
    const { GET } = await import("./route");
    const response = await GET(get, ctx(ID));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { deriveInviteeToken } = await import("@/server/crypto/invitee-token");
    expect(await response.json()).toEqual({ path: `/r/${deriveInviteeToken(ID, "s".repeat(43))}` });
  });

  it("is 404 for a malformed id or someone else's invite, 429 when rate limited", async () => {
    const { GET } = await import("./route");
    expect((await GET(get, ctx("nope"))).status).toBe(404);
    mocks.getMyInviteId.mockResolvedValueOnce({ data: null, error: { message: "tn:not_found" } });
    expect((await GET(get, ctx(ID))).status).toBe(404);
    mocks.getMyInviteId.mockResolvedValueOnce({ data: null, error: { message: "tn:rate_limited" } });
    expect((await GET(get, ctx(ID))).status).toBe(429);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `bun run test src/app/api/me/invites`
Expected: FAIL. The routes do not exist.

- [ ] **Step 7: Write the queries and the routes**

`src/server/queries/my-invites.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import { encodeCursor } from "@/server/http/pagination";
import { responseModeSchema } from "@/shared/api/meeting-settings";
import { meetingStatusSchema } from "@/shared/api/meetings";
import type { MyInvitesFilter, MyInvitesPage, MyInvitesTab } from "@/shared/api/my-invites";
import { answerStatusSchema, markSchema } from "@/shared/api/responses";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;
type Result<T> = { data: T | null; error: DbError | null };

const iso = z.iso.datetime({ offset: true });

/** Keyset of `/invites`: start, then invitee id. */
export const myInvitesCursorSchema = z.tuple([iso, z.uuid()]);

const dbPageSchema = z.object({
  has_more: z.boolean(),
  needs_count: z.number().int(),
  as_of: z.string(),
  items: z.array(
    z.object({
      invitee_id: z.uuid(),
      workspace_name: z.string(),
      title: z.string(),
      starts_at: z.string(),
      timezone: z.string(),
      duration_minutes: z.number().int(),
      status: meetingStatusSchema,
      response_mode: responseModeSchema,
      response_deadline: z.string().nullable(),
      needs_answer: z.boolean(),
      answer: z
        .object({
          status: answerStatusSchema,
          delay_minutes: z.number().int().nullable(),
          reason: z.string(),
          needs_reconfirmation: z.boolean(),
        })
        .nullable(),
      mark: z
        .object({ actual: markSchema.shape.actual, late_minutes: z.number().int().nullable() })
        .nullable(),
    }),
  ),
});

/** `my_invites()`: one page of the signed-in person's invites (spec §7.4). */
export async function getMyInvites(
  client: Client,
  tab: MyInvitesTab,
  filter: MyInvitesFilter,
  limit: number,
  after: [string, string] | null,
): Promise<Result<MyInvitesPage>> {
  const { data, error } = await client.rpc("my_invites", {
    p_tab: tab,
    p_filter: filter,
    p_after_starts: sqlNullable(after?.[0] ?? null),
    p_after_invitee: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const db = dbPageSchema.parse(data);
  const last = db.items.at(-1);
  return {
    data: {
      items: db.items.map((row) => ({
        inviteeId: row.invitee_id,
        workspaceName: row.workspace_name,
        title: row.title,
        startsAt: row.starts_at,
        timezone: row.timezone,
        durationMinutes: row.duration_minutes,
        status: row.status,
        responseMode: row.response_mode,
        responseDeadline: row.response_deadline,
        needsAnswer: row.needs_answer,
        answer: row.answer && {
          status: row.answer.status,
          delayMinutes: row.answer.delay_minutes,
          reason: row.answer.reason,
          needsReconfirmation: row.answer.needs_reconfirmation,
        },
        mark: row.mark && { actual: row.mark.actual, lateMinutes: row.mark.late_minutes },
      })),
      nextCursor: db.has_more && last ? encodeCursor([last.starts_at, last.invitee_id]) : null,
      needsCount: db.needs_count,
      asOf: db.as_of,
    },
    error: null,
  };
}

/** `my_invite()`: the id when the invite is the caller's (else `tn:not_found`). */
export async function getMyInviteId(client: Client, id: string): Promise<Result<string>> {
  const { data, error } = await client.rpc("my_invite", { p_invitee: id });
  return error ? { data: null, error } : { data: z.uuid().parse(data), error: null };
}
```

`src/app/api/me/invites/route.ts`:
```ts
import { NextResponse } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { readPageParams } from "@/server/http/pagination";
import { requireUser } from "@/server/http/require-user";
import { getMyInvites, myInvitesCursorSchema } from "@/server/queries/my-invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { myInvitesQuerySchema } from "@/shared/api/my-invites";

/**
 * The signed-in person's invites across every workspace (spec §7.4):
 * `?tab=upcoming|past&filter=all|needs&cursor=&limit=`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const search = new URL(request.url).searchParams;
  const query = myInvitesQuerySchema.safeParse({
    tab: search.get("tab") ?? undefined,
    filter: search.get("filter") ?? undefined,
  });
  if (!query.success) {
    return apiError("invalid_input");
  }
  const page = readPageParams(request, myInvitesCursorSchema);
  if (!page.ok) {
    return page.response;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const { data, error } = await getMyInvites(
    supabase,
    query.data.tab,
    query.data.filter,
    page.limit,
    page.after,
  );
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
```

`src/app/api/me/invites/[id]/link/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSecret } from "@/config/secrets";
import { deriveInviteeToken } from "@/server/crypto/invitee-token";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { requireUser } from "@/server/http/require-user";
import { getMyInviteId } from "@/server/queries/my-invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/**
 * The answer page of one of the signed-in person's invites (spec §7.4, §10): derived from the
 * invitee id like the emailed link, only after the database confirms the invite is theirs. The
 * response carries a personal link, so it is never cached.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/me/invites/[id]/link">,
): Promise<NextResponse> {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) {
    return apiError("not_found");
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const { data, error } = await getMyInviteId(supabase, id.data);
  if (error || !data) {
    return error ? fromDatabaseError(error) : apiError("not_found");
  }
  const token = deriveInviteeToken(data, requireSecret("INVITE_TOKEN_SECRET"));
  return NextResponse.json({ path: `/r/${token}` }, { headers: { "cache-control": "no-store" } });
}
```

In `src/config/security-headers.ts`, add `"/api/me/invites/:id/link"` to the `tokenPageHeaders` sources, and extend its JSDoc: "and the member route that hands out a personal link".

- [ ] **Step 8: The hook (test first)**

`src/hooks/use-my-invites.test.tsx`: render `useMyInvites("upcoming", "needs")` with the `src/test/render.tsx` query wrapper and `src/test/fetch.ts` to stub `fetch`. Assert:
- it requests `/api/me/invites?tab=upcoming&filter=needs&limit=50`;
- it exposes `needsCount` and `asOf` from the first page;
- `fetchMyInviteLink(id)` returns the `path`.

Run it and see it fail (no module), then write `src/hooks/use-my-invites.ts`:
```ts
"use client";

import { usePagedList } from "@/hooks/use-paged-list";
import { apiRequest } from "@/lib/api-client";
import {
  type MyInvitesFilter,
  type MyInvitesTab,
  myInviteLinkSchema,
  myInvitesPageSchema,
} from "@/shared/api/my-invites";

/** Query key prefix of every `/invites` list (invalidated after answering or deleting). */
export const MY_INVITES_QUERY_KEY = ["my-invites"] as const;

/** One `/invites` tab as a growing list, with the Needs-your-answer count and the server time. */
export function useMyInvites(tab: MyInvitesTab, filter: MyInvitesFilter) {
  const list = usePagedList({
    queryKey: MY_INVITES_QUERY_KEY,
    path: "/api/me/invites",
    params: { tab, filter },
    schema: myInvitesPageSchema,
  });
  const first = list.query.data?.pages[0];
  return { ...list, needsCount: first?.needsCount ?? 0, asOf: first?.asOf ?? null };
}

/** The answer page of one of the person's invites (a personal link; never stored). */
export async function fetchMyInviteLink(inviteeId: string): Promise<string> {
  const { path } = await apiRequest(`/api/me/invites/${inviteeId}/link`, {
    schema: myInviteLinkSchema,
  });
  return path;
}
```

- [ ] **Step 9: Run everything, commit, PR, merge**

```bash
bunx prettier --write src/shared/api/my-invites.ts src/shared/api/my-invites.test.ts src/shared/api/tokens.ts src/server/queries/my-invites.ts src/server/http/auth-cookie.ts src/server/http/auth-cookie.test.ts src/server/http/token-viewer.ts src/server/http/token-viewer.test.ts "src/app/api/me/invites" "src/app/api/r/[token]/route.ts" "src/app/api/r/[token]/route.test.ts" src/config/security-headers.ts src/hooks/use-my-invites.ts src/hooks/use-my-invites.test.tsx && bun run format:check && bun run lint && bun run typecheck && bun run test
git checkout -b feat/<issue>-m8-invites-api
git add src
git commit -m "feat(api): member invites, invite links and the answer page viewer"
```
PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:api`, `area:auth`. Then `merge-when-green.sh`, and confirm `MERGED`.

---

### Task 3: `/invites`, `/invites/[id]`, the member header, landing by role

**Labels:** `type:task`, `area:frontend`.

**Files:**
- Create: `src/config/members.ts`, `src/lib/device/storage.ts` (+ test), `src/lib/my-invites/group.ts` (+ test), `src/lib/my-invites/describe.ts` (+ test), `src/components/shell/member-shell.tsx` (+ test), `src/app/invites/page.tsx`, `src/app/invites/invites-view.tsx` (+ test), `src/app/invites/invite-card.tsx` (+ test), `src/app/invites/[id]/page.tsx`, `src/app/invites/[id]/open-invite.tsx` (+ test)
- Modify: `src/lib/post-sign-in.ts` (+ test), `src/server/supabase/proxy-session.ts` (+ test), `src/components/shell/user-menu.tsx` (+ test: "My invites" item), `messages/en.json` (`MyInvites`, `Shell.myInvites`)

**Interfaces:**
- Consumes: Task 2's `useMyInvites`, `fetchMyInviteLink`, `MyInvite`.
- Produces:
  - `DEVICE_KEYS` and `REMINDERS_NOT_NOW_DAYS` (`src/config/members.ts`).
  - `readDeviceValue<T>(key: DeviceKey, schema: z.ZodType<T>): T | null`, `writeDeviceValue(key: DeviceKey, value: string): void`, `clearDeviceValues(): void` (`src/lib/device/storage.ts`).
  - `weekGroup(startsAt: string, now: Date): "thisWeek" | "nextWeek" | "later"`.
  - `describeInvite(invite: MyInvite, tab: MyInvitesTab): InvitePill[]` with `InvitePill = { key: InvitePillKey; tone: FillTone; values?: Record<string, string | number> }`.
  - `MemberShell({ children })`.
  - `resolvePostSignInPath` sends people without a workspace to `/invites`.
  - `requiresSession` covers `/invites` and `/account`.

- [ ] **Step 1: Write the failing unit tests for the pure parts**

`src/lib/my-invites/group.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { weekGroup } from "./group";

// Wednesday 14 Oct 2026, 10:00 local; weeks start on Monday.
const now = new Date(2026, 9, 14, 10, 0);

describe("weekGroup", () => {
  it("splits by calendar week, Monday first", () => {
    expect(weekGroup(new Date(2026, 9, 18, 18, 0).toISOString(), now)).toBe("thisWeek");
    expect(weekGroup(new Date(2026, 9, 19, 9, 0).toISOString(), now)).toBe("nextWeek");
    expect(weekGroup(new Date(2026, 9, 25, 23, 59).toISOString(), now)).toBe("nextWeek");
    expect(weekGroup(new Date(2026, 9, 26, 0, 0).toISOString(), now)).toBe("later");
  });
});
```

`src/lib/my-invites/describe.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { MyInvite } from "@/shared/api/my-invites";
import { describeInvite } from "./describe";

const base: MyInvite = {
  inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
  workspaceName: "GDG ISSAT",
  title: "Weekly sync",
  startsAt: "2026-10-18T17:00:00.000Z",
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "scheduled",
  responseMode: "attendance",
  responseDeadline: null,
  needsAnswer: true,
  answer: null,
  mark: null,
};

describe("describeInvite", () => {
  it("Upcoming: not answered, with the deadline when there is one", () => {
    expect(describeInvite(base, "upcoming")).toEqual([{ key: "notAnswered", tone: "warning" }]);
    expect(
      describeInvite({ ...base, responseDeadline: "2026-10-17T10:00:00.000Z" }, "upcoming"),
    ).toEqual([
      { key: "notAnswered", tone: "warning" },
      { key: "answerBy", tone: "neutral", values: { when: "Sat 17 Oct, 11:00" } },
    ]);
  });

  it("Upcoming: a time change asks to reconfirm; an answer shows in its tone", () => {
    const going = { status: "attending" as const, delayMinutes: null, reason: "", needsReconfirmation: false };
    expect(
      describeInvite({ ...base, answer: { ...going, needsReconfirmation: true } }, "upcoming")[0],
    ).toEqual({ key: "timeChanged", tone: "warning", values: { answer: "attending" } });
    expect(
      describeInvite({ ...base, needsAnswer: false, answer: going }, "upcoming"),
    ).toEqual([{ key: "answer", tone: "success", values: { status: "attending", minutes: 0 } }]);
  });

  it("cancelled and announcements say so and nothing else", () => {
    expect(describeInvite({ ...base, status: "cancelled" }, "upcoming")).toEqual([
      { key: "cancelled", tone: "neutral" },
    ]);
    expect(describeInvite({ ...base, responseMode: "announcement" }, "past")).toEqual([
      { key: "noAnswerNeeded", tone: "neutral" },
    ]);
  });

  it("Past: what they said next to the check-in", () => {
    expect(
      describeInvite(
        {
          ...base,
          answer: { status: "late", delayMinutes: 10, reason: "Bus", needsReconfirmation: false },
          mark: { actual: "late", lateMinutes: 15 },
        },
        "past",
      ),
    ).toEqual([
      { key: "said", tone: "warning", values: { status: "late", minutes: 10 } },
      { key: "was", tone: "warning", values: { actual: "late", minutes: 15 } },
    ]);
    expect(describeInvite({ ...base, mark: { actual: "present", lateMinutes: null } }, "past")).toEqual([
      { key: "noAnswer", tone: "neutral" },
      { key: "was", tone: "success", values: { actual: "present", minutes: 0 } },
    ]);
  });
});
```

`src/lib/device/storage.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEVICE_KEYS } from "@/config/members";
import { clearDeviceValues, readDeviceValue, writeDeviceValue } from "./storage";

beforeEach(() => window.localStorage.clear());

describe("device storage", () => {
  it("reads back what was written and ignores a value that fails the schema", () => {
    writeDeviceValue(DEVICE_KEYS.invitesFilter, "needs");
    expect(readDeviceValue(DEVICE_KEYS.invitesFilter, z.enum(["all", "needs"]))).toBe("needs");
    window.localStorage.setItem(DEVICE_KEYS.invitesFilter, "bogus");
    expect(readDeviceValue(DEVICE_KEYS.invitesFilter, z.enum(["all", "needs"]))).toBeNull();
  });

  it("clears only TapNShow's own keys", () => {
    writeDeviceValue(DEVICE_KEYS.invitesFilter, "needs");
    window.localStorage.setItem("theme", "dark");
    clearDeviceValues();
    expect(window.localStorage.getItem(DEVICE_KEYS.invitesFilter)).toBeNull();
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
```

Extend `src/lib/post-sign-in.test.ts`: with no workspaces and no `next`, the result is `/invites` (it was `/w/new`). Extend the proxy-session test: `requiresSession("/invites")`, `requiresSession("/invites/abc")` and `requiresSession("/account")` are true, and `requiresSession("/r/abc")` is false.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test src/lib/my-invites src/lib/device src/lib/post-sign-in.test.ts src/server/supabase`
Expected: FAIL. The modules are missing, and the two changed expectations fail.

- [ ] **Step 3: Write the pure parts**

`src/config/members.ts`:
```ts
/** Keys of what TapNShow keeps on a device (`localStorage`); all start with `tn.` (spec §11 Push privacy: wiped at sign-out). */
export const DEVICE_KEYS = {
  /** The last Upcoming chip on `/invites` (spec §7.4). */
  invitesFilter: "tn.invites.filter",
  /** Until when "Not now" hides the reminders card (ISO instant). */
  remindersHiddenUntil: "tn.reminders.hiddenUntil",
} as const;

/** A device storage key. */
export type DeviceKey = (typeof DEVICE_KEYS)[keyof typeof DEVICE_KEYS];

/** "Not now" on the reminders card hides it this long on that device (spec §7.4). */
export const REMINDERS_NOT_NOW_DAYS = 30;
```

`src/lib/device/storage.ts`:
```ts
import type { z } from "zod";
import type { DeviceKey } from "@/config/members";

const PREFIX = "tn.";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Some private modes throw on access: behave as an empty store.
    return null;
  }
}

/** A value TapNShow saved on this device, or null when missing or not what `schema` expects. */
export function readDeviceValue<T>(key: DeviceKey, schema: z.ZodType<T>): T | null {
  const raw = storage()?.getItem(key) ?? null;
  const parsed = raw === null ? null : schema.safeParse(raw);
  return parsed?.success ? parsed.data : null;
}

/** Saves a value on this device (silently skipped when storage is unavailable or full). */
export function writeDeviceValue(key: DeviceKey, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota or private mode: the preference just isn't remembered.
  }
}

/** Removes every value TapNShow saved on this device (sign-out, account deletion). */
export function clearDeviceValues(): void {
  const store = storage();
  if (!store) {
    return;
  }
  const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
    (key): key is string => key?.startsWith(PREFIX) ?? false,
  );
  for (const key of keys) {
    store.removeItem(key);
  }
}
```

`src/lib/my-invites/group.ts`:
```ts
import { addWeeks, startOfWeek } from "date-fns";

/** Upcoming's section headings (spec §7.4). */
export type WeekGroup = "thisWeek" | "nextWeek" | "later";

/** Which Upcoming section an invite falls in, by the viewer's own calendar weeks (Monday first). */
export function weekGroup(startsAt: string, now: Date): WeekGroup {
  const nextWeek = addWeeks(startOfWeek(now, { weekStartsOn: 1 }), 1);
  const start = new Date(startsAt);
  if (start < nextWeek) {
    return "thisWeek";
  }
  return start < addWeeks(nextWeek, 1) ? "nextWeek" : "later";
}
```

`src/lib/my-invites/describe.ts`:
```ts
import type { FillTone } from "@/design/tokens";
import { formatDeadline } from "@/lib/meetings/format";
import { ACTUAL_TONE, ANSWER_TONE } from "@/lib/responses/tones";
import type { MyInvite, MyInvitesTab } from "@/shared/api/my-invites";

/** A pill's message key under `MyInvites.pill`. */
export type InvitePillKey =
  | "notAnswered"
  | "answerBy"
  | "timeChanged"
  | "answer"
  | "cancelled"
  | "noAnswerNeeded"
  | "said"
  | "noAnswer"
  | "was";

/** One status pill of an invite card: what it says and its tone. */
export type InvitePill = {
  key: InvitePillKey;
  tone: FillTone;
  values?: Record<string, string | number>;
};

/**
 * The pills of an invite card (spec §7.4, mockups 2026-10-14). Upcoming: what to do next or the
 * answer. Past: what they said next to any check-in. Cancelled and announcements say only that.
 */
export function describeInvite(invite: MyInvite, tab: MyInvitesTab): InvitePill[] {
  if (invite.status === "cancelled") {
    return [{ key: "cancelled", tone: "neutral" }];
  }
  if (invite.responseMode === "announcement") {
    return [{ key: "noAnswerNeeded", tone: "neutral" }];
  }
  const { answer, mark } = invite;
  if (tab === "past") {
    const said: InvitePill = answer
      ? {
          key: "said",
          tone: ANSWER_TONE[answer.status],
          values: { status: answer.status, minutes: answer.delayMinutes ?? 0 },
        }
      : { key: "noAnswer", tone: "neutral" };
    return mark
      ? [
          said,
          {
            key: "was",
            tone: ACTUAL_TONE[mark.actual],
            values: { actual: mark.actual, minutes: mark.lateMinutes ?? 0 },
          },
        ]
      : [said];
  }
  if (answer?.needsReconfirmation) {
    return [{ key: "timeChanged", tone: "warning", values: { answer: answer.status } }];
  }
  if (answer) {
    return [
      {
        key: "answer",
        tone: ANSWER_TONE[answer.status],
        values: { status: answer.status, minutes: answer.delayMinutes ?? 0 },
      },
    ];
  }
  const pills: InvitePill[] = [{ key: "notAnswered", tone: "warning" }];
  if (invite.responseDeadline) {
    pills.push({
      key: "answerBy",
      tone: "neutral",
      values: { when: formatDeadline(invite.responseDeadline, invite.timezone) },
    });
  }
  return pills;
}
```
Check `ANSWER_TONE` / `ACTUAL_TONE` in `src/lib/responses/tones.ts`. They map `attending → success`, `late → warning`, `absent → danger`, `not_attending → danger` and `present → success`, `late → warning`, `absent → danger`. If a mapping differs, the expected tones in the test follow the file (it is the one source), and the difference goes in a ruling.

Change `resolvePostSignInPath` so its last line is `return slug ? \`/w/${slug}\` : "/invites";`, and update its JSDoc: "else `/invites` (members without a workspace; spec §7.4)". Change `requiresSession`:
```ts
/** Pages that need a session. API routes check sessions themselves (401). */
export function requiresSession(pathname: string): boolean {
  return ["/welcome", "/w", "/invites", "/account"].some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun run test src/lib/my-invites src/lib/device src/lib/post-sign-in.test.ts src/server/supabase`
Expected: PASS.

- [ ] **Step 5: Messages**

Add to `messages/en.json`. Keep the order: a new top-level `MyInvites` namespace after `InvitePage`, and `myInvites` / `yourWorkspace` keys in `Shell`.
```json
"MyInvites": {
  "title": "My invites",
  "tabs": { "label": "Invites", "upcoming": "Upcoming", "past": "Past" },
  "chips": { "label": "Show", "all": "All", "needs": "Needs your answer" },
  "groups": { "thisWeek": "This week", "nextWeek": "Next week", "later": "Later" },
  "pill": {
    "notAnswered": "Not answered",
    "answerBy": "Please answer by {when}",
    "timeChanged": "Time changed",
    "timeChangedHint": "You said {answer, select, attending {Going} late {Late} absent {Can't come} other {Not going}}. Still going?",
    "answer": "{status, select, attending {Going} late {Late by {minutes} min} absent {Can't come} other {Not going}}",
    "cancelled": "Cancelled",
    "noAnswerNeeded": "No answer needed",
    "said": "{status, select, attending {Said going} late {Said late by {minutes} min} absent {Said can't come} other {Said not going}}",
    "noAnswer": "No answer",
    "was": "{actual, select, present {Was present} late {{minutes, plural, =0 {Was late} other {Was late by # min}}} other {Was absent}}"
  },
  "yourReason": "Your reason: {reason}",
  "caughtUp": "You're all caught up",
  "caughtUpBody": "Every upcoming invite has your answer.",
  "emptyTitle": "No invites yet",
  "emptyBody": "When a group invites you at {email}, the meeting shows up here too.",
  "otherAddress": "Invited at another address? Sign in with that one.",
  "organizing": "Organizing meetings yourself?",
  "createWorkspace": "Create a workspace",
  "noPast": "No past invites yet.",
  "opening": "Opening your invite…",
  "notAvailable": "This invite isn't available any more.",
  "backToInvites": "Back to my invites"
},
```
`Shell`: `"myInvites": "My invites"`, `"yourWorkspace": "Your workspaces"`.

- [ ] **Step 6: Write the failing component tests**

`src/app/invites/invite-card.test.tsx` (render with `src/test/render.tsx`):
- it shows the title, "GDG ISSAT · Sat 18 Oct, 18:00" and the "Not answered" pill;
- it links to `/invites/<inviteeId>`;
- a Past card shows "Said late by 10 min", "Was late by 15 min" and "Your reason: Bus", and is not a link.

`src/app/invites/invites-view.test.tsx` (mock `@/hooks/use-my-invites`):
- Upcoming groups cards under "This week" / "Next week" / "Later";
- the "Needs your answer" chip shows the count `2` and, pressed, calls `useMyInvites("upcoming", "needs")` and writes `tn.invites.filter`;
- the chip remembered on the device is used on the next render;
- with the filter on and no items, it shows "You're all caught up";
- with no invites at all, it shows the empty state with the person's email and a **Create a workspace** link to `/w/new`;
- the Past tab has no chips.

`src/app/invites/[id]/open-invite.test.tsx`: mock `fetchMyInviteLink` and `@/lib/navigation`. On success it calls `replaceWith(path)`, a new export next to `goTo` in `src/lib/navigation.ts`: `window.location.replace(href)`, with JSDoc "leaves no history entry, so Back from the answer page returns to `/invites`". On `not_found` it shows "This invite isn't available any more." and a "Back to my invites" link.

`src/components/shell/member-shell.test.tsx`: the logo links to `/invites`. A person with a workspace sees "Your workspaces" linking to `/w/<lastWorkspaceSlug or first slug>`; a person without one doesn't. The avatar menu is there.

`src/components/shell/user-menu.test.tsx`: add a test that the menu has a **My invites** item linking to `/invites`.

- [ ] **Step 7: Run them to verify they fail**

Run: `bun run test src/app/invites src/components/shell`
Expected: FAIL. The components don't exist, and the menu has no My invites item.

- [ ] **Step 8: Write the components**

`src/components/shell/member-shell.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME } from "@/config/app";
import { useMe } from "@/hooks/use-me";
import { UserMenu } from "./user-menu";

/** Shell of the member pages (`/invites`, `/account`; spec §7.4): logo, a way back to a workspace, the avatar menu. */
export function MemberShell({ children }: { children: ReactNode }) {
  const t = useTranslations("Shell");
  const me = useMe();
  if (!me.data) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }
  const slug = me.data.lastWorkspaceSlug ?? me.data.workspaces[0]?.slug;
  return (
    <div className="min-h-dvh pb-12">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b-[length:var(--tn-border-width)] border-outline bg-background px-4 py-3">
        <Link href="/invites" className="font-display text-lg">
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-2">
          {slug ? (
            <Button asChild size="sm">
              <Link href={`/w/${slug}`}>{t("yourWorkspace")}</Link>
            </Button>
          ) : null}
          <UserMenu me={me.data} />
        </div>
      </header>
      <main className="mx-auto max-w-md p-4">{children}</main>
    </div>
  );
}
```
Check that `Button` has a `size="sm"` variant (`src/components/ui/button.tsx` `buttonVariants`). If it doesn't, use the default size and record nothing: it's the existing look.

`src/app/invites/page.tsx`:
```tsx
import { MemberShell } from "@/components/shell/member-shell";
import { InvitesView } from "./invites-view";

/** `/invites`: the member home (spec §7.4). */
export default function InvitesPage() {
  return (
    <MemberShell>
      <InvitesView />
    </MemberShell>
  );
}
```

`src/app/invites/invite-card.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import { cn } from "@/lib/utils";
import { formatDeadline } from "@/lib/meetings/format";
import { describeInvite } from "@/lib/my-invites/describe";
import type { MyInvite, MyInvitesTab } from "@/shared/api/my-invites";
import { CaretRight } from "@phosphor-icons/react";
import { initials } from "@/lib/text/initials";

const PILL_TONE: Record<string, string> = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
};

/**
 * One invite (spec §7.4): workspace sticker, title, "<Workspace> · <day, time>" in the meeting's
 * zone, and its pills. Upcoming cards open the invite; Past cards don't (answers close at the start).
 * `disabled` (offline, Task 8) keeps the card visible but not openable.
 */
export function InviteCard({
  invite,
  tab,
  disabled = false,
}: {
  invite: MyInvite;
  tab: MyInvitesTab;
  disabled?: boolean;
}) {
  const t = useTranslations("MyInvites");
  const pills = describeInvite(invite, tab);
  const body = (
    <Card
      as="article"
      className={cn("flex flex-col gap-2", invite.status === "cancelled" && "opacity-60")}
    >
      <div className="flex items-center gap-3">
        <Sticker tone="primary" label={invite.workspaceName}>
          <span className="text-xs font-bold">{initials(invite.workspaceName)}</span>
        </Sticker>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold">{invite.title}</h3>
          <p className="truncate text-sm text-muted-ink">
            {invite.workspaceName} · {formatDeadline(invite.startsAt, invite.timezone)}
          </p>
        </div>
        {tab === "upcoming" && !disabled ? <CaretRight weight="bold" aria-hidden /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pills.map((pill) => (
          <span
            key={pill.key}
            className={cn(
              "rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
              PILL_TONE[pill.tone],
            )}
          >
            {t(`pill.${pill.key}`, pill.values)}
          </span>
        ))}
        {pills[0]?.key === "timeChanged" && invite.answer ? (
          <span className="text-sm text-muted-ink">
            {t("pill.timeChangedHint", { answer: invite.answer.status })}
          </span>
        ) : null}
      </div>
      {tab === "past" && invite.answer?.reason ? (
        <p className="text-sm text-muted-ink">{t("yourReason", { reason: invite.answer.reason })}</p>
      ) : null}
    </Card>
  );
  return tab === "upcoming" && !disabled ? (
    <Link href={`/invites/${invite.inviteeId}`} className="rounded-[var(--tn-radius-card)]">
      {body}
    </Link>
  ) : (
    body
  );
}
```
Before writing, check these and adjust the imports to what exists:
- `grep -rn "export function initials" src/lib`. If nothing exists, create `src/lib/text/initials.ts` (first letter of the first two words, upper-cased; with a test).
- `cn`'s real path (`grep -rn "export function cn" src/lib`).
- The fill classes a `Chip` uses for tones (`src/components/ui/chip.tsx`, lines 8–13). Import its tone map if it is exported. Otherwise export it from `chip.tsx` as `FILL_CLASS` and use it here, so the class list lives once.
- `Sticker`'s `tone` values (`StickerTone`).

`src/app/invites/invites-view.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import { DEVICE_KEYS } from "@/config/members";
import { useMe } from "@/hooks/use-me";
import { useMyInvites } from "@/hooks/use-my-invites";
import { readDeviceValue, writeDeviceValue } from "@/lib/device/storage";
import { weekGroup, type WeekGroup } from "@/lib/my-invites/group";
import {
  type MyInvite,
  type MyInvitesFilter,
  myInvitesFilterSchema,
  type MyInvitesTab,
  myInvitesTabSchema,
} from "@/shared/api/my-invites";
import { InviteCard } from "./invite-card";

const GROUPS: WeekGroup[] = ["thisWeek", "nextWeek", "later"];

/** `/invites` (spec §7.4): Upcoming in date order with All / Needs your answer, and Past. */
export function InvitesView() {
  const t = useTranslations("MyInvites");
  const me = useMe();
  const [tab, setTab] = useState<MyInvitesTab>("upcoming");
  const [filter, setFilter] = useState<MyInvitesFilter>("all");
  useEffect(() => {
    // Read after mount: the page is pre-rendered, and the device's choice must not cause a hydration mismatch.
    const saved = readDeviceValue(DEVICE_KEYS.invitesFilter, myInvitesFilterSchema);
    if (saved) {
      setFilter(saved);
    }
  }, []);
  const chosen = tab === "upcoming" ? filter : "all";
  const list = useMyInvites(tab, chosen);
  const choose = (next: MyInvitesFilter) => {
    setFilter(next);
    writeDeviceValue(DEVICE_KEYS.invitesFilter, next);
  };
  const now = new Date();
  const grouped = (items: MyInvite[]) =>
    GROUPS.map((group) => ({
      group,
      items: items.filter((item) => weekGroup(item.startsAt, now) === group),
    })).filter((section) => section.items.length > 0);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <SegmentedControl
        label={t("tabs.label")}
        value={tab}
        onValueChange={(value) => setTab(myInvitesTabSchema.parse(value))}
        options={[
          { value: "upcoming", label: t("tabs.upcoming") },
          { value: "past", label: t("tabs.past") },
        ]}
      />
      {tab === "upcoming" ? (
        <div role="group" aria-label={t("chips.label")} className={CHIP_ROW_CLASS}>
          <Chip pressed={filter === "all"} onPressedChange={() => choose("all")}>
            {t("chips.all")}
          </Chip>
          <Chip pressed={filter === "needs"} onPressedChange={() => choose("needs")}>
            {t("chips.needs")}
            {list.needsCount > 0 ? (
              <span className="ml-1.5 rounded-full border-2 border-outline bg-fill-warning px-1.5 text-xs">
                {list.needsCount}
              </span>
            ) : null}
          </Chip>
        </div>
      ) : null}
      {list.query.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : list.items.length === 0 ? (
        <EmptyState tab={tab} filter={chosen} email={me.data?.profile.email ?? ""} />
      ) : tab === "upcoming" ? (
        grouped(list.items).map((section) => (
          <div key={section.group} className="flex flex-col gap-3">
            <h2 className="text-xs font-extrabold tracking-wide text-muted-ink uppercase">
              {t(`groups.${section.group}`)}
            </h2>
            {section.items.map((invite) => (
              <InviteCard key={invite.inviteeId} invite={invite} tab={tab} />
            ))}
          </div>
        ))
      ) : (
        list.items.map((invite) => <InviteCard key={invite.inviteeId} invite={invite} tab={tab} />)
      )}
      <ShowMore hasMore={list.hasMore} loading={list.isLoadingMore} onMore={list.loadMore} />
    </section>
  );
}

function EmptyState({ tab, filter, email }: { tab: MyInvitesTab; filter: MyInvitesFilter; email: string }) {
  const t = useTranslations("MyInvites");
  if (filter === "needs") {
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t("caughtUp")}</h2>
        <p>{t("caughtUpBody")}</p>
      </Card>
    );
  }
  if (tab === "past") {
    return <p className="text-muted-ink">{t("noPast")}</p>;
  }
  return (
    <>
      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t("emptyTitle")}</h2>
        <p>{t("emptyBody", { email })}</p>
        <p className="text-sm text-muted-ink">{t("otherAddress")}</p>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-bold">{t("organizing")}</p>
        <Button asChild>
          <Link href="/w/new">{t("createWorkspace")}</Link>
        </Button>
      </Card>
    </>
  );
}
```
Read `src/components/ui/show-more.tsx` for its exact props (`hasMore`, `loading`, `onMore`, `endLabel`). The empty and "caught up" cards use Phosphor Bold icons in a `<Sticker>` like the mockup (`EnvelopeSimple`, `Check`).

`src/app/invites/[id]/page.tsx` and `open-invite.tsx`: a client page that calls `fetchMyInviteLink(id)` once (`useQuery` with `retry: false`, `staleTime: 0`, `gcTime: 0`: the link is personal and never kept). On success it calls `replaceWith(path)`, so Back from the answer page returns to `/invites`. While it waits, it shows "Opening your invite…" with a skeleton. On error it shows the `ApiErrors` text for the code (`errorCodeOf`) or, for `not_found`, "This invite isn't available any more.", plus a "Back to my invites" link. Wrap it in `MemberShell`.

In `src/components/shell/user-menu.tsx`, add a first menu item before "Your name":
```tsx
          <DropdownMenuItem asChild>
            <Link href="/invites">
              <EnvelopeSimple weight="bold" aria-hidden />
              {t("myInvites")}
            </Link>
          </DropdownMenuItem>
```
(Task 5 replaces "Your name" with Account.)

- [ ] **Step 9: Run the tests, then screenshots**

Run: `bun run test src/app/invites src/components/shell src/lib`
Expected: PASS.

Write `.superpowers/scripts/screens/m8-invites.spec.ts`. It seeds a member with invites in two workspaces (one unanswered with a deadline, one time-changed, one answered, one cancelled, one past with a check-in, using the e2e seed helpers and `signInWithCode`). It shoots `/invites` (All, Needs your answer, Past, empty) and `/invites/<id>` opening, at 390 light, 320 dark and 1024. Look at every image: no horizontal scroll at 320, pills wrap, chips wrap with a fine pointer. Send them to the Owner and ask "Looks right?" before merging.

- [ ] **Step 10: Run everything, commit, PR, merge**

```bash
bunx prettier --write src/config/members.ts src/lib/device src/lib/my-invites src/components/shell src/app/invites src/lib/post-sign-in.ts src/lib/post-sign-in.test.ts src/server/supabase/proxy-session.ts messages/en.json && bun run format:check && bun run lint && bun run typecheck && bun run test && TZ=UTC bun run test:e2e
git checkout -b feat/<issue>-m8-invites-ui
git add src messages
git commit -m "feat(ui): my invites, landing by role, member header"
```
The full e2e run proves the landing change didn't break the M2 sign-in story: a new user with no workspace now lands on `/invites`. If `e2e/auth-workspace.spec.ts` expects `/w/new` after sign-in, update it to go through **Create a workspace** from `/invites`, and record the change as a ruling.

PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:frontend`. Then `merge-when-green.sh`, and confirm `MERGED`.

---

### Task 4: Account deletion: `delete_account`, owner alerts, `DELETE /api/me`

**Labels:** `type:task`, `area:db`, `area:auth`, `area:api`.

**Files:**
- Create: `supabase/migrations/<ts>_m8_account_deletion.sql`, `src/server/db/m8-account-deletion.db.test.ts`, `src/shared/api/account.ts` (+ test), `src/server/queries/account.ts`, `src/server/account/delete-account.ts` (+ test)
- Modify: `src/app/api/me/route.ts` (+ test: `DELETE`), `src/emails/owner-alert-email.tsx` (+ test: `senderRemoved`), `src/shared/api/errors.ts` + `messages/en.json` (`owns_workspaces`, `Email.senderRemoved`), `src/server/supabase/admin-client.ts` (JSDoc: allowed callers), `src/server/db/function-security.db.test.ts`

**Interfaces:**
- Consumes: Task 1's `private.contacts_of`; M7's `private.release_connection`, `releasedSchema`, `revokeReleased`, `createSystemMailer`, `renderOwnerAlertEmail`.
- Produces:
  - SQL `private.owner_alert_target(p_workspace uuid) returns jsonb`: `{email, workspace_name, workspace_slug}` or null when the platform cap is spent. This is the one cap rule; `sheet_pause` now uses it.
  - `public.delete_account(p_confirm text) returns jsonb` → `{released: [{refresh_token_encrypted, google_sub, user_id}], alerts: [{kind: "sender" | "sheet", email, workspace_name, workspace_slug}]}`. Raises `tn:name_mismatch`, `tn:owns_workspaces`, `tn:rate_limited`, `tn:unauthenticated`.
  - `deleteAccountBodySchema` (`{confirm: "confirm"}`) and `ACCOUNT_DELETE_WORD = "confirm"` in `src/shared/api/account.ts`.
  - `deleteAccountData(client, confirm): Promise<Result<AccountDeletion>>`, with `AccountDeletion = { released: ReleasedConnection[]; alerts: OwnerAlert[] }`.
  - `afterAccountDeleted(result: AccountDeletion, deps?): Promise<void>` and `removeAuthUser(userId): Promise<boolean>`.
  - `OwnerAlertEmailProps` gains `{ kind: "senderRemoved"; workspaceName; settingsUrl }`.
  - `DELETE /api/me` (`{confirm}`) → `{ok: true}`, with the session cookies cleared.

- [ ] **Step 1: Write the failing DB tests**

`src/server/db/m8-account-deletion.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError } from "@/test/db/clients";
import { hoursFromNow, seedAnswer, seedContact, seedInviteFor } from "@/test/db/members";
import { overrideLimit } from "@/test/db/outbox";
import { seedConnection, setSender } from "@/test/db/sender";
import { dirtyYears, seedSheet } from "@/test/db/sheets";
import { addMember, createWorkspaceAs } from "@/test/db/workspaces";

const resultSchema = z.object({
  released: z.array(z.object({ google_sub: z.string(), user_id: z.uuid() })),
  alerts: z.array(
    z.object({ kind: z.enum(["sender", "sheet"]), email: z.string(), workspace_name: z.string(), workspace_slug: z.string() }),
  ),
});

async function deleteAs(user: Awaited<ReturnType<typeof createTestUser>>, word = "confirm") {
  const { data, error } = await user.client.rpc("delete_account", { p_confirm: word } as never);
  if (error) {
    throw error;
  }
  return resultSchema.parse(data);
}

describe("delete_account (spec §11 Account deletion)", () => {
  it("refuses the wrong word, and refuses while the person owns a workspace", async () => {
    const owner = await createTestUser();
    await createWorkspaceAs(owner, "Owned");
    await expectAppError(owner.client.rpc("delete_account", { p_confirm: "Confirm" } as never), "name_mismatch");
    await expectAppError(owner.client.rpc("delete_account", { p_confirm: "confirm" } as never), "owns_workspaces");
    const { count } = await adminClient()
      .from("workspace_roles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", owner.id);
    expect(count).toBe(1);
  });

  it("erases reasons and comments in answers and history everywhere, keeps the statuses, marks the sheet", async () => {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const clubA = await createWorkspaceAs(organizer, "Club A");
    const clubB = await createWorkspaceAs(organizer, "Club B");
    const sheetOwner = await seedConnection(organizer.id, { scopes: ["https://www.googleapis.com/auth/drive.file"] });
    await seedSheet(clubA.id, sheetOwner.id, { googleSub: sheetOwner.sub, spreadsheetId: "fake-file-000901" });
    const a = await seedInviteFor(clubA.id, await seedContact(clubA.id, member.email), { starts_at: hoursFromNow(-48) });
    const b = await seedInviteFor(clubB.id, await seedContact(clubB.id, member.email), { starts_at: hoursFromNow(24) });
    await seedAnswer(clubA.id, a.meetingId, a.inviteeId, { status: "absent", reason: "Exam", comment: "Sorry" });
    await seedAnswer(clubB.id, b.meetingId, b.inviteeId, { status: "late", delay_minutes: 10, reason: "Bus" });
    await adminClient().from("sheet_dirty_years").delete().eq("workspace_id", clubA.id);

    await deleteAs(member);

    const { data: answers } = await adminClient()
      .from("responses")
      .select("status, reason, comment")
      .in("invitee_id", [a.inviteeId, b.inviteeId])
      .order("status");
    expect(answers).toEqual([
      { status: "absent", reason: "", comment: "" },
      { status: "late", reason: "", comment: "" },
    ]);
    const { data: history } = await adminClient()
      .from("response_history")
      .select("reason, comment")
      .in("invitee_id", [a.inviteeId, b.inviteeId]);
    expect(history?.every((row) => row.reason === "" && row.comment === "")).toBe(true);
    expect((await dirtyYears(clubA.id)).length).toBeGreaterThan(0);
  });

  it("leaves every workspace, stops the sending that used their Gmail and tells the Owner once", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const club = await createWorkspaceAs(owner, "Sender Club");
    await addMember(club.id, admin.id, "admin");
    const gmail = await seedConnection(admin.id);
    await setSender(club.id, gmail.id);

    const result = await deleteAs(admin);

    const { data: workspace } = await adminClient().from("workspaces").select("sender_connection_id").eq("id", club.id).single();
    expect(workspace?.sender_connection_id).toBeNull();
    expect(result.alerts).toEqual([
      { kind: "sender", email: owner.email, workspace_name: "Sender Club", workspace_slug: club.slug },
    ]);
    expect(result.released.map((row) => row.google_sub)).toEqual([gmail.sub]);
    const { count } = await adminClient()
      .from("workspace_roles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", admin.id);
    expect(count).toBe(0);
  });

  it("pauses a sheet in their Drive and never revokes a Google account another person still uses", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const colleague = await createTestUser();
    const club = await createWorkspaceAs(owner, "Sheet Club");
    await addMember(club.id, admin.id, "admin");
    const shared = `sub-shared-${crypto.randomUUID()}`;
    const theirs = await seedConnection(admin.id, { sub: shared, scopes: ["https://www.googleapis.com/auth/drive.file"] });
    await seedConnection(colleague.id, { sub: shared });
    await seedSheet(club.id, theirs.id, { googleSub: shared, spreadsheetId: "fake-file-000902" });

    const result = await deleteAs(admin);

    expect(result.released).toEqual([]);
    expect(result.alerts.map((alert) => alert.kind)).toEqual(["sheet"]);
    const { data: sheet } = await adminClient()
      .from("sheet_syncs")
      .select("status, paused_reason, connection_id, google_sub")
      .eq("workspace_id", club.id)
      .single();
    expect(sheet).toEqual({ status: "paused", paused_reason: "access_lost", connection_id: null, google_sub: shared });
    const { count } = await adminClient()
      .from("google_connections")
      .select("*", { count: "exact", head: true })
      .eq("user_id", colleague.id);
    expect(count).toBe(1);
  });

  it("is harmless when called again, and rate limited", async () => {
    const member = await createTestUser();
    await deleteAs(member);
    expect(await deleteAs(member)).toEqual({ released: [], alerts: [] });
    const restore = overrideLimit("account_deletions_per_user_per_hour", 0);
    try {
      await expectAppError(member.client.rpc("delete_account", { p_confirm: "confirm" } as never), "rate_limited");
    } finally {
      restore();
    }
  });

  it("the auth user's removal (the route's next step) cascades to the profile", async () => {
    const member = await createTestUser();
    await deleteAs(member);
    const removed = await adminClient().auth.admin.deleteUser(member.id);
    expect(removed.error).toBeNull();
    const { count } = await adminClient()
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", member.id);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `supabase db reset --local </dev/null && bun run test:db src/server/db/m8-account-deletion.db.test.ts`
Expected: FAIL. `delete_account` does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/<ts>_m8_account_deletion.sql`:
```sql
-- M8 account deletion (spec §7.4, §11 Account deletion). Latest sheet_pause body from
-- 20261011094523_m7_sheet_worker.sql; its alert cap moves into owner_alert_target so pausing a
-- sheet and deleting an account share one rule.

-- The Owner to tell about a workspace problem, inside the platform email cap (the M4 Viewer-invite
-- budget). Null when the cap is spent: the problem still shows in Settings.
create function private.owner_alert_target(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours') then
    return null;
  end if;
  return (
    select pg_catalog.jsonb_build_object('email', u.email, 'workspace_name', w.name, 'workspace_slug', w.slug)
    from public.workspaces w
    join public.workspace_roles r on r.workspace_id = w.id and r.role = 'owner'
    join auth.users u on u.id = r.user_id
    where w.id = p_workspace
  );
end;
$$;

create or replace function private.sheet_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.sheet_syncs;
  v_target jsonb;
begin
  update public.sheet_syncs
  set status = 'paused', paused_reason = p_reason, paused_at = pg_catalog.now(), run_id = null, locked_until = null
  where workspace_id = p_workspace and run_id = p_run
  returning * into v_sheet;
  if v_sheet.workspace_id is null
    or (v_sheet.alerted_at is not null and v_sheet.alerted_at > pg_catalog.now() - interval '24 hours') then
    return null;
  end if;
  v_target := private.owner_alert_target(p_workspace);
  if v_target is null then
    return null;
  end if;
  update public.sheet_syncs set alerted_at = pg_catalog.now() where workspace_id = p_workspace;
  return v_target || pg_catalog.jsonb_build_object('reason', p_reason);
end;
$$;

-- Delete my account, the database part (spec §11). The route then revokes the released tokens,
-- emails the alerts and deletes the auth user through the admin API (cascading to the profile and
-- push subscriptions). Calling it again after a failed admin call is harmless.
create function private.delete_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_connections uuid[];
  v_alerts jsonb := '[]'::jsonb;
  v_target jsonb;
  v_row record;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if p_confirm is distinct from 'confirm' then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('account_delete') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  -- Lock the person's seats first: an ownership transfer to them (which needs an existing Admin
  -- seat) waits, then finds no seat.
  perform 1 from public.workspace_roles r where r.user_id = v_user for update;
  if exists (select 1 from public.workspace_roles r where r.user_id = v_user and r.role = 'owner') then
    raise exception 'tn:owns_workspaces' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles r where r.user_id = v_user;

  -- Reasons and comments go everywhere; statuses and check-ins stay for the groups (the sheet
  -- triggers mark the years, so the Google Sheet drops the words at its next redraw).
  update public.responses r set reason = '', comment = ''
  where r.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (r.reason <> '' or r.comment <> '');
  update public.response_history h set reason = '', comment = ''
  where h.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (h.reason <> '' or h.comment <> '');

  select coalesce(pg_catalog.array_agg(c.id), '{}') into v_connections
  from public.google_connections c where c.user_id = v_user;

  for v_row in
    update public.workspaces w set sender_connection_id = null
    where w.sender_connection_id = any (v_connections)
    returning w.id
  loop
    v_target := private.owner_alert_target(v_row.id);
    if v_target is not null then
      v_alerts := v_alerts || pg_catalog.jsonb_build_array(v_target || pg_catalog.jsonb_build_object('kind', 'sender'));
    end if;
  end loop;

  -- The sheet keeps its account (google_sub/email) for "Pick that account"; only the link goes.
  for v_row in
    update public.sheet_syncs s
    set status = 'paused', paused_reason = 'access_lost', paused_at = pg_catalog.now(),
      run_id = null, locked_until = null, connection_id = null
    where s.connection_id = any (v_connections)
    returning s.workspace_id, s.alerted_at
  loop
    if v_row.alerted_at is null or v_row.alerted_at <= pg_catalog.now() - interval '24 hours' then
      v_target := private.owner_alert_target(v_row.workspace_id);
      if v_target is not null then
        update public.sheet_syncs set alerted_at = pg_catalog.now() where workspace_id = v_row.workspace_id;
        v_alerts := v_alerts || pg_catalog.jsonb_build_array(v_target || pg_catalog.jsonb_build_object('kind', 'sheet'));
      end if;
    end if;
  end loop;

  -- Nothing uses them now; release_connection keeps the token when another person's connection
  -- holds the same Google account (spec §9, M7 final review).
  return pg_catalog.jsonb_build_object(
    'released', coalesce((
      select pg_catalog.jsonb_agg(x.released)
      from (select private.release_connection(c, v_user) as released from pg_catalog.unnest(v_connections) as c) x
      where x.released is not null), '[]'::jsonb),
    'alerts', v_alerts
  );
end;
$$;

create function public.delete_account(p_confirm text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.delete_account(p_confirm) $$;

revoke execute on function private.owner_alert_target(uuid) from public, anon, authenticated;
grant execute on function private.delete_account(text) to authenticated;
revoke execute on function private.delete_account(text) from public, anon;
revoke execute on function public.delete_account(text) from public, anon;
grant execute on function public.delete_account(text) to authenticated;
```
`sheet_pause` keeps its signature and grants (`create or replace`). The M7 sheet worker DB tests must stay green, which proves the shared cap kept its behaviour.

- [ ] **Step 4: Allow-list, types, run**

Add `delete_account` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`. Then:
```bash
supabase db reset --local </dev/null && bun run db:types && bun run test:db && supabase db advisors --local </dev/null
```
Expected: all DB tests pass, including `sheet-worker.db.test.ts` and `sheet-state.db.test.ts`. Advisors: only the auth WARN.

- [ ] **Step 5: Write the failing TS tests**

`src/shared/api/account.test.ts`: `deleteAccountBodySchema` accepts `{confirm: "confirm"}` and refuses `"Confirm"`, `" confirm"` and a missing field.

`src/server/account/delete-account.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { afterAccountDeleted } from "./delete-account";

describe("afterAccountDeleted", () => {
  it("revokes what was released and emails each alert, one failure never stopping the rest", async () => {
    const revoke = vi.fn(async () => undefined);
    const send = vi
      .fn<(to: string, kind: "senderRemoved" | "sheetPaused", workspace: string, slug: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValue(undefined);
    await afterAccountDeleted(
      {
        released: [{ tokenEncrypted: "v1.x", googleSub: "s", userId: "u" }],
        alerts: [
          { kind: "sender", email: "o1@example.test", workspaceName: "A", workspaceSlug: "a-1" },
          { kind: "sheet", email: "o2@example.test", workspaceName: "B", workspaceSlug: "b-1" },
        ],
      },
      { revoke, send },
    );
    expect(revoke).toHaveBeenCalledWith([{ tokenEncrypted: "v1.x", googleSub: "s", userId: "u" }]);
    expect(send).toHaveBeenNthCalledWith(1, "o1@example.test", "senderRemoved", "A", "a-1");
    expect(send).toHaveBeenNthCalledWith(2, "o2@example.test", "sheetPaused", "B", "b-1");
  });
});
```

Add `DELETE` cases to `src/app/api/me/route.test.ts` (mock `@/server/queries/account` and `@/server/account/delete-account`; `next/server`'s `after` mocked to run the callback at once):
- `401` without a session;
- `403` without a same-origin `Origin`;
- `400` for `{confirm: "yes"}`;
- `409` when the database says `tn:owns_workspaces`, and `removeAuthUser` is **not** called;
- on success: `removeAuthUser(u1)` is called, then the session's `auth.signOut({ scope: "local" })`, then `afterAccountDeleted` with the parsed result; the response is `{ok: true}`;
- when `removeAuthUser` returns false: `500 internal`, and the session is **not** signed out (the person can try again).

`src/emails/owner-alert-email.test.tsx`: `senderRemoved` renders "Gmail sending for Club stopped" as the subject, the body naming the workspace, and the "Connect Gmail" button to the settings URL. No emoji (the existing emoji guard test covers every kind once `senderRemoved` is in its list).

- [ ] **Step 6: Run them to verify they fail**

Run: `bun run test src/shared/api/account.test.ts src/server/account src/app/api/me src/emails/owner-alert-email.test.tsx`
Expected: FAIL. The modules are missing, `DELETE` is not exported, and `senderRemoved` is unknown.

- [ ] **Step 7: Write the code**

`src/shared/api/account.ts`:
```ts
import { z } from "zod";

/** The word Delete my account asks for (spec §7.4; owner, 2026-10-14). */
export const ACCOUNT_DELETE_WORD = "confirm";

/** `DELETE /api/me`. Twin: `private.delete_account`'s check. */
export const deleteAccountBodySchema = z.object({ confirm: z.literal(ACCOUNT_DELETE_WORD) });
```

`src/server/queries/account.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { type ReleasedConnection, releasedSchema } from "@/server/google/release";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

/** An Owner to email after an account deletion paused something of their workspace. */
export type OwnerAlert = {
  kind: "sender" | "sheet";
  email: string;
  workspaceName: string;
  workspaceSlug: string;
};

/** What the database part of an account deletion hands to the route. */
export type AccountDeletion = { released: ReleasedConnection[]; alerts: OwnerAlert[] };

const dbSchema = z.object({
  released: z.array(releasedSchema),
  alerts: z.array(
    z.object({
      kind: z.enum(["sender", "sheet"]),
      email: z.string(),
      workspace_name: z.string(),
      workspace_slug: z.string(),
    }),
  ),
});

/** `delete_account()`: refuses, or erases and releases (spec §11). */
export async function deleteAccountData(
  client: Client,
  confirm: string,
): Promise<{ data: AccountDeletion | null; error: DbError | null }> {
  const { data, error } = await client.rpc("delete_account", { p_confirm: confirm });
  if (error) {
    return { data: null, error };
  }
  const db = dbSchema.parse(data);
  return {
    data: {
      released: db.released.filter((row): row is ReleasedConnection => row !== null),
      alerts: db.alerts.map((alert) => ({
        kind: alert.kind,
        email: alert.email,
        workspaceName: alert.workspace_name,
        workspaceSlug: alert.workspace_slug,
      })),
    },
    error: null,
  };
}
```

`src/server/account/delete-account.ts`:
```ts
import "server-only";
import { publicEnv } from "@/config/public-env";
import { renderOwnerAlertEmail } from "@/emails/owner-alert-email";
import { logger } from "@/lib/logger";
import { createSystemMailer } from "@/server/email/system-mailer";
import { type ReleasedConnection, revokeReleased } from "@/server/google/release";
import type { AccountDeletion } from "@/server/queries/account";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/** What runs after the deletion commits (injected so tests use fakes). */
export type AfterDeletionDeps = {
  revoke: (released: ReadonlyArray<ReleasedConnection>) => Promise<void>;
  send: (
    to: string,
    kind: "senderRemoved" | "sheetPaused",
    workspaceName: string,
    workspaceSlug: string,
  ) => Promise<void>;
};

function realDeps(): AfterDeletionDeps {
  const mailer = createSystemMailer();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  return {
    revoke: revokeReleased,
    send: async (to, kind, workspaceName, workspaceSlug) => {
      const content =
        kind === "senderRemoved"
          ? await renderOwnerAlertEmail({
              kind,
              workspaceName,
              settingsUrl: `${appUrl}/w/${workspaceSlug}/settings#sending`,
            })
          : await renderOwnerAlertEmail({
              kind,
              reason: "access_lost",
              workspaceName,
              settingsUrl: `${appUrl}/w/${workspaceSlug}/settings#sheets`,
            });
      await mailer.send({ to, ...content });
    },
  };
}

/**
 * Best-effort work after an account deletion commits (spec §11): revoke the released Google
 * tokens, and tell each affected Owner. Never throws; logs counts only.
 */
export async function afterAccountDeleted(
  result: AccountDeletion,
  deps: AfterDeletionDeps = realDeps(),
): Promise<void> {
  await deps.revoke(result.released);
  let failed = 0;
  for (const alert of result.alerts) {
    try {
      await deps.send(
        alert.email,
        alert.kind === "sender" ? "senderRemoved" : "sheetPaused",
        alert.workspaceName,
        alert.workspaceSlug,
      );
    } catch {
      failed += 1;
    }
  }
  logger.info({ revoked: result.released.length, alerts: result.alerts.length, failed }, "account deleted");
}

/** Deletes the auth user (admin API; cascades to the profile and push subscriptions). */
export async function removeAuthUser(userId: string): Promise<boolean> {
  const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(userId);
  if (error) {
    logger.error({ status: error.status }, "auth user deletion failed");
  }
  return !error;
}
```

`src/app/api/me/route.ts`: add the imports (`after` from `next/server`, `deleteAccountBodySchema`, `deleteAccountData`, `afterAccountDeleted`, `removeAuthUser`), `export const maxDuration = 60;`, and:
```ts
/**
 * Delete my account (spec §7.4, §11): the database erases and releases in one transaction, then
 * the auth user is deleted and the session ends. Revoking and Owner emails run after the response.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, deleteAccountBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await deleteAccountData(supabase, body.data.confirm);
  if (error || !data) {
    return error ? fromDatabaseError(error) : apiError("internal");
  }
  if (!(await removeAuthUser(user.id))) {
    return apiError("internal");
  }
  await supabase.auth.signOut({ scope: "local" });
  after(() => afterAccountDeleted(data));
  return ok();
}
```
Check `ClaimsClient` / the server client type: `supabase.auth.signOut` exists on the real client. The route test's mocked client needs `auth: { signOut: vi.fn() }`.

`src/emails/owner-alert-email.tsx`: add the union member `| { kind: "senderRemoved"; workspaceName: string; settingsUrl: string }` and a branch in `alertCopy` reading `Email.senderRemoved.*`. Update the JSDoc: "its Gmail needs reconnecting, its sending stopped because the account was removed, or its Google Sheet stopped updating". Messages:
```json
"senderRemoved": {
  "subject": "Gmail sending for {workspace} stopped",
  "preview": "Meeting emails for {workspace} are paused until a Gmail account is connected.",
  "heading": "Connect Gmail for {workspace}",
  "body": "The person whose Gmail account sent {workspace}'s meeting emails deleted their {appName} account. Queued emails are paused and nothing is lost. Connect a Gmail account to send again.",
  "button": "Connect Gmail",
  "fallback": "If the button doesn't work, copy this link:"
}
```
`ApiErrors.owns_workspaces`: "You own a workspace. Give it to an Admin or delete it first." Add `owns_workspaces` to `API_ERROR_CODES` and `API_ERROR_STATUS` (409).

`src/server/supabase/admin-client.ts` JSDoc: add "account deletion (`removeAuthUser`)" to the allowed callers. Spec §11 lists the service-role callers; add the same words there in this PR.

- [ ] **Step 8: Run everything, commit, PR, merge, hosted push**

```bash
bunx prettier --write src/shared/api/account.ts src/shared/api/account.test.ts src/server/queries/account.ts src/server/account src/app/api/me src/emails/owner-alert-email.tsx src/emails/owner-alert-email.test.tsx src/shared/api/errors.ts src/server/supabase/admin-client.ts src/server/db/m8-account-deletion.db.test.ts src/server/db/function-security.db.test.ts messages/en.json docs/superpowers/specs/2026-10-04-tapnshow-design.md && bun run format:check && bun run lint && bun run typecheck && bun run test && supabase db reset --local </dev/null && bun run db:types && bun run test:db && supabase db advisors --local </dev/null
git checkout -b feat/<issue>-m8-account-deletion
git add supabase/migrations src messages docs
git commit -m "feat: delete my account (erase words, release Google, tell Owners)"
```
PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:db`, `area:auth`, `area:api`. Then `merge-when-green.sh`, confirm `MERGED`, and **run `bash .superpowers/scripts/hosted-push.sh`**.

---

### Task 5: `/account`: name, Download my answers, the delete flow, the copy button, the avatar menu

**Labels:** `type:task`, `area:frontend`, `area:api`.

**Files:**
- Create:
  - `src/lib/api/fetch-all-pages.ts` (+ test), `src/lib/device/clear.ts` (+ test);
  - `src/app/api/me/account/route.ts` (+ test), `src/app/api/me/answers/route.ts` (+ test);
  - `src/hooks/use-account.ts` (+ test);
  - `src/app/account/page.tsx`, `account-view.tsx` (+ test), `delete-account-card.tsx` (+ test), `use-download-my-answers.ts` (+ test);
  - `src/components/forms/display-name-form.tsx` (+ test).
- Modify:
  - `src/shared/api/account.ts` (summary schema), `src/shared/api/my-invites.ts` (`myAnswerSchema`, `myAnswersPageSchema`), `src/server/queries/account.ts` (`getMyAccount`), `src/server/queries/my-invites.ts` (`getMyAnswers`);
  - `src/hooks/use-results.ts` (uses `fetchAllPages`), `src/lib/export/columns.ts`, `src/lib/export/rows.ts` (+ test);
  - `src/components/forms/confirm-name-dialog.tsx` (+ test), `src/app/w/[slug]/settings/danger-zone.tsx` (+ test), `src/components/forms/export-menu.tsx` (`label`), `src/components/shell/user-menu.tsx` (+ test);
  - `src/app/login/*` ("Your account was deleted." notice), `messages/en.json` (`Account`, `Export.columns.group`, `Export.myAnswers`, `Common.copy*`).
- Delete: `src/components/shell/profile-dialog.tsx`, `profile-dialog.test.tsx`.

**Interfaces:**
- Consumes:
  - Task 1's `my_account`, `my_answers`;
  - Task 3's `MemberShell`, `clearDeviceValues`;
  - Task 4's `DELETE /api/me`, `ACCOUNT_DELETE_WORD`.
- Produces:
  - `fetchAllPages<T>(path, params, schema): Promise<T[]>`.
  - `clearDeviceData(): Promise<void>`: in this task it clears `tn.*` storage and deletes every Cache Storage entry whose name starts with `tn-`. Task 8 adds the reminders unsubscribe.
  - `accountSummarySchema` (`{owned: {name, slug}[], workspaces, answersWithText}`) and `useAccount()`.
  - `myAnswerSchema`, `myAnswersPageSchema`; `GET /api/me/account`; `GET /api/me/answers?cursor=&limit=`.
  - `MEMBER_ANSWER_COLUMNS`, `memberAnswerRows(rows, labels, text): ExportCell[][]`.
  - `ConfirmNameDialog` gains `inputLabel?: string` and always shows the word with a copy button.
  - `DisplayNameForm({ initialName, onSaved? })`.
  - `ExportMenu` gains `label?: string`.

- [ ] **Step 1: Write the failing tests for the shared pieces**

`src/lib/api/fetch-all-pages.test.ts`: with `fetch` stubbed (`src/test/fetch.ts`) to return two pages (`nextCursor: "c1"`, then `null`), `fetchAllPages("/api/x", { a: "1" }, schema)`:
- requests `/api/x?a=1&limit=100`, then `/api/x?a=1&limit=100&cursor=c1`;
- returns both pages' items in order.

`src/lib/device/clear.test.ts`: with `window.caches` stubbed (`keys` → `["tn-pages", "tn-invites", "other"]`, `delete` spy) and a `tn.` key in storage:
- `clearDeviceData()` deletes `tn-pages` and `tn-invites` only;
- it clears `tn.*`;
- without `window.caches` it still clears storage and doesn't throw.

`src/lib/export/rows.test.ts`, a new case for `memberAnswerRows`:
```ts
it("member rows: group, meeting, date, answer, words, check-in (spec §7.4)", () => {
  const rows = memberAnswerRows(
    [
      {
        inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
        workspaceName: "GDG ISSAT",
        title: "Kickoff",
        startsAt: "2026-10-11T17:00:00.000Z",
        timezone: "Africa/Tunis",
        responseMode: "attendance",
        status: "scheduled",
        answer: {
          status: "late",
          delayMinutes: 10,
          reason: "Bus",
          comment: "",
          afterDeadline: true,
          updatedAt: "2026-10-10T08:30:00.000Z",
        },
        mark: { actual: "late", lateMinutes: 15 },
      },
    ],
    labels,
    text,
  );
  expect(rows).toEqual([
    [
      "GDG ISSAT",
      "Kickoff",
      "2026-10-11 18:00",
      { text: "Late by 10 min", tone: "warning" },
      10,
      "Bus",
      "",
      "2026-10-10 09:30",
      "Yes",
      { text: "Late", tone: "warning" },
      15,
    ],
  ]);
});
```
(`labels` and `text` are the fixtures the file's other cases already use. Match their exact words.)

`src/components/forms/confirm-name-dialog.test.tsx`, new cases:
- the dialog shows the word in a chip with a button named "Copy confirm";
- clicking it writes `confirm` to `navigator.clipboard` (stub) and toasts "Copied";
- `inputLabel` replaces the default label;
- Delete stays disabled until the typed text equals the word exactly.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test src/lib/api src/lib/device src/lib/export src/components/forms/confirm-name-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the shared pieces**

`src/lib/api/fetch-all-pages.ts` (moved verbatim from `use-results.ts`'s private `fetchAll`, now exported):
```ts
import type { z } from "zod";
import { PAGE_SIZE_MAX } from "@/config/pagination";
import { apiRequest } from "@/lib/api-client";
import type { Page } from "@/shared/api/pagination";

/** Every row of a paged endpoint, following `nextCursor` (exports and downloads only). */
export async function fetchAllPages<T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      ...params,
      limit: String(PAGE_SIZE_MAX),
      ...(cursor ? { cursor } : {}),
    });
    const page: Page<T> = await apiRequest(`${path}?${query.toString()}`, { schema });
    rows.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}
```
In `src/hooks/use-results.ts`, delete `fetchAll` and import `fetchAllPages`. Then grep: `grep -n "fetchAll\b\|fetchAll(" src -r` shows no private copy left.

`src/lib/device/clear.ts`:
```ts
import { clearDeviceValues } from "./storage";

/** Prefix of every Cache Storage name TapNShow's service worker uses (Task 8 `src/app/sw.ts`). */
export const CACHE_PREFIX = "tn-";

/**
 * Removes what TapNShow saved on this device (spec §11 Push privacy): saved pages and invites,
 * and preferences. Called before signing out and after deleting the account, so a shared phone
 * never shows the previous person's invites. Never throws.
 */
export async function clearDeviceData(): Promise<void> {
  clearDeviceValues();
  try {
    if (typeof window !== "undefined" && "caches" in window) {
      const names = await window.caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => window.caches.delete(name)),
      );
    }
  } catch {
    // Storage the browser refuses to open has nothing of ours in it.
  }
}
```

`src/lib/export/columns.ts`:
```ts
/** Download my answers (`memberAnswerRows`, spec §7.4): one row per invite of the signed-in person. */
export const MEMBER_ANSWER_COLUMNS: ReadonlyArray<ExportColumn> = [
  { key: "group", width: 24 },
  { key: "meeting", width: 30 },
  { key: "date", width: 18 },
  { key: "answer", width: 18 },
  { key: "lateBy", width: 12 },
  { key: "reason", width: 40 },
  { key: "comment", width: 40 },
  { key: "answeredAt", width: 18 },
  { key: "afterDeadline", width: 16 },
  { key: "checkedIn", width: 14 },
  { key: "wasLateBy", width: 14 },
];
```

`src/lib/export/rows.ts` (it reuses the file's private `at`, `describeAnswer`, `ANSWER_TONE`, `ACTUAL_TONE`):
```ts
/** Download my answers (`MEMBER_ANSWER_COLUMNS`): the person's own invites, newest first. */
export function memberAnswerRows(
  rows: MyAnswer[],
  labels: AnswerLabels,
  text: ExportText,
): ExportCell[][] {
  return rows.map((row) => [
    row.workspaceName,
    row.title,
    at(row.startsAt, row.timezone),
    row.answer
      ? { text: describeAnswer(labels, row.answer), tone: ANSWER_TONE[row.answer.status] }
      : row.responseMode === "announcement"
        ? ""
        : { text: text.noReply, tone: ANSWER_TONE.no_reply },
    row.answer?.delayMinutes ?? null,
    row.answer?.reason ?? "",
    row.answer?.comment ?? "",
    row.answer ? at(row.answer.updatedAt, row.timezone) : "",
    row.answer?.afterDeadline ? text.yes : "",
    row.mark ? { text: text.actual(row.mark.actual), tone: ACTUAL_TONE[row.mark.actual] } : "",
    row.mark?.lateMinutes ?? null,
  ]);
}
```

`src/shared/api/my-invites.ts` gains:
```ts
/** One row of Download my answers. Twin: `private.my_answers`. */
export const myAnswerSchema = z.object({
  inviteeId: z.uuid(),
  workspaceName: z.string(),
  title: z.string(),
  startsAt: z.string(),
  timezone: z.string(),
  responseMode: responseModeSchema,
  status: meetingStatusSchema,
  answer: z
    .object({
      status: answerStatusSchema,
      delayMinutes: z.number().int().nullable(),
      reason: z.string(),
      comment: z.string(),
      afterDeadline: z.boolean(),
      updatedAt: z.string(),
    })
    .nullable(),
  mark: myInviteSchema.shape.mark,
});
/** One row of Download my answers. */
export type MyAnswer = z.infer<typeof myAnswerSchema>;
/** `GET /api/me/answers`. */
export const myAnswersPageSchema = pageSchema(myAnswerSchema);
```

`ConfirmNameDialog`: add `inputLabel?: string`. Above the `Input`, add a row with the word in a mono chip (`font-mono font-bold rounded-lg border-2 border-outline bg-background px-2`) and a 44 px icon `Button` (`Copy` Phosphor Bold, `aria-label={tCommon("copyWord", { word: name })}`). Clicking it runs `navigator.clipboard.writeText(name)`, then `toast(tCommon("copied"))`; if that throws, `toast(tCommon("copyFailed"))`. The `Input`'s label becomes `inputLabel ?? t("typeName", { workspace: name })`. The JSDoc becomes "Destructive confirmation by typing a word (the workspace name, or 'confirm' for an account; spec §7.11, §7.4). Case-sensitive, trimmed; the word has a copy button (owner, 2026-10-14)." `danger-zone.tsx` needs no change. Its test gains "the workspace name has a copy button".

`messages/en.json` `Common`: `"copyWord": "Copy {word}"`, `"copied": "Copied"`, `"copyFailed": "Couldn't copy. Type it instead."`.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun run test src/lib/api src/lib/device src/lib/export src/components/forms src/hooks/use-results`
Expected: PASS (the meeting and attendance export tests prove the `fetchAllPages` move kept their behaviour).

- [ ] **Step 5: The two routes (tests first)**

Write `src/app/api/me/account/route.test.ts` and `src/app/api/me/answers/route.test.ts` in the style of Task 2's tests:
- 401 without a session;
- the query called with the user's client;
- the answers route passes `limit` and the decoded cursor, refuses a foreign cursor (400), and maps `tn:rate_limited` to 429.

Run them and see them fail. Then write:
- `getMyAccount(client)` in `src/server/queries/account.ts`: parses `{owned, workspaces, answers_with_text}` into `AccountSummary`;
- `getMyAnswers(client, limit, after)` in `src/server/queries/my-invites.ts`: parses like `getMyInvites`, with the cursor from the last row `[starts_at, invitee_id]`;
- `accountSummarySchema` in `src/shared/api/account.ts`;
- the routes:

`src/app/api/me/account/route.ts`:
```ts
import { NextResponse } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { requireUser } from "@/server/http/require-user";
import { getMyAccount } from "@/server/queries/account";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** What `/account` and its delete dialog need (spec §7.4): owned workspaces and counts. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const { data, error } = await getMyAccount(supabase);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
```
`src/app/api/me/answers/route.ts`: `readPageParams(request, myInvitesCursorSchema)`, then `requireUser`, then `getMyAnswers`, then the JSON response. Add `cache-control: no-store`: it holds the person's reasons.

`src/hooks/use-account.ts`: `ACCOUNT_QUERY_KEY = ["account"]`, `useAccount()` (`useQuery`, `accountSummarySchema`).

- [ ] **Step 6: The page (tests first)**

`src/components/forms/display-name-form.test.tsx`: it saves through `PATCH /api/me`, invalidates `me`, toasts "Name saved", and shows the invalid-name message for an empty name. (These are the old `ProfileDialog` cases, moved.)

`src/app/account/delete-account-card.test.tsx`:
- with owned workspaces, it lists each with "Transfer ownership" and "Delete workspace" links to `/w/<slug>/settings#danger`, and the Delete button is disabled;
- with none, Delete opens the dialog. The body names the counts ("Your reasons and comments on 14 answers are erased, and you leave 2 workspaces.");
- typing `confirm` enables "Delete my account", which calls `clearDeviceData` **after** a successful `DELETE /api/me`, then clears the query cache and calls `replaceWith("/login?deleted=1")`;
- a 409 shows the `owns_workspaces` text in the dialog.

`src/app/account/account-view.test.tsx`:
- it shows the four cards in order (Your name, Reminders — rendered only once Task 8 adds it, so assert the other three now — Your answers, Delete my account);
- "Download my answers" opens CSV / Excel.

`src/app/account/use-download-my-answers.test.ts`: with `fetchAllPages` and `saveExport` mocked, it saves one sheet named "My answers" with `MEMBER_ANSWER_COLUMNS` headers, the rows from `memberAnswerRows`, and file parts `["my-answers"]`.

`src/components/shell/user-menu.test.tsx`:
- the items are My invites, Account (`/account`) and Sign out; "Your name" is gone;
- Sign out calls `clearDeviceData` before `POST /api/auth/signout`.

Run them and see them fail. Then write:
- `src/components/forms/display-name-form.tsx`: the former `ProfileForm` body, exported, with a Save button and no Cancel (it lives on a page). Delete `profile-dialog.tsx` and its test, and remove the "Your name" item and `ProfileDialog` from `user-menu.tsx`. Add `<DropdownMenuItem asChild><Link href="/account"><UserCircle weight="bold" aria-hidden />{t("account")}</Link></DropdownMenuItem>` after My invites. `signOut.mutationFn` becomes `async () => { await clearDeviceData(); return apiRequest("/api/auth/signout", …) }`.
- `src/app/account/page.tsx`: `<MemberShell><AccountView /></MemberShell>`.
- `src/app/account/account-view.tsx`: `<h1>Account</h1>`, then:
  - a `Card` "Your name" with `DisplayNameForm` and "Signed in as {email}. Invites sent to this address show up in My invites.";
  - a `Card` "Your answers" with the description and `<ExportMenu label={t("download")} onExport={download} />`;
  - `<DeleteAccountCard />`.
- `src/app/account/use-download-my-answers.ts`:
```ts
"use client";

import type { ExportFormat } from "@/components/forms/export-menu";
import { useExportWords } from "@/hooks/use-answer-labels";
import { fetchAllPages } from "@/lib/api/fetch-all-pages";
import { MEMBER_ANSWER_COLUMNS } from "@/lib/export/columns";
import { memberAnswerRows } from "@/lib/export/rows";
import { saveExport } from "@/lib/export/save";
import { formatDeadline } from "@/lib/meetings/format";
import { myAnswersPageSchema } from "@/shared/api/my-invites";

/** Download my answers (spec §7.4): every invite of the signed-in person, CSV or Excel. */
export function useDownloadMyAnswers(email: string) {
  const words = useExportWords();
  const { t } = words;
  return async (format: ExportFormat): Promise<void> => {
    const rows = await fetchAllPages("/api/me/answers", {}, myAnswersPageSchema);
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sheet = t("myAnswers");
    await saveExport(
      format,
      [
        {
          name: sheet,
          title: t("title", { what: t("myAnswers"), sheet: email }),
          subtitle: t("exported", { context: email, at: formatDeadline(now.toISOString(), zone) }),
          columns: MEMBER_ANSWER_COLUMNS.map((column) => ({
            header: words.column(column.key),
            width: column.width,
            tone: column.tone,
          })),
          rows: memberAnswerRows(rows, words.labels, words.text),
        },
      ],
      ["my-answers"],
      now,
    );
  };
}
```
- `src/app/account/delete-account-card.tsx`: uses `useAccount()`, `ConfirmNameDialog` (`name={ACCOUNT_DELETE_WORD}`, `inputLabel={t("delete.typeWord", { word: ACCOUNT_DELETE_WORD })}`), and a `useMutation` that calls `DELETE /api/me` with `{confirm}`. `onSuccess`: `await clearDeviceData(); queryClient.clear(); replaceWith("/login?deleted=1")`. `onError`: the dialog's `error` is the `ApiErrors` text for `errorCodeOf(error)`.
- The login page reads `deleted=1` (it already reads `next`; use the same `useSearchParams` pattern) and shows a `Card` above the form: "Your account was deleted."
- `ExportMenu` gets `label?: string` (default `t("button")`) for its trigger.

`messages/en.json`:
```json
"Account": {
  "title": "Account",
  "name": "Your name",
  "signedInAs": "Signed in as {email}. Invites sent to this address show up in My invites.",
  "answersTitle": "Your answers",
  "answersBody": "Every meeting you were invited to, what you answered, and any check-in organizers recorded.",
  "download": "Download my answers",
  "downloadHint": "CSV or Excel, like the organizers' export.",
  "delete": {
    "title": "Delete my account",
    "body": "Erases your reasons and comments. Groups keep whether you came, without your account.",
    "button": "Delete my account",
    "owned": "You own these workspaces. Give each one to an Admin, or delete it, first:",
    "transfer": "Transfer ownership",
    "deleteWorkspace": "Delete workspace",
    "dialogTitle": "Delete your account?",
    "dialogBody": "Your reasons and comments on {answers, plural, one {# answer} other {# answers}} are erased, and you leave {workspaces, plural, =0 {no workspace} one {# workspace} other {# workspaces}}. Groups keep whether you came. This can't be undone.",
    "typeWord": "Type {word} to delete",
    "deleted": "Your account was deleted."
  }
},
```
Plus `Shell.account`: "Account"; `Export.myAnswers`: "My answers"; `Export.columns.group`: "Group".

- [ ] **Step 7: Prove the removals, run everything, screenshots**

```bash
grep -rn "ProfileDialog\|profile-dialog" src && exit 1 || true
grep -rn "async function fetchAll\b" src && exit 1 || true
bunx prettier --write src/lib/api src/lib/device src/lib/export src/app/api/me src/hooks src/app/account src/components src/app/login src/shared src/server/queries messages/en.json && bun run format:check && bun run lint && bun run typecheck && bun run test && TZ=UTC bun run test:e2e
```
Screenshots (`.superpowers/scripts/screens/m8-account.spec.ts`), at 390 light, 320 dark and 1024:
- `/account` for a member;
- `/account` for an Owner (the delete card listing workspaces);
- the delete dialog with the copy button;
- the workspace delete dialog with its new copy button;
- the avatar menu;
- `/login?deleted=1`.

Look at them, send them, and ask "Looks right?".

- [ ] **Step 8: Commit, PR, merge**

```bash
git checkout -b feat/<issue>-m8-account
git add src messages
git commit -m "feat(ui): account page, download my answers, delete my account"
```
PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:frontend`, `area:api`. Then `merge-when-green.sh`, and confirm `MERGED`.

---

### Task 6: DB: push tables, subscribe and unsubscribe, enqueue in `dispatch_finish`, claim and results

**Labels:** `type:task`, `area:db`, `area:pipeline`.

**Files:**
- Create: `supabase/migrations/<ts>_m8_push.sql`, `src/server/db/m8-push.db.test.ts`, `src/test/db/push.ts`
- Modify: `src/server/db/function-security.db.test.ts`, `src/server/db/database.types.ts` (regenerated), `src/test/db/outbox.ts` (`parkAllJobs` also clears push deliveries, so a claim test never sees another file's rows)

**Interfaces:**
- Consumes: Task 1's matching comparison (twin comment), M6's `private.reminder_eligible`, M7's newest `dispatch_finish`, `workers_due`, `housekeeping`.
- Produces:
  - `public.push_kind` enum `invite | update | cancel | reminder`.
  - Tables `public.push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, last_success_at)` and `public.push_deliveries (id, subscription_id, invitee_id, kind, audience, job_id, run_after, attempts, locked_until, run_id, created_at)`.
  - `public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void` and `public.push_unsubscribe(p_endpoint text) returns void` (authenticated).
  - `public.push_claim(p_run uuid, p_limit integer, p_lease_seconds integer) returns jsonb` → `{dropped: int, items: [{id, kind, audience, attempts, invitee_id, endpoint, p256dh, auth, workspace_name, locale, title, starts_at, timezone, duration_minutes, location_mode, location_text, online_text, response_mode, answered, needs_reconfirmation}]}`.
  - `public.push_done(p_delivery uuid, p_run uuid) returns boolean`, `public.push_retry(p_delivery uuid, p_run uuid, p_after_seconds integer) returns boolean` (false = given up or lease lost), `public.push_drop(p_delivery uuid, p_run uuid) returns void`, `public.push_gone(p_delivery uuid, p_run uuid) returns void`. All `service_role` only.
  - `workers_due()` is also true for due deliveries.

- [ ] **Step 1: Seed helpers**

`src/test/db/push.ts`:
```ts
import { adminClient } from "./clients";
import { runLocalSql } from "./sql";

/** A subscription as the browser would send it (base64url keys of the right lengths). */
export function fakeSubscription(n = crypto.randomUUID()) {
  return {
    endpoint: `https://push.example.test/send/${n}`,
    p256dh: `B${"A".repeat(86)}`,
    auth: "A".repeat(22),
  };
}

/** An outbox job leased by a run, as `dispatch_claim` would leave it (service role). */
export async function processingJob(
  workspaceId: string,
  meetingId: string,
  inviteeId: string,
  kind: "invite" | "calendar_confirm" | "update" | "cancel" | "reminder",
  payload: Record<string, string | number | boolean> = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .insert({
      kind,
      workspace_id: workspaceId,
      meeting_id: meetingId,
      invitee_id: inviteeId,
      payload,
      idempotency_key: `test:${kind}:${crypto.randomUUID()}`,
      status: "processing",
      locked_until: new Date(Date.now() + 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/** Deletes every push delivery: `push_claim` is global, like the other claims. */
export function parkAllPushes(): void {
  runLocalSql("delete from public.push_deliveries");
}
```
Check `outbox_jobs`' column list in the newest migration (`grep -n "create table public.outbox_jobs" -A25 supabase/migrations/*.sql`) and fill exactly the required columns. If `meeting_id` is not a column (the meeting may live in `payload`), follow the table.

- [ ] **Step 2: Write the failing DB tests**

`src/server/db/m8-push.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { hoursFromNow, seedAnswer, seedContact, seedInviteFor } from "@/test/db/members";
import { overrideLimit, parkAllJobs, serviceRpc } from "@/test/db/outbox";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import { fakeSubscription, parkAllPushes, processingJob } from "@/test/db/push";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const claimSchema = z.object({
  dropped: z.number().int(),
  items: z.array(
    z.object({ id: z.uuid(), kind: z.string(), audience: z.string().nullable(), invitee_id: z.uuid(), endpoint: z.string(), attempts: z.number() }),
  ),
});

async function subscribe(user: TestUser, sub = fakeSubscription()) {
  const { error } = await user.client.rpc("push_subscribe", {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
  } as never);
  if (error) {
    throw error;
  }
  return sub;
}

async function deliveriesFor(inviteeId: string) {
  const { data } = await adminClient()
    .from("push_deliveries")
    .select("id, kind, audience, subscription_id")
    .eq("invitee_id", inviteeId);
  return data ?? [];
}

async function finish(jobId: string, outcome: "sent" | "skipped" | "failed" | "unknown") {
  await serviceRpc("dispatch_finish", {
    p_job: jobId,
    p_outcome: outcome,
    p_error: null,
    p_token_hash: outcome === "sent" ? crypto.randomUUID().replaceAll("-", "").repeat(2) : null,
  });
}

beforeEach(() => {
  parkAllJobs();
  parkAllPushes();
});

describe("push subscriptions (spec §6, §11 Push privacy)", () => {
  it("moves an endpoint to whoever subscribes it last, dropping the old owner's pending pushes", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const organizer = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    const sub = await subscribe(a);
    const invite = await seedInviteFor(club.id, await seedContact(club.id, a.email), { starts_at: hoursFromNow(24) });
    await finish(await processingJob(club.id, invite.meetingId, invite.inviteeId, "invite"), "sent");
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(1);

    await subscribe(b, sub);

    const { data } = await adminClient().from("push_subscriptions").select("user_id").eq("endpoint", sub.endpoint).single();
    expect(data?.user_id).toBe(b.id);
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(0);
  });

  it("keeps at most push_devices_per_user_max per person, oldest out", async () => {
    const user = await createTestUser();
    const restore = overrideLimit("push_devices_per_user_max", 2);
    try {
      const first = await subscribe(user);
      await subscribe(user);
      await subscribe(user);
      const { data } = await adminClient().from("push_subscriptions").select("endpoint").eq("user_id", user.id);
      expect(data?.map((row) => row.endpoint)).not.toContain(first.endpoint);
      expect(data).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it("refuses a non-https endpoint, removes only the caller's own endpoint, and is rate limited", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    const bad = await user.client.rpc("push_subscribe", {
      p_endpoint: "http://push.example.test/x",
      p_p256dh: fakeSubscription().p256dh,
      p_auth: fakeSubscription().auth,
    } as never);
    expect(bad.error?.code).toBe("23514");
    const sub = await subscribe(user);
    await other.client.rpc("push_unsubscribe", { p_endpoint: sub.endpoint } as never);
    expect((await adminClient().from("push_subscriptions").select("id").eq("endpoint", sub.endpoint)).data).toHaveLength(1);
    await user.client.rpc("push_unsubscribe", { p_endpoint: sub.endpoint } as never);
    expect((await adminClient().from("push_subscriptions").select("id").eq("endpoint", sub.endpoint)).data).toHaveLength(0);
    const restore = overrideLimit("push_subscribes_per_user_per_hour", 0);
    try {
      await expectAppError(
        user.client.rpc("push_subscribe", { p_endpoint: fakeSubscription().endpoint, p_p256dh: fakeSubscription().p256dh, p_auth: fakeSubscription().auth } as never),
        "rate_limited",
      );
    } finally {
      restore();
    }
  });

  it("gives signed-in people no direct access to either table", async () => {
    const user = await createTestUser();
    await subscribe(user);
    expect((await user.client.from("push_subscriptions").select("id")).error).not.toBeNull();
    expect((await user.client.from("push_deliveries").select("id")).error).not.toBeNull();
  });
});

describe("enqueue in dispatch_finish (spec §8: no email, no push)", () => {
  it("adds one delivery per device for a sent invite, update, cancel or reminder, and none for anything else", async () => {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    await subscribe(member);
    await subscribe(member);
    const contact = await seedContact(club.id, member.email);
    const invite = await seedInviteFor(club.id, contact, { starts_at: hoursFromNow(24) });
    const job = (kind: Parameters<typeof processingJob>[3], payload = {}) =>
      processingJob(club.id, invite.meetingId, invite.inviteeId, kind, payload);

    await finish(await job("invite"), "sent");
    await finish(await job("reminder", { audience: "going" }), "sent");
    await finish(await job("calendar_confirm", { action: "request", sequence: 0 }), "sent");
    await finish(await job("update"), "skipped");
    await finish(await job("cancel"), "unknown");
    await finish(await job("update"), "failed");

    const rows = await deliveriesFor(invite.inviteeId);
    expect(rows.map((row) => `${row.kind}:${row.audience ?? ""}`).sort()).toEqual([
      "invite:",
      "invite:",
      "reminder:going",
      "reminder:going",
    ]);
  });

  it("enqueues nothing for an unsubscribed person, nor twice for one job", async () => {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    await subscribe(member);
    const contact = await seedContact(club.id, member.email);
    const invite = await seedInviteFor(club.id, contact, { starts_at: hoursFromNow(24) });
    const jobId = await processingJob(club.id, invite.meetingId, invite.inviteeId, "invite");
    await finish(jobId, "sent");
    await finish(jobId, "sent");
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(1);

    await adminClient().from("contacts").update({ unsubscribed_at: new Date().toISOString(), unsubscribed_via: "link" }).eq("id", contact);
    await finish(await processingJob(club.id, invite.meetingId, invite.inviteeId, "cancel"), "sent");
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(1);
  });
});

describe("push_claim and results (spec §8 Push worker)", () => {
  async function queued(options: { meeting?: Parameters<typeof seedInviteFor>[2]; kind?: Parameters<typeof processingJob>[3]; payload?: Record<string, string> } = {}) {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    await subscribe(member);
    const invite = await seedInviteFor(club.id, await seedContact(club.id, member.email), {
      starts_at: hoursFromNow(24),
      ...options.meeting,
    });
    await finish(
      await processingJob(club.id, invite.meetingId, invite.inviteeId, options.kind ?? "invite", options.payload ?? {}),
      "sent",
    );
    return { club, invite, member };
  }
  const claim = async (run = crypto.randomUUID(), limit = 50) =>
    ({ run, ...claimSchema.parse(await serviceRpc("push_claim", { p_run: run, p_limit: limit, p_lease_seconds: 120 })) });

  it("drops what went stale: cancelled, started, or a pending reminder already answered; keeps cancellations", async () => {
    const cancelled = await queued();
    await adminClient().from("meetings").update({ status: "cancelled" }).eq("id", cancelled.invite.meetingId);
    const cancelNotice = await queued({ kind: "cancel" });
    await adminClient().from("meetings").update({ status: "cancelled" }).eq("id", cancelNotice.invite.meetingId);
    const answered = await queued({ kind: "reminder", payload: { audience: "pending" } });
    await seedAnswer(answered.club.id, answered.invite.meetingId, answered.invite.inviteeId, { status: "attending" });
    const started = await queued();
    await adminClient().from("meetings").update({ starts_at: hoursFromNow(-1) }).eq("id", started.invite.meetingId);
    const fresh = await queued();

    const result = await claim();
    expect(result.dropped).toBe(3);
    expect(result.items.map((item) => item.invitee_id).sort()).toEqual(
      [cancelNotice.invite.inviteeId, fresh.invite.inviteeId].sort(),
    );
  });

  it("never gives one delivery to two concurrent runs", async () => {
    for (let n = 0; n < 6; n += 1) {
      await queued();
    }
    const [one, two] = await Promise.all([claim(undefined, 4), claim(undefined, 4)]);
    const ids = [...one.items, ...two.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it("done deletes and stamps the device; retry backs off and gives up; gone removes the device", async () => {
    const a = await queued();
    const b = await queued();
    const c = await queued();
    const { run, items } = await claim();
    const byInvitee = (inviteeId: string) => items.find((item) => item.invitee_id === inviteeId)?.id ?? "";

    expect(await serviceRpc("push_done", { p_delivery: byInvitee(a.invite.inviteeId), p_run: run })).toBe(true);
    const stamped = await adminClient().from("push_subscriptions").select("last_success_at").eq("user_id", a.member.id).single();
    expect(stamped.data?.last_success_at).not.toBeNull();

    expect(await serviceRpc("push_retry", { p_delivery: byInvitee(b.invite.inviteeId), p_run: crypto.randomUUID(), p_after_seconds: 60 })).toBe(false);
    expect(await serviceRpc("push_retry", { p_delivery: byInvitee(b.invite.inviteeId), p_run: run, p_after_seconds: 60 })).toBe(true);
    const [row] = queryLocalSql(
      `select run_after > now() + interval '50 seconds' as later, locked_until is null as free from public.push_deliveries where id = '${byInvitee(b.invite.inviteeId)}'`,
      z.array(z.object({ later: z.boolean(), free: z.boolean() })).length(1),
    );
    expect(row).toEqual({ later: true, free: true });

    await serviceRpc("push_gone", { p_delivery: byInvitee(c.invite.inviteeId), p_run: run });
    expect((await adminClient().from("push_subscriptions").select("id").eq("user_id", c.member.id)).data).toEqual([]);
  });

  it("gives up after push_attempts_max", async () => {
    const restore = overrideLimit("push_attempts_max", 1);
    try {
      const a = await queued();
      const { run, items } = await claim();
      expect(await serviceRpc("push_retry", { p_delivery: items[0].id, p_run: run, p_after_seconds: 1 })).toBe(false);
      expect(await deliveriesFor(a.invite.inviteeId)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("wakes the dispatcher only while a delivery is due", async () => {
    parkAllJobs();
    runLocalSql("update public.sheet_syncs set retry_at = now() + interval '1 day'");
    await queued();
    parkAllJobs();
    const due = () =>
      queryLocalSql("select private.workers_due() as due", z.array(z.object({ due: z.boolean() })).length(1))[0].due;
    expect(due()).toBe(true);
    const { run, items } = await claim();
    for (const item of items) {
      await serviceRpc("push_done", { p_delivery: item.id, p_run: run });
    }
    expect(due()).toBe(false);
  });

  it("housekeeping removes idle devices and old deliveries", async () => {
    const a = await queued();
    runLocalSql(`update public.push_subscriptions set created_at = now() - interval '91 days', last_success_at = null where user_id = '${a.member.id}'`);
    runLocalSql("update public.push_deliveries set created_at = now() - interval '2 days'");
    runLocalSql("select private.housekeeping()");
    expect((await adminClient().from("push_subscriptions").select("id").eq("user_id", a.member.id)).data).toEqual([]);
    expect((await adminClient().from("push_deliveries").select("id")).data).toEqual([]);
  });

  it("claims through the run_after index", async () => {
    await queued();
    const planUser = await createTestUser();
    const claimPlan = explainCall(
      `public.push_claim('${crypto.randomUUID()}', 10, 60)`,
      planUser.id,
      "service_role",
      ["enable_seqscan = off"],
    );
    expect(planUsesIndex(claimPlan, "push_deliveries_run_after_idx")).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `supabase db reset --local </dev/null && bun run test:db src/server/db/m8-push.db.test.ts`
Expected: FAIL. `push_subscribe` does not exist.

- [ ] **Step 4: Check the auth email index**

```bash
psql postgresql://postgres:postgres@127.0.0.1:44322/postgres -c "select indexname, indexdef from pg_indexes where schemaname = 'auth' and tablename = 'users'"
```
Expected: `users_email_partial_key` (unique on `email` where `is_sso_user = false`). `push_enqueue` adds `u.is_sso_user = false` so the planner can use it. If the local index differs, write the predicate that matches it and record a ruling.

- [ ] **Step 5: Write the migration**

`supabase/migrations/<ts>_m8_push.sql`:
```sql
-- M8 phone notifications (spec §6 push_subscriptions / push_deliveries, §8 Push worker, §11).
-- Latest bodies: dispatch_finish from 20261011124719_m7_minors_edits.sql, workers_due from
-- 20261011183115_m7_followups.sql, housekeeping from 20261011094523_m7_sheet_worker.sql.

insert into private.app_limits (name, value) values
  ('push_devices_per_user_max', 10),
  ('push_attempts_max', 5),
  ('push_retry_max_minutes', 30),
  ('push_subscription_idle_days', 90);

create type public.push_kind as enum ('invite', 'update', 'cancel', 'reminder');

-- One row per browser. Key shapes twin pushSubscriptionBodySchema (src/shared/api/push.ts):
-- p256dh is a 65-byte P-256 point and auth 16 bytes, base64url.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{21,24}={0,2}$'),
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at);

-- The push queue: only pending work (rows go when sent or given up).
create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  invitee_id uuid not null references public.meeting_invitees (id) on delete cascade,
  kind public.push_kind not null,
  audience text check (audience in ('pending', 'going') and kind = 'reminder' or audience is null and kind <> 'reminder'),
  job_id uuid not null,
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz,
  run_id uuid,
  created_at timestamptz not null default now(),
  unique (job_id, subscription_id)
);
create index push_deliveries_run_after_idx on public.push_deliveries (run_after);
create index push_deliveries_subscription_idx on public.push_deliveries (subscription_id);
create index push_deliveries_invitee_idx on public.push_deliveries (invitee_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on table public.push_subscriptions, public.push_deliveries from anon, authenticated;
grant all on table public.push_subscriptions, public.push_deliveries to service_role;

-- Turn on reminders for this browser (spec §7.4). An endpoint already held by another account
-- moves to the caller (a shared phone), and that account's pending pushes for it go.
create function private.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('push_subscribe') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  delete from public.push_deliveries d using public.push_subscriptions s
  where d.subscription_id = s.id and s.endpoint = p_endpoint and s.user_id <> v_user;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth)
  values (v_user, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
  set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    created_at = case when s.user_id = excluded.user_id then s.created_at else pg_catalog.now() end,
    last_success_at = case when s.user_id = excluded.user_id then s.last_success_at end;
  delete from public.push_subscriptions s
  where s.id in (
    select x.id from public.push_subscriptions x
    where x.user_id = v_user
    order by x.created_at desc, x.id desc
    offset private.app_limit('push_devices_per_user_max'));
end;
$$;

-- Turn off reminders for this browser: only the caller's own row.
create function private.push_unsubscribe(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid()
$$;

-- A sent email's notifications: one row per device of the person the invite matches. The contact
-- → account direction of the matching rule; twin: private.contacts_of (account → contacts).
-- Unsubscribed people get none (cancellations still email some of them, spec §7.16 / #254).
create function private.push_enqueue(p_job uuid, p_invitee uuid, p_kind public.job_kind, p_audience text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_deliveries (subscription_id, invitee_id, kind, audience, job_id)
  select s.id, p_invitee, p_kind::text::public.push_kind,
    case when p_kind = 'reminder' then coalesce(p_audience, 'pending') end, p_job
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id and c.workspace_id = i.workspace_id
  join auth.users u on u.email = c.email and u.is_sso_user = false and u.email_confirmed_at is not null
  join public.push_subscriptions s on s.user_id = u.id
  where i.id = p_invitee and c.unsubscribed_at is null
  on conflict (job_id, subscription_id) do nothing
$$;
```
Then **copy `public.dispatch_finish` verbatim from `20261011124719_m7_minors_edits.sql`** as `create or replace function public.dispatch_finish(...)`, and insert these lines right after `if v_invitee is null then return; end if;`:
```sql
  -- An email that went out brings its phone notifications (spec §8 Push worker: no email, no push).
  if p_outcome = 'sent' and v_kind <> 'calendar_confirm' then
    perform private.push_enqueue(p_job, v_invitee, v_kind, v_payload ->> 'audience');
  end if;
```
Continue the migration:
```sql
-- Lease due deliveries for one run (spec §8). Stale ones are deleted first, in SQL: the meeting was
-- cancelled or has started (a cancellation still goes), or a "please answer" reminder whose person
-- has answered since (the reminders' own rule, private.reminder_eligible).
create function private.push_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_dropped integer;
begin
  with stale as (
    delete from public.push_deliveries d
    using public.meeting_invitees i
    join public.meetings m on m.id = i.meeting_id
    left join public.responses r on r.invitee_id = i.id
    where d.invitee_id = i.id
      and d.run_after <= v_now and (d.locked_until is null or d.locked_until < v_now)
      and d.kind <> 'cancel'
      and (m.status <> 'scheduled' or m.starts_at <= v_now
        or (d.kind = 'reminder' and not private.reminder_eligible(d.audience, r.status, r.needs_reconfirmation)))
    returning 1
  )
  select count(*) into v_dropped from stale;
  return (
    with picked as (
      select d.id from public.push_deliveries d
      where d.run_after <= v_now and (d.locked_until is null or d.locked_until < v_now)
      order by d.run_after
      limit p_limit
      for update skip locked
    ), leased as (
      update public.push_deliveries d
      set locked_until = v_now + pg_catalog.make_interval(secs => p_lease_seconds), run_id = p_run,
        attempts = d.attempts + 1
      from picked where d.id = picked.id
      returning d.id, d.kind, d.audience, d.attempts, d.invitee_id, d.subscription_id
    )
    select pg_catalog.jsonb_build_object('dropped', v_dropped, 'items', coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', l.id, 'kind', l.kind, 'audience', l.audience, 'attempts', l.attempts, 'invitee_id', l.invitee_id,
        'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
        'workspace_name', w.name, 'locale', w.locale,
        'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone,
        'duration_minutes', m.duration_minutes, 'location_mode', m.location_mode,
        'location_text', m.location_text, 'online_text', m.online_text, 'response_mode', m.response_mode,
        'answered', r.id is not null, 'needs_reconfirmation', coalesce(r.needs_reconfirmation, false))),
      '[]'::jsonb))
    from leased l
    join public.push_subscriptions s on s.id = l.subscription_id
    join public.meeting_invitees i on i.id = l.invitee_id
    join public.meetings m on m.id = i.meeting_id
    join public.workspaces w on w.id = m.workspace_id
    left join public.responses r on r.invitee_id = i.id
  );
end;
$$;

-- Sent: the row goes and the device is marked as reachable.
create function private.push_done(p_delivery uuid, p_run uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription uuid;
begin
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
  returning d.subscription_id into v_subscription;
  if v_subscription is null then
    return false;
  end if;
  update public.push_subscriptions set last_success_at = pg_catalog.now() where id = v_subscription;
  return true;
end;
$$;

-- Try again later (capped at push_retry_max_minutes), or give up after push_attempts_max. False
-- when given up or when this run no longer holds the lease.
create function private.push_retry(p_delivery uuid, p_run uuid, p_after_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select d.attempts into v_attempts from public.push_deliveries d
  where d.id = p_delivery and d.run_id = p_run for update;
  if v_attempts is null then
    return false;
  end if;
  if v_attempts >= private.app_limit('push_attempts_max') then
    delete from public.push_deliveries where id = p_delivery;
    return false;
  end if;
  update public.push_deliveries
  set run_after = pg_catalog.now() + pg_catalog.make_interval(secs =>
        least(greatest(p_after_seconds, 1), private.app_limit('push_retry_max_minutes') * 60)),
    locked_until = null, run_id = null
  where id = p_delivery;
  return true;
end;
$$;

-- A delivery that can never succeed (a bug on our side, 400/413): dropped.
create function private.push_drop(p_delivery uuid, p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
$$;

-- The push service says the device is gone (404/410): the subscription goes, with its deliveries.
create function private.push_gone(p_delivery uuid, p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
  using public.push_deliveries d
  where d.id = p_delivery and d.run_id = p_run and s.id = d.subscription_id
$$;
```
Then **copy `private.workers_due` verbatim** and add a third branch:
```sql
    or exists (
      select 1 from public.push_deliveries d
      where d.run_after <= pg_catalog.now() and (d.locked_until is null or d.locked_until < pg_catalog.now()))
```
**Copy `private.housekeeping` verbatim** and add before `end;`:
```sql
  -- Devices that never or no longer receive notifications, and pushes nobody will send any more.
  delete from public.push_subscriptions s
  where coalesce(s.last_success_at, s.created_at)
    < pg_catalog.now() - pg_catalog.make_interval(days => private.app_limit('push_subscription_idle_days'));
  delete from public.push_deliveries d where d.created_at < pg_catalog.now() - interval '1 day';
```
Wrappers and grants:
```sql
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security invoker set search_path = ''
as $$ select private.push_subscribe(p_endpoint, p_p256dh, p_auth) $$;
create function public.push_unsubscribe(p_endpoint text)
returns void language sql security invoker set search_path = ''
as $$ select private.push_unsubscribe(p_endpoint) $$;
create function public.push_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.push_claim(p_run, p_limit, p_lease_seconds) $$;
create function public.push_done(p_delivery uuid, p_run uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select private.push_done(p_delivery, p_run) $$;
create function public.push_retry(p_delivery uuid, p_run uuid, p_after_seconds integer)
returns boolean language sql security invoker set search_path = ''
as $$ select private.push_retry(p_delivery, p_run, p_after_seconds) $$;
create function public.push_drop(p_delivery uuid, p_run uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.push_drop(p_delivery, p_run) $$;
create function public.push_gone(p_delivery uuid, p_run uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.push_gone(p_delivery, p_run) $$;

revoke execute on function private.push_enqueue(uuid, uuid, public.job_kind, text) from public, anon, authenticated;
-- dispatch_finish (invoker) runs as the service role and calls it.
grant execute on function private.push_enqueue(uuid, uuid, public.job_kind, text) to service_role;

grant execute on function private.push_subscribe(text, text, text), private.push_unsubscribe(text) to authenticated;
revoke execute on function private.push_subscribe(text, text, text), private.push_unsubscribe(text) from public, anon;
revoke execute on function public.push_subscribe(text, text, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text), public.push_unsubscribe(text) to authenticated;

revoke execute on function
  private.push_claim(uuid, integer, integer), private.push_done(uuid, uuid),
  private.push_retry(uuid, uuid, integer), private.push_drop(uuid, uuid), private.push_gone(uuid, uuid),
  public.push_claim(uuid, integer, integer), public.push_done(uuid, uuid),
  public.push_retry(uuid, uuid, integer), public.push_drop(uuid, uuid), public.push_gone(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  private.push_claim(uuid, integer, integer), private.push_done(uuid, uuid),
  private.push_retry(uuid, uuid, integer), private.push_drop(uuid, uuid), private.push_gone(uuid, uuid),
  public.push_claim(uuid, integer, integer), public.push_done(uuid, uuid),
  public.push_retry(uuid, uuid, integer), public.push_drop(uuid, uuid), public.push_gone(uuid, uuid)
to service_role;
```
In `src/test/db/outbox.ts`, `parkAllJobs` also runs `delete from public.push_deliveries` (its JSDoc names why: claims are global).

- [ ] **Step 6: Allow-list, types, run, mutation check**

Add `push_subscribe` and `push_unsubscribe` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`. Then:
```bash
supabase db reset --local </dev/null && bun run db:types && bun run test:db && supabase db advisors --local </dev/null
```
Expected:
- every DB test passes, including the M4–M7 dispatcher tests (`outbox.db.test.ts`, `calendar-dispatch.db.test.ts`, `m6-dispatch.db.test.ts`, `run-dispatch.db.test.ts`), which prove `dispatch_finish` kept its behaviour;
- the advisors report only the auth WARN. An advisor about an unindexed foreign key on `push_deliveries` would mean an index is missing: add it.

Mutation check: comment out the `if p_outcome = 'sent' …` block, reset, and see "adds one delivery per device…" fail. Restore it and reset.

- [ ] **Step 7: Commit, PR, merge, hosted push**

```bash
bunx prettier --write src/test/db/push.ts src/test/db/outbox.ts src/server/db/m8-push.db.test.ts src/server/db/function-security.db.test.ts && bun run format:check && bun run lint && bun run typecheck && bun run test
git checkout -b feat/<issue>-m8-push-db
git add supabase/migrations src/server/db src/test/db
git commit -m "feat(db): push queue filled with each sent email; claim, results, wake-up"
```
PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:db`, `area:pipeline`. Then `merge-when-green.sh`, confirm `MERGED`, and **run `bash .superpowers/scripts/hosted-push.sh`**.

---

### Task 7: The push lane: `web-push`, VAPID env, message builder, result classifier, `runPush`, subscription routes

**Labels:** `type:task`, `area:pipeline`, `area:api`, `area:config`.

**Files:**
- Create:
  - `src/config/push.ts` (+ test);
  - `src/lib/push/message.ts` (+ test);
  - `src/server/push/classify.ts` (+ test), `src/server/push/send.ts` (+ test), `src/server/push/run-push.ts` (+ test), `src/server/push/push-deps.ts`;
  - `src/server/queries/push.ts`;
  - `src/shared/api/push.ts` (+ test);
  - `src/app/api/me/push-subscriptions/route.ts` (+ test).
- Modify:
  - `src/config/env.ts`, `src/config/public-env.ts`, `src/config/secrets.ts` (+ tests);
  - `src/server/workers/schedule-workers.ts` (+ test);
  - `src/shared/api/errors.ts` + `messages/en.json` (`reminders_unavailable`, `Notifications`);
  - `package.json`/`bun.lock` (`web-push`, `@types/web-push`);
  - `.env.example` if the repo has one (`grep -l VAPID .env.example` after editing), `docs/superpowers/specs/2026-10-04-tapnshow-design.md` §11 Secrets (names only).

**Interfaces:**
- Consumes: Task 6's push functions and `push_kind`.
- Produces:
  - `PUSH_BUDGET_MS = 50_000`, `PUSH_REQUEST_TIMEOUT_MS = 10_000`, `PUSH_MIN_LEFT_MS = 12_000`, `PUSH_CONCURRENCY = 10`, `PUSH_LEASE_SECONDS = 120`, `PUSH_IDLE_POLL_MS = 2_000`, `PUSH_CANCEL_TTL_SECONDS = 86_400`, `PUSH_TTL_MIN_SECONDS = 60`, `PUSH_TTL_MAX_SECONDS = 2_419_200`, `PUSH_TEXT_MAX = 240`, `PUSH_BACKOFF_MAX_SECONDS = 1_800` (twin of `push_retry_max_minutes`).
  - `pushConfigured(env: ServerEnv, pub: PublicEnv): boolean`.
  - `pushItemSchema` / `PushItem` from `src/shared/api/push.ts` (the claim row, DB-shaped in, camelCase out).
  - `PushStore` (`claim`, `done`, `retry`, `drop`, `gone`) from `src/server/queries/push.ts`, plus `subscribePush(client, body)` and `unsubscribePush(client, endpoint)`.
  - `pushWords(locale)`, `pushMessage(item, words): PushMessage` with `PushMessage = { title: string; body: string; url: string; tag: string }`, and `pushTtlSeconds(item, nowMs)`, `pushUrgency(item)` (`src/lib/push/message.ts`).
  - `classifyPushResult(result: PushSendResult, attempts: number): PushOutcome`.
  - `createPushSender(...)` → `PushSend`; `pushTopic(tag): string` (32 base64url characters).
  - `runPush(deps, options, emails?: { running: () => boolean }): Promise<PushSummary>`.
  - `pushSubscriptionBodySchema`, `pushUnsubscribeBodySchema`.
  - `POST` / `DELETE /api/me/push-subscriptions`.

- [ ] **Step 1: Add the dependencies**

```bash
bun add web-push@3.6.7 && bun add -d @types/web-push@3.6.4
```
Read `node_modules/web-push/src/index.js` and `node_modules/@types/web-push/index.d.ts` for the exact `sendNotification(subscription, payload, options)` options (`TTL`, `urgency`, `topic`, `vapidDetails`, `timeout`) and the `WebPushError` fields (`statusCode`, `headers`, `body`). The code below assumes those names. If one differs, follow the library and record a ruling.

- [ ] **Step 2: Write the failing pure tests**

`src/config/push.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PUSH_BUDGET_MS, PUSH_LEASE_SECONDS, PUSH_MIN_LEFT_MS, PUSH_REQUEST_TIMEOUT_MS } from "./push";

describe("push tuning (spec §8)", () => {
  it("stays inside the internal route's 60 s, and a lease outlives any run", () => {
    expect(PUSH_BUDGET_MS).toBeLessThanOrEqual(50_000);
    expect(PUSH_MIN_LEFT_MS).toBeGreaterThan(PUSH_REQUEST_TIMEOUT_MS);
    expect(PUSH_LEASE_SECONDS * 1000).toBeGreaterThanOrEqual(2 * 60_000);
  });
});
```

`src/lib/push/message.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { PushItem } from "@/shared/api/push";
import { pushMessage, pushTtlSeconds, pushUrgency, pushWords } from "./message";

const item: PushItem = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "invite",
  audience: null,
  attempts: 1,
  inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
  endpoint: "https://push.example.test/x",
  p256dh: "k",
  auth: "a",
  workspaceName: "GDG ISSAT",
  locale: "en",
  title: "Weekly sync",
  startsAt: "2026-10-18T17:00:00.000Z",
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  locationMode: "in_person",
  locationText: "Room B12",
  onlineText: "",
  responseMode: "attendance",
  answered: false,
  needsReconfirmation: false,
};
const words = pushWords("en");

describe("pushMessage (spec §7.4)", () => {
  it("titles with the workspace and meeting, opens the invite, and tags by event", () => {
    expect(pushMessage(item, words)).toEqual({
      title: "GDG ISSAT · Weekly sync",
      body: "New invite: Sun 18 Oct, 18:00. Are you coming?",
      url: "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
      tag: "invite:6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    });
  });

  it("says each event in one line", () => {
    const body = (patch: Partial<PushItem>) => pushMessage({ ...item, ...patch }, words).body;
    expect(body({ responseMode: "announcement" })).toBe("New meeting: Sun 18 Oct, 18:00.");
    expect(body({ kind: "update", answered: true, needsReconfirmation: true })).toBe(
      "The time changed to Sun 18 Oct, 18:00. Still going?",
    );
    expect(body({ kind: "update" })).toBe("Details changed: Sun 18 Oct, 18:00, Room B12.");
    expect(body({ kind: "cancel" })).toBe("This meeting was cancelled.");
    expect(body({ kind: "reminder", audience: "pending" })).toBe("Please answer: Sun 18 Oct, 18:00.");
    expect(body({ kind: "reminder", audience: "going" })).toBe("Starts at 18:00, Room B12.");
    expect(body({ kind: "reminder", audience: "going", locationMode: "online", locationText: "", onlineText: "Club Discord" })).toBe(
      "Starts at 18:00, Club Discord.",
    );
  });

  it("never carries a personal link, an answer or a reason, and stays short", () => {
    const long = pushMessage({ ...item, title: "x".repeat(500) }, words);
    expect(long.title.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(long)).not.toMatch(/\/r\//);
  });

  it("lives until the start (a minute at least); cancellations a day; starts-soon is urgent", () => {
    const now = Date.parse("2026-10-18T16:00:00.000Z");
    expect(pushTtlSeconds(item, now)).toBe(3600);
    expect(pushTtlSeconds({ ...item, startsAt: "2026-10-18T16:00:30.000Z" }, now)).toBe(60);
    expect(pushTtlSeconds({ ...item, kind: "cancel" }, now)).toBe(86_400);
    expect(pushUrgency({ ...item, kind: "reminder", audience: "going" })).toBe("high");
    expect(pushUrgency(item)).toBe("normal");
  });
});
```
(The dates use the meeting's zone: 17:00 UTC is 18:00 in Tunis, and the 18th of October 2026 is a Sunday. Fix the fixture's day name if `formatDeadline` says otherwise. The fixture must match the real formatter.)

`src/server/push/classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classifyPushResult } from "./classify";

describe("classifyPushResult (spec §8)", () => {
  it("2xx sent; 404/410 gone", () => {
    expect(classifyPushResult({ status: 201, retryAfter: null }, 1)).toEqual({ kind: "sent" });
    expect(classifyPushResult({ status: 410, retryAfter: null }, 1)).toEqual({ kind: "gone" });
    expect(classifyPushResult({ status: 404, retryAfter: null }, 1)).toEqual({ kind: "gone" });
  });

  it("429, 5xx and no answer retry, honouring Retry-After, else doubling from a minute up to 30", () => {
    expect(classifyPushResult({ status: 429, retryAfter: "120" }, 1)).toEqual({ kind: "retry", afterSeconds: 120 });
    expect(classifyPushResult({ status: 503, retryAfter: null }, 1)).toEqual({ kind: "retry", afterSeconds: 60 });
    expect(classifyPushResult({ status: null }, 3)).toEqual({ kind: "retry", afterSeconds: 240 });
    expect(classifyPushResult({ status: 500, retryAfter: null }, 10)).toEqual({ kind: "retry", afterSeconds: 1800 });
    const date = new Date(Date.now() + 90_000).toUTCString();
    const fromDate = classifyPushResult({ status: 429, retryAfter: date }, 1);
    expect(fromDate.kind === "retry" && fromDate.afterSeconds).toBeGreaterThanOrEqual(85);
  });

  it("any other answer is a bug on our side: dropped and reported", () => {
    for (const status of [400, 401, 403, 413]) {
      expect(classifyPushResult({ status, retryAfter: null }, 1)).toEqual({ kind: "drop", report: true });
    }
  });
});
```

`src/shared/api/push.test.ts`: the body accepts a Chrome-shaped subscription (`https://fcm.googleapis.com/fcm/send/abc`, an 87-character p256dh, a 22-character auth). It refuses `http://`, an endpoint over 2,048 characters, and keys of the wrong length.

- [ ] **Step 3: Run them to verify they fail**

Run: `bun run test src/config/push.test.ts src/lib/push src/server/push src/shared/api/push.test.ts`
Expected: FAIL (no modules).

- [ ] **Step 4: Write the pure pieces**

`src/config/push.ts`:
```ts
/** Phone notification tuning (spec §8 Push worker). */

/** One push run's time, inside the internal route's 60 s `maxDuration` (like the other workers). */
export const PUSH_BUDGET_MS = 50_000;
/** A push service request gives up after this long (then it is retried). */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000;
/** A batch starts only with this much budget left, so a run never passes `maxDuration`. */
export const PUSH_MIN_LEFT_MS = PUSH_REQUEST_TIMEOUT_MS + 2_000;
/** Deliveries sent side by side, and claimed per batch (`push_claim`'s `p_limit`). */
export const PUSH_CONCURRENCY = 10;
/** Lease length: twice the route's `maxDuration`, so a run is dead before its lease can be taken. */
export const PUSH_LEASE_SECONDS = 120;
/** While the email worker still runs, an empty claim waits this long and looks again. */
export const PUSH_IDLE_POLL_MS = 2_000;
/** How long a push service keeps a cancellation for an offline phone. */
export const PUSH_CANCEL_TTL_SECONDS = 86_400;
/** Shortest TTL we send (a meeting about to start). */
export const PUSH_TTL_MIN_SECONDS = 60;
/** Longest TTL push services accept (FCM: 4 weeks). */
export const PUSH_TTL_MAX_SECONDS = 2_419_200;
/** Longest title or body; the payload stays far under the 4 KB push limit. */
export const PUSH_TEXT_MAX = 240;
/** Longest back-off. Twin: `private.app_limits.push_retry_max_minutes` (30). */
export const PUSH_BACKOFF_MAX_SECONDS = 1_800;
```

`src/server/queries/push.ts` (store and route calls). Write `itemSchema` below into `src/shared/api/push.ts` as the exported `pushItemSchema`, with `export type PushItem = z.output<typeof pushItemSchema>;`. This file then imports both, and keeps no copy:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { locationModeSchema, responseModeSchema } from "@/shared/api/meeting-settings";
import type { PushSubscriptionBody } from "@/shared/api/push";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;

const itemSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["invite", "update", "cancel", "reminder"]),
    audience: z.enum(["pending", "going"]).nullable(),
    attempts: z.number().int(),
    invitee_id: z.uuid(),
    endpoint: z.string(),
    p256dh: z.string(),
    auth: z.string(),
    workspace_name: z.string(),
    locale: z.string(),
    title: z.string(),
    starts_at: z.string(),
    timezone: z.string(),
    duration_minutes: z.number().int(),
    location_mode: locationModeSchema,
    location_text: z.string(),
    online_text: z.string(),
    response_mode: responseModeSchema,
    answered: z.boolean(),
    needs_reconfirmation: z.boolean(),
  })
  .transform((db) => ({
    id: db.id,
    kind: db.kind,
    audience: db.audience,
    attempts: db.attempts,
    inviteeId: db.invitee_id,
    endpoint: db.endpoint,
    p256dh: db.p256dh,
    auth: db.auth,
    workspaceName: db.workspace_name,
    locale: db.locale,
    title: db.title,
    startsAt: db.starts_at,
    timezone: db.timezone,
    durationMinutes: db.duration_minutes,
    locationMode: db.location_mode,
    locationText: db.location_text,
    onlineText: db.online_text,
    responseMode: db.response_mode,
    answered: db.answered,
    needsReconfirmation: db.needs_reconfirmation,
  }));

/** One leased delivery with what its notification says. Twin: `private.push_claim`. */
export type PushItem = z.output<typeof itemSchema>;

/** What the push lane needs from the database (injected, so tests use fakes). */
export type PushStore = {
  claim(run: string, limit: number, leaseSeconds: number): Promise<{ dropped: number; items: PushItem[] }>;
  done(id: string, run: string): Promise<boolean>;
  retry(id: string, run: string, afterSeconds: number): Promise<boolean>;
  drop(id: string, run: string): Promise<void>;
  gone(id: string, run: string): Promise<void>;
};

/** The push store over the service-role client. Database errors throw (the run logs and stops). */
export function createPushStore(admin: Client): PushStore {
  const check = <T>(name: string, result: { data: T; error: DbError | null }): T => {
    if (result.error) {
      throw new Error(`${name} failed: ${result.error.code ?? ""}`);
    }
    return result.data;
  };
  return {
    claim: async (run, limit, leaseSeconds) =>
      z
        .object({ dropped: z.number().int(), items: z.array(itemSchema) })
        .parse(check("push_claim", await admin.rpc("push_claim", { p_run: run, p_limit: limit, p_lease_seconds: leaseSeconds }))),
    done: async (id, run) => z.boolean().parse(check("push_done", await admin.rpc("push_done", { p_delivery: id, p_run: run }))),
    retry: async (id, run, afterSeconds) =>
      z.boolean().parse(
        check("push_retry", await admin.rpc("push_retry", { p_delivery: id, p_run: run, p_after_seconds: afterSeconds })),
      ),
    drop: async (id, run) => {
      check("push_drop", await admin.rpc("push_drop", { p_delivery: id, p_run: run }));
    },
    gone: async (id, run) => {
      check("push_gone", await admin.rpc("push_gone", { p_delivery: id, p_run: run }));
    },
  };
}

/** `push_subscribe()` for the signed-in person (spec §7.4). */
export async function subscribePush(client: Client, body: PushSubscriptionBody): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("push_subscribe", {
    p_endpoint: body.endpoint,
    p_p256dh: body.keys.p256dh,
    p_auth: body.keys.auth,
  });
  return { error };
}

/** `push_unsubscribe()`: removes only the caller's own endpoint. */
export async function unsubscribePush(client: Client, endpoint: string): Promise<{ error: DbError | null }> {
  const { error } = await client.rpc("push_unsubscribe", { p_endpoint: endpoint });
  return { error };
}
```

`src/lib/push/message.ts`:
```ts
import { createTranslator } from "next-intl";
import type { Locale } from "@/config/i18n";
import {
  PUSH_CANCEL_TTL_SECONDS,
  PUSH_TEXT_MAX,
  PUSH_TTL_MAX_SECONDS,
  PUSH_TTL_MIN_SECONDS,
} from "@/config/push";
import { formatDeadline, formatTime } from "@/lib/meetings/format";
import type { PushItem } from "@/shared/api/push";
import messages from "../../../messages/en.json";

/** What a notification shows and opens (the service worker displays exactly this). */
export type PushMessage = { title: string; body: string; url: string; tag: string };

/** The `Notifications` translator of one locale. */
export type PushWords = ReturnType<typeof createTranslator<typeof messages, "Notifications">>;

/** The notification words of a workspace's locale (built once per locale per run). */
export function pushWords(locale: Locale): PushWords {
  return createTranslator({ locale, messages, namespace: "Notifications" });
}

const clip = (text: string) => (text.length > PUSH_TEXT_MAX ? `${text.slice(0, PUSH_TEXT_MAX - 1)}…` : text);

function placeOf(item: PushItem): string {
  return item.locationMode === "online" ? item.onlineText : item.locationText;
}

/**
 * The one builder of a notification (spec §7.4): "<Workspace> · <Meeting>" and one line per
 * event. Never an answer, a reason, another person or a personal link; it opens `/invites/<id>`.
 */
export function pushMessage(item: PushItem, t: PushWords): PushMessage {
  const when = formatDeadline(item.startsAt, item.timezone);
  const place = placeOf(item) || "none";
  const body = (() => {
    switch (item.kind) {
      case "invite":
        return item.responseMode === "announcement" ? t("inviteAnnouncement", { when }) : t("invite", { when });
      case "update":
        return item.answered && item.needsReconfirmation ? t("timeChanged", { when }) : t("changed", { when, place });
      case "cancel":
        return t("cancelled");
      case "reminder":
        return item.audience === "going"
          ? t("startsSoon", { time: formatTime(item.startsAt, item.timezone), place })
          : t("pleaseAnswer", { when });
    }
  })();
  return {
    title: clip(`${item.workspaceName} · ${item.title}`),
    body: clip(body),
    url: `/invites/${item.inviteeId}`,
    tag: `${item.kind}:${item.inviteeId}`,
  };
}

/** How long a push service keeps it for an offline phone: until the start, a day for a cancellation. */
export function pushTtlSeconds(item: PushItem, nowMs: number): number {
  if (item.kind === "cancel") {
    return PUSH_CANCEL_TTL_SECONDS;
  }
  const left = Math.floor((Date.parse(item.startsAt) - nowMs) / 1000);
  return Math.min(PUSH_TTL_MAX_SECONDS, Math.max(PUSH_TTL_MIN_SECONDS, left));
}

/** "Starts soon" reminders wake the phone; everything else waits for a good moment. */
export function pushUrgency(item: PushItem): "high" | "normal" {
  return item.kind === "reminder" && item.audience === "going" ? "high" : "normal";
}
```
`message.ts` stays free of server modules: `PushItem` comes from `src/shared/api/push.ts`.

`messages/en.json`:
```json
"Notifications": {
  "invite": "New invite: {when}. Are you coming?",
  "inviteAnnouncement": "New meeting: {when}.",
  "timeChanged": "The time changed to {when}. Still going?",
  "changed": "Details changed: {when}{place, select, none {} other {, {place}}}.",
  "cancelled": "This meeting was cancelled.",
  "pleaseAnswer": "Please answer: {when}.",
  "startsSoon": "Starts at {time}{place, select, none {} other {, {place}}}.",
  "fallbackTitle": "TapNShow",
  "fallbackBody": "You have an update from TapNShow."
},
```

`src/server/push/classify.ts`:
```ts
import { PUSH_BACKOFF_MAX_SECONDS } from "@/config/push";

/** What a push service answered: an HTTP status (with `Retry-After`), or nothing (network, timeout). */
export type PushSendResult = { status: number; retryAfter: string | null } | { status: null };

/** What to do with a delivery after one attempt (spec §8). */
export type PushOutcome =
  | { kind: "sent" }
  | { kind: "gone" }
  | { kind: "retry"; afterSeconds: number }
  | { kind: "drop"; report: true };

function retryAfterSeconds(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(1, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Sorts a push service's answer (RFC 8030): 2xx sent; 404/410 the device is gone; 429, 5xx or no
 * answer retry (honouring `Retry-After`, else 1, 2, 4… minutes up to 30); anything else (400, 401,
 * 403, 413) is a bug on our side, dropped and reported.
 */
export function classifyPushResult(result: PushSendResult, attempts: number): PushOutcome {
  const { status } = result;
  if (status !== null && status >= 200 && status < 300) {
    return { kind: "sent" };
  }
  if (status === 404 || status === 410) {
    return { kind: "gone" };
  }
  if (status === null || status === 429 || status >= 500) {
    const backoff = Math.min(PUSH_BACKOFF_MAX_SECONDS, 60 * 2 ** Math.max(0, attempts - 1));
    const asked = status === null ? null : retryAfterSeconds(result.retryAfter);
    return { kind: "retry", afterSeconds: Math.min(PUSH_BACKOFF_MAX_SECONDS, asked ?? backoff) };
  }
  return { kind: "drop", report: true };
}
```

`src/shared/api/push.ts` (body schemas + the item schema moved here):
```ts
/** `POST /api/me/push-subscriptions`: the browser's `PushSubscription.toJSON()`. Twin: the checks on `push_subscriptions`. */
export const pushSubscriptionBodySchema = z.object({
  endpoint: z.url().startsWith("https://").max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{21,24}={0,2}$/),
  }),
});
/** A browser subscription. */
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;
/** `DELETE /api/me/push-subscriptions`. */
export const pushUnsubscribeBodySchema = pushSubscriptionBodySchema.pick({ endpoint: true });
```

- [ ] **Step 5: Run them to verify they pass**

Run: `bun run test src/config/push.test.ts src/lib/push src/server/push/classify.test.ts src/shared/api/push.test.ts`
Expected: PASS.

- [ ] **Step 6: Env, the sender and the lane (tests first)**

`src/config/env.ts` adds, with JSDoc (a `superRefine` pair makes them required together, like the Google pair):
```ts
    /** Web Push signing key (VAPID, RFC 8292; spec §11 Secrets). Set with VAPID_SUBJECT. */
    VAPID_PRIVATE_KEY: z.string().min(40).optional(),
    /** Who push services contact about our pushes: mailto: or https: (RFC 8292). */
    VAPID_SUBJECT: z.string().regex(/^(mailto:|https:)/).optional(),
```
`src/config/public-env.ts` adds `NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{86,88}$/).optional()`, read literally like the others. `src/config/secrets.ts` adds `"VAPID_PRIVATE_KEY"` to `SecretName`.

In `src/server/push/push-deps.ts`, add:
```ts
/** Reminders work only when the signing pair and the public key are all set (spec §8; previews and CI without keys skip the lane). */
export function pushConfigured(env: ServerEnv, pub: PublicEnv): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && pub.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}
```

`src/server/push/send.test.ts`: mock `web-push`:
- a 201 → `{status: 201, retryAfter: null}`;
- a thrown `WebPushError` with `statusCode 429` and `headers {"retry-after": "30"}` → `{status: 429, retryAfter: "30"}`;
- a thrown plain `Error` (timeout) → `{status: null}`;
- the options passed carry `TTL`, `urgency`, `topic`, `timeout` and `vapidDetails`;
- `pushTopic("invite:<uuid>")` is 32 characters of `[A-Za-z0-9_-]` and stable.

`src/server/push/run-push.test.ts` (a fake store, a fake `send` and a fake clock):
- sends every claimed item and calls `done`; summary `{sent: n}`;
- a `410` → `gone`; a `429` → `retry(id, run, 30)`; a `400` → `drop` and `reportBug(400)`;
- never sends more than `concurrency` at once (the fake `send` counts in-flight calls);
- stops claiming when less than `minLeftMs` is left (the clock advances 45 s per batch), so no batch starts past the budget;
- with `emails.running()` true and an empty claim, it waits `idlePollMs` and claims again. Once `running()` is false and the claim is empty, it returns;
- a store error stops the run and is rethrown (the lane logs it).

`src/server/workers/schedule-workers.test.ts`, new cases (mock `runDispatch`, `runSheetSync`, `runPush`, the deps factories and `pushConfigured`):
- with push configured, `scheduleWorkers()` starts all three, and the push lane's `running()` turns false once the email run settles;
- `scheduleWorkers(["emails"])` starts emails and push but not sheets;
- without push configured, push never starts;
- a dispatch deps factory that throws doesn't stop the sheet run.

Run them and see them fail. Then write:

`src/server/push/send.ts`:
```ts
import "server-only";
import { createHash } from "node:crypto";
import webpush, { WebPushError } from "web-push";
import type { PushSendResult } from "./classify";

/** What a push needs besides the payload. */
export type PushSendOptions = { ttl: number; urgency: "high" | "normal"; topic: string };
/** Sends one encrypted push to one browser endpoint (RFC 8030/8291/8292). */
export type PushSend = (
  target: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  options: PushSendOptions,
) => Promise<PushSendResult>;

/** The `Topic` header for a notification tag: a resend replaces the pending one (RFC 8030 §5.4; at most 32 URL-safe characters). */
export function pushTopic(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

/** A `web-push` sender with our VAPID keys and request timeout. Never throws. */
export function createPushSender(vapid: { subject: string; publicKey: string; privateKey: string }, timeoutMs: number): PushSend {
  return async (target, payload, options) => {
    try {
      const response = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          TTL: options.ttl,
          urgency: options.urgency,
          topic: options.topic,
          timeout: timeoutMs,
          vapidDetails: vapid,
        },
      );
      return { status: response.statusCode, retryAfter: null };
    } catch (error) {
      if (error instanceof WebPushError) {
        const header = error.headers["retry-after"];
        return { status: error.statusCode, retryAfter: typeof header === "string" ? header : null };
      }
      return { status: null };
    }
  };
}
```

`src/server/push/run-push.ts`:
```ts
import "server-only";
import { resolveLocale } from "@/config/i18n";
import { logger } from "@/lib/logger";
import { pushMessage, pushTtlSeconds, pushUrgency, pushWords, type PushWords } from "@/lib/push/message";
import type { PushStore } from "@/server/queries/push";
import type { PushItem } from "@/shared/api/push";
import { classifyPushResult } from "./classify";
import { type PushSend, pushTopic } from "./send";

/** What the push lane needs from the outside world (injected, so tests use fakes). */
export type PushDeps = {
  store: PushStore;
  send: PushSend;
  reportBug: (status: number) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  newRunId: () => string;
};

/** One run's limits (`WORKER_OPTIONS.push` in production). */
export type PushOptions = {
  budgetMs: number;
  minLeftMs: number;
  concurrency: number;
  leaseSeconds: number;
  idlePollMs: number;
};

/** What a run did (logged as counts only). */
export type PushSummary = { sent: number; gone: number; retried: number; dropped: number; stale: number };

/**
 * Drains due phone notifications (spec §8 Push worker): claims a batch, sends it side by side,
 * and records each result. While the email worker still runs (`emails.running()`), an empty claim
 * waits and looks again, so a push follows its email within seconds.
 */
export async function runPush(
  deps: PushDeps,
  options: PushOptions,
  emails: { running: () => boolean } = { running: () => false },
): Promise<PushSummary> {
  const started = deps.now();
  const run = deps.newRunId();
  const summary: PushSummary = { sent: 0, gone: 0, retried: 0, dropped: 0, stale: 0 };
  const words = new Map<string, PushWords>();
  const wordsFor = (locale: string) => {
    const resolved = resolveLocale(locale);
    const cached = words.get(resolved) ?? pushWords(resolved);
    words.set(resolved, cached);
    return cached;
  };
  const deliver = async (item: PushItem) => {
    const message = pushMessage(item, wordsFor(item.locale));
    const result = await deps.send(
      { endpoint: item.endpoint, p256dh: item.p256dh, auth: item.auth },
      JSON.stringify(message),
      { ttl: pushTtlSeconds(item, deps.now()), urgency: pushUrgency(item), topic: pushTopic(message.tag) },
    );
    const outcome = classifyPushResult(result, item.attempts);
    if (outcome.kind === "sent") {
      await deps.store.done(item.id, run);
      summary.sent += 1;
    } else if (outcome.kind === "gone") {
      await deps.store.gone(item.id, run);
      summary.gone += 1;
    } else if (outcome.kind === "retry") {
      await deps.store.retry(item.id, run, outcome.afterSeconds);
      summary.retried += 1;
    } else {
      deps.reportBug(result.status ?? 0);
      await deps.store.drop(item.id, run);
      summary.dropped += 1;
    }
  };
  while (options.budgetMs - (deps.now() - started) >= options.minLeftMs) {
    const claim = await deps.store.claim(run, options.concurrency, options.leaseSeconds);
    summary.stale += claim.dropped;
    if (claim.items.length === 0) {
      if (!emails.running()) {
        break;
      }
      await deps.sleep(options.idlePollMs);
      continue;
    }
    await Promise.all(claim.items.map(deliver));
  }
  if (summary.sent + summary.gone + summary.retried + summary.dropped + summary.stale > 0) {
    logger.info(summary, "push run");
  }
  return summary;
}
```
(One batch = `concurrency` claims sent with `Promise.all`, so at most `concurrency` requests are in flight, and each batch starts only with `minLeftMs` > the request timeout left.)

`src/server/push/push-deps.ts`:
```ts
import "server-only";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { getServerEnv, type ServerEnv } from "@/config/env";
import { type PublicEnv, publicEnv } from "@/config/public-env";
import { PUSH_REQUEST_TIMEOUT_MS } from "@/config/push";
import { requireSecret } from "@/config/secrets";
import { createPushStore } from "@/server/queries/push";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { PushDeps } from "./run-push";
import { createPushSender } from "./send";

/** Reminders work only when the signing pair and the public key are all set (spec §8). */
export function pushConfigured(env: ServerEnv, pub: PublicEnv): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && pub.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/**
 * Real dependencies for `runPush`.
 * @throws Error naming the missing key when push isn't configured
 */
export function createPushDeps(env: ServerEnv = getServerEnv()): PushDeps {
  const publicKey = publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey || !env.VAPID_SUBJECT) {
    throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_SUBJECT are required for reminders");
  }
  return {
    store: createPushStore(createSupabaseAdminClient()),
    send: createPushSender(
      { subject: env.VAPID_SUBJECT, publicKey, privateKey: requireSecret("VAPID_PRIVATE_KEY", env) },
      PUSH_REQUEST_TIMEOUT_MS,
    ),
    reportBug: (status) => Sentry.captureMessage(`Web Push ${status}`, "error"),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newRunId: () => randomUUID(),
  };
}
```

`src/server/workers/schedule-workers.ts`: add `push` options to `WORKER_OPTIONS` (`budgetMs: PUSH_BUDGET_MS, minLeftMs: PUSH_MIN_LEFT_MS, concurrency: PUSH_CONCURRENCY, leaseSeconds: PUSH_LEASE_SECONDS, idlePollMs: PUSH_IDLE_POLL_MS`). Then rewrite the body:
```ts
/**
 * Starts the named workers after the response is sent (Next `after()`), side by side, each with its
 * own budget; one failing never stops another. "emails" brings the push lane with it when reminders
 * are configured: pushes follow emails (spec §8), so the lane polls while the email run lasts.
 * Failures are logged, never thrown into the request.
 */
export function scheduleWorkers(which: ReadonlyArray<Worker> = ["emails", "sheets"]): void {
  after(async () => {
    const runs: Promise<unknown>[] = [];
    if (which.includes("emails")) {
      let emailsRunning = true;
      runs.push(
        Promise.resolve()
          .then(() => runDispatch(createDispatchDeps(), WORKER_OPTIONS.emails))
          .finally(() => {
            emailsRunning = false;
          }),
      );
      if (pushConfigured(getServerEnv(), publicEnv)) {
        runs.push(
          Promise.resolve().then(() =>
            runPush(createPushDeps(), WORKER_OPTIONS.push, { running: () => emailsRunning }),
          ),
        );
      }
    }
    if (which.includes("sheets")) {
      runs.push(Promise.resolve().then(() => runSheetSync(createSheetsDeps(), WORKER_OPTIONS.sheets)));
    }
    for (const result of await Promise.allSettled(runs)) {
      if (result.status === "rejected") {
        logger.error({ err: result.reason }, "worker run failed");
      }
    }
  });
}
```
`src/config/sheets.test.ts` pins that both workers stay inside `maxDuration`. Add the push budget to that test (`PUSH_BUDGET_MS + PUSH_REQUEST_TIMEOUT_MS < 60_000`).

- [ ] **Step 7: The subscription routes (tests first)**

`src/app/api/me/push-subscriptions/route.test.ts`:
- `POST` → `subscribePush(client, body)`, `{ok: true}`;
- `DELETE` → `unsubscribePush(client, endpoint)`;
- 403 without a same-origin Origin; 401 without a session; 400 for a bad body; 429 from `tn:rate_limited`;
- 503 `reminders_unavailable` when push isn't configured (mock `pushConfigured`).

Run it and see it fail. Then write:
```ts
import { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { pushConfigured } from "@/server/push/push-deps";
import { subscribePush, unsubscribePush } from "@/server/queries/push";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { pushSubscriptionBodySchema, pushUnsubscribeBodySchema } from "@/shared/api/push";

async function signedIn(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return { ok: false as const, response: blocked };
  }
  if (!pushConfigured(getServerEnv(), publicEnv)) {
    return { ok: false as const, response: apiError("reminders_unavailable") };
  }
  const supabase = await createSupabaseServerClient();
  return (await requireUser(supabase))
    ? { ok: true as const, supabase }
    : { ok: false as const, response: apiError("unauthenticated") };
}

/** Turn on reminders for this browser (spec §7.4; rate limited, at most 10 devices). */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await signedIn(request);
  if (!session.ok) {
    return session.response;
  }
  const body = await parseJsonBody(request, pushSubscriptionBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await subscribePush(session.supabase, body.data);
  return error ? fromDatabaseError(error) : ok();
}

/** Turn off reminders for this browser (sign-out and account deletion call it too). */
export async function DELETE(request: Request): Promise<NextResponse> {
  const session = await signedIn(request);
  if (!session.ok) {
    return session.response;
  }
  const body = await parseJsonBody(request, pushUnsubscribeBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await unsubscribePush(session.supabase, body.data.endpoint);
  return error ? fromDatabaseError(error) : ok();
}
```
`reminders_unavailable` goes in `API_ERROR_CODES`, `API_ERROR_STATUS` (503) and `ApiErrors`: "Reminders aren't available right now."

- [ ] **Step 8: Run everything, commit, PR, merge**

```bash
bunx prettier --write src/config src/lib/push src/server/push src/server/queries/push.ts src/shared/api src/app/api/me/push-subscriptions src/server/workers messages/en.json package.json docs/superpowers/specs/2026-10-04-tapnshow-design.md && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db
git checkout -b feat/<issue>-m8-push-lane
git add src messages package.json bun.lock docs
git commit -m "feat(pipeline): push lane next to the email worker; subscription routes"
```
`bun run test:db` re-runs the dispatcher DB tests, which now go through the real `scheduleWorkers` imports.

PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:pipeline`, `area:api`, `area:config`. Then `merge-when-green.sh`, and confirm `MERGED`.

---

### Task 8: PWA: Serwist worker, manifest and icons, offline invites, install, the reminders UI

**Labels:** `type:task`, `area:frontend`, `area:config`.

**Files:**
- Create:
  - `src/config/offline.ts`;
  - `src/app/sw.ts`, `src/app/serwist/[path]/route.ts`, `src/app/~offline/page.tsx`;
  - `src/app/manifest.ts` (+ test), `src/lib/brand/app-icon.ts` (+ test), `src/app/icons/[file]/route.tsx`;
  - `src/lib/push/sw-handlers.ts` (+ test), `src/lib/push/client.ts` (+ test), `src/lib/push/base64url.ts` (+ test);
  - `src/hooks/use-reminders.ts` (+ test), `src/hooks/use-online.ts` (+ test);
  - `src/components/providers/install-prompt-provider.tsx` (+ test), `src/hooks/use-install-prompt.ts`;
  - `src/components/members/reminders-card.tsx` (+ test), `iphone-install-sheet.tsx` (+ test), `reminders-section.tsx` (+ test), `offline-banner.tsx` (+ test).
- Modify:
  - `next.config.ts`, `src/proxy.ts` (matcher), `src/app/layout.tsx` (Serwist provider, install provider, icons, viewport);
  - `src/lib/device/clear.ts` (+ test: reminders off first);
  - `src/hooks/use-paged-list.ts` (`networkMode`), `src/hooks/use-my-invites.ts` (`offlineFirst`);
  - `src/app/invites/invites-view.tsx`, `invite-card.tsx` (offline), `src/app/account/account-view.tsx` (reminders section);
  - `messages/en.json` (`Reminders`, `Offline`), `package.json`/`bun.lock`.
- Delete: `src/app/favicon.ico`.

**Interfaces:**
- Consumes:
  - Task 3's `InvitesView`, `InviteCard`, device storage;
  - Task 5's `AccountView`, `clearDeviceData`, `CACHE_PREFIX`;
  - Task 7's `POST` / `DELETE /api/me/push-subscriptions`, `pushSubscriptionBodySchema`, the `Notifications.fallback*` words.
- Produces:
  - `SW_CACHES = { pages: "tn-pages", invites: "tn-invites", static: "tn-static" }`, `OFFLINE_INVITES_MAX_AGE_SECONDS = 86_400`, `SW_NETWORK_TIMEOUT_SECONDS = 4`.
  - `notificationFromPush(text: string | null, fallback: { title: string; body: string }): { title: string; options: NotificationOptions }`.
  - `focusOrOpen(clients: Clients, url: string): Promise<void>`.
  - `RemindersState = "unavailable" | "unsupported" | "needs_install" | "blocked" | "off" | "on"`; `remindersState()`, `turnOnReminders()`, `turnOffReminders()`.
  - `useReminders()` → `{ state, turnOn, turnOff, pending }`; `useInstallPrompt()` → `{ canInstall, install, needsIphoneGuide, standalone }`; `useOnline(): boolean`.
  - `clearDeviceData()` now turns reminders off for this device first.

- [ ] **Step 1: Dependencies and the Serwist docs**

```bash
bun add -d @serwist/turbopack@9.5.13 serwist@9.5.13 esbuild
```
Read the installed docs and types before writing anything:
- `node_modules/@serwist/turbopack/README.md`, its `dist/*.d.ts`: `withSerwist`, `createSerwistRoute` options, and `SerwistProvider` props (`swUrl`, whether it accepts `disable`, `register`, `options.scope`).
- `node_modules/serwist/dist/index.d.ts`: `Serwist`, `NetworkFirst`, `CacheFirst`, `ExpirationPlugin`, and the `RuntimeCaching` matcher signature.

The code below follows the Turbopack guide (checked 2026-10-14). Where the installed types differ, follow them and record a ruling.

- [ ] **Step 2: Write the failing pure tests**

`src/lib/push/sw-handlers.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { focusOrOpen, notificationFromPush } from "./sw-handlers";

const fallback = { title: "TapNShow", body: "You have an update from TapNShow." };

describe("notificationFromPush (spec §8: always show one)", () => {
  it("shows what the server built, with its tag, the app badge and the url to open", () => {
    const shown = notificationFromPush(
      JSON.stringify({ title: "GDG ISSAT · Weekly sync", body: "New invite", url: "/invites/abc", tag: "invite:abc" }),
      fallback,
    );
    expect(shown).toEqual({
      title: "GDG ISSAT · Weekly sync",
      options: {
        body: "New invite",
        tag: "invite:abc",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        data: { url: "/invites/abc" },
      },
    });
  });

  it("falls back to a plain notification for an empty, broken or foreign payload", () => {
    for (const text of [null, "", "{not json", JSON.stringify({ url: "https://evil.example" })]) {
      const shown = notificationFromPush(text, fallback);
      expect(shown.title).toBe("TapNShow");
      expect(shown.options.body).toBe(fallback.body);
      expect(shown.options.data).toEqual({ url: "/invites" });
    }
  });
});

describe("focusOrOpen", () => {
  it("navigates an open TapNShow window when there is one, else opens a new one", async () => {
    const navigate = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    const openWindow = vi.fn(async () => null);
    const client = { url: "https://tapnshow.vercel.app/invites", navigate, focus };
    await focusOrOpen({ matchAll: async () => [client], openWindow } as never, "/invites/abc");
    expect(navigate).toHaveBeenCalledWith("/invites/abc");
    expect(focus).toHaveBeenCalled();
    await focusOrOpen({ matchAll: async () => [], openWindow } as never, "/invites/abc");
    expect(openWindow).toHaveBeenCalledWith("/invites/abc");
  });
});
```

`src/lib/push/base64url.test.ts`: `base64UrlToBytes("AQID")` is `Uint8Array [1, 2, 3]`, and it handles missing padding and `-`/`_`.

`src/lib/brand/app-icon.test.ts`:
- `appIconSvg("full")` is valid SVG markup (starts with `<svg`, has `viewBox="0 0 512 512"`) using `palette.light.success` and `palette.light.ink`;
- `"maskable"` keeps the tile inside the central 80 % safe zone (its tile path is scaled to `0.75` about the centre);
- `"badge"` uses only `#FFFFFF` on transparent (one colour).

`src/app/manifest.test.ts`:
- `start_url` is `/invites`, `display` is `standalone`, the theme colour is `palette.light.background`;
- it has 192 and 512 `any` icons and a 512 `maskable` icon;
- every icon `src` is one the icon route serves (`ICON_FILES` keys).

- [ ] **Step 3: Run them to verify they fail**

Run: `bun run test src/lib/push/sw-handlers.test.ts src/lib/push/base64url.test.ts src/lib/brand src/app/manifest.test.ts`
Expected: FAIL (no modules).

- [ ] **Step 4: Write the pure pieces**

`src/config/offline.ts`:
```ts
/**
 * What the service worker keeps on the device (spec §10 PWA). Every name starts with `tn-`
 * (`CACHE_PREFIX`, `src/lib/device/clear.ts`), so sign-out and account deletion wipe them all.
 */
export const SW_CACHES = { pages: "tn-pages", invites: "tn-invites", static: "tn-static" } as const;
/** The last-loaded invites stay readable offline this long. */
export const OFFLINE_INVITES_MAX_AGE_SECONDS = 86_400;
/** A cached page or invites list is shown when the network hasn't answered after this long. */
export const SW_NETWORK_TIMEOUT_SECONDS = 4;
/** Member pages served from the cache when offline (spec §7.4). */
export const OFFLINE_PAGES = ["/invites", "/account"] as const;
```

`src/lib/push/sw-handlers.ts`:
```ts
import { z } from "zod";

const payloadSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(300),
  url: z.string().regex(/^\/invites(\/[0-9a-f-]{36})?$/),
  tag: z.string().max(80),
});

/**
 * What to show for a push (spec §8). The worker always shows something: iOS takes the permission
 * away from a web app that receives a push and shows nothing. Only `/invites` links are opened.
 */
export function notificationFromPush(
  text: string | null,
  fallback: { title: string; body: string },
): { title: string; options: NotificationOptions } {
  let parsed: z.infer<typeof payloadSchema> | null = null;
  try {
    const result = payloadSchema.safeParse(text ? JSON.parse(text) : null);
    parsed = result.success ? result.data : null;
  } catch {
    parsed = null;
  }
  const base = { icon: "/icons/icon-192.png", badge: "/icons/badge-96.png" };
  return parsed
    ? { title: parsed.title, options: { body: parsed.body, tag: parsed.tag, ...base, data: { url: parsed.url } } }
    : { title: fallback.title, options: { body: fallback.body, ...base, data: { url: "/invites" } } };
}

/** On a tap: reuse an open TapNShow window (navigate and focus it), else open one. */
export async function focusOrOpen(clients: Clients, url: string): Promise<void> {
  const open = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const first = open[0];
  if (first && "navigate" in first) {
    const client = first as WindowClient;
    await client.navigate(url);
    await client.focus();
    return;
  }
  await clients.openWindow(url);
}
```
`Clients` and `WindowClient` come from `lib.webworker`. If `tsconfig.json`'s `lib` lacks `webworker`, add a triple-slash reference at the top of this file, as `sw.ts` does: `/// <reference lib="webworker" />`.

`src/lib/push/base64url.ts`:
```ts
/** The VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
```

`src/lib/brand/app-icon.ts`:
```ts
import { palette } from "@/design/tokens";

/** The three drawings the icon route turns into PNGs (spec §10 PWA; icon "B", owner 2026-10-14). */
export type AppIconVariant = "full" | "maskable" | "badge";

const { background, ink, success } = palette.light;
const TILE = `<rect x="104" y="100" width="304" height="304" rx="72" fill="${ink}"/><rect x="104" y="84" width="304" height="304" rx="72" fill="${success}" stroke="${ink}" stroke-width="20"/><path d="M168 240l60 60 116-116" fill="none" stroke="${ink}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * The tilted green "confirmed" tile (the mockup's option B) as SVG: `full` on the app background
 * with rounded corners, `maskable` full-bleed with the tile inside Android's safe zone, `badge` a
 * white silhouette for Android's notification bar.
 */
export function appIconSvg(variant: AppIconVariant): string {
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">';
  if (variant === "badge") {
    return `${open}<g transform="rotate(-8 256 256)"><rect x="104" y="84" width="304" height="304" rx="72" fill="none" stroke="#FFFFFF" stroke-width="28"/><path d="M168 240l60 60 116-116" fill="none" stroke="#FFFFFF" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  }
  const tile = `<g transform="rotate(-8 256 256)">${TILE}</g>`;
  return variant === "maskable"
    ? `${open}<rect width="512" height="512" fill="${background}"/><g transform="translate(64 64) scale(0.75)">${tile}</g></svg>`
    : `${open}<rect width="512" height="512" rx="112" fill="${background}"/>${tile}</svg>`;
}
```

`src/app/icons/[file]/route.tsx`:
```tsx
import { ImageResponse } from "next/og";
import { type AppIconVariant, appIconSvg } from "@/lib/brand/app-icon";

/** Every PNG the manifest, the layout and notifications use (built at build time). */
export const ICON_FILES: Record<string, { size: number; variant: AppIconVariant }> = {
  "icon-192.png": { size: 192, variant: "full" },
  "icon-512.png": { size: 512, variant: "full" },
  "maskable-512.png": { size: 512, variant: "maskable" },
  "apple-touch-icon.png": { size: 180, variant: "maskable" },
  "favicon-32.png": { size: 32, variant: "full" },
  "badge-96.png": { size: 96, variant: "badge" },
};

export const dynamic = "force-static";

/** The static params Next pre-renders. */
export function generateStaticParams(): { file: string }[] {
  return Object.keys(ICON_FILES).map((file) => ({ file }));
}

/** One app icon PNG, drawn from the single SVG source. */
export function GET(_request: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  return ctx.params.then(({ file }) => {
    const spec = ICON_FILES[file];
    if (!spec) {
      return new Response(null, { status: 404 });
    }
    const src = `data:image/svg+xml;base64,${Buffer.from(appIconSvg(spec.variant)).toString("base64")}`;
    return new ImageResponse(<img src={src} width={spec.size} height={spec.size} alt="" />, {
      width: spec.size,
      height: spec.size,
    });
  });
}
```
Route files may only export what Next allows. If `next build` refuses the `ICON_FILES` export, move it to `src/lib/brand/icon-files.ts`. Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` for the allowed exports and the `RouteContext` type, and use `ctx: RouteContext<"/icons/[file]">` like the other routes. After `bun run build`, open `/icons/icon-512.png` and `/icons/badge-96.png` in a browser and **look at them**. If the SVG data URI renders blank (a Satori limit), draw the same shapes with inline `<svg>` JSX from the same path strings and record a ruling.

`src/app/manifest.ts`:
```ts
import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { palette } from "@/design/tokens";

/** The web app manifest (spec §10 PWA): installs TapNShow with My invites as its start page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/invites",
    scope: "/",
    display: "standalone",
    background_color: palette.light.background,
    theme_color: palette.light.background,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `bun run test src/lib/push src/lib/brand src/app/manifest.test.ts`
Expected: PASS.

- [ ] **Step 6: The worker, its route, config and the layout**

`src/app/sw.ts`:
```ts
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";
import { OFFLINE_INVITES_MAX_AGE_SECONDS, OFFLINE_PAGES, SW_CACHES, SW_NETWORK_TIMEOUT_SECONDS } from "@/config/offline";
import { focusOrOpen, notificationFromPush } from "@/lib/push/sw-handlers";
import messages from "../../messages/en.json";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const isMemberPage = (pathname: string) =>
  OFFLINE_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));

// Only these are cached (spec §10 PWA): the shell's hashed files, the member pages, and the
// invites list. Answer pages, every other API call and every write always go to the network.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, sameOrigin, url }) => sameOrigin && request.mode === "navigate" && isMemberPage(url.pathname),
      handler: new NetworkFirst({ cacheName: SW_CACHES.pages, networkTimeoutSeconds: SW_NETWORK_TIMEOUT_SECONDS }),
    },
    {
      matcher: ({ request, sameOrigin, url }) =>
        sameOrigin && request.method === "GET" && url.pathname === "/api/me/invites",
      handler: new NetworkFirst({
        cacheName: SW_CACHES.invites,
        networkTimeoutSeconds: SW_NETWORK_TIMEOUT_SECONDS,
        plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: OFFLINE_INVITES_MAX_AGE_SECONDS })],
      }),
    },
    {
      matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: SW_CACHES.static, plugins: [new ExpirationPlugin({ maxEntries: 300 })] }),
    },
  ],
  fallbacks: {
    entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

self.addEventListener("push", (event) => {
  const { title, options } = notificationFromPush(event.data?.text() ?? null, {
    title: messages.Notifications.fallbackTitle,
    body: messages.Notifications.fallbackBody,
  });
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data: { url?: string } = event.notification.data ?? {};
  event.waitUntil(focusOrOpen(self.clients, data.url ?? "/invites"));
});

serwist.addEventListeners();
```
`sw.ts` runs in the worker. Exclude it from the app's DOM type checking if `tsc` complains about `ServiceWorkerGlobalScope` vs `Window`: give `src/app/sw.ts` its own `tsconfig.sw.json` (`lib: ["esnext", "webworker"]`, include only `src/app/sw.ts` and `src/lib/push/sw-handlers.ts`), exclude it from the root `tsconfig.json`, and run both from `bun run typecheck` (`tsc --noEmit && tsc --noEmit -p tsconfig.sw.json`). Serwist's guide suggests this; record the tsconfig change.

`src/app/serwist/[path]/route.ts`:
```ts
import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// The offline page's precache revision: the deployed commit (Vercel sets it), else the local HEAD.
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  (spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim() || crypto.randomUUID());

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});
```

`src/app/~offline/page.tsx`: a static page in `PublicPage`'s look. A Sticker with `WifiSlash`, "You're offline", "Connect to the internet to keep going. Your invites from your last visit are in My invites.", and a link to `/invites`. Words under `Offline`.

`next.config.ts`:
```ts
import { withSerwist } from "@serwist/turbopack";
// …
const nextConfig: NextConfig = {
  headers: async () => [
    ...tokenPageHeaders,
    {
      // The worker must update at once and control the whole app from /serwist/ (spec §10 PWA).
      source: "/serwist/:path*",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
  ],
};
// …
export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), { … });
```
Move the new header rule into `src/config/security-headers.ts` as `serviceWorkerHeaders`, with a test next to the existing ones, so next.config stays a list of imports.

`src/proxy.ts` matcher:
```ts
    "/((?!_next/static|_next/image|serwist|icons|manifest.webmanifest|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
```

`src/app/layout.tsx`:
- `metadata.icons = { icon: "/icons/favicon-32.png", apple: "/icons/apple-touch-icon.png" }`;
- `metadata.appleWebApp = { capable: true, title: APP_NAME, statusBarStyle: "default" }`;
- `export const viewport: Viewport = { themeColor: palette.light.background }`;
- wrap the providers' children in `<InstallPromptProvider>` and, **only when `process.env.NODE_ENV === "production"`**, in `SerwistProvider swUrl="/serwist/sw.js"` with scope `/` (use the prop or option name the installed types give).

Delete `src/app/favicon.ico`.

- [ ] **Step 7: The browser side (tests first)**

`src/lib/push/client.test.ts`, with fakes for `navigator.serviceWorker` (`ready`, `getRegistration`), `PushManager` (`getSubscription`, `subscribe`), `Notification` (`permission`, `requestPermission`), `matchMedia`, the user agent, and `fetch`:
- `remindersState()`:
  - `"unavailable"` without the public key;
  - `"needs_install"` on an iPhone user agent not in standalone mode;
  - `"unsupported"` without `PushManager`;
  - `"blocked"` when the permission is `denied`;
  - `"on"` with a subscription and `granted`;
  - `"off"` otherwise.
- `turnOnReminders()`:
  - asks the permission, subscribes with `userVisibleOnly: true` and the key's bytes, and POSTs the parsed `toJSON()`;
  - if the POST fails, it unsubscribes again and rethrows;
  - if the permission isn't granted, it returns `"off"` or `"blocked"` without subscribing.
- `turnOffReminders()` sends `DELETE` with the endpoint and then `unsubscribe()`. A failed `DELETE` (signed out already) still unsubscribes. With no subscription it does nothing.

`src/lib/device/clear.test.ts`, a new case: `clearDeviceData()` calls `turnOffReminders()` before clearing caches and storage, and still clears both when it throws.

`src/hooks/use-online.test.ts`: it follows the `online`/`offline` events.

`src/components/providers/install-prompt-provider.test.tsx`:
- a dispatched `beforeinstallprompt` (with `prompt` and `userChoice`) makes `useInstallPrompt().canInstall` true, and `install()` calls `prompt()`;
- `appinstalled` sets it false;
- an iPhone user agent outside standalone mode gives `needsIphoneGuide: true`.

`src/components/members/reminders-card.test.tsx` (mock `useReminders`, `useInstallPrompt`, device storage):
- `off`: "Get reminders on this phone", **Turn on**, **Install the app** only when `canInstall`, and **Not now**, which writes `tn.reminders.hiddenUntil` 30 days ahead and hides the card;
- `needs_install`: "Get reminders on this iPhone", and **Show me how** opens the sheet with the three steps;
- `blocked`: the blocked text and **Hide**;
- after a successful Turn on: "Reminders are on for this phone", once; after a re-render with state `on`, nothing;
- `unavailable` / `unsupported` / `on`: renders nothing;
- a stored `hiddenUntil` in the future hides it.

`src/components/members/reminders-section.test.tsx`: a `Switch` labelled "Reminders on this phone" toggles `turnOn` / `turnOff`; it's disabled with a hint for `blocked`, `needs_install` (with Show me how) and `unsupported`; Install the app shows when `canInstall`; the section is hidden when `unavailable`.

`src/components/members/offline-banner.test.tsx`: offline with `asOf` gives "You're offline. Showing your invites from 14:02. Answering needs a connection." (the time in the viewer's zone); online gives nothing.

`src/app/invites/invites-view.test.tsx` (extend): offline → banner, cards rendered with `disabled` (not links, "Connect to answer" under each); offline with no data → "Connect to see your invites."

Run them and see them fail. Then write:

`src/lib/push/client.ts`:
```ts
import { publicEnv } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { pushSubscriptionBodySchema } from "@/shared/api/push";
import { base64UrlToBytes } from "./base64url";

/** Where this device stands with reminders (spec §7.4). */
export type RemindersState = "unavailable" | "unsupported" | "needs_install" | "blocked" | "off" | "on";

const SUBSCRIPTIONS = "/api/me/push-subscriptions";

/** Reminders exist on this deployment (the public key is set; previews without keys hide them). */
export function remindersAvailable(): boolean {
  return Boolean(publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/** An iPhone or iPad (iPadOS reports a Mac with touch). */
export function isIphone(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the Home Screen / as an installed app. */
export function isStandalone(): boolean {
  const legacy = "standalone" in navigator && navigator.standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || legacy;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** This device's reminders state. */
export async function remindersState(): Promise<RemindersState> {
  if (!remindersAvailable()) {
    return "unavailable";
  }
  if (isIphone() && !isStandalone()) {
    return "needs_install";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "blocked";
  }
  return Notification.permission === "granted" && (await currentSubscription()) ? "on" : "off";
}

/** Asks the browser, subscribes this device and tells the server; undone if the server refuses. */
export async function turnOnReminders(): Promise<RemindersState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "blocked" : "off";
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""),
  });
  try {
    await apiRequest(SUBSCRIPTIONS, {
      method: "POST",
      body: pushSubscriptionBodySchema.parse(subscription.toJSON()),
      schema: okSchema,
    });
  } catch (error) {
    await subscription.unsubscribe();
    throw error;
  }
  return "on";
}

/** Tells the server (best effort: the person may be signed out already), then unsubscribes. */
export async function turnOffReminders(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const subscription = await currentSubscription();
  if (!subscription) {
    return;
  }
  try {
    await apiRequest(SUBSCRIPTIONS, { method: "DELETE", body: { endpoint: subscription.endpoint }, schema: okSchema });
  } catch {
    // The device is unsubscribed below either way; the server row ages out (housekeeping).
  }
  await subscription.unsubscribe();
}
```
`navigator.standalone` is Safari-only and not in `lib.dom`. Declare it once in `src/types/navigator.d.ts` (`interface Navigator { standalone?: boolean }`) instead of the `in` check if lint flags it.

`src/lib/device/clear.ts`: `clearDeviceData()` first does `await turnOffReminders().catch(() => undefined);`. The JSDoc names the order: the server call needs the session, so it runs before sign-out.

`src/hooks/use-reminders.ts`: `useState<RemindersState | null>` loaded with `remindersState()` in an effect; `turnOn` / `turnOff` mutations update it. When `turnOn` fails, toast the `ApiErrors` text (`errorCodeOf`).

`src/hooks/use-online.ts`: `useSyncExternalStore` over `online`/`offline` events, server snapshot `true`.

`src/components/providers/install-prompt-provider.tsx` + `src/hooks/use-install-prompt.ts`: a context that stores the deferred `beforeinstallprompt` event, captured at the root (the event fires once, at load), cleared on `appinstalled` or after `prompt()`. Type the event locally:
```ts
/** Chrome's `beforeinstallprompt` (not in lib.dom). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
```

`src/hooks/use-paged-list.ts`: add an optional `networkMode?: "online" | "offlineFirst"` passed to `useInfiniteQuery`. `useMyInvites` uses `"offlineFirst"`: TanStack's default pauses fetches offline, and the request must reach the service worker's cache.

Components, words from the mockups:
- `RemindersCard` (top of `/invites`, above the tabs);
- `IphoneInstallSheet` (a `Dialog`: the three steps with numbered stickers; Share icon `Export` from Phosphor);
- `RemindersSection` (an `/account` card between Your name and Your answers);
- `OfflineBanner` (`role="status"`, above the tabs).

`InvitesView` passes `disabled={!online}` to every `InviteCard`. The card shows "Connect to answer" under a disabled upcoming card.

`messages/en.json`:
```json
"Reminders": {
  "cardTitle": "Get reminders on this phone",
  "cardTitleIphone": "Get reminders on this iPhone",
  "cardBody": "We'll tell you about new invites, changes and reminders here as well as by email.",
  "cardBodyIphone": "On iPhone, reminders work once TapNShow is on your Home Screen.",
  "turnOn": "Turn on",
  "install": "Install the app",
  "notNow": "Not now",
  "showMe": "Show me how",
  "blockedTitle": "Notifications are blocked",
  "blockedBody": "This browser is set to block TapNShow's notifications. Allow them in the browser's site settings, then come back.",
  "hide": "Hide",
  "on": "Reminders are on for this phone",
  "sectionTitle": "Reminders on this phone",
  "sectionBody": "New invites, changes and reminders, as well as the emails.",
  "unsupported": "This browser can't show reminders.",
  "sheetTitle": "Add TapNShow to your Home Screen",
  "step1": "Tap Share at the bottom of Safari.",
  "step2": "Choose Add to Home Screen, then Add.",
  "step3": "Open TapNShow from your Home Screen and tap Turn on.",
  "gotIt": "Got it"
},
"Offline": {
  "title": "You're offline",
  "body": "Connect to the internet to keep going. Your invites from your last visit are in My invites.",
  "banner": "You're offline. Showing your invites from {time}. Answering needs a connection.",
  "connectToAnswer": "Connect to answer",
  "connectToSee": "Connect to see your invites.",
  "openInvites": "My invites"
},
```

- [ ] **Step 8: Build and look**

```bash
bun run build
bun scripts/with-local-supabase.ts bun run start -p 3000
```
Then, in a browser at `http://localhost:3000` (Chrome DevTools > Application), check each item, and note each in the ledger:
1. The worker is registered with scope `/` and is activated.
2. The manifest shows the name, the start URL `/invites` and three icons, and Chrome's installability panel reports no errors.
3. `/icons/icon-512.png`, `/icons/maskable-512.png` and `/icons/badge-96.png` look like icon B. Look at them.
4. After loading `/invites` while signed in, `tn-invites` holds a `/api/me/invites?...` entry, and nothing under `/r/` or other `/api/` paths is cached.
5. With Network > Offline, reloading `/invites` shows the list with the offline banner, and `/w/<slug>` shows the offline page.
6. Sign out: the `tn-*` caches and `tn.*` storage are gone.

Stop the server afterwards (`ss -ltnp | grep :3000`, kill by PID).

- [ ] **Step 9: Screenshots, run everything, commit, PR, merge**

Screenshots (`.superpowers/scripts/screens/m8-pwa.spec.ts`), at 390 light, 320 dark and 1024:
- the reminders card in each state (`off` with Install, `needs_install` with an iPhone user agent, `blocked`, the "on" note);
- the iPhone sheet;
- the Account reminders section;
- `/invites` offline with the banner;
- `/~offline`.

Look at them, send them, and ask "Looks right?".
```bash
grep -rn "favicon.ico" src && exit 1 || true
bunx prettier --write src next.config.ts messages/en.json && bun run format:check && bun run lint && bun run typecheck && bun run test && TZ=UTC bun run test:e2e
git checkout -b feat/<issue>-m8-pwa
git add src next.config.ts messages package.json bun.lock tsconfig*.json
git commit -m "feat(pwa): installable app, offline invites, reminders on this phone"
```
PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:frontend`, `area:config`. Then `merge-when-green.sh`, and confirm `MERGED`.

---

### Task 9: Discovery: the email footer line, the sign-in card and "Back to my invites" on the answer page

**Labels:** `type:task`, `area:email`, `area:frontend`.

**Files:**
- Create: `src/app/r/[token]/sign-in-card.tsx` (+ test), `src/app/r/[token]/back-to-invites.tsx`
- Modify:
  - `src/emails/meeting-blocks.tsx` (`MeetingFooter`), `src/server/dispatch/run-dispatch.ts` (`links.invites`), and every meeting email test (`meeting-invite-email`, `meeting-update-email`, `meeting-cancel-email`, `meeting-reminder-email`, `calendar-confirm-email`);
  - `src/app/r/[token]/answer-view.tsx` (+ test);
  - `messages/en.json` (`Email.meetingInvite.seeAll`, `AnswerPage.signIn*`, `AnswerPage.backToInvites`).

**Interfaces:**
- Consumes: Task 2's `TokenInfo.viewer`; Task 3's `/invites`.
- Produces: `MeetingFooter`'s `links` gains `invites: string`; `CommonEmailProps.links.invites = \`${appUrl}/invites\``.

- [ ] **Step 1: Write the failing tests**

In each meeting email test (`src/emails/*-email.test.tsx` that renders `MeetingFooter`), add:
```ts
it("points to all of the member's invites in one place (spec §7.4)", async () => {
  const { html, text } = await render(/* the file's existing fixture */);
  expect(text).toContain("See all your invites in one place: https://tapnshow.example/invites");
  expect(html).toContain('href="https://tapnshow.example/invites"');
});
```
Use each file's existing fixture and render helper; the fixture's `links` gains `invites: "https://tapnshow.example/invites"`.

`src/app/r/[token]/sign-in-card.test.tsx`:
- it renders "Get reminders on your phone", "Sign in with the email this invite came to, to see all your invites in one place." and a **Sign in** link to `/login?next=%2Finvites`;
- the link has no email in it.

`src/app/r/[token]/answer-view.test.tsx`, new cases:
- `viewer: "signed_out"`: after Confirm (the existing just-saved flow), the sign-in card appears under the summary; before any answer it doesn't;
- `viewer: "owner"`: "Back to my invites" (a link to `/invites`) replaces "Not you?";
- `viewer: "other"`: no card, and "Not you?" as today.

In `src/server/dispatch/run-dispatch.test.ts`, extend the case that checks `links` to expect `invites: "<appUrl>/invites"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test src/emails src/app/r src/server/dispatch/run-dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the code**

`MeetingFooter`, a new first line (above "Sent from …"):
```tsx
      {tr("meetingInvite.seeAll")}{" "}
      <Link href={links.invites} style={{ color: t.muted, textDecoration: "underline" }}>
        {links.invites.replace(/^https?:\/\//, "")}
      </Link>
      <br />
```
`links` type becomes `{ unsubscribe: string; report: string; invites: string }`. The JSDoc gains: "and, first, where to see all of the member's invites (M8, spec §7.4)". `Email.meetingInvite.seeAll`: "See all your invites in one place:".

`run-dispatch.ts`: `links` gains `invites: \`${deps.appUrl}/invites\``. Update `CommonEmailProps` if it spells the links type out.

`sign-in-card.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bell } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";

/**
 * After an answer, a quiet invitation to sign in for reminders and every invite in one place
 * (spec §7.4). The email is never pre-filled: a forwarded link must not reveal the address.
 */
export function SignInCard() {
  const t = useTranslations("AnswerPage");
  return (
    <Card className="flex flex-col gap-2 shadow-none">
      <div className="flex items-center gap-3">
        <Sticker tone="warning">
          <Bell weight="bold" aria-hidden />
        </Sticker>
        <p className="font-bold">{t("signInTitle")}</p>
      </div>
      <p>{t("signInBody")}</p>
      <Button asChild>
        <Link href={`/login?next=${encodeURIComponent("/invites")}`}>{t("signIn")}</Link>
      </Button>
    </Card>
  );
}
```
`back-to-invites.tsx`: a `Link` to `/invites` with `ArrowLeft` and `t("backToInvites")`, in the footer's text style.

`answer-view.tsx`:
- under `AnswerSummary` (when `answer && !editing && !emailOverride`), render `{data.viewer === "signed_out" ? <SignInCard /> : null}`;
- in the footer, `{data.viewer === "owner" ? <BackToInvites /> : <NotYou … />}`.

Messages `AnswerPage`: `"signInTitle": "Get reminders on your phone"`, `"signInBody": "Sign in with the email this invite came to, to see all your invites in one place."`, `"signIn": "Sign in"`, `"backToInvites": "Back to my invites"`.

- [ ] **Step 4: Run, screenshots, commit, PR, merge**

```bash
bunx prettier --write src/emails src/server/dispatch "src/app/r/[token]" messages/en.json && bun run format:check && bun run lint && bun run typecheck && bun run test && TZ=UTC bun run test:e2e
```
The e2e responses story reads email bodies (`answerLinkFrom`), so a full run proves the footer change kept the answer links intact.

Screenshots at 390 light, 320 dark and 1024:
- the answer page after Confirm, signed out (the card);
- the answer page signed in as the invite's owner (Back to my invites);
- the invite email preview (the existing preview route or the wizard's Review "full email").

Look at them, send them, and ask "Looks right?".
```bash
git checkout -b feat/<issue>-m8-discovery
git add src messages
git commit -m "feat: invites link in every meeting email; sign-in card on the answer page"
```
PR with `Closes #<issue>` and `Part of #10`, labels `type:task`, `area:email`, `area:frontend`. Then `merge-when-green.sh`, and confirm `MERGED`.

---

### Task 10: Rollout: the M8 e2e story with a fake push service, VAPID keys, final review, production check, evidence

**Labels:** `type:task`, `area:infra`.

**Files:**
- Create: `e2e/helpers/push.ts`, `e2e/m8-members.spec.ts`
- Modify: `e2e/global-setup.ts` (the HTTPS fake push service), `playwright.config.ts` (VAPID test keys, `NODE_EXTRA_CA_CERTS`), `package.json`/`bun.lock` (`http_ece` dev), `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§14 M8 evidence), `.env.local` (backup block; git-ignored)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `E2E_VAPID` (test-only keys) and `pushesFor(stamp)` / `decryptPush(body, keys)` in `e2e/helpers/push.ts`;
  - an HTTPS fake push service (`FAKE_PUSH_URL`): `POST /push/:id` (stores the body and the `TTL`, `Urgency`, `Topic`, `Authorization` headers, answers 201) and `GET /__pushes`.

- [ ] **Step 1: The fake push service and test keys**

```bash
bun add -d http_ece@1.2.0
bunx web-push generate-vapid-keys --json
```
Paste the generated pair into `e2e/helpers/push.ts` as `E2E_VAPID = { publicKey, privateKey, subject: "mailto:e2e@example.test" }`. These are test-only, like `E2E_TOKEN_KEY`; production keys are never in the repo.

`e2e/helpers/push.ts` also exports:
- `newBrowserKeys()`: an ECDH P-256 key pair and a 16-byte auth secret (`node:crypto`), base64url;
- `seedPushSubscription(userId, keys, id)`: service role, endpoint `${FAKE_PUSH_URL}/push/<id>`;
- `pushesFor(id)`: `GET /__pushes`, filtered by id;
- `decryptPush(body, keys)`: `http_ece.decrypt(body, { version: "aes128gcm", privateKey: ecdh, authSecret })`.

**HTTPS for the fake push service:** `push_subscriptions.endpoint` must start with `https://` (a production rule that tests never weaken), so the fake push routes run on their own HTTPS server, port `44398` (`FAKE_PUSH_URL = "https://127.0.0.1:44398"`), started in `e2e/global-setup.ts` next to the fake Google:
- `e2e/global-setup.ts` creates a throwaway self-signed certificate into the OS temp dir with `openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=127.0.0.1 -keyout <tmp>/key.pem -out <tmp>/cert.pem` (`execFileSync`; the CI image has `openssl`);
- it starts `https.createServer({ key, cert })` with the push routes;
- it deletes both files on teardown.
- The app trusts it only in e2e: `playwright.config.ts` `webServer.env` sets `NODE_EXTRA_CA_CERTS` to that `cert.pem`. That's narrower than turning TLS checks off, and Node reads it at start-up, which is why the certificate path is fixed at config load (`<os.tmpdir()>/tapnshow-e2e-push/cert.pem`) and created before the web server starts.

Record this as a ruling (the fake push service is HTTPS, unlike the fake Google).

`playwright.config.ts` `webServer.env` adds `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` from `E2E_VAPID`, plus `NODE_EXTRA_CA_CERTS`, with a comment naming why.

- [ ] **Step 2: The story (it fails until every task has merged; run it at the end)**

`e2e/m8-members.spec.ts`:
1. **Member home.**
   - Seed an organizer with two workspaces (`createWorkspace`, `seedRoster`, `seedSender`).
   - Send a meeting in each to the same member address through `sendMeetingThroughUi` (stamp-scoped), then run the workers.
   - The member signs in with a code at `/login` → lands on `/invites`.
   - Both invites are under Upcoming with "Not answered"; "Needs your answer (2)".
   - Tap one: the answer page opens; "Back to my invites" shows.
   - Confirm Going → back on `/invites` → "Going"; "Needs your answer (1)".
2. **Push.**
   - Seed a push subscription for the member (fake endpoint, the test's browser keys).
   - The organizer sends a third meeting; run the workers.
   - The fake push service holds one push for this endpoint: `TTL` > 0, `Topic` of 32 characters, a `vapid` Authorization header.
   - Decrypted, it is `{ title: "<Workspace> · <Title>", body: "New invite: …. Are you coming?", url: "/invites/<id>", tag: "invite:<id>" }` with no `/r/` anywhere.
   - `page.goto(url)` lands on that meeting's answer page.
3. **Stale push.** Seed a delivery whose meeting is then cancelled (DB), run the workers: no new push arrives for it.
4. **Offline.**
   - Load `/invites` (the worker installs), reload once so it controls the page, then `context.setOffline(true)` and reload.
   - The list still shows, the banner says "You're offline", and the cards say "Connect to answer".
   - Set the context back online.
5. **Sign-out wipes the device.**
   - Sign out. The `tn-*` caches are empty (`page.evaluate(() => caches.keys())`) and `tn.*` storage is empty.
   - Signing in as another member shows their (empty) invites, never the first member's.
6. **Account deletion.**
   - An Owner sees the blocked delete card listing their workspace.
   - The member types `confirm` (the copy button fills the clipboard: grant `clipboard-read`/`clipboard-write` and read it back) and deletes. They land on `/login` with "Your account was deleted."
   - The organizer's meeting page shows the member's answer with no reason or comment.
7. **Footer.** The invite email's text has "See all your invites in one place" and the `/invites` link.

Run against CI conditions: `NEXT_PUBLIC_GMAIL_CONNECT_ENABLED=false TZ=UTC bun run test:e2e e2e/m8-members.spec.ts` must pass with nothing from `.env.local` (the memory `e2e-env-local-leak`).

- [ ] **Step 3: Production keys (ask first)**

1. Generate the production pair locally into `~/.config/tapnshow/vapid.json` (`umask 077`; `bunx web-push generate-vapid-keys --json > ~/.config/tapnshow/vapid.json`). Never print it.
2. Add both keys and `VAPID_SUBJECT=mailto:<the platform Gmail>` to the `VERCEL BACKUP` block of `.env.local` with a script that never prints values (memory `env-backup-in-env-local`).
3. **AskUserQuestion:** "Add the reminder keys to Vercel (Preview and Production) and redeploy? This turns phone reminders on for everyone." Only on yes: `vercel env add` for `VAPID_PRIVATE_KEY` (sensitive), `VAPID_SUBJECT` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, for both environments, then redeploy production (`vercel --prod` from the clean `main` worktree, or an empty commit through a PR).

- [ ] **Step 4: Final whole-branch review (fresh reviewer)**

`superpowers:requesting-code-review` with `model: "opus"`:
- the package from `review-package docs/superpowers/plans/2026-10-14-m8-member-accounts-pwa.md <merge-base of Task 1> HEAD`;
- this plan's **Review Focus** verbatim;
- a pointer to the ledger's rulings.

The reviewer appends its findings to `.superpowers/sdd/2026-10-14-m8-member-accounts-pwa/review-notes.md` as it goes. Then follow `superpowers:receiving-code-review`:
- re-grade the findings by effect;
- make ONE fix pass with a RED→GREEN test per Critical or Important finding;
- put the minors in one issue (milestone M8) and ask the Owner whether they're done now.

- [ ] **Step 5: Production check with the Owner (test workspaces and inboxes only)**

Ask the Owner to:
1. On Android (Chrome) and on an iPhone with iOS 16.4+, open `https://tapnshow.vercel.app/invites`, sign in with a test inbox's address, and install the app (Install / Add to Home Screen). Open it from the Home Screen and **Turn on** reminders.
2. In their test workspace, send a meeting to that test inbox (2+ days ahead, so a reminder can be set) and make a reminder due (`prod-due-timers.ts` **writes**, so ask before running it).
3. Confirm:
   - the invite and the reminder arrive as notifications on both phones;
   - tapping one opens the answer page;
   - `/invites` shows invites from two workspaces;
   - Download my answers opens in Excel.
4. Delete a throwaway test account. Its reasons are gone from the organizer's meeting page and, if a sheet is on, from the sheet after the next redraw.

Check Sentry (`search_issues`, org `dev-daly`, region `https://de.sentry.io`) and the read-only prod helpers (counts only). Record the exact results.

- [ ] **Step 6: Evidence and closing**

- Spec §14 M8 row: a "**Done <date>:**" sentence with the counts (unit, DB and e2e totals; advisors; Sentry) and what the Owner checked. Merge it in a docs PR (`documentation` + `type:task`).
- A rulings comment on epic #10 (every ledger `Ruling:` line, each with its cost if wrong).
- Close the task issues, epic #10 and the M8 milestone.
- Update the memory: rename `m7-done-open-items` to `m8-done-open-items` with what is still open, and delete `m8-design-decisions` (the spec is the record now).
- **Ask before deleting** the ledger folder and `spike/m0-s2-s4`.

---

## Self-review (done while writing; re-run after any amendment)

**Spec coverage (spec section → task):**

| Spec | Task |
|---|---|
| §3 Member row; §4 Member accounts; §7.4 landing | 3 |
| §6 Identity rules: verified email, read-time, `contacts.user_id` dropped, `contacts (email)` index | 1 |
| §7.4 `/invites` (tabs, chips, groups, pills, empty, Past with check-ins) | 1 (data), 2 (API), 3 (UI) |
| §7.4 answering through `/r`, `/invites/[id]`, no personal link in a push | 2, 3, 7 |
| §7.4 reminders card, iPhone guide, blocked, "on" note | 8 |
| §7.4 install and offline (banner, Connect to answer, offline page) | 8 |
| §7.4 `/account` (name, reminders, download, delete), copy button on both dialogs | 5, 8 |
| §7.4 discovery: card after Confirm, footer line, Back to my invites | 9 |
| §6 `push_subscriptions`, `push_deliveries`, Access pattern (M8) | 6 |
| §8 Push worker: enqueue in `dispatch_finish`, wake-up, claim, re-check, results, TTL/Urgency/Topic, tag, always show | 6, 7, 8 |
| §8 Housekeeping additions | 6 |
| §10 PWA (manifest, icons, Serwist, caching rules, sign-out wipe) | 8 |
| §10 Members API (routes, `viewer`, `asOf`, error codes) | 2, 4, 5, 7 |
| §11 Account deletion (owner block, erasure, sender/sheet pause + alerts, shared-grant guard, cascade) | 4 |
| §11 Push privacy, Rate limiting, Secrets (VAPID) | 6, 7, 8, 10 |
| §12 M8 tests | 1–10 |
| §14 M8 "done when" | 10 |
| §15 VAPID rotation note | spec only (no code) |

**Placeholders:** none intentional. Steps that depend on a library's installed shape (`web-push` options, Serwist provider props, Satori and SVG) name the file to read and the fallback to take, with a ruling.

**Type consistency:**
- `MyInvite`, `MyInvitesPage`, `MyAnswer` (`src/shared/api/my-invites.ts`) are used by Tasks 2, 3, 5 and 8.
- `PushItem` comes from `src/shared/api/push.ts` and is used by Task 7's store, message and lane.
- `RemindersState` is used by `client.ts`, `use-reminders.ts` and the components.
- `ACCOUNT_DELETE_WORD` is used by Task 4's schema and Task 5's dialog.
- `CACHE_PREFIX` (`tn-`) matches every `SW_CACHES` name.
- `DEVICE_KEYS` all start with `tn.`, which `clearDeviceValues` removes.

**Review Focus pins:**
1. Shared phone: Tasks 6 and 8 (+ Task 10 e2e step 5).
2. Stale push: Task 6 (+ Task 10 e2e step 3).
3. Deletion side effects: Task 4.
4. Matching edge cases: Task 1.
5. Offline after time passes: Tasks 2 and 8 (+ Task 10 e2e step 4).
