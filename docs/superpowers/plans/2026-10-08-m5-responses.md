# TapNShow M5 (Responses, the MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member taps a button in the invite email, lands on `/r/[token]` with that choice pre-selected, confirms in one tap (or picks a delay and gives a reason), and gets a calendar invite email; organizers and Viewers watch the answers arrive live on the meeting page, read each person's history, compare everyone in an Attendance view, and export CSV or Excel. Every list that can grow loads in pages. The milestone is done when the club runs a real meeting end to end (after the Owner's explicit go-ahead).

**Architecture:** Two new tables (`responses`, `response_history`) behind RLS that members never write directly: the public token routes call `public.token_submit_response` / `public.token_request_calendar` (service role only), which validate the answer against the meeting's settings, write the answer and its history row, and refresh the person's `calendar_confirm` job in one transaction. The dispatcher (M4) learns a second job kind: at reserve time it compares "should have the event" with the invitee's `calendar_state` and sends a pre-accepted `METHOD:REQUEST`, a `METHOD:CANCEL`, or nothing, through the same lease/quota/thread path as invites. Organizer screens read through `SECURITY INVOKER` functions that return one page (keyset cursor) or one aggregate; the client uses TanStack Query (`useInfiniteQuery` for pages, `refetchInterval` for the 10 s live refresh). Exports are built on the device.

**Tech Stack:** Next.js 16.3.8 (`after()`, `maxDuration`), React 19.2.8, TypeScript 5, bun 1.3.11, `@supabase/supabase-js` 2.117.2 + `@supabase/ssr` 0.12.7, Supabase CLI 2.119.0 (local ports 44320–44329), Postgres 17, `zod` 4.6, `@tanstack/react-query` 5.104 (`useInfiniteQuery`), `motion` (Expressive motion), `date-fns` 4 + `@date-fns/tz` 1.5, `react-email` 6.11, `nodemailer` 10.0.15 (`MailComposer` `icalEvent`: a `text/calendar` alternative plus an `application/ics` attachment; checked in `node_modules/nodemailer/dist/cjs/mail-composer/index.d.ts` 2026-10-08), PapaParse 5 (`unparse`), **new:** `write-excel-file` 4.1.1 (MIT, one dependency `fflate`, 7 releases since April 2026, same author as the `read-excel-file` we use; `write-excel-file/universal` → `toBlob()`, multi-sheet form `[{ data, sheet, columns }]`; checked on npm 2026-10-08). Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md` — read §4 (Calendar delivery, Response edits, Email answer buttons, Reasons, Results & history, Pagination rows), §6 (`meeting_invitees`, `responses`, `response_history`, Access pattern (M5)), §7.3, §7.7, §7.10, §8 (`calendar_confirm`, #168 fixes, Errors, Idempotency), §9 (Calendar files, Calendar confirmation email, Meeting invite email), §10 (routes, Responses API, Pagination contract, Libraries), §11 (Public token route), §12 (M5 tests) and §14 (M5 row) before starting. Design approved 2026-10-08 (#175). Epic #7; #51, #168 and #174 folded in.

## Global Constraints

- Everything from the M0+M1, M2, M3 and M4 plans' Global Constraints still applies: free only; bun; **no Server Actions** and no RSC data reads (every read and write through `src/app/api/**/route.ts` + TanStack Query); no emojis anywhere (UI, emails, `.ics`); no `any`/`unknown` (the ESLint rule bans the `unknown` keyword, including `as unknown as`); no `console.*`; JSDoc on every export; imports at the top of the file only; no hardcoded values (limits in `private.app_limits`, client tuning in `src/config/*`); SQL only in `supabase/migrations/*` and `src/server/queries/*`; every UI and email string through next-intl (`messages/en.json`); Soft Neobrutalism; Expressive motion with a reduced-motion fallback; WCAG 2.2 AA; ≥ 44 px tap targets; one branch + PR per task with the repo template, CI green including `db`, squash merge, commit trailer from the session's attribution reminder.
- **No native form controls; confirm dialogs for important actions; no technical text for users** (owner rules). M5 adds no destructive action; Confirm on the answer page is the action itself, not a dialog. Error copy on the answer page is plain ("The meeting has started, so answers are closed."), never a code.
- **Opening a link never writes** (spec §4 Email answer buttons, §11): `GET /api/r/[token]` and the `/r/[token]` page never save an answer or request a calendar email; `?choice=` only pre-selects. Answer writes are `PUT`/`POST` with `rejectCrossOrigin` (only our page calls them; the RFC 8058 unsubscribe `POST` stays the documented exception) and the existing per-IP / per-token token budgets.
- **Answer rules live in the database** (`public.token_submit_response`): choice fits the mode (attendance: `attending|late|absent`; RSVP: `attending|not_attending`; announcement: none); Late needs a delay that is one of the meeting's `delay_options`; Late/Absent/Not going need a non-empty reason when `reason_required`; Going stores no reason; comments only when `comments_enabled`; reason and comment ≤ 500 characters, trimmed; closed when `status <> 'scheduled'` or `starts_at <= now()`; `after_deadline = response_deadline is not null and now() > response_deadline`. Identical re-saves change nothing. The route maps `tn:answers_closed`, `tn:invalid_choice`, `tn:delay_required`, `tn:reason_required` to new API codes (Task 8).
- **Calendar job = final state** (spec §8): every save refreshes the invitee's pending (or paused) `calendar_confirm` job to `now() + calendar_confirm_delay_seconds` (60, `app_limits`) or inserts one; the invitee row lock serializes saves. At reserve time the job decides add / remove / nothing; `dispatch_finish` records `calendar_state` and `calendar_sequence + 1` for `sent` and `unknown`. Calendar jobs never touch `email_status`. Duplicate pending calendar jobs (from retries) are harmless because each one re-decides.
- **Pagination contract** (#174, spec §10): list endpoints take `cursor` (opaque base64url of the keyset values; malformed → `400 invalid_input`) and `limit` (default `PAGE_SIZE_DEFAULT` 50, max `PAGE_SIZE_MAX` 100, `src/config/pagination.ts`) and return `{ items, nextCursor }`; SQL uses keyset conditions on an index (no `OFFSET`) with `id` as the last tie-breaker; every page query fetches `limit + 1` rows to know whether more exist. Bounded-by-design lists (roster, Audience step, Attendance table: ≤ 2,000 contacts; list chips ≤ 50) load at once.
- **Query plans** (M4 `import_contacts` lesson, spec §6 Access pattern (M5)): organizer read functions are `private` `SECURITY DEFINER` bodies behind `public` invoker wrappers that check `private.is_member()` once and then read without per-row RLS probes; they read each table once and join aggregates instead of correlated subqueries. Task 7's plan tests (auto_explain through `psql`) assert the named index is used both after `analyze` and right after a bulk insert without `analyze` (stale statistics).
- Supabase: every new `public` table gets `enable row level security`, `revoke all … from anon, authenticated`, explicit `GRANT select` to `authenticated` where organizers read it, and `grant all … to service_role`. Policies are `to authenticated` and use `private.is_member(workspace_id)`. `responses` and `response_history` get **no** insert/update/delete grant for `authenticated`.
- **Function security (spec §11):** token write functions and dispatcher functions are `public` `SECURITY INVOKER`, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role` (the M4 `token_*` pattern; this replaces the spec's working name `private.submit_response`, see Task 3 ruling). Organizer read functions (`meetings_page`, `members_page`, `meeting_results`, `meeting_people`, `contact_history`, `attendance_summary`, `attendance_details`) are `private` definer bodies behind `public` invoker wrappers granted to `authenticated`; `invites_page` is a plain invoker function (RLS on `workspace_invites` is cheap and already restricts it to Owner/Admin). Every private function granted to `authenticated` is added to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` in `src/server/db/function-security.db.test.ts` (sorted) in the same PR. Run `supabase db advisors --local </dev/null` after every migration; expected: no WARN or ERROR.
- **Changing an existing function:** copy the latest body from **the newest migration that defines it** (grep all migrations: `dispatch_claim` was last redefined in `20261008152332_m4_online_place.sql`, `dispatch_reserve` in `20261008114104_m4_reserve_token_hash.sql`, `token_invitee` in `20261008152332_m4_online_place.sql`, `meeting_progress` in `20261007205641_m4_outbox.sql`). A signature change is `drop function … (old args)` + `create function` + re-grant (grants are per signature). Plan code below shows complete bodies.
- **PostgREST resolves functions by argument names:** pass SQL null with `sqlNullable()` (`src/server/db/rpc-args.ts`); a new optional argument needs `default null` in SQL.
- New error codes (Task 8 adds them to `API_ERROR_CODES`, `API_ERROR_STATUS` and `ApiErrors`): `answers_closed` (409), `invalid_choice` (400), `delay_required` (400), `reason_required` (400).
- New limits (`private.app_limits`, Task 3): `calendar_confirm_delay_seconds` 60. New client config: `src/config/responses.ts` (`REASON_MAX` 500, `COMMENT_MAX` 500, `RESULTS_POLL_MS` 10_000, `RESULTS_POLL_STOP_AFTER_END_MS` 10_800_000, `HISTORY_PERIODS`, `HISTORY_DEFAULT_PERIOD` `"3m"`), `src/config/pagination.ts`.
- **No rollout flag** (owner decision 2026-10-08): no real club meeting has been sent, so only the Owner's own test invites can reach `/r`. Each task ships complete and usable.
- **Sends during development:** fake Gmail in tests and e2e. The S2 client checks (Task 16) send from localhost with the Owner's Gmail **only to the Owner's own four inboxes** (fresh Gmail, Outlook.com, iCloud, university address). The **first real club send needs the Owner's explicit go-ahead** in that session (ask with AskUserQuestion; never the roster otherwise).
- UI verification: Playwright screenshots through `.superpowers/scripts/screens/pw.config.ts` (`bun run test:e2e -c .superpowers/scripts/screens/pw.config.ts <spec>`; specs import `./shots`) at **390 px light, 320 px dark and 1024 px** for every new or changed screen; look at them before claiming done; no horizontal page scroll at 320 px; dialogs centered at 1024 px; hidden scrollbars on horizontal chip rows; `p-1.5` inner padding in popovers and menus.
- Local stack: `supabase start` (API 44321, DB 44322, Studio 44323, Mailpit 44324/44325). Always run the CLI with `</dev/null`; `supabase db query` with `--agent no`. After a Docker/WSL restart, if `test:db` fails with a ZodError on `API_URL`, run `supabase stop </dev/null && supabase start </dev/null`. Stop any `next dev` before `bun run test:e2e` (`ss -ltnp | grep :3000`, kill by PID; never `pkill -f`). Regenerate types with `bun run db:types` after each migration. Escape `[slug]`/`[token]` in vitest paths.
- **Before every commit, chained:** `bunx prettier --write <touched files> && bun run format:check && bun run lint && bun run typecheck && bun run test` (+ `bun run test:db` for DB work, + `bun run test:e2e` when a flow changes). Scripted edits: assert the old text exists and re-read the file after Prettier.
- **Merging and hosted migrations** (owner-approved 2026-10-08): open the PR, then `bash .superpowers/scripts/merge-when-green.sh <pr>` with `run_in_background`; verify `gh pr view <pr> --json state` is `MERGED`; after a PR with a migration merges, `bash .superpowers/scripts/hosted-push.sh` (preview, then production; record the advisor output in the ledger). Every M5 migration is additive or replaces function bodies compatibly, so merge-then-push is safe; Task 5's `list_meetings` replacement keeps the old function until Task 5's UI no longer calls it (dropped in Task 6's migration; see the ruling there).
- Every deviation from this plan becomes a ledger line `Task N: Ruling: <what> — <why> — <cost if wrong>` in `.superpowers/sdd/2026-10-08-m5-responses/progress.md`.

## Review Focus

1. **A link scanner (or the member) opening `/r/<token>?choice=attending` without tapping Confirm** — nothing is saved and no calendar email is queued; the page only shows the choice pre-selected. Pinned in Task 8 (`GET /api/r/[token]` leaves `responses` and `outbox_jobs` untouched) and Task 9 (the page renders the pre-selected card and sends no request until Confirm).
2. **Quick flips and double taps** (Going → Absent → Going within a minute; two tabs saving at once; the same answer saved twice) — exactly one pending calendar job per person, at most one email per real change of state, and the final calendar state matches the final answer. Pinned in Task 3 (concurrent `token_submit_response` calls leave one pending job and one history row per distinct save; an identical re-save adds nothing), Task 4 (`dispatch_reserve` returns `done` without sending when the state already matches) and Task 11 (dispatcher run over Going → Absent → Going sends nothing).
3. **The start instant, the deadline instant, and other time zones** — an answer at `starts_at` or later is refused with "answers are closed" (and the page shows the read-only state), an answer one second after the deadline is accepted and flagged, and a member whose browser is in another zone sees the meeting's zone plus "your time". Pinned in Task 3 (`answers_closed` when `starts_at <= now()`; `after_deadline` flag), Task 9 (closed state and "your time" line) and Task 2 (spring-forward wall time).
4. **Hostile or messy text in reasons, comments, names and titles** — `=HYPERLINK("…")`, `+1`, `@cmd`, `<script>`, newlines, quotes, commas and semicolons, accents, 600-character pastes: stored trimmed and capped at 500, shown as plain text on every screen, escaped in CSV/Excel (formula prefix), and escaped and folded in `.ics` (`\,` `\;` `\n`, 75-octet lines, `"` stripped from `CN`). Pinned in Task 3 (length check), Task 10 (`buildMeetingIcs` escaping and folding), Task 13 (rows render text, not HTML) and Task 15 (`escapeCell`).
5. **Paging while answers keep arriving** — a new answer, a new invitee or two people with the same name between page 1 and page 2 never cause a duplicate or a missing row. Pinned in Task 5 (meetings list keyset with equal `starts_at`) and Task 7 (`meeting_people` with equal names and a row inserted between pages).

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge this plan (docs PR); create the agent-task issues (Tracking) | — |
| 1 | Task 1 — #51: `Stagger` before hydration and the other M1 minors | 0 |
| 2 | Task 2 — #168: daily-cap loop, send budget vs `maxDuration`, spring-forward wall time | 0 |
| 3 | Task 3 — DB: `responses`, `response_history`, invitee calendar fields, `token_submit_response`, `token_request_calendar`, extended `token_invitee` | 0 |
| 4 | Task 4 — DB: `calendar_confirm` in `dispatch_claim` / `dispatch_reserve` / `dispatch_finish` / `dispatch_retry`; invite-only progress counts | 3 |
| 5 | Task 5 — Pagination foundation (#174) + paged Meetings list with answer counts (DB, API, hooks, UI, Home "needs attention") | 3 |
| 6 | Task 6 — Pagination: Settings members and invites; roster at 2,000 measured; old `list_meetings` dropped | 5 |
| 7 | Task 7 — DB: organizer reads (`meeting_results`, `meeting_people`, `contact_history`, `attendance_summary`, `attendance_details`) + plan checks | 3, 5 |
| 8 | Task 8 — Token API: answer and calendar routes, shared schemas, error codes, hooks | 3 |
| 9 | Task 9 — Answer page `/r/[token]` (choice cards, form, stamp, states) | 1, 8 |
| 10 | Task 10 — `.ics` builder, calendar confirmation email, MIME `icalEvent`, announcement button in the invite email | 0 |
| 11 | Task 11 — Dispatcher sends `calendar_confirm`; answer routes kick a dispatch | 2, 4, 8, 10 |
| 12 | Task 12 — Organizer API + hooks: results, people pages, history, attendance | 5, 7 |
| 13 | Task 13 — Meeting page: tiles, people list, delivery sheet, live refresh; Meetings cards and Home next-meeting card | 12 |
| 14 | Task 14 — Person history in the person sheet; Lists → Attendance view | 12 |
| 15 | Task 15 — Export: meeting answers and Attendance (CSV, Excel) | 13, 14 |
| 16 | Task 16 — Rollout: e2e story, S2 client checks, final review, production check, first real club send, spec §14 evidence | 1–15 |

Tasks 1, 2 and 10 are independent; Tasks 3 → 4 and 3 → 5 → 6 / 7 are chains; Tasks 8 → 9 and 12 → 13/14 → 15 are chains.

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–16 with the agent-task template, labels `type:task` + the area labels named in each task, milestone `M5 Responses (MVP)`, and add each as a sub-issue of epic #7:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/7/sub_issues -F sub_issue_id="$id"
```
- [ ] Tick "Plan written for M5" in epic #7's body.
- [ ] #51 → Task 1, #168 → Task 2, #174 → Tasks 5 and 6 (+ the M5 lists in Tasks 7, 12–14): comment on each with the task issue numbers; close each when its last task merges.
- [ ] Ledger: create `.superpowers/sdd/2026-10-08-m5-responses/progress.md` with `bash ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/sdd-workspace docs/superpowers/plans/2026-10-08-m5-responses.md`; one line per task and every `Ruling:`. Per task: `task-start` / `task-done` (`…/executing-plans/scripts/`), `task-done` only on an up-to-date `main` after verifying the merge.
- [ ] **Design rulings (2026-10-08)**, copied into the ledger: email buttons pre-select only; reasons for Late/Absent (optional when off); soft deadline with `after_deadline`; automatic calendar email via a final-state job; announcement calendar button; choice-card answer page; filter tiles; person history + Lists Attendance view; period chips default 3 months; roster/Audience/Attendance load-all (cap 2,000, measured in Task 6); Windows `Africa/Lagos` kept; no rollout flag; S2 checks with the Owner's four inboxes.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `src/components/motion/stagger.tsx` (+ test) | Entrance only after a client mount; server HTML fully visible | 1 |
| `src/instrumentation.ts`, `src/config/env.ts`, `src/config/public-env.ts`, `src/app/global-error.tsx`, `src/app/design/design-showcase.tsx`, `src/app/api/health/route.test.ts`, `e2e/smoke.spec.ts`, `src/components/ui/{chip,sticker}.tsx` | #51 minors | 1 |
| `src/server/dispatch/run-dispatch.ts`, `src/config/meetings.ts`, `src/config/gmail.ts`, `src/lib/meetings/format.ts` (+ tests) | #168 fixes | 2 |
| `supabase/migrations/*_m5_responses.sql` | Enums, invitee calendar columns, `responses`, `response_history`, `refresh_calendar_job`, `token_submit_response`, `token_request_calendar`, `token_invitee` | 3 |
| `src/server/db/responses.db.test.ts`, `src/test/db/invitees.ts` | Answer rules, history, calendar job refresh, RLS, `seedInvitee` | 3 |
| `supabase/migrations/*_m5_calendar_dispatch.sql` | Kind-aware `dispatch_claim` / `dispatch_reserve` / `dispatch_finish` / `dispatch_retry`; `meeting_progress` counts invites only | 4 |
| `src/server/db/calendar-dispatch.db.test.ts` | Add / remove / nothing decisions, unknown recorded, email status untouched | 4 |
| `src/config/pagination.ts`, `src/shared/api/pagination.ts`, `src/server/http/pagination.ts` | Page sizes, `pageSchema(item)`, cursor encode/decode, `readPageParams` | 5 |
| `src/hooks/use-paged-list.ts`, `src/components/ui/show-more.tsx` | `useInfiniteQuery` wrapper; "Show more" + end state | 5 |
| `supabase/migrations/*_m5_meetings_page.sql` | `meetings_page(workspace, tab, cursor…, limit)` with invite + answer counts; indexes | 5 |
| `src/app/api/workspaces/[slug]/meetings/route.ts`, `src/server/queries/meetings.ts`, `src/shared/api/meetings.ts`, `src/hooks/use-meetings.ts`, `src/app/w/[slug]/meetings/meetings-list.tsx`, `src/app/w/[slug]/needs-attention.tsx` | Paged Meetings list | 5 |
| `supabase/migrations/*_m5_members_invites_pages.sql` | `members_page`, `invites_page`, drop `list_meetings` | 6 |
| `src/app/api/workspaces/[slug]/{members,invites}/route.ts`, `src/hooks/{use-members,use-invites}.ts`, `src/app/w/[slug]/settings/{people-section,invites-panel,page}.tsx` | Paged Settings lists | 6 |
| `.superpowers/scripts/perf/roster-2000.ts` (git-ignored) | Roster load timing at 2,000 | 6 |
| `supabase/migrations/*_m5_results_reads.sql` | `meeting_results`, `meeting_people`, `contact_history`, `attendance_summary`, `attendance_details`, indexes | 7 |
| `src/server/db/results.db.test.ts`, `src/test/db/plans.ts` | Counts, filters, keyset boundaries, RLS, `planUsesIndex` | 7 |
| `src/shared/api/responses.ts` | Answer, token info (extended), results, people, history, attendance schemas | 8 |
| `src/server/queries/tokens.ts`, `src/app/api/r/[token]/{route,response/route,calendar/route}.ts`, `src/hooks/use-token-page.ts`, `src/shared/api/errors.ts` | Token API | 8 |
| `src/app/r/[token]/{page,answer-view,choice-card,answer-form,answer-summary,not-you}.tsx`, `src/lib/responses/choices.ts` | Answer page | 9 |
| `src/lib/calendar/ics.ts` (+ test) | `buildMeetingIcs` | 10 |
| `src/emails/calendar-confirm-email.tsx` (+ test), `src/emails/meeting-invite-email.tsx`, `src/server/gmail/mime.ts` | Calendar email, announcement button, MIME calendar part | 10 |
| `src/server/queries/dispatch.ts`, `src/server/dispatch/run-dispatch.ts` (+ tests) | Calendar jobs in the dispatcher | 11 |
| `src/server/queries/results.ts`, `src/app/api/workspaces/[slug]/meetings/[id]/{results,people}/route.ts`, `src/app/api/workspaces/[slug]/contacts/[id]/history/route.ts`, `src/app/api/workspaces/[slug]/attendance/{route,details/route}.ts`, `src/hooks/use-results.ts` | Organizer API | 12 |
| `src/app/w/[slug]/meetings/[id]/{page,result-tiles,people-list,delivery-sheet}.tsx`, `src/app/w/[slug]/next-meeting-card.tsx` | Meeting page results, Home card | 13 |
| `src/lib/responses/periods.ts`, `src/components/forms/period-chips.tsx`, `src/app/w/[slug]/lists/{contact-history,attendance-view}.tsx` | History and Attendance | 14 |
| `src/lib/export/{escape-cell,csv,xlsx,download}.ts`, `src/components/forms/export-menu.tsx` | Export | 15 |
| `e2e/responses.spec.ts`, `docs/spikes/S2.md` | M5 e2e story, S2 results | 16 |

---
### Task 1: #51 — `Stagger` before hydration and the other M1 minors

**Labels:** `type:task`, `area:design-system`, `area:config`, `area:observability`. Branch `fix/<issue>-m1-minors`.

**Files:**
- Modify: `src/components/motion/stagger.tsx`
- Create: `src/components/motion/stagger.test.tsx`
- Modify: `src/instrumentation.ts`, `src/config/env.ts`, `src/config/public-env.ts`, `src/sentry.server.config.ts`, `src/instrumentation-client.ts`
- Modify: `src/app/global-error.tsx`; Create: `src/app/global-error.test.tsx`
- Modify: `src/app/design/design-showcase.tsx`; its test if present (`src/app/design/design-showcase.test.tsx`)
- Modify: `src/app/api/health/route.test.ts`
- Modify: `e2e/design-system.spec.ts`
- Modify: `src/components/ui/chip.tsx`, `src/components/ui/sticker.tsx`

**Interfaces:**
- Produces: `Stagger` / `StaggerItem` keep their props; server HTML and the first client render have `opacity: 1` (no `initial="hidden"` until a client-side mount after hydration). Task 9 uses them on `/r/[token]`.
- Produces: `serverEnv.VERCEL_ENV` and `publicEnv.NEXT_PUBLIC_VERCEL_ENV` (`"production" | "preview" | "development"`, optional).

- [ ] **Step 1: Failing test — `Stagger` is visible in server HTML**

```tsx
// src/components/motion/stagger.test.tsx
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stagger, StaggerItem } from "./stagger";

describe("Stagger", () => {
  it("renders children fully visible on the server (no opacity 0 before hydration)", () => {
    const html = renderToString(
      <Stagger>
        <StaggerItem>Meeting card</StaggerItem>
      </Stagger>,
    );
    expect(html).toContain("Meeting card");
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it("still renders its children on the client", () => {
    render(
      <Stagger>
        <StaggerItem>Choice</StaggerItem>
      </Stagger>,
    );
    expect(screen.getByText("Choice")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`opacity:0` in the server HTML)

Run: `bun run test src/components/motion/stagger.test.tsx`

- [ ] **Step 3: Gate the entrance on a client-side mount** (same rule as `ConfirmStamp`: decided once at mount; SSR/hydration render the final state)

```tsx
// src/components/motion/stagger.tsx
"use client";

import { motion } from "motion/react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { STAGGER_SECONDS, springs } from "@/design/motion";
import { useIsClient } from "@/lib/use-is-client";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const AnimateEntrance = createContext(false);

/**
 * Container whose `StaggerItem` children rise in one after another. The entrance plays only when
 * the container mounts on the client after hydration; server HTML (and the hydrating render) is
 * the final, fully visible state, so content never sits at opacity 0 waiting for JavaScript (#51).
 * Reduced-motion users get no entrance.
 */
export function Stagger({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const isClient = useIsClient();
  const [entranceAllowed] = useState(isClient);
  const reduced = usePrefersReducedMotion();
  const animate = entranceAllowed && !reduced;
  return (
    <AnimateEntrance.Provider value={animate}>
      <motion.div
        className={className}
        initial={animate ? "hidden" : false}
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: STAGGER_SECONDS } },
        }}
      >
        {children}
      </motion.div>
    </AnimateEntrance.Provider>
  );
}

/** One staggered child. */
export function StaggerItem({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const animate = useContext(AnimateEntrance);
  return (
    <motion.div
      className={className}
      initial={animate ? "hidden" : false}
      variants={{
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0, transition: springs.enter },
      }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 4: Run it — expect PASS.** Also run `bun run test src/app/design` (the showcase uses `Stagger`).

- [ ] **Step 5: Server env validated at startup.** Failing test first:

```ts
// src/instrumentation.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

const getServerEnv = vi.fn();
vi.mock("@/config/env", () => ({ getServerEnv }));
vi.mock("./sentry.server.config", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  getServerEnv.mockReset();
});

describe("register", () => {
  it("validates the server env when the Node.js server starts", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("./instrumentation");
    await register();
    expect(getServerEnv).toHaveBeenCalledOnce();
  });

  it("fails startup with the env error", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    getServerEnv.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY: Required");
    });
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow("SUPABASE_SECRET_KEY");
  });
});
```

Then:

```ts
// src/instrumentation.ts
import * as Sentry from "@sentry/nextjs";
import { getServerEnv } from "@/config/env";

/**
 * Registers server-side instrumentation (Node.js runtime only; Edge is not used) and validates the
 * server env once at startup, so a missing or malformed variable fails the deploy instead of the
 * first request that needs it (#51).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    getServerEnv();
    await import("./sentry.server.config");
  }
}

/** Reports errors thrown while handling requests. */
export const onRequestError = Sentry.captureRequestError;
```

Check first that `next build` does not run `register()` without the env (CI's build job sets the env from `.env.ci` or GitHub vars; run `bun run build` locally with `.env.local` moved aside to confirm the build step itself does not call `register`). If CI's build fails because env is missing at build time, record a ruling and gate on `process.env.NEXT_PHASE !== "phase-production-build"`.

- [ ] **Step 6: `VERCEL_ENV` through config.** Add to `serverEnvSchema` in `src/config/env.ts`: `VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),` and to `publicEnvSchema`: `NEXT_PUBLIC_VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),` with the literal `NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV` entry. Replace `process.env.VERCEL_ENV ?? "development"` in `src/sentry.server.config.ts` with `getServerEnv().VERCEL_ENV ?? "development"` and `process.env.NEXT_PUBLIC_VERCEL_ENV` in `src/instrumentation-client.ts` with `publicEnv.NEXT_PUBLIC_VERCEL_ENV ?? "development"`. Extend `src/config/env.test.ts` / `public-env.test.ts` with one accepted and one rejected value (`"staging"` → error naming the variable).

- [ ] **Step 7: `global-error.tsx`: inline styles following the color scheme + retry.** Failing test:

```tsx
// src/app/global-error.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("GlobalError", () => {
  it("offers a retry that calls reset", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("styles itself without the app stylesheet, in light and dark", () => {
    const { container } = render(
      <GlobalError error={new Error("boom")} reset={vi.fn()} />,
    );
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain("prefers-color-scheme: dark");
  });
});
```

Implementation: keep the Sentry effect; render `<html lang="en"><head><style>{GLOBAL_ERROR_CSS}</style></head><body><main><p>{messages.Errors.global}</p><button type="button" onClick={() => reset()}>{messages.Errors.retry}</button></main></body></html>`, where `GLOBAL_ERROR_CSS` is a module constant built from `src/design/tokens.ts` values (background, ink, outline, primary fill; a `@media (prefers-color-scheme: dark)` block with the dark set; button 44 px min height, 2.5 px outline, 16 px radius). Add `"retry": "Try again"` under `Errors` in `messages/en.json`. Props type: `{ error: Error & { digest?: string }; reset: () => void }`.

- [ ] **Step 8: Showcase focus after Attend (WCAG 2.4.3).** In `design-showcase.tsx`, give the `ConfirmStamp` wrapper `tabIndex={-1}` and a ref; when `choice` becomes `"attend"`, focus it in the click handler's `requestAnimationFrame` callback (not in an effect: `react-hooks/set-state-in-effect`). Test in `design-showcase.test.tsx`: click "Attend", `await waitFor(() => expect(screen.getByRole("status").parentElement).toHaveFocus())`. Task 9 reuses the same pattern on the answer page.

- [ ] **Step 9: Silence the pino line in the health route test.** Add `vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));` at the top of `src/app/api/health/route.test.ts`, and assert `logger.error` was called once in the 503 case.

- [ ] **Step 10: No-flash e2e with a stored preference.** Add two cases to `e2e/design-system.spec.ts`, after the existing dark one:

```ts
test("a stored light preference wins over a dark OS on first paint", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  await context.addInitScript(() => window.localStorage.setItem("theme", "light"));
  const page = await context.newPage();
  await page.goto("/design", { waitUntil: "commit" });
  await page.waitForSelector("body");
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe("rgb(243, 238, 255)");
  await context.close();
});

test("a stored dark preference wins over a light OS on first paint", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  await context.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  const page = await context.newPage();
  await page.goto("/design", { waitUntil: "commit" });
  await page.waitForSelector("body");
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe("rgb(22, 19, 31)");
  await context.close();
});
```

(`next-themes` stores the choice under `theme` by default; `#F3EEFF` = `rgb(243, 238, 255)`, `#16131F` = `rgb(22, 19, 31)`.)

- [ ] **Step 11: Chip/Sticker border width.** Ruling: align both to the 2.5 px token, like cards and the public meeting card. Replace `border-2` with `border-[length:var(--tn-border-width)]` in `chip.tsx` and `sticker.tsx`. Screenshot `/design` and one Lists page at 390 light / 320 dark / 1024 and compare before/after; if a 2.5 px sticker looks blurry at `size="sm"`, keep `sm` at 2 px and record it.

- [ ] **Step 12: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:e2e e2e/design-system.spec.ts`
Expected: all pass. Tick every #51 box (or mark won't-fix with a reason) in the PR body; `Closes #51` in the PR.

```bash
git add -A && git commit -m "fix: #51 M1 minors (Stagger visible before hydration, env at startup, global error page)"
```

---

### Task 2: #168 — daily-cap loop, send budget vs `maxDuration`, spring-forward wall time

**Labels:** `type:task`, `area:pipeline`, `area:frontend`. Branch `fix/<issue>-m4-minors`.

**Files:**
- Modify: `src/server/dispatch/run-dispatch.ts`, `src/server/dispatch/run-dispatch.test.ts`
- Modify: `src/config/meetings.ts`; Create: `src/config/meetings.test.ts` (or extend)
- Modify: `src/lib/meetings/format.ts`, `src/lib/meetings/format.test.ts`

**Interfaces:**
- Produces: on `reserve` → `quota`, `runDispatch` calls `store.deferSender(run, connectionId, new Date(retryAt), "quota")` and moves on to the next sender (no re-claim of the same sender in that run).
- Produces: `DISPATCH_MAX_DURATION_S` (60), `DISPATCH_SAFETY_MARGIN_MS` (5_000), `DISPATCH_BUDGET_MS` (35_000) with the invariant `DISPATCH_BUDGET_MS + GMAIL_SEND_TIMEOUT_MS + DISPATCH_SAFETY_MARGIN_MS <= DISPATCH_MAX_DURATION_S * 1000`. Route files keep the literal `export const maxDuration = 60;` (Next reads it statically); a test asserts it equals `DISPATCH_MAX_DURATION_S` (Step 5). Task 8's answer routes export the same literal.
- Produces: `zonedWallTimeToUtc` builds the instant from numbers, never through the browser's own zone.

- [ ] **Step 1: Failing test — daily cap defers the whole sender once**

Add to `src/server/dispatch/run-dispatch.test.ts` (reuse the file's existing fake store/deps builders; names below match them — check the top of the file and adapt):

```ts
it("on the daily cap, defers all of that sender's jobs once and does not re-claim it", async () => {
  const claims = [claimWith(["j1", "j2", "j3"]), null];
  const store = fakeStore({
    claim: vi.fn(async () => claims.shift() ?? null),
    reserve: vi.fn(async () => ({ kind: "quota" as const, retryAt: "2026-10-09T08:00:00.000Z" })),
  });
  const deps = fakeDeps({ store });
  const summary = await runDispatch(deps, OPTIONS);
  expect(store.deferSender).toHaveBeenCalledOnce();
  expect(store.deferSender).toHaveBeenCalledWith(
    expect.any(String),
    CONNECTION_ID,
    new Date("2026-10-09T08:00:00.000Z"),
    "quota",
  );
  expect(store.reserve).toHaveBeenCalledOnce();
  expect(deps.refresh).toHaveBeenCalledOnce();
  expect(summary.deferred).toBe(1);
});
```

- [ ] **Step 2: Run — expect FAIL** (today it calls `unclaim`, then the next round re-claims).

Run: `bun run test src/server/dispatch/run-dispatch.test.ts`

- [ ] **Step 3: Implement.** In `drainSender`, replace the `quota` branch:

```ts
    if (reservation.kind === "quota") {
      summary.deferred += 1;
      // Every due job of this sender would hit the same cap: push them all to the window's
      // reopening in one call, so the next round claims another sender instead (#168).
      await deps.store.deferSender(
        run,
        claim.connection.id,
        new Date(reservation.retryAt),
        "quota",
      );
      return;
    }
```

`dispatch_defer_sender` already moves this run's processing jobs and the sender's pending jobs to `p_until`, restores `attempts` and drops their `send_log` rows (none exist for unstarted jobs). The reserved job was already set to `retry_at` by `dispatch_reserve`.

- [ ] **Step 4: Run — expect PASS**; the existing "quota unclaims the rest" test must be updated to the new expectation (delete its `unclaim` assertion, keep its job-count assertion).

- [ ] **Step 5: Failing test — the send budget fits `maxDuration`**

```ts
// src/config/meetings.test.ts
import { describe, expect, it } from "vitest";
import { GMAIL_SEND_TIMEOUT_MS } from "./gmail";
import {
  DISPATCH_BUDGET_MS,
  DISPATCH_MAX_DURATION_S,
  DISPATCH_SAFETY_MARGIN_MS,
} from "./meetings";
import { maxDuration as dispatchRouteMax } from "@/app/api/internal/dispatch/route";
import { maxDuration as sendRouteMax } from "@/app/api/workspaces/[slug]/meetings/[id]/send/route";

describe("dispatch timing", () => {
  it("never starts a send that could outlive the function", () => {
    expect(
      DISPATCH_BUDGET_MS + GMAIL_SEND_TIMEOUT_MS + DISPATCH_SAFETY_MARGIN_MS,
    ).toBeLessThanOrEqual(DISPATCH_MAX_DURATION_S * 1000);
  });

  it("routes that run the dispatcher use the same maxDuration", () => {
    expect(dispatchRouteMax).toBe(DISPATCH_MAX_DURATION_S);
    expect(sendRouteMax).toBe(DISPATCH_MAX_DURATION_S);
  });
});
```

(Importing the route modules in a unit test needs their `server-only` imports stubbed; vitest already aliases `server-only` to `src/test/server-only-stub.ts`. If importing a route pulls in Supabase clients that need env, mock `@/server/dispatch/schedule-dispatch` in this test.)

- [ ] **Step 6: Run — expect FAIL** (50 000 + 20 000 + 5 000 > 60 000).

- [ ] **Step 7: Implement** in `src/config/meetings.ts`:

```ts
/** The dispatcher routes' `maxDuration` (seconds); route files repeat it as a literal (Next needs one). */
export const DISPATCH_MAX_DURATION_S = 60;
/** Room for the last send's bookkeeping after Gmail answers. */
export const DISPATCH_SAFETY_MARGIN_MS = 5_000;
/**
 * A run starts no new send after this long, so the slowest send (Gmail timeout) still finishes
 * before the function is stopped (#168): 35 s + 20 s + 5 s = 60 s.
 */
export const DISPATCH_BUDGET_MS = 35_000;
```

(Delete the old `DISPATCH_BUDGET_MS = 50_000` line and its comment.) Ruling for the ledger: `Task 2: Ruling: budget 50 s → 35 s (sends start only while a 20 s Gmail timeout still fits in 60 s) — a send killed mid-flight becomes "Delivery unknown" and loses the thread id — about 35 sends per run instead of 50; 500 invites take ~15 min instead of ~9.`

- [ ] **Step 8: Run — expect PASS.**

- [ ] **Step 9: Failing test — spring-forward in the browser's zone**

```ts
// src/lib/meetings/format.test.ts (add)
it("keeps the picked wall time when the browser's own zone skips that hour", () => {
  vi.stubEnv("TZ", "Europe/Paris");
  // 29 Mar 2026 02:30 does not exist in Paris (clocks jump 02:00 → 03:00) but does in Tunis.
  expect(
    zonedWallTimeToUtc({ date: "2026-03-29", time: "02:30", timezone: "Africa/Tunis" }),
  ).toBe("2026-03-29T01:30:00.000Z");
  vi.unstubAllEnvs();
});
```

If changing `TZ` at runtime does not affect `Date` in the vitest worker, run this case in a child process instead: `execFileSync("bun", ["-e", script], { env: { ...process.env, TZ: "Europe/Paris" } })` printing the result, and assert on stdout.

- [ ] **Step 10: Run — expect FAIL** (`2026-03-29T02:30:00.000Z`).

- [ ] **Step 11: Implement**:

```ts
/** The UTC instant of a wall-clock date + time in `timezone` (what the pickers store). */
export function zonedWallTimeToUtc(input: {
  date: string;
  time: string;
  timezone: string;
}): string {
  // Numbers straight into TZDate: parsing first would go through the browser's own zone, which
  // can shift a time that does not exist there (spring forward, #168).
  const [year, month, day] = input.date.split("-").map(Number);
  const [hours, minutes] = input.time.split(":").map(Number);
  const zoned = new TZDate(year, month - 1, day, hours, minutes, input.timezone);
  // TZDate#toISOString() keeps the zone's offset ("…+01:00"); the API stores UTC ("…Z").
  return new Date(zoned.getTime()).toISOString();
}
```

Remove the now-unused `parse` import if nothing else uses it.

- [ ] **Step 12: Run — expect PASS**, plus the existing Review Focus 4 tests from M4 (Tunis/Paris, 25 Oct).

- [ ] **Step 13: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db`
Expected: PASS. `Closes #168`.

```bash
git add -A && git commit -m "fix: #168 dispatcher cap loop, send budget, spring-forward wall time"
```

---
### Task 3: DB — `responses`, `response_history`, invitee calendar fields, `token_submit_response`, `token_request_calendar`, extended `token_invitee`

**Labels:** `type:task`, `area:db`. Branch `feat/<issue>-responses-db`.

**Files:**
- Create: `supabase/migrations/<timestamp>_m5_responses.sql` (`supabase migration new m5_responses </dev/null`)
- Create: `src/test/db/invitees.ts`
- Create: `src/server/db/responses.db.test.ts`
- Modify: `src/server/db/database.types.ts` (`bun run db:types`)
- Modify: `src/server/db/tokens.db.test.ts` (the `token_invitee` shape gains fields; keep its assertions passing)

**Interfaces:**
- Produces (SQL, service role only):
  - `public.token_submit_response(p_token_hash text, p_status public.response_status, p_delay_minutes integer default null, p_reason text default null, p_comment text default null) returns jsonb` — `null` for an unknown token; otherwise `{status, delay_minutes, reason, comment, after_deadline, responded_at, updated_at}`. Raises `tn:answers_closed`, `tn:invalid_choice`, `tn:delay_required`, `tn:reason_required`.
  - `public.token_request_calendar(p_token_hash text) returns boolean` — `false` for an unknown token. Raises `tn:invalid_choice` (not an announcement), `tn:answers_closed`.
  - `public.token_invitee(p_token_hash text) returns jsonb` — M4 fields plus `full_name`, `answers` (`{response_mode, delay_options, reason_required, comments_enabled, footer_note, response_deadline}`), `answer` (same shape as above or `null`), `calendar_requested` (boolean).
- Produces (tables): `public.responses`, `public.response_history`; `meeting_invitees.calendar_state` (`none|added`), `calendar_sequence` (int ≥ 0), `calendar_requested_at`; enum `public.response_status` (`attending|late|absent|not_attending`), enum `public.calendar_state`.
- Produces (helper): `private.refresh_calendar_job(p_invitee uuid, p_workspace uuid) returns void` (service role).
- Produces (test helper): `seedInvitee(workspaceId, meetingId, contactId, options?) → Promise<{ inviteeId: string; hash: string }>` in `src/test/db/invitees.ts`.

- [ ] **Step 1: Test helper**

```ts
// src/test/db/invitees.ts
import { adminClient } from "./clients";

/**
 * Inserts an invitee with a known token hash (service role), as if its invite email went out.
 * Returns the invitee id and the hash to call the token functions with.
 */
export async function seedInvitee(
  workspaceId: string,
  meetingId: string,
  contactId: string,
  options: {
    emailStatus?: "queued" | "sent" | "skipped" | "failed" | "unknown";
  } = {},
): Promise<{ inviteeId: string; hash: string }> {
  const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
  const { data, error } = await adminClient()
    .from("meeting_invitees")
    .insert({
      workspace_id: workspaceId,
      meeting_id: meetingId,
      contact_id: contactId,
      token_hash: hash,
      email_status: options.emailStatus ?? "sent",
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return { inviteeId: data.id, hash };
}
```

- [ ] **Step 2: Failing DB tests**

```ts
// src/server/db/responses.db.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  anonClient,
  createTestUser,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { seedContacts } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let contact: string;
let invitee: string;
let hash: string;

const answerSchema = z.object({
  status: z.enum(["attending", "late", "absent", "not_attending"]),
  delay_minutes: z.number().int().nullable(),
  reason: z.string(),
  comment: z.string(),
  after_deadline: z.boolean(),
  responded_at: z.string(),
  updated_at: z.string(),
});

async function submit(
  args: Partial<{
    p_status: string;
    p_delay_minutes: number | null;
    p_reason: string | null;
    p_comment: string | null;
  }> & { p_token_hash?: string },
) {
  return adminClient().rpc("token_submit_response", {
    p_token_hash: hash,
    p_status: "attending",
    p_delay_minutes: null,
    p_reason: null,
    p_comment: null,
    ...args,
  } as never);
}

async function setMeeting(fields: Record<string, string | boolean | null>) {
  const { error } = await adminClient()
    .from("meetings")
    .update(fields as never)
    .eq("id", meeting);
  if (error) {
    throw error;
  }
}

async function calendarJobs() {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .select("id, status, run_after, idempotency_key")
    .eq("invitee_id", invitee)
    .eq("kind", "calendar_confirm");
  if (error) {
    throw error;
  }
  return data;
}

async function historyCount() {
  const { count, error } = await adminClient()
    .from("response_history")
    .select("id", { count: "exact", head: true })
    .eq("invitee_id", invitee);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Answer Club");
  [contact] = await seedContacts(
    workspace.id,
    1,
    `ans-${crypto.randomUUID().slice(0, 6)}`,
  );
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  ({ inviteeId: invitee, hash } = await seedInvitee(
    workspace.id,
    meeting,
    contact,
  ));
});

describe("token_submit_response", () => {
  it("saves Going with no reason, writes history and queues one calendar job", async () => {
    const { data, error } = await submit({ p_status: "attending", p_reason: "ignored" });
    expect(error).toBeNull();
    const answer = answerSchema.parse(data);
    expect(answer).toMatchObject({ status: "attending", delay_minutes: null, reason: "", after_deadline: false });
    expect(await historyCount()).toBe(1);
    const jobs = await calendarJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("pending");
    expect(new Date(jobs[0].run_after).getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it("returns null for an unknown token", async () => {
    const { data, error } = await submit({ p_token_hash: "f".repeat(64) });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("requires a delay from the meeting's options for Late", async () => {
    expect((await submit({ p_status: "late", p_reason: "Bus" })).error?.message).toBe("tn:delay_required");
    expect((await submit({ p_status: "late", p_delay_minutes: 7, p_reason: "Bus" })).error?.message).toBe("tn:delay_required");
    const ok = await submit({ p_status: "late", p_delay_minutes: 10, p_reason: "Bus" });
    expect(answerSchema.parse(ok.data)).toMatchObject({ status: "late", delay_minutes: 10, reason: "Bus" });
  });

  it("requires a reason for Late and Absent when the meeting asks for one", async () => {
    expect((await submit({ p_status: "absent", p_reason: "   " })).error?.message).toBe("tn:reason_required");
    await setMeeting({ reason_required: false });
    const ok = await submit({ p_status: "absent", p_reason: "  " });
    expect(answerSchema.parse(ok.data)).toMatchObject({ status: "absent", reason: "" });
  });

  it("accepts only the choices of the meeting's mode", async () => {
    expect((await submit({ p_status: "not_attending" })).error?.message).toBe("tn:invalid_choice");
    await setMeeting({ response_mode: "rsvp" });
    expect((await submit({ p_status: "late", p_delay_minutes: 10, p_reason: "x" })).error?.message).toBe("tn:invalid_choice");
    expect((await submit({ p_status: "not_attending", p_reason: "Exam" })).error).toBeNull();
    await setMeeting({ response_mode: "announcement" });
    expect((await submit({ p_status: "attending" })).error?.message).toBe("tn:invalid_choice");
  });

  it("keeps a comment only when the meeting allows comments", async () => {
    const off = await submit({ p_comment: "See you" });
    expect(answerSchema.parse(off.data).comment).toBe("");
    await setMeeting({ comments_enabled: true });
    const on = await submit({ p_comment: "  See you  " });
    expect(answerSchema.parse(on.data).comment).toBe("See you");
  });

  it("refuses reasons or comments over 500 characters", async () => {
    const { error } = await submit({ p_status: "absent", p_reason: "x".repeat(501) });
    expect(error?.code).toBe("23514");
  });

  it("is closed once the meeting has started (Review Focus 3)", async () => {
    await setMeeting({ starts_at: new Date(Date.now() - 1000).toISOString() });
    expect((await submit({})).error?.message).toBe("tn:answers_closed");
  });

  it("is closed for a cancelled or draft meeting", async () => {
    await setMeeting({ status: "cancelled" });
    expect((await submit({})).error?.message).toBe("tn:answers_closed");
  });

  it("flags an answer saved after the deadline but still accepts it (Review Focus 3)", async () => {
    await setMeeting({ response_deadline: new Date(Date.now() - 1000).toISOString() });
    const late = await submit({ p_status: "attending" });
    expect(answerSchema.parse(late.data).after_deadline).toBe(true);
  });

  it("changes the answer in place, appends history, keeps one pending job", async () => {
    await submit({ p_status: "attending" });
    const first = (await calendarJobs())[0];
    await submit({ p_status: "absent", p_reason: "Sick" });
    const { data } = await adminClient().from("responses").select("status, responded_at, updated_at").eq("invitee_id", invitee).single();
    expect(data?.status).toBe("absent");
    expect(await historyCount()).toBe(2);
    const jobs = await calendarJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(first.id);
    expect(new Date(jobs[0].run_after).getTime()).toBeGreaterThanOrEqual(new Date(first.run_after).getTime());
  });

  it("ignores an identical re-save (no history row, no job change) (Review Focus 2)", async () => {
    await submit({ p_status: "late", p_delay_minutes: 10, p_reason: "Bus" });
    const before = await calendarJobs();
    await submit({ p_status: "late", p_delay_minutes: 10, p_reason: " Bus " });
    expect(await historyCount()).toBe(1);
    expect(await calendarJobs()).toEqual(before);
  });

  it("serializes concurrent saves: one answer row, one pending job (Review Focus 2)", async () => {
    const results = await Promise.all([
      submit({ p_status: "attending" }),
      submit({ p_status: "absent", p_reason: "Sick" }),
      submit({ p_status: "late", p_delay_minutes: 5, p_reason: "Bus" }),
    ]);
    expect(results.every((r) => r.error === null)).toBe(true);
    const { count } = await adminClient().from("responses").select("id", { count: "exact", head: true }).eq("invitee_id", invitee);
    expect(count).toBe(1);
    expect(await historyCount()).toBe(3);
    expect((await calendarJobs()).filter((j) => j.status === "pending")).toHaveLength(1);
  });

  it("refreshes a paused calendar job instead of adding a second one", async () => {
    await submit({ p_status: "attending" });
    const [job] = await calendarJobs();
    await adminClient().from("outbox_jobs").update({ status: "paused" }).eq("id", job.id);
    await submit({ p_status: "absent", p_reason: "Sick" });
    const jobs = await calendarJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("paused");
  });
});

describe("token_request_calendar", () => {
  it("records the request for an announcement and queues a calendar job", async () => {
    await setMeeting({ response_mode: "announcement" });
    const { data, error } = await adminClient().rpc("token_request_calendar", { p_token_hash: hash });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: row } = await adminClient().from("meeting_invitees").select("calendar_requested_at").eq("id", invitee).single();
    expect(row?.calendar_requested_at).not.toBeNull();
    expect(await calendarJobs()).toHaveLength(1);
  });

  it("is only for announcements, and closed after the start", async () => {
    expect((await adminClient().rpc("token_request_calendar", { p_token_hash: hash })).error?.message).toBe("tn:invalid_choice");
    await setMeeting({ response_mode: "announcement", starts_at: new Date(Date.now() - 1000).toISOString() });
    expect((await adminClient().rpc("token_request_calendar", { p_token_hash: hash })).error?.message).toBe("tn:answers_closed");
  });

  it("returns false for an unknown token", async () => {
    const { data } = await adminClient().rpc("token_request_calendar", { p_token_hash: "e".repeat(64) });
    expect(data).toBe(false);
  });
});

describe("token_invitee (M5 fields)", () => {
  it("returns the answer settings, the holder's name and the current answer", async () => {
    await submit({ p_status: "late", p_delay_minutes: 15, p_reason: "Bus" });
    const { data } = await adminClient().rpc("token_invitee", { p_token_hash: hash });
    expect(data).toMatchObject({
      full_name: expect.any(String),
      calendar_requested: false,
      answers: {
        response_mode: "attendance",
        delay_options: [5, 10, 15, 30],
        reason_required: true,
        comments_enabled: false,
        footer_note: "",
        response_deadline: null,
      },
      answer: { status: "late", delay_minutes: 15, reason: "Bus" },
    });
  });
});

describe("responses RLS", () => {
  it("lets Owner, Admin and Viewer read answers; nobody writes; no cross-workspace reads", async () => {
    await submit({ p_status: "absent", p_reason: "Sick" });
    const admin = await createTestUser();
    const viewer = await createTestUser();
    const outsider = await createTestUser();
    await addMember(workspace.id, admin.id, "admin");
    await addMember(workspace.id, viewer.id, "viewer");
    await createWorkspaceAs(outsider, "Other Club");
    for (const member of [owner, admin, viewer]) {
      const { data } = await member.client.from("responses").select("reason").eq("invitee_id", invitee);
      expect(data).toEqual([{ reason: "Sick" }]);
      const history = await member.client.from("response_history").select("id").eq("invitee_id", invitee);
      expect(history.data).toHaveLength(1);
    }
    expect((await outsider.client.from("responses").select("id").eq("invitee_id", invitee)).data).toEqual([]);
    expect((await anonClient().from("responses").select("id")).error?.code).toBe("42501");
    const write = await owner.client.from("responses").update({ reason: "x" }).eq("invitee_id", invitee).select("id");
    expect(write.error?.code ?? (write.data?.length === 0 ? "none" : "updated")).not.toBe("updated");
    const insert = await owner.client.from("response_history").insert({} as never);
    expect(insert.error).not.toBeNull();
  });

  it("does not let signed-in users call the token write functions", async () => {
    const { error } = await owner.client.rpc("token_submit_response", {
      p_token_hash: hash,
      p_status: "attending",
      p_delay_minutes: null,
      p_reason: null,
      p_comment: null,
    } as never);
    expect(error?.code).toBe("42501");
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (functions and tables don't exist).

Run: `bun run test:db src/server/db/responses.db.test.ts`

- [ ] **Step 4: Migration**

```sql
-- M5 responses (spec §4, §6, §7.3, §8): members answer only through their personal link; the
-- token routes call these service-role functions, which validate the answer against the meeting,
-- write the answer and its history row, and refresh the person's calendar job in one transaction.

insert into private.app_limits (name, value) values ('calendar_confirm_delay_seconds', 60);

create type public.response_status as enum ('attending', 'late', 'absent', 'not_attending');
create type public.calendar_state as enum ('none', 'added');

alter table public.meeting_invitees
  add column calendar_state public.calendar_state not null default 'none',
  add column calendar_sequence integer not null default 0 check (calendar_sequence >= 0),
  add column calendar_requested_at timestamptz;

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  meeting_id uuid not null,
  invitee_id uuid not null unique references public.meeting_invitees (id) on delete cascade,
  status public.response_status not null,
  delay_minutes smallint check (delay_minutes between 1 and 240),
  reason text not null default '' check (reason = btrim(reason) and char_length(reason) <= 500),
  comment text not null default '' check (comment = btrim(comment) and char_length(comment) <= 500),
  after_deadline boolean not null default false,
  needs_reconfirmation boolean not null default false,
  responded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'late') = (delay_minutes is not null)),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade
);
create index responses_meeting_ws_idx on public.responses (meeting_id, workspace_id);
create index responses_workspace_idx on public.responses (workspace_id);

create table public.response_history (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  invitee_id uuid not null references public.meeting_invitees (id) on delete cascade,
  response_id uuid not null references public.responses (id) on delete cascade,
  status public.response_status not null,
  delay_minutes smallint,
  reason text not null default '',
  comment text not null default '',
  after_deadline boolean not null,
  changed_at timestamptz not null default now()
);
create index response_history_invitee_idx on public.response_history (invitee_id, changed_at);
create index response_history_response_idx on public.response_history (response_id);
create index response_history_meeting_idx on public.response_history (meeting_id);
create index response_history_workspace_idx on public.response_history (workspace_id);

alter table public.responses enable row level security;
alter table public.response_history enable row level security;
revoke all on table public.responses, public.response_history from anon, authenticated;
grant select on table public.responses, public.response_history to authenticated;
grant all on table public.responses, public.response_history to service_role;
create policy responses_select_members on public.responses
  for select to authenticated using (private.is_member(workspace_id));
create policy response_history_select_members on public.response_history
  for select to authenticated using (private.is_member(workspace_id));

-- One pending (or paused) calendar job per person, pushed back on every save (spec §8). The caller
-- holds the invitee row lock, so two saves for one person never both insert.
create function private.refresh_calendar_job(p_invitee uuid, p_workspace uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_due timestamptz := pg_catalog.now()
    + pg_catalog.make_interval(secs => private.app_limit('calendar_confirm_delay_seconds'));
begin
  update public.outbox_jobs
  set run_after = v_due, last_error = null
  where invitee_id = p_invitee and kind = 'calendar_confirm' and status in ('pending', 'paused');
  if not found then
    insert into public.outbox_jobs (kind, workspace_id, invitee_id, idempotency_key, run_after)
    values ('calendar_confirm', p_workspace, p_invitee,
      'calendar:' || p_invitee::text || ':' || gen_random_uuid()::text, v_due);
  end if;
end;
$$;
revoke execute on function private.refresh_calendar_job(uuid, uuid) from public, anon, authenticated;
grant execute on function private.refresh_calendar_job(uuid, uuid) to service_role;

create function public.token_submit_response(
  p_token_hash text,
  p_status public.response_status,
  p_delay_minutes integer default null,
  p_reason text default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v record;
  v_delay smallint;
  v_reason text;
  v_comment text;
  v_after boolean;
  v_old public.responses;
  v_new public.responses;
begin
  select i.id as invitee_id, i.workspace_id, i.meeting_id, m.status, m.starts_at, m.response_mode,
    m.delay_options, m.reason_required, m.comments_enabled, m.response_deadline
  into v
  from public.meeting_invitees i
  join public.meetings m on m.id = i.meeting_id
  where i.token_hash = p_token_hash
  for update of i;
  if v.invitee_id is null then
    return null;
  end if;
  if v.status <> 'scheduled' or v.starts_at is null or v.starts_at <= pg_catalog.now() then
    raise exception 'tn:answers_closed' using errcode = 'P0001';
  end if;
  if (v.response_mode = 'attendance' and p_status not in ('attending', 'late', 'absent'))
    or (v.response_mode = 'rsvp' and p_status not in ('attending', 'not_attending'))
    or v.response_mode = 'announcement' then
    raise exception 'tn:invalid_choice' using errcode = 'P0001';
  end if;
  if p_status = 'late' then
    if p_delay_minutes is null or not (p_delay_minutes::smallint = any (v.delay_options)) then
      raise exception 'tn:delay_required' using errcode = 'P0001';
    end if;
    v_delay := p_delay_minutes::smallint;
  end if;
  v_reason := case when p_status = 'attending' then '' else pg_catalog.btrim(coalesce(p_reason, '')) end;
  if p_status <> 'attending' and v.reason_required and v_reason = '' then
    raise exception 'tn:reason_required' using errcode = 'P0001';
  end if;
  v_comment := case when v.comments_enabled then pg_catalog.btrim(coalesce(p_comment, '')) else '' end;
  v_after := v.response_deadline is not null and pg_catalog.now() > v.response_deadline;

  select * into v_old from public.responses r where r.invitee_id = v.invitee_id;
  if v_old.id is not null
    and v_old.status = p_status
    and v_old.delay_minutes is not distinct from v_delay
    and v_old.reason = v_reason
    and v_old.comment = v_comment then
    v_new := v_old;
  else
    insert into public.responses (workspace_id, meeting_id, invitee_id, status, delay_minutes, reason, comment, after_deadline)
    values (v.workspace_id, v.meeting_id, v.invitee_id, p_status, v_delay, v_reason, v_comment, v_after)
    on conflict (invitee_id) do update
      set status = excluded.status, delay_minutes = excluded.delay_minutes, reason = excluded.reason,
        comment = excluded.comment, after_deadline = excluded.after_deadline, updated_at = pg_catalog.now()
    returning * into v_new;
    insert into public.response_history (workspace_id, meeting_id, invitee_id, response_id, status, delay_minutes,
      reason, comment, after_deadline)
    values (v.workspace_id, v.meeting_id, v.invitee_id, v_new.id, v_new.status, v_new.delay_minutes, v_new.reason,
      v_new.comment, v_new.after_deadline);
    perform private.refresh_calendar_job(v.invitee_id, v.workspace_id);
  end if;

  return pg_catalog.jsonb_build_object(
    'status', v_new.status, 'delay_minutes', v_new.delay_minutes, 'reason', v_new.reason,
    'comment', v_new.comment, 'after_deadline', v_new.after_deadline,
    'responded_at', v_new.responded_at, 'updated_at', v_new.updated_at
  );
end;
$$;
revoke execute on function public.token_submit_response(text, public.response_status, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.token_submit_response(text, public.response_status, integer, text, text)
  to service_role;

create function public.token_request_calendar(p_token_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v record;
begin
  select i.id as invitee_id, i.workspace_id, i.calendar_requested_at, m.status, m.starts_at, m.response_mode
  into v
  from public.meeting_invitees i
  join public.meetings m on m.id = i.meeting_id
  where i.token_hash = p_token_hash
  for update of i;
  if v.invitee_id is null then
    return false;
  end if;
  if v.response_mode <> 'announcement' then
    raise exception 'tn:invalid_choice' using errcode = 'P0001';
  end if;
  if v.status <> 'scheduled' or v.starts_at is null or v.starts_at <= pg_catalog.now() then
    raise exception 'tn:answers_closed' using errcode = 'P0001';
  end if;
  if v.calendar_requested_at is null then
    update public.meeting_invitees set calendar_requested_at = pg_catalog.now() where id = v.invitee_id;
    perform private.refresh_calendar_job(v.invitee_id, v.workspace_id);
  end if;
  return true;
end;
$$;
revoke execute on function public.token_request_calendar(text) from public, anon, authenticated;
grant execute on function public.token_request_calendar(text) to service_role;

-- token_invitee: latest body from 20261008152332_m4_online_place.sql plus the answer page's fields.
create or replace function public.token_invitee(p_token_hash text)
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
    'full_name', c.full_name,
    'unsubscribed', c.unsubscribed_at is not null,
    'reported', c.unsubscribed_via is not distinct from 'report',
    'calendar_requested', i.calendar_requested_at is not null,
    'meeting', pg_catalog.jsonb_build_object(
      'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone, 'duration_minutes', m.duration_minutes,
      'location_mode', m.location_mode, 'location_text', m.location_text, 'online_text', m.online_text,
      'meeting_url', m.meeting_url, 'agenda_md', m.agenda_md,
      'status', m.status
    ),
    'answers', pg_catalog.jsonb_build_object(
      'response_mode', m.response_mode, 'delay_options', m.delay_options, 'reason_required', m.reason_required,
      'comments_enabled', m.comments_enabled, 'footer_note', m.footer_note, 'response_deadline', m.response_deadline
    ),
    'answer', case when r.id is null then null else pg_catalog.jsonb_build_object(
      'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
      'after_deadline', r.after_deadline, 'responded_at', r.responded_at, 'updated_at', r.updated_at
    ) end
  )
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.responses r on r.invitee_id = i.id
  where i.token_hash = p_token_hash;
$$;
```

Note: `token_invitee` keeps its M4 grants (`create or replace` keeps them). It now also returns `agenda_md` (the answer page shows the agenda folded); the agenda is rendered with `renderAgendaHtml` on the client (safe subset).

- [ ] **Step 5: Apply locally and regenerate types**

Run: `supabase migration up --local </dev/null && bun run db:types && supabase db advisors --local </dev/null`
Expected: migration applied; advisors print no WARN/ERROR (if the "unindexed foreign keys" lint names `responses (meeting_id, workspace_id)`, it is covered by `responses_meeting_ws_idx`; if it names another FK, add its index).

- [ ] **Step 6: Run — expect PASS**

Run: `bun run test:db src/server/db/responses.db.test.ts src/server/db/tokens.db.test.ts src/server/db/function-security.db.test.ts`

If the RLS "nobody writes" assertion is awkward (an `update` without a grant returns `42501`), simplify it to `expect(write.error?.code).toBe("42501")` once you see the actual behavior; the point is that no row changes (re-read the reason with the admin client and assert it is still `"Sick"`).

- [ ] **Step 7: Ledger.** The spec wording was aligned in the plan's docs PR. Ledger: `Task 3: Ruling: token write functions follow the M4 public/service-role pattern, and the calendar job is refreshed under the invitee row lock instead of a unique partial index — a partial unique index on pending jobs would make every processing → pending path (retry, unclaim, quota, lease loss) able to violate it — none.`

- [ ] **Step 8: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db`

```bash
git add -A && git commit -m "feat: responses tables and token answer functions (M5)"
```

After merge: `bash .superpowers/scripts/hosted-push.sh` (record advisors in the ledger).

---
### Task 4: DB — `calendar_confirm` in the dispatcher functions; invite-only progress counts

**Labels:** `type:task`, `area:db`, `area:pipeline`, `area:calendar`. Branch `feat/<issue>-calendar-dispatch-db`.

**Files:**
- Create: `supabase/migrations/<timestamp>_m5_calendar_dispatch.sql`
- Create: `src/server/db/calendar-dispatch.db.test.ts`
- Modify: `src/server/db/database.types.ts`
- Modify: `src/server/db/outbox.db.test.ts` only if an existing assertion reads the exact claim JSON keys (add the new keys)

**Interfaces:**
- Consumes: Task 3's `responses`, `meeting_invitees.calendar_state/calendar_sequence/calendar_requested_at`, `token_submit_response`, `refresh_calendar_job`.
- Produces: `dispatch_claim` job objects gain `kind` (`"invite" | "calendar_confirm"`) and `meeting.ics_uid`.
- Produces: `dispatch_reserve(p_job, p_token_hash)` returns, for calendar jobs, `{ kind: "ok", calendar: { action: "request" | "cancel", sequence: number } }` or `{ kind: "done" }` (nothing to send); invites unchanged (`{ kind: "ok" }`). It stores `{action, sequence}` in the job's `payload`.
- Produces: `dispatch_finish(job, 'sent' | 'unknown', …)` on a calendar job sets `calendar_state` (`added` for `request`, `none` for `cancel`) and `calendar_sequence = sequence + 1`; never touches `email_status`. `failed` changes nothing on the invitee.
- Produces: an expired lease with `send_started_at` on a calendar job is recorded like `unknown` (state applied), not as an invite `unknown`.
- Produces: `meeting_progress` `paused` / `resumes_at` count invite jobs only.

- [ ] **Step 1: Failing DB tests**

```ts
// src/server/db/calendar-dispatch.db.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { serviceRpc } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let invitee: string;
let hash: string;

const claimSchema = z.object({
  jobs: z.array(
    z.object({
      job_id: z.uuid(),
      kind: z.enum(["invite", "calendar_confirm"]),
      invitee_id: z.uuid(),
      meeting: z.object({ ics_uid: z.string() }).loose(),
    }).loose(),
  ),
}).loose();

const reserveSchema = z.union([
  z.object({ kind: z.literal("ok"), calendar: z.object({ action: z.enum(["request", "cancel"]), sequence: z.number().int() }) }),
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("quota"), retry_at: z.string() }),
]);

async function answer(status: "attending" | "late" | "absent", extra: Record<string, string | number> = {}) {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: hash,
    p_status: status,
    p_delay_minutes: status === "late" ? 10 : null,
    p_reason: status === "attending" ? null : "Reason",
    p_comment: null,
    ...extra,
  } as never);
  if (error) {
    throw error;
  }
}

/** Makes this person's calendar job due, claims it and reserves it. */
async function claimAndReserve() {
  await adminClient().from("outbox_jobs").update({ run_after: new Date(Date.now() - 1000).toISOString() })
    .eq("invitee_id", invitee).eq("kind", "calendar_confirm").eq("status", "pending");
  const run = crypto.randomUUID();
  const claim = claimSchema.parse(await serviceRpc("dispatch_claim", { p_run: run, p_limit: 50, p_lease_seconds: 70 }));
  const job = claim.jobs.find((j) => j.kind === "calendar_confirm");
  if (!job) {
    throw new Error("no calendar job claimed");
  }
  const reserved = reserveSchema.parse(await serviceRpc("dispatch_reserve", { p_job: job.job_id, p_token_hash: null }));
  await serviceRpc("dispatch_release", { p_run: run });
  return { jobId: job.job_id, reserved, icsUid: job.meeting.ics_uid };
}

async function inviteeRow() {
  const { data, error } = await adminClient().from("meeting_invitees")
    .select("calendar_state, calendar_sequence, email_status").eq("id", invitee).single();
  if (error) {
    throw error;
  }
  return data;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Calendar Club");
  await setSender(workspace.id, await seedConnection(owner.id));
  const [contact] = await seedContacts(workspace.id, 1, `cal-${crypto.randomUUID().slice(0, 6)}`);
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  ({ inviteeId: invitee, hash } = await seedInvitee(workspace.id, meeting, contact));
});

describe("calendar_confirm jobs", () => {
  it("adds the event after Going, then removes it after Absent; email status untouched", async () => {
    await answer("attending");
    const first = await claimAndReserve();
    expect(first.reserved).toEqual({ kind: "ok", calendar: { action: "request", sequence: 0 } });
    expect(first.icsUid).toMatch(/@/);
    await serviceRpc("dispatch_finish", { p_job: first.jobId, p_outcome: "sent", p_error: null, p_token_hash: null });
    expect(await inviteeRow()).toEqual({ calendar_state: "added", calendar_sequence: 1, email_status: "sent" });

    await answer("absent");
    const second = await claimAndReserve();
    expect(second.reserved).toEqual({ kind: "ok", calendar: { action: "cancel", sequence: 1 } });
    await serviceRpc("dispatch_finish", { p_job: second.jobId, p_outcome: "sent", p_error: null, p_token_hash: null });
    expect(await inviteeRow()).toMatchObject({ calendar_state: "none", calendar_sequence: 2, email_status: "sent" });
  });

  it("sends nothing when the state already matches (quick flips, Late delay change) (Review Focus 2)", async () => {
    await answer("attending");
    const add = await claimAndReserve();
    await serviceRpc("dispatch_finish", { p_job: add.jobId, p_outcome: "sent", p_error: null, p_token_hash: null });
    await answer("absent");
    await answer("late");
    const flip = await claimAndReserve();
    expect(flip.reserved).toEqual({ kind: "done" });
    const { count } = await adminClient().from("send_log").select("id", { count: "exact", head: true }).eq("job_id", flip.jobId);
    expect(count).toBe(0);
  });

  it("records an unknown outcome as sent (never retried)", async () => {
    await answer("attending");
    const job = await claimAndReserve();
    await serviceRpc("dispatch_finish", { p_job: job.jobId, p_outcome: "unknown", p_error: "delivery_unknown", p_token_hash: null });
    expect(await inviteeRow()).toEqual({ calendar_state: "added", calendar_sequence: 1, email_status: "sent" });
  });

  it("treats a lost lease after the send started like unknown", async () => {
    await answer("attending");
    const job = await claimAndReserve();
    await adminClient().from("outbox_jobs").update({ status: "processing", locked_until: new Date(Date.now() - 1000).toISOString() }).eq("id", job.jobId);
    await serviceRpc("dispatch_claim", { p_run: crypto.randomUUID(), p_limit: 50, p_lease_seconds: 70 });
    expect(await inviteeRow()).toEqual({ calendar_state: "added", calendar_sequence: 1, email_status: "sent" });
  });

  it("does nothing for unsubscribed people or a started meeting", async () => {
    await answer("attending");
    const { data } = await adminClient().from("meeting_invitees").select("contact_id").eq("id", invitee).single();
    await adminClient().from("contacts").update({ unsubscribed_at: new Date().toISOString(), unsubscribed_via: "link" }).eq("id", data?.contact_id ?? "");
    expect((await claimAndReserve()).reserved).toEqual({ kind: "done" });
    expect(await inviteeRow()).toMatchObject({ calendar_state: "none", email_status: "sent" });
  });

  it("sends the event for an announcement only after the calendar request", async () => {
    await adminClient().from("meetings").update({ response_mode: "announcement" }).eq("id", meeting);
    await adminClient().rpc("token_request_calendar", { p_token_hash: hash });
    expect((await claimAndReserve()).reserved).toEqual({ kind: "ok", calendar: { action: "request", sequence: 0 } });
  });

  it("gives up after the max attempts without touching the invite's email status", async () => {
    await answer("attending");
    const job = await claimAndReserve();
    await adminClient().from("outbox_jobs").update({ attempts: 99 }).eq("id", job.jobId);
    await serviceRpc("dispatch_retry", { p_job: job.jobId, p_error: "http_503" });
    expect(await inviteeRow()).toMatchObject({ calendar_state: "none", email_status: "sent" });
  });

  it("counts only invite jobs as paused on the meeting page", async () => {
    await answer("attending");
    await adminClient().from("outbox_jobs").update({ status: "paused" }).eq("invitee_id", invitee).eq("kind", "calendar_confirm");
    const { data } = await owner.client.rpc("meeting_progress", { p_meeting: meeting });
    expect(data).toMatchObject({ paused: 0 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `bun run test:db src/server/db/calendar-dispatch.db.test.ts`

- [ ] **Step 3: Migration** (complete bodies; `create or replace` keeps grants because signatures are unchanged)

```sql
-- M5 calendar confirmation jobs in the dispatcher (spec §8 calendar_confirm): a final-state job
-- decides at reserve time whether to add the event, remove it, or do nothing; calendar jobs never
-- change an invite's email status.

create or replace function public.dispatch_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection public.google_connections;
  v_lease interval := pg_catalog.make_interval(secs => p_lease_seconds);
  v_rows integer;
  v_lost record;
begin
  -- A lease expired after the email may have reached Gmail: never resend (at most once). An invite
  -- becomes "Delivery unknown"; a calendar email is recorded as sent (its decision is in payload).
  for v_lost in
    update public.outbox_jobs j
    set status = 'failed', last_error = 'delivery_unknown', locked_until = null
    where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is not null
    returning j.invitee_id, j.kind, j.payload
  loop
    if v_lost.kind = 'invite' then
      update public.meeting_invitees i set email_status = 'unknown', email_error = 'delivery_unknown'
      where i.id = v_lost.invitee_id;
    elsif v_lost.kind = 'calendar_confirm' and v_lost.payload ? 'action' then
      update public.meeting_invitees i
      set calendar_state = case when v_lost.payload ->> 'action' = 'request'
                                then 'added'::public.calendar_state else 'none'::public.calendar_state end,
        calendar_sequence = (v_lost.payload ->> 'sequence')::integer + 1
      where i.id = v_lost.invitee_id;
    end if;
  end loop;

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
          'kind', j.kind,
          'attempts', j.attempts,
          'invitee_id', i.id,
          'workspace_id', w.id,
          'workspace_name', w.name,
          'contact', pg_catalog.jsonb_build_object('full_name', c.full_name, 'email', c.email),
          'meeting', pg_catalog.jsonb_build_object(
            'id', m.id, 'title', m.title, 'agenda_md', m.agenda_md, 'starts_at', m.starts_at,
            'duration_minutes', m.duration_minutes, 'timezone', m.timezone, 'location_mode', m.location_mode,
            'location_text', m.location_text, 'online_text', m.online_text, 'meeting_url', m.meeting_url,
            'response_mode', m.response_mode, 'response_deadline', m.response_deadline, 'footer_note', m.footer_note,
            'ics_uid', m.ics_uid,
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

create or replace function public.dispatch_reserve(p_job uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_action text;
  v_count integer;
  v_oldest timestamptz;
  v_retry timestamptz;
begin
  select j.id, j.kind, j.status, j.workspace_id, j.invitee_id, c.google_sub, m.status as meeting_status,
    m.starts_at, m.response_mode, ct.unsubscribed_at, i.calendar_state, i.calendar_sequence,
    i.calendar_requested_at, r.status as answer
  into v_job
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id
  join public.meeting_invitees i on i.id = j.invitee_id
  join public.meetings m on m.id = i.meeting_id
  join public.contacts ct on ct.id = i.contact_id
  left join public.responses r on r.invitee_id = i.id
  where j.id = p_job
  for update of j, i;
  if v_job.id is null or v_job.status <> 'processing' then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;

  if v_job.kind = 'calendar_confirm' then
    if v_job.unsubscribed_at is not null or v_job.starts_at <= pg_catalog.now() then
      update public.outbox_jobs set status = 'done', locked_until = null,
        last_error = case when v_job.unsubscribed_at is not null then 'unsubscribed' else 'meeting_started' end
      where id = p_job;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
    v_action := case
      when v_job.meeting_status = 'scheduled'
        and (v_job.answer in ('attending', 'late')
             or (v_job.response_mode = 'announcement' and v_job.calendar_requested_at is not null))
      then case when v_job.calendar_state = 'none' then 'request' end
      else case when v_job.calendar_state = 'added' then 'cancel' end
    end;
    if v_action is null then
      update public.outbox_jobs set status = 'done', locked_until = null, last_error = 'nothing_to_send'
      where id = p_job;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
  elsif v_job.unsubscribed_at is not null or v_job.meeting_status <> 'scheduled' or v_job.starts_at <= pg_catalog.now() then
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
  update public.outbox_jobs
  set send_started_at = pg_catalog.now(),
    payload = case when v_job.kind = 'calendar_confirm'
      then pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence)
      else payload end
  where id = p_job;
  -- The personal links must work in any email that may have gone out, including one whose outcome
  -- ends up "unknown" (the token is derived from the invitee id, so storing it early is safe).
  if p_token_hash is not null then
    update public.meeting_invitees set token_hash = coalesce(token_hash, p_token_hash) where id = v_job.invitee_id;
  end if;
  if v_job.kind = 'calendar_confirm' then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;

create or replace function public.dispatch_finish(
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
  v_kind public.job_kind;
  v_payload jsonb;
begin
  update public.outbox_jobs
  set status = case when p_outcome in ('sent', 'skipped') then 'done'::public.job_status else 'failed'::public.job_status end,
    last_error = p_error, locked_until = null
  where id = p_job and status = 'processing'
  returning invitee_id, kind, payload into v_invitee, v_kind, v_payload;
  if v_invitee is null then
    return;
  end if;
  if p_outcome = 'failed' then
    delete from public.send_log s where s.job_id = p_job;
  end if;
  if v_kind = 'calendar_confirm' then
    if p_outcome in ('sent', 'unknown') and v_payload ? 'action' then
      update public.meeting_invitees
      set calendar_state = case when v_payload ->> 'action' = 'request'
                                then 'added'::public.calendar_state else 'none'::public.calendar_state end,
        calendar_sequence = (v_payload ->> 'sequence')::integer + 1
      where id = v_invitee;
    end if;
    return;
  end if;
  update public.meeting_invitees
  set email_status = p_outcome,
    email_error = p_error,
    sent_at = case when p_outcome = 'sent' then pg_catalog.now() end,
    token_hash = case when p_outcome = 'sent' then coalesce(token_hash, p_token_hash) else token_hash end
  where id = v_invitee;
end;
$$;

create or replace function public.dispatch_retry(p_job uuid, p_error text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
  v_invitee uuid;
  v_kind public.job_kind;
  v_retry timestamptz;
begin
  select j.attempts, j.invitee_id, j.kind into v_attempts, v_invitee, v_kind
  from public.outbox_jobs j where j.id = p_job and j.status = 'processing' for update;
  if v_attempts is null then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;
  delete from public.send_log s where s.job_id = p_job;
  if v_attempts >= private.app_limit('dispatch_job_max_attempts') then
    update public.outbox_jobs set status = 'failed', last_error = p_error, locked_until = null, send_started_at = null
    where id = p_job;
    if v_kind = 'invite' then
      update public.meeting_invitees set email_status = 'failed', email_error = p_error where id = v_invitee;
    end if;
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;
  v_retry := pg_catalog.now() + pg_catalog.make_interval(mins => (2 ^ (v_attempts - 1))::integer);
  update public.outbox_jobs
  set status = 'pending', run_after = v_retry, last_error = p_error, locked_until = null, run_id = null, send_started_at = null
  where id = p_job;
  return pg_catalog.jsonb_build_object('kind', 'retry', 'retry_at', v_retry);
end;
$$;

-- meeting_progress: latest body from 20261007205641_m4_outbox.sql; paused / resumes_at count invites only.
create or replace function private.meeting_progress(p_meeting uuid)
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
      where i.meeting_id = p_meeting and j.kind = 'invite' and j.status = 'paused'
    ),
    'resumes_at', (
      select min(j.run_after) from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      where i.meeting_id = p_meeting and j.kind = 'invite' and j.status = 'pending'
        and j.run_after > pg_catalog.now() + interval '2 minutes'
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
```

Before writing, diff each body against its latest version (`git grep -n "function public.dispatch_claim" supabase/migrations` etc.) to be sure nothing newer exists; if anything differs beyond the M5 changes above, keep the newer behavior and note it in the ledger.

- [ ] **Step 4: Apply, types, advisors.** Run: `supabase migration up --local </dev/null && bun run db:types && supabase db advisors --local </dev/null`

- [ ] **Step 5: Run — expect PASS**, plus the whole M4 suite: `bun run test:db src/server/db/calendar-dispatch.db.test.ts src/server/db/outbox.db.test.ts src/server/dispatch/run-dispatch.db.test.ts`. If `run-dispatch.db.test.ts` parses claims with `claimSchema` (Task 11 adds `kind`), it still passes because zod ignores unknown keys.

- [ ] **Step 6: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db`

```bash
git add -A && git commit -m "feat: calendar_confirm jobs in the dispatcher functions (M5)"
```

After merge: `bash .superpowers/scripts/hosted-push.sh`.

---
### Task 5: Pagination foundation (#174) and the paged Meetings list with answer counts

**Labels:** `type:task`, `area:api`, `area:db`, `area:frontend`. Branch `feat/<issue>-pagination-meetings`.

**Files:**
- Create: `src/config/pagination.ts`, `src/shared/api/pagination.ts` (+ `.test.ts`), `src/server/http/pagination.ts` (+ `.test.ts`)
- Create: `src/hooks/use-paged-list.ts`, `src/components/ui/show-more.tsx` (+ `.test.tsx`)
- Create: `supabase/migrations/<timestamp>_m5_meetings_page.sql`, `src/server/db/meetings-page.db.test.ts`
- Modify: `src/server/db/function-security.db.test.ts`
- Modify: `src/shared/api/meetings.ts` (`meetingSummarySchema` gains answer counts; `meetingPageSchema`; `meetingTabSchema`)
- Modify: `src/server/queries/meetings.ts` (`listMeetingsPage` replaces `listMeetings`)
- Modify: `src/app/api/workspaces/[slug]/meetings/route.ts` (+ its test)
- Modify: `src/hooks/use-meetings.ts` (`useMeetingsPage`, `useHasDrafts`; `useMeetings` removed)
- Modify: `src/app/w/[slug]/meetings/meetings-list.tsx` (+ test), `src/app/w/[slug]/needs-attention.tsx` (+ test)
- Delete: `src/lib/meetings/partition.ts` (+ test) — the tabs are now filtered in SQL
- Modify: `messages/en.json` (`Pagination` namespace; `Meetings.answers`)

**Interfaces:**
- Produces: `PAGE_SIZE_DEFAULT = 50`, `PAGE_SIZE_MAX = 100` (`src/config/pagination.ts`).
- Produces: `pageSchema(item)` → `z.object({ items: z.array(item), nextCursor: z.string().nullable() })`; `type Page<T> = { items: T[]; nextCursor: string | null }` (`src/shared/api/pagination.ts`).
- Produces (server): `encodeCursor(values: readonly (string | number)[]): string`; `readPageParams<T>(request, cursorSchema: z.ZodType<T>) → { ok: true; limit: number; after: T | null } | { ok: false; response: NextResponse }`; `toPage<T>(rows: T[], limit: number, keyOf: (row: T) => readonly (string | number)[]): Page<T>` (takes `limit + 1` rows, returns at most `limit` and a cursor from the last kept row).
- Produces (client): `usePagedList<T>({ queryKey, path, params?, schema, limit?, refetchInterval?, enabled? })` → `{ items: T[]; hasMore: boolean; loadMore(): void; isLoadingMore: boolean; query }` built on `useInfiniteQuery`; `<ShowMore hasMore loading onMore endLabel? />`.
- Produces (SQL): `public.meetings_page(p_workspace uuid, p_tab text, p_after_key timestamptz default null, p_after_id uuid default null, p_limit integer default 50) returns jsonb` (an invoker wrapper over a `private` definer body) → `{ items: [...], has_more: boolean }`, items with `sort_key` and counts `{ invited, sent, attending, late, absent, no_reply }` (RSVP "not going" counts as `absent`).
- Produces (API): `GET /api/workspaces/[slug]/meetings?tab=upcoming|past|drafts&cursor=&limit=` → `Page<MeetingSummary>`.
- Produces (hooks): `useMeetingsPage(slug, tab, limit?)`, `useHasDrafts(slug)`; query keys start with `["meetings", slug]` so existing invalidations still match.

- [ ] **Step 1: Config and shared contract** (failing test first)

```ts
// src/shared/api/pagination.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

describe("pagination contract", () => {
  it("parses a page of items with a nullable cursor", () => {
    const schema = pageSchema(z.object({ id: z.string() }));
    expect(schema.parse({ items: [{ id: "a" }], nextCursor: null })).toEqual({ items: [{ id: "a" }], nextCursor: null });
  });

  it("defaults the limit and caps it", () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(pageQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(pageQuerySchema.parse({ limit: "20", cursor: "abc" })).toEqual({ limit: 20, cursor: "abc" });
  });
});
```

```ts
// src/config/pagination.ts
/** Rows per page when a list endpoint gets no `limit` (spec §10 Pagination contract). */
export const PAGE_SIZE_DEFAULT = 50;
/** Largest `limit` a list endpoint accepts. */
export const PAGE_SIZE_MAX = 100;
/** Longest cursor a client may send back (base64url of a small JSON array). */
export const CURSOR_MAX_LENGTH = 512;
```

```ts
// src/shared/api/pagination.ts
import { z } from "zod";
import {
  CURSOR_MAX_LENGTH,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
} from "@/config/pagination";

/** One page of a list endpoint: the rows and the cursor of the next page (null = the end). */
export type Page<T> = { items: T[]; nextCursor: string | null };

/** Response schema of a paged endpoint whose rows match `item`. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** `?cursor=&limit=` of a paged endpoint (query-string values arrive as strings). */
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
```

- [ ] **Step 2: Server cursor helpers** (failing test first)

```ts
// src/server/http/pagination.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { encodeCursor, readPageParams, toPage } from "./pagination";

const key = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);
const ID = "4b7f8c2e-2f3a-4c55-9a1e-0d6f6b1c2a10";

describe("cursor helpers", () => {
  it("round-trips a keyset through the query string", () => {
    const cursor = encodeCursor(["2026-10-09T17:00:00.000Z", ID]);
    const parsed = readPageParams(new Request(`https://x.test/a?cursor=${cursor}&limit=10`), key);
    expect(parsed).toEqual({ ok: true, limit: 10, after: ["2026-10-09T17:00:00.000Z", ID] });
  });

  it("starts at the beginning without a cursor", () => {
    expect(readPageParams(new Request("https://x.test/a"), key)).toEqual({ ok: true, limit: 50, after: null });
  });

  it("rejects a tampered cursor or limit with 400", async () => {
    for (const query of ["cursor=bm90LWpzb24", `cursor=${encodeCursor(["x", "y"])}`, "limit=0", "limit=500"]) {
      const parsed = readPageParams(new Request(`https://x.test/a?${query}`), key);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.response.status).toBe(400);
      }
    }
  });

  it("keeps limit rows and points the cursor at the last kept one", () => {
    const rows = [1, 2, 3].map((n) => ({ n, id: `id-${n}` }));
    const page = toPage(rows, 2, (r) => [r.n, r.id]);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(encodeCursor([2, "id-2"]));
    expect(toPage(rows.slice(0, 2), 2, (r) => [r.n, r.id]).nextCursor).toBeNull();
  });
});
```

```ts
// src/server/http/pagination.ts
import "server-only";
import type { NextResponse } from "next/server";
import type { z } from "zod";
import { pageQuerySchema, type Page } from "@/shared/api/pagination";
import { apiError } from "./errors";

/** Opaque cursor: base64url of the keyset values of the last row shown. */
export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Reads `?cursor=&limit=` and decodes the cursor with this endpoint's keyset schema. A malformed
 * or foreign cursor is `400 invalid_input`, never a silent restart from page one.
 */
export function readPageParams<T>(
  request: Request,
  cursorSchema: z.ZodType<T>,
):
  | { ok: true; limit: number; after: T | null }
  | { ok: false; response: NextResponse } {
  const search = new URL(request.url).searchParams;
  const query = pageQuerySchema.safeParse({
    cursor: search.get("cursor") ?? undefined,
    limit: search.get("limit") ?? undefined,
  });
  if (!query.success) {
    return { ok: false, response: apiError("invalid_input") };
  }
  if (!query.data.cursor) {
    return { ok: true, limit: query.data.limit, after: null };
  }
  const after = decodeCursor(query.data.cursor, cursorSchema);
  return after === null
    ? { ok: false, response: apiError("invalid_input") }
    : { ok: true, limit: query.data.limit, after };
}

/**
 * Turns `limit + 1` fetched rows into one page: at most `limit` items, and a cursor from the last
 * kept row when more exist.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => readonly (string | number)[],
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null,
  };
}
```

Run: `bun run test src/shared/api/pagination.test.ts src/server/http/pagination.test.ts` — FAIL first, then PASS after writing the modules.

- [ ] **Step 3: Client hook and "Show more" primitive** (failing component test first)

```tsx
// src/components/ui/show-more.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { ShowMore } from "./show-more";

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>
);

describe("ShowMore", () => {
  it("loads the next page on tap", () => {
    const onMore = vi.fn();
    render(wrap(<ShowMore hasMore loading={false} onMore={onMore} />));
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("shows a busy button while loading and an end line when done", () => {
    const { rerender } = render(wrap(<ShowMore hasMore loading onMore={vi.fn()} />));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    rerender(wrap(<ShowMore hasMore={false} loading={false} onMore={vi.fn()} endLabel="That's everyone" />));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("That's everyone")).toBeInTheDocument();
  });
});
```

Messages: add `"Pagination": { "more": "Show more", "loading": "Loading…", "end": "That's all" }`.

```tsx
// src/components/ui/show-more.tsx
"use client";

import { useTranslations } from "next-intl";
import { Button } from "./button";

/** The foot of a paged list: "Show more" while pages remain, then a quiet end line (#174). */
export function ShowMore({
  hasMore,
  loading,
  onMore,
  endLabel,
}: {
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  endLabel?: string;
}) {
  const t = useTranslations("Pagination");
  if (!hasMore) {
    return endLabel ? (
      <p className="py-2 text-center text-sm text-muted-ink">{endLabel}</p>
    ) : null;
  }
  return (
    <Button
      type="button"
      className="w-full justify-center"
      disabled={loading}
      aria-busy={loading}
      onClick={onMore}
    >
      {loading ? t("loading") : t("more")}
    </Button>
  );
}
```

```ts
// src/hooks/use-paged-list.ts
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { PAGE_SIZE_DEFAULT } from "@/config/pagination";
import { apiRequest } from "@/lib/api-client";
import type { Page } from "@/shared/api/pagination";

function pathWith(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

/**
 * A paged list endpoint (`{ items, nextCursor }`) as one growing list. Pages refetch together on
 * `refetchInterval` or invalidation, so live lists stay consistent (TanStack `useInfiniteQuery`).
 */
export function usePagedList<T>(options: {
  queryKey: readonly (string | number)[];
  path: string;
  params?: Record<string, string>;
  schema: z.ZodType<Page<T>>;
  limit?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
}) {
  const params = options.params ?? {};
  const limit = options.limit ?? PAGE_SIZE_DEFAULT;
  const query = useInfiniteQuery({
    queryKey: [...options.queryKey, params, limit],
    queryFn: ({ pageParam }) =>
      apiRequest(
        pathWith(options.path, {
          ...params,
          limit: String(limit),
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
        { schema: options.schema },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: options.refetchInterval ?? false,
    refetchIntervalInBackground: false,
    enabled: options.enabled ?? true,
  });
  return {
    query,
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
  };
}
```

Add `src/hooks/use-paged-list.test.tsx` with `renderHook` + the repo's fetch mock (`src/test/fetch.ts`): first page returns `nextCursor: "c1"`, second returns `null`; after `loadMore()` assert (with `waitFor`) that `items` has both pages' rows, the second request URL contains `cursor=c1&` … and `hasMore` is false.

- [ ] **Step 4: Failing DB tests for `meetings_page`**

```ts
// src/server/db/meetings-page.db.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { seedContacts } from "@/test/db/roster";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;

const pageSchema = z.object({
  has_more: z.boolean(),
  items: z.array(z.object({
    id: z.uuid(),
    title: z.string(),
    sort_key: z.string().nullable(),
    counts: z.object({ invited: z.number(), sent: z.number(), attending: z.number(), late: z.number(), absent: z.number(), no_reply: z.number() }),
  }).loose()),
});

const at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

async function page(tab: string, after: { key: string | null; id: string } | null = null, limit = 50, as = owner) {
  const { data, error } = await as.client.rpc("meetings_page", {
    p_workspace: workspace.id, p_tab: tab, p_after_key: after?.key ?? null, p_after_id: after?.id ?? null, p_limit: limit,
  } as never);
  if (error) {
    throw error;
  }
  return pageSchema.parse(data);
}

beforeEach(async () => {
  owner = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Paging Club");
});

describe("meetings_page", () => {
  it("splits upcoming, past and drafts like the old tabs", async () => {
    const soon = await seedMeeting(workspace.id, { status: "scheduled", title: "Soon", starts_at: at(2) });
    const running = await seedMeeting(workspace.id, { status: "scheduled", title: "Running", starts_at: at(-0.5) });
    const done = await seedMeeting(workspace.id, { status: "scheduled", title: "Done", starts_at: at(-48) });
    const draft = await seedMeeting(workspace.id, { status: "draft", title: "Draft" });
    await seedMeeting(workspace.id, { status: "draft", title: "", starts_at: null });
    expect((await page("upcoming")).items.map((m) => m.id)).toEqual([running, soon]);
    expect((await page("past")).items.map((m) => m.id)).toEqual([done]);
    expect((await page("drafts")).items.map((m) => m.id)).toEqual([draft]);
  });

  it("pages by keyset with equal start times and a row inserted between pages (Review Focus 5)", async () => {
    const same = at(5);
    const ids = [];
    for (let n = 0; n < 5; n += 1) {
      ids.push(await seedMeeting(workspace.id, { status: "scheduled", title: `M${n}`, starts_at: same }));
    }
    const first = await page("upcoming", null, 2);
    expect(first.items).toHaveLength(2);
    expect(first.has_more).toBe(true);
    await seedMeeting(workspace.id, { status: "scheduled", title: "Earlier", starts_at: at(1) });
    const last = first.items[1];
    const second = await page("upcoming", { key: last.sort_key, id: last.id }, 10);
    const seen = [...first.items, ...second.items].map((m) => m.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((id) => ids.includes(id)).sort()).toEqual([...ids].sort());
  });

  it("counts invites and answers per meeting", async () => {
    const meeting = await seedMeeting(workspace.id, { status: "scheduled", starts_at: at(3) });
    const contacts = await seedContacts(workspace.id, 4, `pg-${crypto.randomUUID().slice(0, 6)}`);
    const hashes = [];
    for (const contact of contacts) {
      hashes.push((await seedInvitee(workspace.id, meeting, contact)).hash);
    }
    await adminClient().rpc("token_submit_response", { p_token_hash: hashes[0], p_status: "attending", p_delay_minutes: null, p_reason: null, p_comment: null } as never);
    await adminClient().rpc("token_submit_response", { p_token_hash: hashes[1], p_status: "late", p_delay_minutes: 10, p_reason: "Bus", p_comment: null } as never);
    await adminClient().rpc("token_submit_response", { p_token_hash: hashes[2], p_status: "absent", p_delay_minutes: null, p_reason: "Sick", p_comment: null } as never);
    const [item] = (await page("upcoming")).items;
    expect(item.counts).toEqual({ invited: 4, sent: 4, attending: 1, late: 1, absent: 1, no_reply: 1 });
  });

  it("is for members only and checks its arguments", async () => {
    const outsider = await createTestUser();
    await expectAppError(outsider.client.rpc("meetings_page", { p_workspace: workspace.id, p_tab: "upcoming", p_after_key: null, p_after_id: null, p_limit: 10 } as never), "forbidden");
    await expectAppError(owner.client.rpc("meetings_page", { p_workspace: workspace.id, p_tab: "all", p_after_key: null, p_after_id: null, p_limit: 10 } as never), "invalid_input");
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    expect((await page("upcoming", null, 10, viewer)).items).toEqual([]);
  });
});
```

Run: `bun run test:db src/server/db/meetings-page.db.test.ts` — expect FAIL.

- [ ] **Step 5: Migration**

```sql
-- M5 / #174: the Meetings tabs load in pages (keyset), with invite and answer counts per card.

create index meetings_ws_status_starts_idx on public.meetings (workspace_id, status, starts_at, id);
create index meetings_ws_status_updated_idx on public.meetings (workspace_id, status, updated_at, id);

-- Definer body (one membership check, then no per-row RLS probes; spec §6 Access pattern (M5)) behind
-- a public invoker wrapper (spec §11).
create function private.meetings_page(
  p_workspace uuid,
  p_tab text,
  p_after_key timestamptz,
  p_after_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_ids uuid[];
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_tab not in ('upcoming', 'past', 'drafts') or p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;

  -- One indexed keyset scan per tab (no OFFSET); limit + 1 rows tell whether a next page exists.
  if p_tab = 'upcoming' then
    select coalesce(pg_catalog.array_agg(x.id order by x.starts_at, x.id), '{}') into v_ids
    from (
      select m.id, m.starts_at from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'scheduled'
        and m.starts_at > v_now - interval '12 hours'
        and m.starts_at + pg_catalog.make_interval(mins => m.duration_minutes) > v_now
        and (p_after_id is null or (m.starts_at, m.id) > (p_after_key, p_after_id))
      order by m.starts_at, m.id
      limit p_limit + 1
    ) x;
  elsif p_tab = 'past' then
    select coalesce(pg_catalog.array_agg(x.id order by x.starts_at desc, x.id desc), '{}') into v_ids
    from (
      select m.id, m.starts_at from public.meetings m
      where m.workspace_id = p_workspace and m.status in ('scheduled', 'cancelled')
        and (m.status = 'cancelled' or m.starts_at + pg_catalog.make_interval(mins => m.duration_minutes) <= v_now)
        and (p_after_id is null or (m.starts_at, m.id) < (p_after_key, p_after_id))
      order by m.starts_at desc, m.id desc
      limit p_limit + 1
    ) x;
  else
    select coalesce(pg_catalog.array_agg(x.id order by x.updated_at desc, x.id desc), '{}') into v_ids
    from (
      select m.id, m.updated_at from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'draft' and (m.title <> '' or m.starts_at is not null)
        and (p_after_id is null or (m.updated_at, m.id) < (p_after_key, p_after_id))
      order by m.updated_at desc, m.id desc
      limit p_limit + 1
    ) x;
  end if;

  return pg_catalog.jsonb_build_object(
    'has_more', pg_catalog.cardinality(v_ids) > p_limit,
    'items', coalesce((
      with page as (
        select u.id, u.ord from pg_catalog.unnest(v_ids) with ordinality as u(id, ord) where u.ord <= p_limit
      ), counts as materialized (
        select i.meeting_id,
          count(*) as invited,
          count(*) filter (where i.email_status = 'sent') as sent,
          count(r.id) filter (where r.status = 'attending') as attending,
          count(r.id) filter (where r.status = 'late') as late,
          count(r.id) filter (where r.status in ('absent', 'not_attending')) as absent,
          count(*) filter (where r.id is null and i.email_status in ('sent', 'unknown')) as no_reply
        from public.meeting_invitees i
        left join public.responses r on r.invitee_id = i.id
        where i.meeting_id in (select page.id from page)
        group by i.meeting_id
      )
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone,
          'duration_minutes', m.duration_minutes, 'status', m.status, 'location_mode', m.location_mode,
          'response_mode', m.response_mode,
          'sort_key', case when p_tab = 'drafts' then m.updated_at else m.starts_at end,
          'counts', pg_catalog.jsonb_build_object(
            'invited', coalesce(c.invited, 0), 'sent', coalesce(c.sent, 0),
            'attending', coalesce(c.attending, 0), 'late', coalesce(c.late, 0),
            'absent', coalesce(c.absent, 0), 'no_reply', coalesce(c.no_reply, 0)
          )
        )
        order by page.ord
      )
      from page
      join public.meetings m on m.id = page.id
      left join counts c on c.meeting_id = m.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function private.meetings_page(uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function private.meetings_page(uuid, text, timestamptz, uuid, integer) to authenticated;

create function public.meetings_page(
  p_workspace uuid,
  p_tab text,
  p_after_key timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.meetings_page(p_workspace, p_tab, p_after_key, p_after_id, p_limit) $$;
revoke execute on function public.meetings_page(uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.meetings_page(uuid, text, timestamptz, uuid, integer) to authenticated;
```

(The `starts_at > now() - 12 hours` bound lets the upcoming scan use the index; 12 h = the 720-minute maximum duration.) Keep `list_meetings` until Task 6 (the deployed UI calls it until this PR's deploy finishes).

Add `"meetings_page"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` in `src/server/db/function-security.db.test.ts` (sorted). Run: `supabase migration up --local </dev/null && bun run db:types && supabase db advisors --local </dev/null`, then the DB test — expect PASS.

- [ ] **Step 6: Shared schema, query module, route** (failing route test first)

Shared (`src/shared/api/meetings.ts`): replace `meetingSummarySchema` / `meetingListSchema` with

```ts
/** Meetings page tabs (spec §10). */
export const meetingTabSchema = z.enum(["upcoming", "past", "drafts"]);
/** A Meetings page tab. */
export type MeetingTab = z.infer<typeof meetingTabSchema>;

/** Answer and invite counts on a card (RSVP "not going" counts as absent). */
export const meetingCountsSchema = z.object({
  invited: z.number().int(),
  sent: z.number().int(),
  attending: z.number().int(),
  late: z.number().int(),
  absent: z.number().int(),
  noReply: z.number().int(),
});
/** Counts on a meeting card. */
export type MeetingCounts = z.infer<typeof meetingCountsSchema>;

/** One card on the Meetings page. */
export const meetingSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.string().nullable(),
  timezone: z.string(),
  durationMinutes: z.number().int(),
  status: meetingStatusSchema,
  locationMode: locationModeSchema,
  responseMode: responseModeSchema,
  counts: meetingCountsSchema,
});
/** A meeting in the list. */
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;
/** `GET …/meetings?tab=`: one page of cards. */
export const meetingPageSchema = pageSchema(meetingSummarySchema);
```

Query (`src/server/queries/meetings.ts`), replacing `listMeetings`:

```ts
const meetingRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  starts_at: z.string().nullable(),
  timezone: z.string(),
  duration_minutes: z.number().int(),
  status: meetingStatusSchema,
  location_mode: locationModeSchema,
  response_mode: responseModeSchema,
  sort_key: z.string().nullable(),
  counts: z.object({
    invited: z.number().int(), sent: z.number().int(), attending: z.number().int(),
    late: z.number().int(), absent: z.number().int(), no_reply: z.number().int(),
  }),
});

/** Keyset of the Meetings tabs: the sort time and the id of the last card shown. */
export const meetingCursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

/** One page of a Meetings tab (`meetings_page`). */
export async function listMeetingsPage(
  client: Client,
  workspaceId: string,
  tab: MeetingTab,
  limit: number,
  after: [string, string] | null,
): Promise<Result<Page<MeetingSummary>>> {
  const { data, error } = await client.rpc("meetings_page", {
    p_workspace: workspaceId,
    p_tab: tab,
    p_after_key: sqlNullable(after?.[0] ?? null),
    p_after_id: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = z.object({ has_more: z.boolean(), items: z.array(meetingRowSchema) }).parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      items: parsed.items.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.starts_at,
        timezone: r.timezone,
        durationMinutes: r.duration_minutes,
        status: r.status,
        locationMode: r.location_mode,
        responseMode: r.response_mode,
        counts: {
          invited: r.counts.invited,
          sent: r.counts.sent,
          attending: r.counts.attending,
          late: r.counts.late,
          absent: r.counts.absent,
          noReply: r.counts.no_reply,
        },
      })),
      nextCursor: parsed.has_more && last?.sort_key ? encodeCursor([last.sort_key, last.id]) : null,
    },
    error: null,
  };
}
```

`encodeCursor` comes from `@/server/http/pagination` (server-only, fine in a query module); `sqlNullable` from `@/server/db/rpc-args`.

Route (`GET` in `src/app/api/workspaces/[slug]/meetings/route.ts`):

```ts
/** One page of a Meetings tab (any member); `?tab=upcoming|past|drafts&cursor=&limit=`. */
export async function GET(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const tab = meetingTabSchema.safeParse(new URL(request.url).searchParams.get("tab") ?? "upcoming");
  const page = readPageParams(request, meetingCursorSchema);
  if (!tab.success) {
    return apiError("invalid_input");
  }
  if (!page.ok) {
    return page.response;
  }
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listMeetingsPage(context.supabase, context.workspace.id, tab.data, page.limit, page.after);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
```

Route test (extend the existing route test file, same mocking style as M4): `?tab=nope` → 400; `?cursor=garbage` → 400; a valid call passes `tab`, `limit`, `after` to `listMeetingsPage` and returns its page.

- [ ] **Step 7: Hooks and UI**

In `src/hooks/use-meetings.ts` replace `useMeetings` with:

```ts
/** One Meetings tab, paged (spec §10). */
export function useMeetingsPage(slug: string, tab: MeetingTab, limit?: number) {
  return usePagedList({
    queryKey: [...meetingsQueryKey(slug), tab],
    path: base(slug),
    params: { tab },
    schema: meetingPageSchema,
    limit,
  });
}

/** Whether any draft exists (Home "needs attention"): one row of the Drafts tab. */
export function useHasDrafts(slug: string, enabled: boolean) {
  const drafts = usePagedList({
    queryKey: [...meetingsQueryKey(slug), "drafts"],
    path: base(slug),
    params: { tab: "drafts" },
    schema: meetingPageSchema,
    limit: 1,
    enabled,
  });
  return drafts.items.length > 0;
}
```

`MeetingsList`: drop `partitionMeetings`; `const list = useMeetingsPage(slug, tab);` render `list.items`; loading skeleton while `list.query.isPending`; after the `<ul>`, `<ShowMore hasMore={list.hasMore} loading={list.isLoadingMore} onMore={list.loadMore} />`. The card's status line keeps "N of M sent" for a sending meeting (`counts.sent < counts.invited`) and otherwise shows the answers line from Task 13 (`MeetingAnswersLine`; in this task render `t("answers", { attending, late, noReply })` = "{attending} going · {late} late · {noReply} no reply" for `rsvp`/`attendance` meetings, and the sent line for announcements). `NeedsAttention`: `const hasDrafts = useHasDrafts(workspace.slug, isOwner && !sender.data?.sender);` replaces the `meetings.data.some(...)` check.

Update `meetings-list.test.tsx` (mock two pages; tapping "Show more" requests `cursor=`; switching tabs requests `tab=past`) and `needs-attention.test.tsx`; delete `src/lib/meetings/partition.ts` and its test.

- [ ] **Step 8: Screenshots** of the Meetings page with 60 seeded past meetings (seed through the admin client in the screens spec) at 390 light / 320 dark / 1024: the Show more button, the end of the list, the answers line on a card.

- [ ] **Step 9: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db && bun run test:e2e e2e/meetings.spec.ts`

```bash
git add -A && git commit -m "feat: pagination contract and paged Meetings list with answer counts (#174)"
```

After merge: `bash .superpowers/scripts/hosted-push.sh`.

---
### Task 6: Pagination — Settings members and invites; roster measured at 2,000; `list_meetings` dropped

**Labels:** `type:task`, `area:api`, `area:db`, `area:frontend`. Branch `feat/<issue>-pagination-settings`.

**Files:**
- Create: `supabase/migrations/<timestamp>_m5_members_invites_pages.sql`, `src/server/db/settings-pages.db.test.ts`
- Modify: `src/shared/api/members.ts`, `src/shared/api/invites.ts` (page schemas, cursor schemas)
- Modify: `src/server/queries/members.ts` (`listMembersPage`), `src/server/queries/invites.ts` (`listOpenInvitesPage`)
- Modify: `src/app/api/workspaces/[slug]/members/route.ts`, `src/app/api/workspaces/[slug]/invites/route.ts` (+ tests)
- Modify: `src/hooks/use-members.ts`, `src/hooks/use-invites.ts`
- Modify: `src/app/w/[slug]/settings/{page,people-section,invites-panel,danger-zone}.tsx` (+ tests)
- Modify: `src/server/db/function-security.db.test.ts` (`members_page` added to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`)
- Create (git-ignored): `.superpowers/scripts/perf/roster-2000.spec.ts`

**Interfaces:**
- Consumes: Task 5's `pageSchema`, `readPageParams`, `toPage`, `encodeCursor`, `usePagedList`, `ShowMore`.
- Produces (SQL): `public.members_page(p_workspace uuid, p_role public.workspace_role default null, p_after_role public.workspace_role default null, p_after_name text default null, p_after_id uuid default null, p_limit integer default 50) returns jsonb` (`{items, has_more}`; items as `list_members` rows plus `sort_name`), a `public` invoker wrapper over a `private` definer body (it reads `auth.users`). `public.invites_page(p_workspace uuid, p_after_created timestamptz default null, p_after_id uuid default null, p_limit integer default 50) returns jsonb` (invoker; `workspace_invites` RLS applies).
- Produces (API): `GET …/members?role=&cursor=&limit=` → `Page<Member>`; `GET …/invites?cursor=&limit=` → `Page<Invite>`.
- Produces (hooks): `useMembersPage(slug, role?)`, `useInvitesPage(slug, enabled)`; keys keep the `["members", slug]` / `["invites", slug]` prefixes so mutation invalidations still match.

- [ ] **Step 1: Failing DB tests**

```ts
// src/server/db/settings-pages.db.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;

const membersPage = z.object({
  has_more: z.boolean(),
  items: z.array(z.object({ user_id: z.uuid(), role: z.string(), sort_name: z.string() }).loose()),
});

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Settings Club");
});

describe("members_page", () => {
  it("pages Owner, Admins, Viewers in order without gaps, including equal names", async () => {
    for (let n = 0; n < 5; n += 1) {
      const user = await createTestUser({ fullName: "Same Name" });
      await addMember(workspace.id, user.id, n < 2 ? "admin" : "viewer");
    }
    const first = membersPage.parse((await owner.client.rpc("members_page", {
      p_workspace: workspace.id, p_role: null, p_after_role: null, p_after_name: null, p_after_id: null, p_limit: 3,
    } as never)).data);
    expect(first.has_more).toBe(true);
    expect(first.items.map((m) => m.role)).toEqual(["owner", "admin", "admin"]);
    const last = first.items[2];
    const second = membersPage.parse((await owner.client.rpc("members_page", {
      p_workspace: workspace.id, p_role: null, p_after_role: last.role, p_after_name: last.sort_name, p_after_id: last.user_id, p_limit: 10,
    } as never)).data);
    const ids = [...first.items, ...second.items].map((m) => m.user_id);
    expect(new Set(ids).size).toBe(6);
    expect(second.has_more).toBe(false);
  });

  it("filters by role (the transfer dialog lists Admins only)", async () => {
    const admin = await createTestUser({ fullName: "Ada" });
    await addMember(workspace.id, admin.id, "admin");
    const page = membersPage.parse((await owner.client.rpc("members_page", {
      p_workspace: workspace.id, p_role: "admin", p_after_role: null, p_after_name: null, p_after_id: null, p_limit: 50,
    } as never)).data);
    expect(page.items.map((m) => m.user_id)).toEqual([admin.id]);
  });

  it("is for members only", async () => {
    const outsider = await createTestUser();
    await expectAppError(outsider.client.rpc("members_page", {
      p_workspace: workspace.id, p_role: null, p_after_role: null, p_after_name: null, p_after_id: null, p_limit: 50,
    } as never), "forbidden");
  });
});

describe("invites_page", () => {
  it("pages open invites newest first", async () => {
    for (let n = 0; n < 3; n += 1) {
      const { error } = await owner.client.rpc("create_invite", {
        p_workspace: workspace.id, p_email: `inv-${n}-${crypto.randomUUID().slice(0, 6)}@example.test`, p_role: "viewer", p_token_hash: crypto.randomUUID().replaceAll("-", "").repeat(2),
      } as never);
      expect(error).toBeNull();
    }
    const page = z.object({ has_more: z.boolean(), items: z.array(z.object({ id: z.uuid(), created_at: z.string() }).loose()) })
      .parse((await owner.client.rpc("invites_page", { p_workspace: workspace.id, p_after_created: null, p_after_id: null, p_limit: 2 } as never)).data);
    expect(page.items).toHaveLength(2);
    expect(page.has_more).toBe(true);
  });
});
```

(Check `create_invite`'s argument names in `database.types.ts` before running; the M2 signature is `(p_workspace, p_email, p_role, p_token_hash)`.)

- [ ] **Step 2: Run — expect FAIL.** `bun run test:db src/server/db/settings-pages.db.test.ts`

- [ ] **Step 3: Migration**

```sql
-- #174: Settings > People and pending invites load in pages; the Meetings list moved to
-- meetings_page (Task 5), so list_meetings goes.

drop function public.list_meetings(uuid);

create function private.members_page(
  p_workspace uuid,
  p_role public.workspace_role,
  p_after_role public.workspace_role,
  p_after_name text,
  p_after_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count integer;
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select r.user_id, r.role, r.can_check_in, p.display_name, p.avatar_url, u.email::text as email,
      r.created_at as joined_at, lower(coalesce(p.display_name, u.email::text)) as sort_name
    from public.workspace_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.user_id = r.user_id
    where r.workspace_id = p_workspace
      and (p_role is null or r.role = p_role)
      and (p_after_id is null
        or (r.role, lower(coalesce(p.display_name, u.email::text)), r.user_id) > (p_after_role, p_after_name, p_after_id))
    order by r.role, lower(coalesce(p.display_name, u.email::text)), r.user_id
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.role, page.sort_name, page.user_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e) from pg_catalog.jsonb_array_elements(v_rows) with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;
revoke execute on function private.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) from public, anon;
grant execute on function private.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) to authenticated;

create function public.members_page(
  p_workspace uuid,
  p_role public.workspace_role default null,
  p_after_role public.workspace_role default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.members_page(p_workspace, p_role, p_after_role, p_after_name, p_after_id, p_limit) $$;
revoke execute on function public.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) from public, anon;
grant execute on function public.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) to authenticated;

create index workspace_invites_open_idx on public.workspace_invites (workspace_id, created_at desc, id desc)
  where accepted_at is null and revoked_at is null;

create function public.invites_page(
  p_workspace uuid,
  p_after_created timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count integer;
begin
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select i.id, i.email, i.role, i.invited_by, i.expires_at, i.created_at
    from public.workspace_invites i
    where i.workspace_id = p_workspace and i.accepted_at is null and i.revoked_at is null
      and (p_after_id is null or (i.created_at, i.id) < (p_after_created, p_after_id))
    order by i.created_at desc, i.id desc
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.created_at desc, page.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e) from pg_catalog.jsonb_array_elements(v_rows) with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.invites_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.invites_page(uuid, timestamptz, uuid, integer) to authenticated;
```

Before writing `invites_page`, read `INVITE_COLUMNS` and `toInvite` in `src/server/queries/invites.ts` and select exactly those columns (the list above is a guess at the M2 shape; match the real one). `workspace_invites` RLS already limits rows to Owner/Admin; a Viewer gets an empty page, same as today's disabled query.

Run: `supabase migration up --local </dev/null && bun run db:types && supabase db advisors --local </dev/null`; add `"members_page"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted); DB tests PASS.

- [ ] **Step 4: Shared schemas, queries, routes** (route tests first: bad cursor → 400; `?role=owner` passes the role; Viewers calling invites get an empty page, as before)

- `src/shared/api/members.ts`: `export const membersPageSchema = pageSchema(memberSchema);` and keep `memberSchema`.
- `src/shared/api/invites.ts`: `export const invitesPageSchema = pageSchema(inviteSchema);` (use the existing row schema name).
- `src/server/queries/members.ts`: `export const memberCursorSchema = z.tuple([workspaceRoleSchema, z.string().max(320), z.uuid()]);` and `listMembersPage(client, workspaceId, role, limit, after)` calling `members_page` with `sqlNullable` for every null argument, mapping rows like `listMembers` does today, and `nextCursor = has_more ? encodeCursor([last.role, last.sort_name, last.user_id]) : null`.
- `src/server/queries/invites.ts`: `export const inviteCursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);` and `listOpenInvitesPage(client, workspaceId, limit, after, now)` mapping rows through the existing `toInvite`.
- Routes: `GET` reads `readPageParams(request, …CursorSchema)` and, for members, `role` with `workspaceRoleSchema.optional()`; keep `listMembers`/`listOpenInvites` only if another route still calls them (`grep -rn "listMembers\|listOpenInvites" src`), otherwise delete them.

- [ ] **Step 5: Hooks and UI**

```ts
// src/hooks/use-members.ts
/** Members of a workspace, paged; `role` narrows to one role (the transfer dialog lists Admins). */
export function useMembersPage(slug: string, role?: WorkspaceRole) {
  return usePagedList({
    queryKey: [...membersQueryKey(slug), role ?? "all"],
    path: `/api/workspaces/${encodeURIComponent(slug)}/members`,
    params: role ? { role } : {},
    schema: membersPageSchema,
  });
}
```

```ts
// src/hooks/use-invites.ts
/** Open invites, paged; disabled for Viewers. */
export function useInvitesPage(slug: string, enabled: boolean) {
  return usePagedList({
    queryKey: invitesQueryKey(slug),
    path: `/api/workspaces/${encodeURIComponent(slug)}/invites`,
    schema: invitesPageSchema,
    enabled,
  });
}
```

- `PeopleSection`: render `members.items` and `<ShowMore …/>` under the list. Any logic that needs "all members" (e.g. "you're the only Owner") must come from `workspace.myRole` / server errors, not from the loaded page: read the component and move such checks; record each in the ledger.
- `DangerZone`: take no `members` prop; inside, the transfer dialog uses `useMembersPage(slug, "admin")` with `ShowMore` in its picker. `SettingsPage` stops calling `useMembers` and renders `DangerZone` directly (its own skeleton while the Admins page loads).
- `InvitesPanel`: `useInvitesPage(slug, canManage)`; empty state when `items.length === 0 && !hasMore`; `ShowMore` below.
- Any mutation that `setQueryData`s the members or invites cache with an array must switch to invalidation (`grep -rn "setQueryData" src/hooks/use-members.ts src/hooks/use-invites.ts src/app/w/\[slug\]/settings`).

Update the component tests for paged responses (`{ items, nextCursor }`) and one "Show more" case each.

- [ ] **Step 6: Roster at 2,000 — measure and record** (no product change unless it is slow)

Write `.superpowers/scripts/perf/roster-2000.spec.ts` (Playwright, run with the screens config): seed a workspace with 2,000 contacts in 10 lists through the admin client, sign in as its Owner, on a `devices["Pixel 7"]` context with CDP `Emulation.setCPUThrottlingRate { rate: 4 }`, open `/w/<slug>/lists` and measure (a) `GET …/contacts` response size (`response.body()` length) and duration, (b) time from navigation to the first contact card visible, (c) time for typing a search to filter the list, and the same for the meeting wizard's Audience step with all lists selected. Thresholds: first card ≤ 2.5 s, search ≤ 200 ms per keystroke, payload ≤ 600 KB uncompressed. Comment the numbers on #174. If any threshold fails, stop and ask the owner (stop condition in #174) before paging the roster.

- [ ] **Step 7: Screenshots** of Settings > People with 60 members and the transfer dialog (390 light / 320 dark / 1024).

- [ ] **Step 8: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db && bun run test:e2e e2e/settings.spec.ts e2e/invites.spec.ts`

```bash
git add -A && git commit -m "feat: paged Settings members and invites; drop list_meetings (#174)"
```

After merge: `bash .superpowers/scripts/hosted-push.sh`. Close #174 only after Tasks 7, 12–14 (the new M5 lists) also merge.

---
### Task 7: DB — organizer reads (`meeting_results`, `meeting_people`, `contact_history`, `attendance_summary`, `attendance_details`) and plan checks

**Labels:** `type:task`, `area:db`. Branch `feat/<issue>-results-reads-db`.

**Files:**
- Create: `supabase/migrations/<timestamp>_m5_results_reads.sql`
- Create: `src/test/db/plans.ts`
- Create: `src/server/db/results.db.test.ts`
- Modify: `src/server/db/function-security.db.test.ts` (five names added), `src/server/db/database.types.ts`
- Modify: `.github/workflows/ci.yml` only if the `db` job lacks `psql` (Step 6)

**Interfaces:**
- Consumes: Task 3 tables, Task 4 job kinds, Task 5's `meetings_ws_status_starts_idx`.
- Produces (all `public` `SECURITY INVOKER` wrappers over `private` `SECURITY DEFINER` bodies that check `private.is_member()` once and then read without per-row RLS; granted to `authenticated`):
  - `meeting_results(p_meeting uuid) → jsonb` `{ response_mode, emails: {total, queued, sent, skipped, failed, unknown}, answers: {attending, late, absent, not_attending, no_reply, calendar_requested}, paused, resumes_at, sender_state }` (`tn:not_found` for non-members).
  - `meeting_people(p_meeting uuid, p_filter text default 'all', p_after_name text default null, p_after_id uuid default null, p_limit integer default 50) → jsonb` `{ items, has_more }`; filters `all | attending | late | absent | not_attending | no_reply | not_delivered`; rows `{ invitee_id, contact_id, full_name, email, is_adhoc, sort_name, email_status, email_error, sent_at, answer: {status, delay_minutes, reason, comment, after_deadline, updated_at} | null }`; order `lower(full_name), invitee_id`.
  - `contact_history(p_contact uuid, p_from timestamptz default null, p_to timestamptz default null, p_after_starts timestamptz default null, p_after_meeting uuid default null, p_limit integer default 50) → jsonb` `{ counts: {attending, late, absent, no_reply}, items, has_more }`; rows `{ meeting_id, title, starts_at, timezone, response_mode, email_status, answer | null }`; newest first.
  - `attendance_summary(p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null) → jsonb` `{ meetings: number, rows: [{ contact_id, invited, attending, late, absent, no_reply }] }` for every roster contact (`not is_adhoc`), zeros included.
  - `attendance_details(p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null, p_after_starts timestamptz default null, p_after_meeting uuid default null, p_after_name text default null, p_after_invitee uuid default null, p_limit integer default 100) → jsonb` `{ items, has_more }`; one row per invitee per counted meeting `{ meeting_id, title, starts_at, timezone, response_mode, invitee_id, contact_id, full_name, email, sort_name, email_status, answer | null }`; order `starts_at, meeting_id, sort_name, invitee_id`.
  - "Counted meeting" everywhere: `status = 'scheduled'`, `response_mode <> 'announcement'`, `starts_at <= now()`, `starts_at` in `[p_from, p_to)` (nulls = open). RSVP Not going counts as Absent in `counts`/`summary`. **No reply** = `email_status in ('sent','unknown')` and no answer.
- Produces (test helper): `explainCall(call: string, userId: string): string` and `planUsesIndex(plan: string, index: string): boolean` in `src/test/db/plans.ts`.

- [ ] **Step 1: Plan helper**

```ts
// src/test/db/plans.ts
import { spawnSync } from "node:child_process";

/** Local DB as `supabase_admin` (auto_explain needs it; the local password is "postgres"). */
const ADMIN_URL = "postgresql://supabase_admin:postgres@127.0.0.1:44322/postgres";

/**
 * Runs `select <call>` as `userId` (role `authenticated`, JWT claims set) inside a rolled-back
 * transaction with auto_explain logging every nested statement, and returns psql's output with the
 * plans (auto_explain prints them as NOTICEs on stderr). Test assertions only.
 */
export function explainCall(call: string, userId: string): string {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const sql = [
    "begin;",
    "load 'auto_explain';",
    "set local auto_explain.log_min_duration = 0;",
    "set local auto_explain.log_nested_statements = on;",
    "set local auto_explain.log_level = notice;",
    "set local client_min_messages = notice;",
    `select set_config('request.jwt.claims', '${claims}', true);`,
    "set local role authenticated;",
    `select ${call};`,
    "rollback;",
  ].join("\n");
  const result = spawnSync("psql", [ADMIN_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

/** True when the plan text scans `index` (index, index-only or bitmap index scan). */
export function planUsesIndex(plan: string, index: string): boolean {
  return new RegExp(
    `(Index Scan|Index Only Scan)( Backward)? using ${index}\\b|Bitmap Index Scan on ${index}\\b`,
  ).test(plan);
}
```

- [ ] **Step 2: Failing DB tests**

```ts
// src/server/db/results.db.test.ts
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import { seedContacts } from "@/test/db/roster";
import { runLocalSql } from "@/test/db/sql";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let workspace: TestWorkspace;
let past: string;
let contacts: string[];
const hashes: string[] = [];

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

async function answer(hash: string, status: string, extra: Record<string, string | number> = {}) {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: hash, p_status: status, p_delay_minutes: status === "late" ? 10 : null,
    p_reason: status === "attending" ? null : "Reason", p_comment: null, ...extra,
  } as never);
  if (error) {
    throw error;
  }
}

beforeAll(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  viewer = await createTestUser();
  outsider = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Results Club");
  await addMember(workspace.id, viewer.id, "viewer");
  contacts = await seedContacts(workspace.id, 6, `res-${crypto.randomUUID().slice(0, 6)}`);
  // Answers are written while the meeting is upcoming, then it is moved into the past.
  past = await seedMeeting(workspace.id, { status: "scheduled", title: "Last week" });
  for (const [n, contact] of contacts.entries()) {
    const emailStatus = n === 5 ? "failed" : "sent";
    hashes.push((await seedInvitee(workspace.id, past, contact, { emailStatus })).hash);
  }
  await answer(hashes[0], "attending");
  await answer(hashes[1], "late");
  await answer(hashes[2], "absent");
  await adminClient().from("meetings").update({ starts_at: ago(24 * 7) }).eq("id", past);
});

describe("meeting_results", () => {
  it("counts emails and answers; no reply excludes undelivered emails", async () => {
    const { data, error } = await viewer.client.rpc("meeting_results", { p_meeting: past } as never);
    expect(error).toBeNull();
    expect(data).toMatchObject({
      response_mode: "attendance",
      emails: { total: 6, sent: 5, failed: 1 },
      answers: { attending: 1, late: 1, absent: 1, not_attending: 0, no_reply: 2, calendar_requested: 0 },
      paused: 0,
    });
  });

  it("is not found for non-members", async () => {
    await expectAppError(outsider.client.rpc("meeting_results", { p_meeting: past } as never), "not_found");
  });
});

describe("meeting_people", () => {
  const pageSchema = z.object({
    has_more: z.boolean(),
    items: z.array(z.object({ invitee_id: z.uuid(), sort_name: z.string(), answer: z.object({ status: z.string(), reason: z.string() }).nullable() }).loose()),
  });
  const call = async (filter: string, after: { name: string; id: string } | null, limit: number) =>
    pageSchema.parse((await owner.client.rpc("meeting_people", {
      p_meeting: past, p_filter: filter, p_after_name: after?.name ?? null, p_after_id: after?.id ?? null, p_limit: limit,
    } as never)).data);

  it("filters by answer, no reply and not delivered", async () => {
    expect((await call("late", null, 50)).items.map((r) => r.answer?.status)).toEqual(["late"]);
    expect((await call("no_reply", null, 50)).items).toHaveLength(2);
    expect((await call("not_delivered", null, 50)).items).toHaveLength(1);
  });

  it("pages without duplicates when names are equal and rows arrive between pages (Review Focus 5)", async () => {
    await adminClient().from("contacts").update({ full_name: "Same Name" }).in("id", contacts);
    const first = await call("all", null, 4);
    const last = first.items[3];
    const extra = await seedContacts(workspace.id, 1, `res-late-${crypto.randomUUID().slice(0, 6)}`);
    await seedInvitee(workspace.id, past, extra[0]);
    const second = await call("all", { name: last.sort_name, id: last.invitee_id }, 50);
    const ids = [...first.items, ...second.items].map((r) => r.invitee_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(7);
  });
});

describe("contact_history", () => {
  it("counts only started meetings that asked for answers, in the period, newest first", async () => {
    const upcoming = await seedMeeting(workspace.id, { status: "scheduled" });
    await seedInvitee(workspace.id, upcoming, contacts[1]);
    const announcement = await seedMeeting(workspace.id, { status: "scheduled" });
    await adminClient().from("meetings").update({ response_mode: "announcement", starts_at: ago(1) }).eq("id", announcement);
    await seedInvitee(workspace.id, announcement, contacts[1]);
    const { data } = await viewer.client.rpc("contact_history", {
      p_contact: contacts[1], p_from: null, p_to: null, p_after_starts: null, p_after_meeting: null, p_limit: 50,
    } as never);
    expect(data).toMatchObject({ counts: { attending: 0, late: 1, absent: 0, no_reply: 0 }, has_more: false });
    expect((data as { items: unknown[] }).items).toHaveLength(1);
    const outside = await viewer.client.rpc("contact_history", {
      p_contact: contacts[1], p_from: ago(24), p_to: null, p_after_starts: null, p_after_meeting: null, p_limit: 50,
    } as never);
    expect(outside.data).toMatchObject({ counts: { late: 0 }, items: [] });
  });
});

describe("attendance_summary and attendance_details", () => {
  it("summarizes every roster contact, zeros included", async () => {
    const { data } = await viewer.client.rpc("attendance_summary", { p_workspace: workspace.id, p_from: null, p_to: null } as never);
    const parsed = z.object({ meetings: z.number(), rows: z.array(z.object({ contact_id: z.uuid(), invited: z.number(), no_reply: z.number() }).loose()) }).parse(data);
    expect(parsed.meetings).toBeGreaterThanOrEqual(1);
    expect(parsed.rows.find((r) => r.contact_id === contacts[4])).toMatchObject({ invited: 1, no_reply: 1 });
  });

  it("lists one row per person per counted meeting, in pages", async () => {
    const { data } = await viewer.client.rpc("attendance_details", {
      p_workspace: workspace.id, p_from: null, p_to: null, p_after_starts: null, p_after_meeting: null,
      p_after_name: null, p_after_invitee: null, p_limit: 3,
    } as never);
    expect(data).toMatchObject({ has_more: true });
  });

  it("is forbidden to non-members", async () => {
    await expectAppError(outsider.client.rpc("attendance_summary", { p_workspace: workspace.id, p_from: null, p_to: null } as never), "forbidden");
  });
});

describe("query plans (fresh and stale statistics)", () => {
  it("uses the meeting and contact indexes, also right after a bulk insert without analyze", async () => {
    runLocalSql("analyze public.meeting_invitees; analyze public.responses; analyze public.meetings;");
    const fresh = explainCall(`public.meeting_people('${past}', 'all', null, null, 50)`, owner.id);
    expect(planUsesIndex(fresh, "meeting_invitees_meeting_ws_idx")).toBe(true);
    const bulk = await seedContacts(workspace.id, 400, `res-bulk-${crypto.randomUUID().slice(0, 6)}`);
    const busy = await seedMeeting(workspace.id, { status: "scheduled" });
    for (const contact of bulk) {
      await seedInvitee(workspace.id, busy, contact);
    }
    const stale = explainCall(`public.meeting_people('${past}', 'all', null, null, 50)`, owner.id);
    expect(planUsesIndex(stale, "meeting_invitees_meeting_ws_idx")).toBe(true);
    const history = explainCall(`public.contact_history('${contacts[0]}', null, null, null, null, 50)`, owner.id);
    expect(planUsesIndex(history, "meeting_invitees_contact_ws_idx")).toBe(true);
  });
});
```

(400 single inserts are slow; insert the invitees in one bulk `adminClient().from("meeting_invitees").insert([...])` call with every key set on every row, as M4 learned, instead of looping `seedInvitee`.)

- [ ] **Step 3: Run — expect FAIL.** `bun run test:db src/server/db/results.db.test.ts`

- [ ] **Step 4: Migration**

```sql
-- M5 organizer reads (spec §6 Access pattern (M5), §7.7): one membership check per call, then plain
-- reads (definer bodies; no per-row RLS probes), aggregates joined once, keyset pages.

create function private.meeting_results(p_meeting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meeting record;
begin
  select m.id, m.workspace_id, m.response_mode into v_meeting from public.meetings m where m.id = p_meeting;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return (
    with inv as materialized (
      select i.id, i.email_status, i.calendar_requested_at, r.status as answer
      from public.meeting_invitees i
      left join public.responses r on r.invitee_id = i.id
      where i.meeting_id = p_meeting
    ), jobs as materialized (
      select j.status, j.run_after
      from public.outbox_jobs j
      join inv on inv.id = j.invitee_id
      where j.kind = 'invite' and j.status in ('paused', 'pending')
    )
    select pg_catalog.jsonb_build_object(
      'response_mode', v_meeting.response_mode,
      'emails', (select pg_catalog.jsonb_build_object(
        'total', count(*),
        'queued', count(*) filter (where inv.email_status = 'queued'),
        'sent', count(*) filter (where inv.email_status = 'sent'),
        'skipped', count(*) filter (where inv.email_status = 'skipped'),
        'failed', count(*) filter (where inv.email_status = 'failed'),
        'unknown', count(*) filter (where inv.email_status = 'unknown')) from inv),
      'answers', (select pg_catalog.jsonb_build_object(
        'attending', count(*) filter (where inv.answer = 'attending'),
        'late', count(*) filter (where inv.answer = 'late'),
        'absent', count(*) filter (where inv.answer = 'absent'),
        'not_attending', count(*) filter (where inv.answer = 'not_attending'),
        'no_reply', count(*) filter (where inv.answer is null and inv.email_status in ('sent', 'unknown')),
        'calendar_requested', count(*) filter (where inv.calendar_requested_at is not null)) from inv),
      'paused', (select count(*) from jobs where jobs.status = 'paused'),
      'resumes_at', (select min(jobs.run_after) from jobs
        where jobs.status = 'pending' and jobs.run_after > pg_catalog.now() + interval '2 minutes'),
      'sender_state', (select case when c.id is null then 'missing' when c.status = 'broken' then 'broken' else 'ok' end
        from public.workspaces w left join public.google_connections c on c.id = w.sender_connection_id
        where w.id = v_meeting.workspace_id)
    )
  );
end;
$$;

create function private.meeting_people(
  p_meeting uuid, p_filter text, p_after_name text, p_after_id uuid, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_rows jsonb;
  v_count integer;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_filter not in ('all', 'attending', 'late', 'absent', 'not_attending', 'no_reply', 'not_delivered')
    or p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select i.id as invitee_id, c.id as contact_id, c.full_name, c.email, c.is_adhoc, lower(c.full_name) as sort_name,
      i.email_status, i.email_error, i.sent_at,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at) end as answer
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and i.workspace_id = v_workspace
      and case p_filter
        when 'all' then true
        when 'no_reply' then r.id is null and i.email_status in ('sent', 'unknown')
        when 'not_delivered' then i.email_status in ('failed', 'skipped')
        else r.status::text = p_filter
      end
      and (p_after_id is null or (lower(c.full_name), i.id) > (p_after_name, p_after_id))
    order by lower(c.full_name), i.id
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.sort_name, page.invitee_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e order by t.n) from pg_catalog.jsonb_array_elements(v_rows)
      with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;

create function private.contact_history(
  p_contact uuid, p_from timestamptz, p_to timestamptz, p_after_starts timestamptz, p_after_meeting uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select c.workspace_id into v_workspace from public.contacts c where c.id = p_contact;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return (
    with hist as materialized (
      select m.id as meeting_id, m.title, m.starts_at, m.timezone, m.response_mode, i.email_status,
        r.status,
        case when r.id is null then null else pg_catalog.jsonb_build_object(
          'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
          'after_deadline', r.after_deadline, 'updated_at', r.updated_at) end as answer
      from public.meeting_invitees i
      join public.meetings m on m.id = i.meeting_id
      left join public.responses r on r.invitee_id = i.id
      where i.contact_id = p_contact and i.workspace_id = v_workspace
        and m.status = 'scheduled' and m.response_mode <> 'announcement' and m.starts_at <= pg_catalog.now()
        and (p_from is null or m.starts_at >= p_from) and (p_to is null or m.starts_at < p_to)
    ), page as (
      select * from hist
      where p_after_meeting is null or (hist.starts_at, hist.meeting_id) < (p_after_starts, p_after_meeting)
      order by hist.starts_at desc, hist.meeting_id desc
      limit p_limit + 1
    ), numbered as (
      select page.*, row_number() over (order by page.starts_at desc, page.meeting_id desc) as n from page
    )
    select pg_catalog.jsonb_build_object(
      'counts', (select pg_catalog.jsonb_build_object(
        'attending', count(*) filter (where hist.status = 'attending'),
        'late', count(*) filter (where hist.status = 'late'),
        'absent', count(*) filter (where hist.status in ('absent', 'not_attending')),
        'no_reply', count(*) filter (where hist.status is null and hist.email_status in ('sent', 'unknown'))) from hist),
      'has_more', (select count(*) > p_limit from page),
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'meeting_id', numbered.meeting_id, 'title', numbered.title, 'starts_at', numbered.starts_at,
          'timezone', numbered.timezone, 'response_mode', numbered.response_mode,
          'email_status', numbered.email_status, 'answer', numbered.answer) order by numbered.n)
        from numbered where numbered.n <= p_limit), '[]'::jsonb)
    )
  );
end;
$$;

create function private.attendance_summary(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return (
    with counted as materialized (
      select m.id from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'scheduled' and m.response_mode <> 'announcement'
        and m.starts_at <= pg_catalog.now()
        and (p_from is null or m.starts_at >= p_from) and (p_to is null or m.starts_at < p_to)
    ), agg as materialized (
      select i.contact_id,
        count(*) as invited,
        count(r.id) filter (where r.status = 'attending') as attending,
        count(r.id) filter (where r.status = 'late') as late,
        count(r.id) filter (where r.status in ('absent', 'not_attending')) as absent,
        count(*) filter (where r.id is null and i.email_status in ('sent', 'unknown')) as no_reply
      from public.meeting_invitees i
      join counted on counted.id = i.meeting_id
      left join public.responses r on r.invitee_id = i.id
      group by i.contact_id
    )
    select pg_catalog.jsonb_build_object(
      'meetings', (select count(*) from counted),
      'rows', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'contact_id', c.id, 'invited', coalesce(a.invited, 0), 'attending', coalesce(a.attending, 0),
          'late', coalesce(a.late, 0), 'absent', coalesce(a.absent, 0), 'no_reply', coalesce(a.no_reply, 0)
        ) order by lower(c.full_name), c.id)
        from public.contacts c
        left join agg a on a.contact_id = c.id
        where c.workspace_id = p_workspace and not c.is_adhoc
      ), '[]'::jsonb)
    )
  );
end;
$$;

create function private.attendance_details(
  p_workspace uuid, p_from timestamptz, p_to timestamptz, p_after_starts timestamptz, p_after_meeting uuid,
  p_after_name text, p_after_invitee uuid, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count integer;
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select m.id as meeting_id, m.title, m.starts_at, m.timezone, m.response_mode, i.id as invitee_id,
      c.id as contact_id, c.full_name, c.email, lower(c.full_name) as sort_name, i.email_status,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at) end as answer
    from public.meetings m
    join public.meeting_invitees i on i.meeting_id = m.id
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where m.workspace_id = p_workspace and m.status = 'scheduled' and m.response_mode <> 'announcement'
      and m.starts_at <= pg_catalog.now()
      and (p_from is null or m.starts_at >= p_from) and (p_to is null or m.starts_at < p_to)
      and (p_after_invitee is null
        or (m.starts_at, m.id, lower(c.full_name), i.id) > (p_after_starts, p_after_meeting, p_after_name, p_after_invitee))
    order by m.starts_at, m.id, lower(c.full_name), i.id
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.starts_at, page.meeting_id, page.sort_name, page.invitee_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e order by t.n) from pg_catalog.jsonb_array_elements(v_rows)
      with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;

revoke execute on function private.meeting_results(uuid), private.meeting_people(uuid, text, text, uuid, integer),
  private.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  private.attendance_summary(uuid, timestamptz, timestamptz),
  private.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  from public, anon;
grant execute on function private.meeting_results(uuid), private.meeting_people(uuid, text, text, uuid, integer),
  private.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  private.attendance_summary(uuid, timestamptz, timestamptz),
  private.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  to authenticated;

create function public.meeting_results(p_meeting uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.meeting_results(p_meeting) $$;

create function public.meeting_people(
  p_meeting uuid, p_filter text default 'all', p_after_name text default null, p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.meeting_people(p_meeting, p_filter, p_after_name, p_after_id, p_limit) $$;

create function public.contact_history(
  p_contact uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_after_starts timestamptz default null, p_after_meeting uuid default null, p_limit integer default 50
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.contact_history(p_contact, p_from, p_to, p_after_starts, p_after_meeting, p_limit) $$;

create function public.attendance_summary(p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.attendance_summary(p_workspace, p_from, p_to) $$;

create function public.attendance_details(
  p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_after_starts timestamptz default null, p_after_meeting uuid default null, p_after_name text default null,
  p_after_invitee uuid default null, p_limit integer default 100
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.attendance_details(p_workspace, p_from, p_to, p_after_starts, p_after_meeting, p_after_name, p_after_invitee, p_limit) $$;

revoke execute on function public.meeting_results(uuid), public.meeting_people(uuid, text, text, uuid, integer),
  public.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  public.attendance_summary(uuid, timestamptz, timestamptz),
  public.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  from public, anon;
grant execute on function public.meeting_results(uuid), public.meeting_people(uuid, text, text, uuid, integer),
  public.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  public.attendance_summary(uuid, timestamptz, timestamptz),
  public.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  to authenticated;
```

Add `attendance_details`, `attendance_summary`, `contact_history`, `meeting_people`, `meeting_results` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted).

- [ ] **Step 5: Apply, types, advisors, run — expect PASS.** `supabase migration up --local </dev/null && bun run db:types && supabase db advisors --local </dev/null && bun run test:db src/server/db/results.db.test.ts src/server/db/function-security.db.test.ts`. If a plan assertion fails with stale stats, apply the M4 fix (read the invitees once into a `materialized` CTE; as a last resort `set enable_nestloop = off` on that function with a test asserting the setting, like `import_contacts`) and record a ruling.

- [ ] **Step 6: CI `psql`.** Push the branch and check the `db` job log for the plan test. GitHub's `ubuntu-latest` image ships the PostgreSQL client; if `psql` is missing, add `- run: sudo apt-get update && sudo apt-get install -y postgresql-client` before the DB tests in `.github/workflows/ci.yml`.

- [ ] **Step 7: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db`

```bash
git add -A && git commit -m "feat: organizer read functions for results, history and attendance (M5)"
```

After merge: `bash .superpowers/scripts/hosted-push.sh`.

---
### Task 8: Token API — answer and calendar routes, shared schemas, error codes, hooks

**Labels:** `type:task`, `area:api`. Branch `feat/<issue>-answer-api`.

**Files:**
- Create: `src/shared/api/responses.ts` (+ `.test.ts`)
- Modify: `src/shared/api/tokens.ts` (extended `tokenInfoSchema`)
- Modify: `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors`)
- Create: `src/config/responses.ts`
- Modify: `src/server/queries/tokens.ts` (`lookupToken` parses the new fields; `submitAnswer`, `requestCalendar`)
- Create: `src/app/api/r/[token]/response/route.ts` (+ `route.test.ts`), `src/app/api/r/[token]/calendar/route.ts` (+ `route.test.ts`)
- Modify: `src/app/api/r/[token]/route.test.ts` (GET never writes)
- Modify: `src/hooks/use-token-page.ts` (+ test)
- Modify: `src/lib/observability/scrub.ts` only if its token-route patterns need `/api/r/<token>/response|calendar` (check its tests; M4 scrubs any 43-char token in `/r/`, `/u/`, `/report/`, `/api/r/`)

**Interfaces:**
- Consumes: Task 3's `token_submit_response`, `token_request_calendar`, extended `token_invitee`; Task 2's `DISPATCH_MAX_DURATION_S` (the routes repeat the literal 60); M4's `loadTokenContext`, `rejectCrossOrigin`, `parseJsonBody`, `scheduleDispatch`.
- Produces (`src/shared/api/responses.ts`):
  - `answerStatusSchema = z.enum(["attending", "late", "absent", "not_attending"])`, `type AnswerStatus`.
  - `answerSchema` `{ status, delayMinutes: number | null, reason: string, comment: string, afterDeadline: boolean, respondedAt: string, updatedAt: string }`, `type Answer`.
  - `answerSettingsSchema` `{ responseMode, delayOptions: number[], reasonRequired, commentsEnabled, footerNote, responseDeadline: string | null }`, `type AnswerSettings`.
  - `submitAnswerBodySchema` `{ status: AnswerStatus, delayMinutes: number | null, reason: string (≤ REASON_MAX), comment: string (≤ COMMENT_MAX) }`, `type SubmitAnswerBody`.
  - `choiceToStatus(choice: string | null, mode: ResponseMode): AnswerStatus | null` — maps the email's `?choice=` (`attending|late|absent|going|not_going`) to a status allowed by the mode, else `null`.
  - `statusesFor(mode: ResponseMode): AnswerStatus[]` — `attendance` → `["attending", "late", "absent"]`, `rsvp` → `["attending", "not_attending"]`, `announcement` → `[]`.
  - `needsReason(status: AnswerStatus): boolean` — `status !== "attending"`.
- Produces (`TokenInfo` additions): `fullName`, `calendarRequested`, `meeting.agendaMd`, `answers: AnswerSettings`, `answer: Answer | null`.
- Produces (API): `PUT /api/r/[token]/response` (body `SubmitAnswerBody`) → `Answer`; `POST /api/r/[token]/calendar` → `{ ok: true }`. Errors: `invalid_origin` 403, `not_found` 404, `rate_limited` 429, `invalid_input` 400, `answers_closed` 409, `invalid_choice` 400, `delay_required` 400, `reason_required` 400.
- Produces (hooks): `useSubmitAnswer(token)` (mutation; on success writes the answer into the `["token-page", token]` cache), `useRequestCalendar(token)`.
- Produces (config `src/config/responses.ts`): `REASON_MAX = 500`, `COMMENT_MAX = 500`, `RESULTS_POLL_MS = 10_000`, `RESULTS_POLL_STOP_AFTER_END_MS = 10_800_000`, `HISTORY_PERIODS = ["30d", "3m", "year", "all", "custom"] as const`, `HISTORY_DEFAULT_PERIOD = "3m"`.

- [ ] **Step 1: Config**

```ts
// src/config/responses.ts
/** Reason and comment length (database checks on `responses`). */
export const REASON_MAX = 500;
export const COMMENT_MAX = 500;

/** The meeting page refreshes answers this often while visible (spec §7.7). */
export const RESULTS_POLL_MS = 10_000;
/** …and stops this long after the meeting ends (3 h). */
export const RESULTS_POLL_STOP_AFTER_END_MS = 10_800_000;

/** History period chips (spec §7.7): last 30 days, last 3 months, this year, all time, from–to. */
export const HISTORY_PERIODS = ["30d", "3m", "year", "all", "custom"] as const;
/** The chip selected by default. */
export const HISTORY_DEFAULT_PERIOD = "3m";
```

- [ ] **Step 2: Failing schema tests**

```ts
// src/shared/api/responses.test.ts
import { describe, expect, it } from "vitest";
import { choiceToStatus, statusesFor, submitAnswerBodySchema } from "./responses";

describe("choiceToStatus", () => {
  it("maps the email's choices to statuses the mode allows", () => {
    expect(choiceToStatus("late", "attendance")).toBe("late");
    expect(choiceToStatus("going", "rsvp")).toBe("attending");
    expect(choiceToStatus("not_going", "rsvp")).toBe("not_attending");
    expect(choiceToStatus("attending", "rsvp")).toBe("attending");
  });

  it("ignores a choice that does not fit the mode, or junk", () => {
    expect(choiceToStatus("late", "rsvp")).toBeNull();
    expect(choiceToStatus("absent", "announcement")).toBeNull();
    expect(choiceToStatus("<script>", "attendance")).toBeNull();
    expect(choiceToStatus(null, "attendance")).toBeNull();
    expect(choiceToStatus("constructor", "attendance")).toBeNull();
  });
});

describe("statusesFor", () => {
  it("lists the cards per mode", () => {
    expect(statusesFor("attendance")).toEqual(["attending", "late", "absent"]);
    expect(statusesFor("rsvp")).toEqual(["attending", "not_attending"]);
    expect(statusesFor("announcement")).toEqual([]);
  });
});

describe("submitAnswerBodySchema", () => {
  it("caps reason and comment at 500 characters", () => {
    const base = { status: "absent", delayMinutes: null, comment: "" };
    expect(submitAnswerBodySchema.safeParse({ ...base, reason: "x".repeat(500) }).success).toBe(true);
    expect(submitAnswerBodySchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Implement the schemas**

```ts
// src/shared/api/responses.ts
import { z } from "zod";
import { COMMENT_MAX, REASON_MAX } from "@/config/responses";
import { responseModeSchema, type ResponseMode } from "./meeting-settings";

/** A member's answer (spec §6 `responses.status`; RSVP uses attending / not_attending). */
export const answerStatusSchema = z.enum(["attending", "late", "absent", "not_attending"]);
/** An answer status. */
export type AnswerStatus = z.infer<typeof answerStatusSchema>;

/** A saved answer as the member's page and the organizer screens see it. */
export const answerSchema = z.object({
  status: answerStatusSchema,
  delayMinutes: z.number().int().nullable(),
  reason: z.string(),
  comment: z.string(),
  afterDeadline: z.boolean(),
  respondedAt: z.string(),
  updatedAt: z.string(),
});
/** A saved answer. */
export type Answer = z.infer<typeof answerSchema>;

/** The meeting's answer settings shown on `/r/[token]`. */
export const answerSettingsSchema = z.object({
  responseMode: responseModeSchema,
  delayOptions: z.array(z.number().int()),
  reasonRequired: z.boolean(),
  commentsEnabled: z.boolean(),
  footerNote: z.string(),
  responseDeadline: z.string().nullable(),
});
/** Answer settings of one meeting. */
export type AnswerSettings = z.infer<typeof answerSettingsSchema>;

/** `PUT /api/r/[token]/response`. The database applies the meeting's rules (spec §7.3). */
export const submitAnswerBodySchema = z.object({
  status: answerStatusSchema,
  delayMinutes: z.number().int().min(1).max(240).nullable(),
  reason: z.string().max(REASON_MAX),
  comment: z.string().max(COMMENT_MAX),
});
/** An answer save. */
export type SubmitAnswerBody = z.infer<typeof submitAnswerBodySchema>;

const STATUSES: Record<ResponseMode, AnswerStatus[]> = {
  attendance: ["attending", "late", "absent"],
  rsvp: ["attending", "not_attending"],
  announcement: [],
};

/** The answer cards a mode shows, in order. */
export function statusesFor(mode: ResponseMode): AnswerStatus[] {
  return STATUSES[mode];
}

const CHOICE_TO_STATUS: Record<string, AnswerStatus> = {
  attending: "attending",
  going: "attending",
  late: "late",
  absent: "absent",
  not_going: "not_attending",
};

/** The email button's `?choice=` as a status this mode allows, or null (spec §7.3: pre-select only). */
export function choiceToStatus(choice: string | null, mode: ResponseMode): AnswerStatus | null {
  // hasOwn: a crafted `?choice=constructor` must not reach Object.prototype.
  const status =
    choice && Object.hasOwn(CHOICE_TO_STATUS, choice) ? CHOICE_TO_STATUS[choice] : undefined;
  return status && STATUSES[mode].includes(status) ? status : null;
}

/** Late, Absent and Not going may carry a reason; Going never does (spec §4 Reasons). */
export function needsReason(status: AnswerStatus): boolean {
  return status !== "attending";
}
```

Extend `tokenInfoSchema` in `src/shared/api/tokens.ts`: add `fullName: z.string()`, `calendarRequested: z.boolean()`, `meeting.agendaMd: z.string()`, `answers: answerSettingsSchema`, `answer: answerSchema.nullable()`. Update `dbInfoSchema` in `src/server/queries/tokens.ts` with the snake_case fields from Task 3 and map them.

- [ ] **Step 4: Error codes.** Add to `API_ERROR_CODES` and `API_ERROR_STATUS`: `answers_closed: 409`, `invalid_choice: 400`, `delay_required: 400`, `reason_required: 400`. Messages (`ApiErrors`): `"answers_closed": "The meeting has started, so answers are closed."`, `"invalid_choice": "That answer isn't available for this meeting."`, `"delay_required": "Pick how late you'll be."`, `"reason_required": "Please add a reason."`. The existing `errors.test.ts` checks that every code has a message.

- [ ] **Step 5: Query functions**

```ts
// src/server/queries/tokens.ts (add)
const dbAnswerSchema = z
  .object({
    status: answerStatusSchema,
    delay_minutes: z.number().int().nullable(),
    reason: z.string(),
    comment: z.string(),
    after_deadline: z.boolean(),
    responded_at: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (db): Answer => ({
      status: db.status,
      delayMinutes: db.delay_minutes,
      reason: db.reason,
      comment: db.comment,
      afterDeadline: db.after_deadline,
      respondedAt: db.responded_at,
      updatedAt: db.updated_at,
    }),
  );

/** `token_submit_response()`: null for an unknown token. Service-role client only. */
export async function submitAnswer(
  client: Client,
  tokenHash: string,
  body: SubmitAnswerBody,
): Promise<{ data: Answer | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_submit_response", {
    p_token_hash: tokenHash,
    p_status: body.status,
    p_delay_minutes: sqlNullable(body.delayMinutes),
    p_reason: body.reason,
    p_comment: body.comment,
  });
  return error
    ? { data: null, error }
    : { data: data ? dbAnswerSchema.parse(data) : null, error: null };
}

/** `token_request_calendar()`: false for an unknown token. */
export async function requestCalendar(
  client: Client,
  tokenHash: string,
): Promise<{ data: boolean | null; error: DbError | null }> {
  const { data, error } = await client.rpc("token_request_calendar", { p_token_hash: tokenHash });
  return { data: data ?? null, error };
}
```

Reuse `dbAnswerSchema` inside `dbInfoSchema` for `answer` (`dbAnswerSchema.nullable()`).

- [ ] **Step 6: Failing route tests**

```ts
// src/app/api/r/[token]/response/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadTokenContext, submitAnswer, scheduleDispatch } = vi.hoisted(() => ({
  loadTokenContext: vi.fn(),
  submitAnswer: vi.fn(),
  scheduleDispatch: vi.fn(),
}));
vi.mock("@/server/http/token-context", () => ({ loadTokenContext }));
vi.mock("@/server/queries/tokens", () => ({ submitAnswer }));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({ scheduleDispatch }));

const TOKEN = "a".repeat(43);
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const ANSWER = {
  status: "late", delayMinutes: 10, reason: "Bus", comment: "", afterDeadline: false,
  respondedAt: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z",
};

function put(body: object, origin = "https://tapnshow.test") {
  return new Request(`https://tapnshow.test/api/r/${TOKEN}/response`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadTokenContext.mockResolvedValue({ ok: true, client: {}, tokenHash: "h" });
});

describe("PUT /api/r/[token]/response", () => {
  it("saves the answer and kicks a dispatch", async () => {
    submitAnswer.mockResolvedValue({ data: ANSWER, error: null });
    const { PUT } = await import("./route");
    const response = await PUT(put({ status: "late", delayMinutes: 10, reason: "Bus", comment: "" }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ANSWER);
    expect(submitAnswer).toHaveBeenCalledWith({}, "h", { status: "late", delayMinutes: 10, reason: "Bus", comment: "" });
    expect(scheduleDispatch).toHaveBeenCalledOnce();
  });

  it("refuses another site (403) before touching the token", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(put({ status: "attending", delayMinutes: null, reason: "", comment: "" }, "https://evil.test"), ctx);
    expect(response.status).toBe(403);
    expect(loadTokenContext).not.toHaveBeenCalled();
  });

  it("maps database rules to plain errors", async () => {
    submitAnswer.mockResolvedValue({ data: null, error: { message: "tn:answers_closed" } });
    const { PUT } = await import("./route");
    const response = await PUT(put({ status: "attending", delayMinutes: null, reason: "", comment: "" }), ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "answers_closed" } });
  });

  it("is 404 for an unknown token and 400 for a bad body", async () => {
    submitAnswer.mockResolvedValue({ data: null, error: null });
    const { PUT } = await import("./route");
    expect((await PUT(put({ status: "attending", delayMinutes: null, reason: "", comment: "" }), ctx)).status).toBe(404);
    expect((await PUT(put({ status: "maybe" }), ctx)).status).toBe(400);
    expect(scheduleDispatch).not.toHaveBeenCalled();
  });
});
```

Same shape for `calendar/route.test.ts` (POST; `requestCalendar` → `true` → `{ ok: true }` + `scheduleDispatch`; `false` → 404; cross-origin → 403; `tn:invalid_choice` → 400).

In `src/app/api/r/[token]/route.test.ts` add: "GET never writes (Review Focus 1)": mock `@/server/queries/tokens` with `lookupToken`, `submitAnswer`, `requestCalendar`, `unsubscribeToken` as spies; call `GET` with `?choice=attending`; assert only `lookupToken` was called.

- [ ] **Step 7: Routes**

```ts
// src/app/api/r/[token]/response/route.ts
import { NextResponse } from "next/server";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadTokenContext } from "@/server/http/token-context";
import { submitAnswer } from "@/server/queries/tokens";
import { submitAnswerBodySchema } from "@/shared/api/responses";

/** The dispatch kicked after an answer may run this long (`DISPATCH_MAX_DURATION_S`). */
export const maxDuration = 60;

/**
 * Saves the member's answer (spec §7.3). Only our page calls this, so it checks Origin like any
 * mutation; the token is the credential (no cookie). The database applies the meeting's rules and
 * refreshes the calendar job; a dispatch run is kicked so a due job goes out without waiting for cron.
 */
export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/r/[token]/response">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, submitAnswerBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await submitAnswer(context.client, context.tokenHash, body.data);
  if (error) {
    return fromDatabaseError(error);
  }
  if (!data) {
    return apiError("not_found");
  }
  scheduleDispatch();
  return NextResponse.json(data);
}
```

```ts
// src/app/api/r/[token]/calendar/route.ts
import { NextResponse } from "next/server";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadTokenContext } from "@/server/http/token-context";
import { requestCalendar } from "@/server/queries/tokens";

/** The dispatch kicked after a request may run this long (`DISPATCH_MAX_DURATION_S`). */
export const maxDuration = 60;

/** Announcement meetings: "Email me a calendar invite" (spec §7.3). Opening the page never does this. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/r/[token]/calendar">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await requestCalendar(context.client, context.tokenHash);
  if (error) {
    return fromDatabaseError(error);
  }
  if (!data) {
    return apiError("not_found");
  }
  scheduleDispatch();
  return ok();
}
```

Add both routes to the `maxDuration` assertion in Task 2's `src/config/meetings.test.ts`.

- [ ] **Step 8: Hooks** (test with `renderHook` + fetch mock: `useSubmitAnswer` PUTs the body and, on success, the token-info cache's `answer` equals the response; assert with `waitFor`)

```ts
// src/hooks/use-token-page.ts (add)
/** Saves the member's answer and shows it at once (spec §7.3). */
export function useSubmitAnswer(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitAnswerBody) =>
      apiRequest(`/api/r/${token}/response`, {
        method: "PUT",
        body,
        schema: answerSchema,
        onUnauthenticated: noLogin,
      }),
    onSuccess: (answer) =>
      queryClient.setQueryData<TokenInfo>(key(token), (info) => (info ? { ...info, answer } : info)),
  });
}

/** "Email me a calendar invite" on an announcement. */
export function useRequestCalendar(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`/api/r/${token}/calendar`, {
        method: "POST",
        body: {},
        schema: okSchema,
        onUnauthenticated: noLogin,
      }),
    onSuccess: () =>
      queryClient.setQueryData<TokenInfo>(key(token), (info) => (info ? { ...info, calendarRequested: true } : info)),
  });
}
```

- [ ] **Step 9: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db`

```bash
git add -A && git commit -m "feat: answer and calendar token routes (M5)"
```

---
### Task 9: Answer page `/r/[token]` — choice cards, form, CONFIRMED stamp, every state

**Labels:** `type:task`, `area:frontend`, `area:i18n`. Branch `feat/<issue>-answer-page`.

**Files:**
- Modify: `src/app/r/[token]/page.tsx`; Delete: `src/app/r/[token]/response-placeholder.tsx` (+ its test if any) and the `placeholderTitle`/`placeholderBody` strings
- Create: `src/app/r/[token]/answer-view.tsx` (+ `answer-view.test.tsx`)
- Create: `src/app/r/[token]/choice-cards.tsx`, `src/app/r/[token]/answer-fields.tsx`, `src/app/r/[token]/answer-summary.tsx`, `src/app/r/[token]/not-you.tsx`, `src/app/r/[token]/announcement-calendar.tsx`
- Create: `src/lib/responses/describe-answer.ts` (+ test), `src/hooks/use-answer-labels.ts`
- Modify: `src/components/public/meeting-card.tsx` (agenda folded, "your time") (+ test)
- Modify: `src/components/motion/confirm-stamp.tsx` (`confetti` prop, default `true`) (+ test)
- Modify: `messages/en.json` (`AnswerPage` namespace)
- Create: `.superpowers/scripts/screens/answer-page.spec.ts` (git-ignored screenshots)

**Interfaces:**
- Consumes: Task 8's `useTokenInfo`, `useSubmitAnswer`, `useRequestCalendar`, `TokenInfo`, `choiceToStatus`, `statusesFor`, `needsReason`, `REASON_MAX`, `COMMENT_MAX`; Task 1's fixed `Stagger`; M4's `MeetingCard`, `InvalidLink`, `PublicPage`, `renderAgendaHtml`.
- Produces: `describeAnswer(labels: AnswerLabels, answer): string` and `useAnswerLabels(): AnswerLabels` (`src/hooks/use-answer-labels.ts`) — "Going", "Late by 20 min", "Can't come", "Not going"; reused by Tasks 13–15 for consistent wording.
- Produces: `ConfirmStamp` accepts `confetti?: boolean`.

**Page layout (decided 2026-10-08, "choice cards"):** meeting card → "Are you coming?" → one large card per choice (`RadioGroup`; the selected card shows its fields directly below its header, inside the same outlined block, never inside the radio button) → footer note → Confirm (names the answer) → "Answering as <name>. Not you?" + "Your answer is visible to <Workspace> organizers".

- [ ] **Step 1: Messages** (`messages/en.json`, new `AnswerPage` namespace)

```json
"AnswerPage": {
  "question": "Are you coming?",
  "choice": {
    "attending": "I'm going",
    "late": "I'll be late",
    "absent": "I can't come",
    "rsvpAttending": "Going",
    "not_attending": "Not going"
  },
  "delay": "How late?",
  "delayChip": "{minutes} min",
  "delayError": "Pick how late you'll be.",
  "reason": "Reason",
  "reasonOptional": "Reason (optional)",
  "reasonHint": "Only {workspace} organizers see it.",
  "reasonError": "Please add a reason.",
  "comment": "Comment (optional)",
  "confirm": {
    "attending": "Confirm: I'm going",
    "late": "Confirm: late by {minutes} min",
    "lateNoDelay": "Confirm: I'll be late",
    "absent": "Confirm: I can't come",
    "rsvpAttending": "Confirm: going",
    "not_attending": "Confirm: not going"
  },
  "saving": "Saving…",
  "confirmed": "CONFIRMED",
  "yourAnswer": "Your answer: {answer}",
  "answer": {
    "attending": "Going",
    "late": "Late by {minutes} min",
    "absent": "Can't come",
    "not_attending": "Not going"
  },
  "change": "Change",
  "calendarSent": "We emailed you a calendar invite.",
  "calendarUnsubscribed": "You unsubscribed from {workspace}, so we won't email you a calendar invite.",
  "subscribeAgain": "Subscribe again",
  "deadline": "Please answer by {deadline}.",
  "deadlinePassed": "The answer deadline has passed. You can still answer.",
  "closed": "The meeting has started, so answers are closed.",
  "closedCancelled": "This meeting was cancelled.",
  "noAnswerYet": "You didn't answer.",
  "answeringAs": "Answering as {name}.",
  "notYou": "Not you?",
  "notYouTitle": "This link is personal",
  "notYouBody": "Anyone with this link answers as {name}. If you got it from someone else, ask {workspace} for your own invite.",
  "visibility": "Your answer is visible to {workspace} organizers.",
  "announcement": "No answer needed.",
  "announcementCalendar": "Email me a calendar invite",
  "saveFailed": "Couldn't save your answer. Check your connection and try again.",
  "afterDeadline": "Saved after the deadline."
},
```

Add to `TokenPages`: `"agenda": "Agenda"`, `"showAgenda": "Show agenda"`, `"hideAgenda": "Hide agenda"`, `"yourTime": "Your time: {time}"`.

- [ ] **Step 2: `describeAnswer`** (failing test first). It takes ready-made labels so it stays a pure function and needs no cast around next-intl's typed `t`.

```ts
// src/lib/responses/describe-answer.test.ts
import { describe, expect, it } from "vitest";
import { describeAnswer, type AnswerLabels } from "./describe-answer";

const labels: AnswerLabels = {
  attending: "Going",
  late: (minutes) => `Late by ${minutes} min`,
  absent: "Can't come",
  not_attending: "Not going",
};

describe("describeAnswer", () => {
  it("names each status, with the delay for Late", () => {
    expect(describeAnswer(labels, { status: "late", delayMinutes: 20 })).toBe("Late by 20 min");
    expect(describeAnswer(labels, { status: "attending", delayMinutes: null })).toBe("Going");
    expect(describeAnswer(labels, { status: "not_attending", delayMinutes: null })).toBe("Not going");
  });
});
```

```ts
// src/lib/responses/describe-answer.ts
import type { Answer } from "@/shared/api/responses";

/** Wording of each answer (from `AnswerPage.answer.*`). */
export type AnswerLabels = {
  attending: string;
  late: (minutes: number) => string;
  absent: string;
  not_attending: string;
};

/** "Going", "Late by 20 min", "Can't come", "Not going". */
export function describeAnswer(
  labels: AnswerLabels,
  answer: Pick<Answer, "status" | "delayMinutes">,
): string {
  return answer.status === "late"
    ? labels.late(answer.delayMinutes ?? 0)
    : labels[answer.status];
}
```

```ts
// src/hooks/use-answer-labels.ts
"use client";

import { useTranslations } from "next-intl";
import type { AnswerLabels } from "@/lib/responses/describe-answer";

/** `AnswerLabels` from the current messages (answer page, meeting page, history). */
export function useAnswerLabels(): AnswerLabels {
  const t = useTranslations("AnswerPage.answer");
  return {
    attending: t("attending"),
    late: (minutes) => t("late", { minutes }),
    absent: t("absent"),
    not_attending: t("not_attending"),
  };
}
```

- [ ] **Step 3: `ConfirmStamp` confetti prop.** Add `confetti = true` to its props; render the pieces only when `animate && confetti`. Test: `render(<ConfirmStamp label="CONFIRMED" show confetti={false} />)` after a client mount → `queryAllByTestId("confetti-piece")` is empty.

- [ ] **Step 4: `MeetingCard`: agenda folded and "your time"** (failing tests first)

Tests (`src/components/public/meeting-card.test.tsx`):
- with `agendaMd: "**Bring** a laptop <script>x</script>"`: a "Show agenda" button; after a tap the agenda shows bold "Bring", and the literal text `<script>x</script>` (escaped, no script element: `container.querySelector("script")` is null).
- with `Intl.DateTimeFormat` mocked to report `Europe/Paris` and a Tunis meeting at 17:00Z: the line "Your time: 19:00" appears (Paris summer time, UTC+2 in early October; pick the instant accordingly); with the browser in `Africa/Tunis`, no such line.

Implementation:
- `const browserZone = useIsClient() ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;` and, when `browserZone && browserZone !== meeting.timezone`, render `t("yourTime", { time: format(new TZDate(meeting.startsAt, browserZone), "EEE d MMM, HH:mm") })` under the when line (server render shows nothing, so no hydration mismatch).
- Agenda: when `meeting.agendaMd`, a full-width ghost `Button` toggling `aria-expanded` and a `div` with `dangerouslySetInnerHTML={{ __html: renderAgendaHtml(meeting.agendaMd) }}` (same renderer and comment as the wizard preview: it escapes raw HTML and keeps only safe links).

- [ ] **Step 5: Failing page tests** (`src/app/r/[token]/answer-view.test.tsx`)

Render `AnswerView` inside `NextIntlClientProvider` + `QueryClientProvider`, mock `next/navigation` (`useParams` → `{ token }`, `useSearchParams` → the case's query), and mock `fetch` with `src/test/fetch.ts` routes: `GET /api/r/<token>` → a `TokenInfo` fixture (attendance meeting tomorrow, `reasonRequired: true`, delays `[10, 20, 30]`, no answer); `PUT /api/r/<token>/response` → echoes an `Answer`. Cases:

```tsx
it("pre-selects the email's choice and saves nothing until Confirm (Review Focus 1)", async () => {
  renderWith("?choice=late");
  expect(await screen.findByRole("radio", { name: "I'll be late" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Confirm: I'll be late" })).toBeInTheDocument();
  expect(fetchCalls("PUT")).toHaveLength(0);
});

it("ignores a choice the meeting doesn't offer", async () => {
  renderWith("?choice=not_going");
  await screen.findByText("Are you coming?");
  expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
});

it("asks for a delay and a reason before saving Late", async () => {
  renderWith("?choice=late");
  fireEvent.click(await screen.findByRole("button", { name: "Confirm: I'll be late" }));
  expect(await screen.findByText("Pick how late you'll be.")).toBeInTheDocument();
  expect(screen.getByText("Please add a reason.")).toBeInTheDocument();
  expect(fetchCalls("PUT")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "20 min" }));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Bus from campus" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm: late by 20 min" }));
  await waitFor(() => expect(fetchCalls("PUT")).toHaveLength(1));
  expect(JSON.parse(fetchCalls("PUT")[0].body)).toEqual({ status: "late", delayMinutes: 20, reason: "Bus from campus", comment: "" });
  expect(await screen.findByText("CONFIRMED")).toBeInTheDocument();
  expect(screen.getByText("Your answer: Late by 20 min")).toBeInTheDocument();
  expect(screen.getByText("We emailed you a calendar invite.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("status").closest("[tabindex='-1']")).toHaveFocus());
});

it("saves Going in one tap, without a reason box", async () => {
  renderWith("?choice=attending");
  expect(screen.queryByLabelText(/Reason/)).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Confirm: I'm going" }));
  expect(await screen.findByText("Your answer: Going")).toBeInTheDocument();
});

it("shows a saved answer with Change, and Change keeps the values", async () => {
  renderWith("", { answer: { status: "absent", delayMinutes: null, reason: "Exam", comment: "", afterDeadline: false, respondedAt: NOW, updatedAt: NOW } });
  expect(await screen.findByText("Your answer: Can't come")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  expect(screen.getByRole("radio", { name: "I can't come" })).toBeChecked();
  expect(screen.getByLabelText("Reason")).toHaveValue("Exam");
});

it("is read-only after the start (Review Focus 3)", async () => {
  renderWith("?choice=attending", { meeting: { startsAt: new Date(Date.now() - 60_000).toISOString() } });
  expect(await screen.findByText("The meeting has started, so answers are closed.")).toBeInTheDocument();
  expect(screen.queryByRole("radio")).toBeNull();
});

it("keeps answering open after the deadline and says so", async () => {
  renderWith("", { answers: { responseDeadline: new Date(Date.now() - 60_000).toISOString() } });
  expect(await screen.findByText("The answer deadline has passed. You can still answer.")).toBeInTheDocument();
  expect(screen.getAllByRole("radio")).toHaveLength(3);
});

it("shows a reason as text, never as HTML (Review Focus 4)", async () => {
  const { container } = renderWith("", { answer: { status: "absent", delayMinutes: null, reason: "<img src=x onerror=alert(1)>", comment: "", afterDeadline: false, respondedAt: NOW, updatedAt: NOW } });
  expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
});

it("offers the calendar email on an announcement", async () => {
  renderWith("", { answers: { responseMode: "announcement" } });
  fireEvent.click(await screen.findByRole("button", { name: "Email me a calendar invite" }));
  await waitFor(() => expect(fetchCalls("POST")).toHaveLength(1));
  expect(await screen.findByText("We emailed you a calendar invite.")).toBeInTheDocument();
});

it("tells an unsubscribed member that no calendar email comes", async () => {
  renderWith("?choice=attending", { unsubscribed: true });
  fireEvent.click(await screen.findByRole("button", { name: "Confirm: I'm going" }));
  expect(await screen.findByText(/won't email you a calendar invite/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Subscribe again" })).toHaveAttribute("href", `/u/${TOKEN}`);
});

it("moves to the closed state when the server says answers closed meanwhile", async () => {
  respondWith("PUT", 409, { error: { code: "answers_closed" } });
  renderWith("?choice=attending");
  fireEvent.click(await screen.findByRole("button", { name: "Confirm: I'm going" }));
  expect(await screen.findByText("The meeting has started, so answers are closed.")).toBeInTheDocument();
});
```

(`renderWith(search, overrides)` builds the fixture with deep overrides; `fetchCalls(method)` and `respondWith(method, status, body)` are small helpers over the fetch mock; write them at the top of the test file.)

- [ ] **Step 6: Implement.** Key pieces (complete the JSX with the repo's primitives: `Card`, `Button`, `Chip`, `Textarea`, `RadioGroup`/`RadioCard`, `Sticker`, Phosphor Bold icons `CheckCircle`, `Clock`, `XCircle`, `CalendarCheck`, `Question`):

```tsx
// src/app/r/[token]/page.tsx
import { Suspense } from "react";
import { PublicPage } from "@/components/public/public-page";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswerView } from "./answer-view";

/** `/r/[token]`: a member's personal answer page (spec §7.3). No session needed. */
export default function Page() {
  return (
    <PublicPage>
      {/* AnswerView reads ?choice= through useSearchParams. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <AnswerView />
      </Suspense>
    </PublicPage>
  );
}
```

```tsx
// src/app/r/[token]/answer-view.tsx (core logic; layout per the decided mockup)
"use client";

/** States: loading → invalid | closed | announcement | answered (summary) | answering (form). */
export function AnswerView() {
  const t = useTranslations("AnswerPage");
  const { token } = useParams<{ token: string }>();
  const search = useSearchParams();
  const info = useTokenInfo(token);
  const submit = useSubmitAnswer(token);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [closedByServer, setClosedByServer] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  if (info.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (!info.data) {
    return <InvalidLink limited={info.error instanceof ApiClientError && info.error.code === "rate_limited"} />;
  }
  const data = info.data;
  const { meeting, answers, answer } = data;
  const started = !meeting.startsAt || new Date(meeting.startsAt) <= new Date();
  const closed = closedByServer || meeting.status !== "scheduled" || started;
  const deadlinePassed = answers.responseDeadline !== null && new Date(answers.responseDeadline) < new Date();

  const save = (body: SubmitAnswerBody) =>
    submit.mutate(body, {
      onSuccess: () => {
        setEditing(false);
        setJustSaved(true);
        // WCAG 2.4.3: move focus to the result once it has rendered.
        requestAnimationFrame(() => statusRef.current?.focus());
      },
      onError: (error) => {
        if (error instanceof ApiClientError && error.code === "answers_closed") {
          setClosedByServer(true);
        }
      },
    });

  return (
    <Stagger className="flex flex-col gap-4">
      <StaggerItem><MeetingHeader workspaceName={data.workspaceName} /></StaggerItem>
      <StaggerItem><MeetingCard meeting={meeting} /></StaggerItem>
      {closed ? (
        <ClosedState meeting={meeting} answer={answer} />
      ) : answers.responseMode === "announcement" ? (
        <AnnouncementCalendar token={token} info={data} />
      ) : answer && !editing ? (
        <AnswerSummary
          ref={statusRef}
          info={data}
          answer={answer}
          celebrate={justSaved}
          onChange={() => { setEditing(true); setJustSaved(false); }}
        />
      ) : (
        <ChoiceCards
          info={data}
          initialStatus={answer?.status ?? choiceToStatus(search.get("choice"), answers.responseMode)}
          initial={answer}
          deadlinePassed={deadlinePassed}
          saving={submit.isPending}
          serverError={submit.error instanceof ApiClientError && submit.error.code !== "answers_closed" ? submit.error.code : submit.error ? "saveFailed" : null}
          onConfirm={save}
        />
      )}
      <StaggerItem><Footer token={token} info={data} /></StaggerItem>
    </Stagger>
  );
}
```

`ChoiceCards` (in `choice-cards.tsx`) owns the selection and field state:

```tsx
export function ChoiceCards({ info, initialStatus, initial, deadlinePassed, saving, serverError, onConfirm }: {
  info: TokenInfo; initialStatus: AnswerStatus | null; initial: Answer | null; deadlinePassed: boolean;
  saving: boolean; serverError: string | null; onConfirm: (body: SubmitAnswerBody) => void;
}) {
  const t = useTranslations("AnswerPage");
  const { answers } = info;
  const [status, setStatus] = useState<AnswerStatus | null>(initialStatus);
  const [delay, setDelay] = useState<number | null>(initial?.delayMinutes ?? null);
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [tried, setTried] = useState(false);
  const delayMissing = status === "late" && delay === null;
  const reasonMissing = status !== null && needsReason(status) && answers.reasonRequired && reason.trim() === "";
  const confirmLabel = status === null ? null : confirmText(t, answers.responseMode, status, delay);

  const confirm = () => {
    setTried(true);
    if (status === null || delayMissing || reasonMissing) {
      return;
    }
    onConfirm({
      status,
      delayMinutes: status === "late" ? delay : null,
      reason: needsReason(status) ? reason.trim() : "",
      comment: answers.commentsEnabled ? comment.trim() : "",
    });
  };

  return (
    <section aria-labelledby="answer-question" className="flex flex-col gap-3">
      {answers.responseDeadline ? (
        <p className="text-sm font-bold">
          {deadlinePassed ? t("deadlinePassed") : t("deadline", { deadline: formatDeadline(answers.responseDeadline, info.meeting.timezone) })}
        </p>
      ) : null}
      <h2 id="answer-question" className="font-display text-xl">{t("question")}</h2>
      <RadioGroup value={status ?? ""} onValueChange={(next) => setStatus(answerStatusSchema.parse(next))} aria-labelledby="answer-question">
        {statusesFor(answers.responseMode).map((option) => (
          <div key={option} className={cn("flex flex-col gap-3 rounded-card", status === option && "border-[length:var(--tn-border-width)] border-outline p-2", STATUS_FILL[option])}>
            <RadioCard value={option} className="min-h-14 text-base">{choiceText(t, answers.responseMode, option)}</RadioCard>
            {status === option ? (
              <AnswerFields
                status={option}
                info={info}
                delay={delay}
                onDelay={setDelay}
                reason={reason}
                onReason={setReason}
                comment={comment}
                onComment={setComment}
                delayError={tried && delayMissing ? t("delayError") : undefined}
                reasonError={tried && reasonMissing ? t("reasonError") : undefined}
              />
            ) : null}
          </div>
        ))}
      </RadioGroup>
      {answers.footerNote ? <p className="text-sm text-muted-ink whitespace-pre-line">{answers.footerNote}</p> : null}
      {serverError ? <p role="alert" className="font-bold">{serverError === "saveFailed" ? t("saveFailed") : tErrors(serverError)}</p> : null}
      <Button tone="primary" size="lg" className="justify-center" disabled={status === null || saving} aria-busy={saving} onClick={confirm}>
        {saving ? t("saving") : (confirmLabel ?? t("question"))}
      </Button>
    </section>
  );
}
```

with `STATUS_FILL = { attending: "bg-fill-success", late: "bg-fill-warning", absent: "bg-fill-danger", not_attending: "bg-fill-danger" }` applied to the selected block only, `choiceText` mapping RSVP `attending` to `choice.rsvpAttending`, and `confirmText` mapping to `confirm.*` (`late` without a delay → `confirm.lateNoDelay`). `AnswerFields` renders, for Late, the delay chips (`Chip` with `aria-pressed`, `tone="warning"`, one selected at a time, in a `role="group"` labelled "How late?", error text below linked with `aria-describedby`); for Late/Absent/Not going the `Textarea` labelled "Reason" (required) or "Reason (optional)" with `maxLength={REASON_MAX}` and the hint; when `commentsEnabled`, the comment `Textarea` (`maxLength={COMMENT_MAX}`) for every status. The chip row hides its scrollbar (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`) and wraps on narrow screens.

`AnswerSummary` (`forwardRef` is not needed in React 19: take `ref` as a prop): a `div tabIndex={-1} ref={ref}` containing `ConfirmStamp label={t("confirmed")} show={celebrate} confetti={answer.status === "attending"}`, `t("yourAnswer", { answer: describeAnswer(useAnswerLabels(), answer) })`, the reason and comment as plain text (`whitespace-pre-line break-words`), `after_deadline` note, the calendar line (attending/late: `calendarSent`, or `calendarUnsubscribed` + `Link href={`/u/${token}`}` "Subscribe again" when `info.unsubscribed`), and a `Button` "Change".

`ClosedState`: `closedCancelled` for a cancelled meeting, else `closed`, then the saved answer (`yourAnswer`) or `noAnswerYet`. `AnnouncementCalendar`: `announcement` text, then (not unsubscribed, not requested) the "Email me a calendar invite" button using `useRequestCalendar`, else `calendarSent` / `calendarUnsubscribed`. `Footer`: `answeringAs` + `NotYou` (a `Popover` with `p-1.5` inner padding holding `notYouTitle` / `notYouBody`) and `visibility`. `MeetingHeader`: workspace sticker + "<Workspace> invites you" (reuse `Email.meetingInvite.invitedBy` wording by adding `AnswerPage.invitedBy: "{workspace} invites you"`).

- [ ] **Step 7: Run the tests — expect PASS.** `bun run test src/app/r src/components/public src/components/motion src/lib/responses`

- [ ] **Step 8: Screenshots** (`.superpowers/scripts/screens/answer-page.spec.ts`): seed an invitee (admin client; `deriveInviteeToken` from `e2e/helpers/seed-sender.ts`'s test secret) and capture at 390 light / 320 dark / 1024: fresh page from `?choice=late` with Late open; the validation errors; the CONFIRMED summary for Late; Going summary; an RSVP meeting; an announcement before/after the calendar tap; the closed state; the "Not you?" popover; the agenda open; a 500-character reason. Look at every shot: no horizontal scroll at 320 px, the selected block's fill readable in dark mode, Confirm ≥ 44 px, chips wrap.

- [ ] **Step 9: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:e2e e2e/meetings.spec.ts`

```bash
git add -A && git commit -m "feat: the answer page on personal links (M5)"
```

---
### Task 10: `.ics` builder, calendar confirmation email, MIME calendar part, announcement button

**Labels:** `type:task`, `area:email`, `area:calendar`, `area:i18n`. Branch `feat/<issue>-calendar-email`.

**Files:**
- Create: `src/lib/calendar/ics.ts` (+ `ics.test.ts`)
- Create: `src/emails/calendar-confirm-email.tsx` (+ `calendar-confirm-email.test.tsx`)
- Modify: `src/emails/meeting-invite-email.tsx` (+ test): announcement gets an "Add to my calendar" button
- Modify: `src/server/gmail/mime.ts` (+ `mime.test.ts`): optional calendar part
- Modify: `messages/en.json` (`Email.calendarConfirm`, `Email.meetingInvite.addToCalendar`)

**Interfaces:**
- Produces: `buildMeetingIcs(input: MeetingIcsInput): string` with
  ```ts
  export type MeetingIcsInput = {
    method: "REQUEST" | "CANCEL";
    uid: string;
    sequence: number;
    stamp: Date;
    start: Date;
    durationMinutes: number;
    title: string;
    description: string;
    location: string;
    url: string | null;
    organizer: { name: string; email: string };
    attendee: { name: string; email: string };
  };
  ```
  CRLF line endings, 75-octet folding, RFC 5545 TEXT escaping, UTC `DTSTART`/`DTEND`/`DTSTAMP`, `PRODID:-//<APP_NAME>//Meetings//EN`.
- Produces: `icsDescription(meeting: { agendaMd: string; onlineText: string; locationMode: LocationMode }): string` and `icsLocation(meeting): string` (place and/or online words; no personal link anywhere in the event).
- Produces: `renderCalendarConfirmEmail(props: CalendarConfirmEmailProps): Promise<{ subject: string; html: string; text: string }>` with `props = { action: "request" | "cancel"; workspaceName; recipientName; senderEmail; meeting: MeetingInviteEmailProps["meeting"]; links: { respond: string; unsubscribe: string; report: string } }`.
- Produces: `buildMeetingMime(input)` accepts `calendar?: { method: "REQUEST" | "CANCEL"; ics: string }` → `icalEvent { method, filename: "invite.ics", content }` (a `text/calendar; method=…` alternative + an `application/ics` attachment).

- [ ] **Step 1: Failing `.ics` tests**

```ts
// src/lib/calendar/ics.test.ts
import { describe, expect, it } from "vitest";
import { buildMeetingIcs, icsLocation, type MeetingIcsInput } from "./ics";

const BASE: MeetingIcsInput = {
  method: "REQUEST",
  uid: "abc@tapnshow.vercel.app",
  sequence: 0,
  stamp: new Date("2026-10-08T12:00:00Z"),
  start: new Date("2026-10-09T17:00:00Z"),
  durationMinutes: 90,
  title: "Weekly sync",
  description: "Agenda",
  location: "Room B12",
  url: "https://meet.google.com/abc-defg-hij",
  organizer: { name: "GDG ISSAT", email: "club@gmail.com" },
  attendee: { name: "Amira B.", email: "amira@uni.tn" },
};

const lines = (ics: string) => ics.split("\r\n");

describe("buildMeetingIcs", () => {
  it("writes a pre-accepted REQUEST with UTC times and CRLF endings", () => {
    const ics = buildMeetingIcs(BASE);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(lines(ics)).toEqual(expect.arrayContaining([
      "BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:REQUEST", "BEGIN:VEVENT",
      "UID:abc@tapnshow.vercel.app", "SEQUENCE:0",
      "DTSTAMP:20261008T120000Z", "DTSTART:20261009T170000Z", "DTEND:20261009T183000Z",
      "SUMMARY:Weekly sync", "STATUS:CONFIRMED",
      'ORGANIZER;CN="GDG ISSAT":mailto:club@gmail.com',
      'ATTENDEE;CN="Amira B.";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:amira@uni.tn',
      "END:VEVENT", "END:VCALENDAR",
    ]));
  });

  it("cancels with the same UID and a higher sequence", () => {
    const ics = buildMeetingIcs({ ...BASE, method: "CANCEL", sequence: 1 });
    expect(lines(ics)).toEqual(expect.arrayContaining(["METHOD:CANCEL", "SEQUENCE:1", "STATUS:CANCELLED"]));
  });

  it("escapes TEXT values and strips quotes and line breaks from names (Review Focus 4)", () => {
    const ics = buildMeetingIcs({
      ...BASE,
      title: 'Sync; plan, review\\notes',
      description: "Line 1\nLine 2\r\nLine 3",
      attendee: { name: 'Amira "the boss"\r\nX-INJECT:1', email: "amira@uni.tn" },
    });
    expect(ics).toContain("SUMMARY:Sync\\; plan\\, review\\\\notes");
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2\\nLine 3");
    expect(ics).toContain('ATTENDEE;CN="Amira the boss X-INJECT:1";');
    expect(lines(ics).some((line) => line.startsWith("X-INJECT"))).toBe(false);
  });

  it("folds lines longer than 75 octets without splitting a character", () => {
    const ics = buildMeetingIcs({ ...BASE, description: "é".repeat(120) });
    for (const line of lines(ics)) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`DESCRIPTION:${"é".repeat(120)}`);
  });

  it("omits URL when there is no link", () => {
    expect(buildMeetingIcs({ ...BASE, url: null })).not.toContain("URL:");
  });
});

describe("icsLocation", () => {
  it("joins the place and the online words for hybrid meetings", () => {
    expect(icsLocation({ locationMode: "hybrid", locationText: "Room B12", onlineText: "Club Discord" })).toBe("Room B12 · Club Discord");
    expect(icsLocation({ locationMode: "online", locationText: "", onlineText: "Club Discord" })).toBe("Club Discord");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `bun run test src/lib/calendar/ics.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/calendar/ics.ts
import { addMinutes } from "date-fns";
import { APP_NAME } from "@/config/app";
import type { LocationMode } from "@/shared/api/meeting-settings";

/** One calendar invitation for one member (spec §9 Calendar files). */
export type MeetingIcsInput = {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  stamp: Date;
  start: Date;
  durationMinutes: number;
  title: string;
  description: string;
  location: string;
  url: string | null;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
};

const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** RFC 5545 §3.3.11 TEXT: escape backslash, semicolon, comma; line breaks become `\n`. */
function text(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** A quoted parameter value (RFC 5545 §3.1): no DQUOTE and no control characters allowed. */
function param(value: string): string {
  return `"${value.replace(/["\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim()}"`;
}

/** `20261009T170000Z`. */
function utc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 §3.1 folding: at most 75 octets per line, continuation lines start with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    const limit = out.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** Where the meeting happens, in words (place and/or online place; never a personal link). */
export function icsLocation(meeting: {
  locationMode: LocationMode;
  locationText: string;
  onlineText: string;
}): string {
  const parts = [
    meeting.locationMode !== "online" ? meeting.locationText : "",
    meeting.locationMode !== "in_person" ? meeting.onlineText : "",
  ].filter((part) => part !== "");
  return parts.join(" · ");
}

/**
 * A pre-accepted `REQUEST` (the member as attendee, `PARTSTAT=ACCEPTED`, `RSVP=FALSE`, so Gmail
 * shows no Yes/No/Maybe buttons) or a `CANCEL` for the same UID (spec §9, S2).
 */
export function buildMeetingIcs(input: MeetingIcsInput): string {
  const cancel = input.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    `PRODID:-//${APP_NAME}//Meetings//EN`,
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${utc(input.stamp)}`,
    `DTSTART:${utc(input.start)}`,
    `DTEND:${utc(addMinutes(input.start, input.durationMinutes))}`,
    `SUMMARY:${text(input.title)}`,
    ...(input.description ? [`DESCRIPTION:${text(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${text(input.location)}`] : []),
    ...(input.url ? [`URL:${input.url}`] : []),
    `ORGANIZER;CN=${param(input.organizer.name)}:mailto:${input.organizer.email}`,
    cancel
      ? `ATTENDEE;CN=${param(input.attendee.name)};ROLE=REQ-PARTICIPANT:mailto:${input.attendee.email}`
      : `ATTENDEE;CN=${param(input.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${input.attendee.email}`,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}
```

Notes: `meeting_url` is already restricted to `https?://` without whitespace by the database check, so `URL:` needs no escaping. `icsDescription` = the agenda Markdown as plain text (keep the raw Markdown; calendar apps show it as text) — add it with a one-line test. The S2 cosmetic note ("Unnamed attendee") is covered by `CN`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: MIME calendar part** (failing test first, in `src/server/gmail/mime.test.ts`):

```ts
it("adds the calendar invitation as an alternative and an invite.ics attachment", async () => {
  const raw = await buildMeetingMime({ ...BASE_INPUT, calendar: { method: "REQUEST", ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" } });
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  expect(mime).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REQUEST/i);
  expect(mime).toMatch(/Content-Type: application\/ics; name=invite\.ics/i);
  expect(mime).toContain("List-Unsubscribe:");
});
```

(Adapt the header assertions to nodemailer's exact casing once you see one built message; keep the meaning: a `text/calendar` part with `method=REQUEST`, an `invite.ics` attachment, unsubscribe headers still present.) Implementation: add `calendar?: { method: "REQUEST" | "CANCEL"; ics: string };` to `MeetingMimeInput` and `...(input.calendar ? { icalEvent: { method: input.calendar.method, filename: "invite.ics", content: input.calendar.ics } } : {})` to the `MailComposer` options.

- [ ] **Step 6: Calendar email** (failing tests first)

```tsx
// src/emails/calendar-confirm-email.test.tsx
import { describe, expect, it } from "vitest";
import { renderCalendarConfirmEmail } from "./calendar-confirm-email";

const PROPS = {
  action: "request" as const,
  workspaceName: "GDG ISSAT",
  recipientName: "Amira",
  senderEmail: "club@gmail.com",
  meeting: {
    title: "Weekly sync", agendaMd: "", startsAt: "2026-10-09T17:00:00Z", durationMinutes: 60,
    timezone: "Africa/Tunis", locationMode: "in_person" as const, locationText: "Room B12", onlineText: "",
    meetingUrl: "", responseMode: "attendance" as const, responseDeadline: null,
  },
  links: { respond: "https://app.test/r/TOKEN", unsubscribe: "https://app.test/u/TOKEN", report: "https://app.test/report/TOKEN" },
};

describe("calendar confirmation email", () => {
  it("names the meeting in the subject and links to change the answer", async () => {
    const email = await renderCalendarConfirmEmail(PROPS);
    expect(email.subject).toBe("In your calendar: Weekly sync · Fri 9 Oct, 18:00");
    expect(email.html).toContain("https://app.test/r/TOKEN");
    expect(email.text).toContain("Not in your calendar yet?");
    expect(email.html).toContain("https://app.test/u/TOKEN");
  });

  it("says the event was removed after a switch to Absent", async () => {
    const email = await renderCalendarConfirmEmail({ ...PROPS, action: "cancel" });
    expect(email.subject).toBe("Removed from your calendar: Weekly sync · Fri 9 Oct, 18:00");
    expect(email.text).not.toContain("Not in your calendar yet?");
  });

  it("has no Change-your-answer link for an announcement", async () => {
    const email = await renderCalendarConfirmEmail({ ...PROPS, meeting: { ...PROPS.meeting, responseMode: "announcement" } });
    expect(email.html).not.toContain("https://app.test/r/TOKEN");
  });
});
```

Messages (`Email.calendarConfirm`):

```json
"calendarConfirm": {
  "subjectRequest": "In your calendar: {title} · {date}, {time}",
  "subjectCancel": "Removed from your calendar: {title} · {date}, {time}",
  "preview": "{title}: {date}, {time}",
  "greeting": "Hi {name},",
  "requestBody": "Here is {title} for your calendar.",
  "cancelBody": "You said you can't come, so {title} is no longer in your calendar.",
  "notYet": "Not in your calendar yet? Open the invitation in this email and add it.",
  "change": "Change your answer"
}
```

and `Email.meetingInvite.addToCalendar`: `"Add to my calendar"`.

Implementation (`src/emails/calendar-confirm-email.tsx`): same `EmailLayout`, sticker, footer (sent-from, unsubscribe, not my group) and When/Where/Join blocks as `MeetingInviteEmail` — **extract those shared blocks into `src/emails/meeting-blocks.tsx`** (`MeetingWhenWhere`, `MeetingFooter`) and use them in both templates, so the invite email's tests keep passing unchanged. Body: greeting, `requestBody` or `cancelBody`, When/Where (request only), `notYet` (request only), and a "Change your answer" button to `links.respond` unless `responseMode === "announcement"`. Subject from `meetingSubject`-style formatting through the translator.

- [ ] **Step 7: Announcement button in the invite email.** In `MeetingInviteEmail`, replace the announcement branch (`choices.length === 0`) with `noAnswer` text plus a `Button` "Add to my calendar" to `links.respond` (no `?choice`). Test: an announcement invite's HTML contains `href="https://app.test/r/TOKEN"` and "Add to my calendar"; attendance invites are unchanged.

- [ ] **Step 8: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test`

```bash
git add -A && git commit -m "feat: calendar invitation file and confirmation email (M5)"
```

---
### Task 11: Dispatcher sends `calendar_confirm` jobs

**Labels:** `type:task`, `area:pipeline`, `area:calendar`. Branch `feat/<issue>-calendar-dispatch`.

**Files:**
- Modify: `src/server/queries/dispatch.ts` (claim `kind` + `ics_uid`; reserve `calendar`)
- Modify: `src/server/dispatch/run-dispatch.ts` (+ `run-dispatch.test.ts`)
- Modify: `src/server/dispatch/run-dispatch.db.test.ts` (calendar emails against the fake Gmail)

**Interfaces:**
- Consumes: Task 4 (`kind`, `ics_uid`, `{ kind: "ok", calendar: { action, sequence } }`, kind-aware finish), Task 10 (`buildMeetingIcs`, `icsLocation`, `icsDescription`, `renderCalendarConfirmEmail`, `buildMeetingMime({ calendar })`), Task 2 (cap defers the sender).
- Produces: `ClaimedJob.kind: "invite" | "calendar_confirm"`, `ClaimedJob.meeting.icsUid: string`; `ReserveResult` `ok` variant `{ kind: "ok"; calendar: { action: "request" | "cancel"; sequence: number } | null }`.
- Produces: `DispatchSummary.calendar` (calendar emails sent; also counted in `sent`).

- [ ] **Step 1: Failing unit tests** (in `run-dispatch.test.ts`, with the file's fake store/deps; add a `calendarJob()` builder next to the existing invite job builder)

```ts
it("sends a pre-accepted calendar invitation for a calendar job, in the meeting's thread", async () => {
  const job = calendarJob({ meeting: { threadId: "t-1", rootMessageId: "<root@app>" } });
  const store = fakeStore({
    claim: vi.fn().mockResolvedValueOnce(claimWithJobs([job])).mockResolvedValue(null),
    reserve: vi.fn(async () => ({ kind: "ok" as const, calendar: { action: "request" as const, sequence: 0 } })),
  });
  const deps = fakeDeps({ store });
  const summary = await runDispatch(deps, OPTIONS);
  const sent = vi.mocked(deps.gmail).mock.calls[0][0];
  expect(sent.threadId).toBe("t-1");
  const mime = Buffer.from(sent.raw, "base64url").toString("utf8");
  expect(mime).toMatch(/method=REQUEST/i);
  expect(mime).toContain("PARTSTAT=ACCEPTED");
  expect(mime).toContain(`UID:${job.meeting.icsUid}`);
  expect(store.finish).toHaveBeenCalledWith(job.jobId, "sent", null, expect.any(String));
  expect(summary).toMatchObject({ sent: 1, calendar: 1 });
});

it("sends a CANCEL with the given sequence", async () => {
  const job = calendarJob();
  const store = fakeStore({
    claim: vi.fn().mockResolvedValueOnce(claimWithJobs([job])).mockResolvedValue(null),
    reserve: vi.fn(async () => ({ kind: "ok" as const, calendar: { action: "cancel" as const, sequence: 3 } })),
  });
  const deps = fakeDeps({ store });
  await runDispatch(deps, OPTIONS);
  const mime = Buffer.from(vi.mocked(deps.gmail).mock.calls[0][0].raw, "base64url").toString("utf8");
  expect(mime).toMatch(/method=CANCEL/i);
  expect(mime).toContain("SEQUENCE:3");
  expect(mime).toContain("STATUS:CANCELLED");
});

it("sends nothing when the reservation says there is nothing to do (quick flips)", async () => {
  const store = fakeStore({
    claim: vi.fn().mockResolvedValueOnce(claimWithJobs([calendarJob()])).mockResolvedValue(null),
    reserve: vi.fn(async () => ({ kind: "done" as const })),
  });
  const deps = fakeDeps({ store });
  await runDispatch(deps, OPTIONS);
  expect(deps.gmail).not.toHaveBeenCalled();
});
```

Add one more case: "the calendar event carries no personal link" — `vi.spyOn(icsModule, "buildMeetingIcs")` (import `* as icsModule from "@/lib/calendar/ics"`), run a calendar job, and assert `expect(spy.mock.results[0].value).not.toContain("/r/")` and `.not.toContain(deps.tokenFor(job.inviteeId))`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

`src/server/queries/dispatch.ts`: add `kind: z.enum(["invite", "calendar_confirm"])` to the claimed job, `ics_uid: z.string()` to its meeting, map to `kind` and `meeting.icsUid`; change the reserve schema's `ok` variant to `z.object({ kind: z.literal("ok"), calendar: z.object({ action: z.enum(["request", "cancel"]), sequence: z.number().int() }).optional() })` and transform it to `{ kind: "ok", calendar: db.calendar ?? null }`.

`src/server/dispatch/run-dispatch.ts`:
- `DispatchSummary` gains `calendar: number` (initialized to 0).
- In `drainSender`, pass the reservation on: `const outcome = await sendJob(deps, run, session, job, reservation.calendar, summary);`. A calendar job whose reservation has no `calendar` decision is a bug: log it, `finish(job.jobId, "failed", "no_calendar_decision", null)`, continue.
- In `sendJob`, choose the email by kind:

```ts
  const links = {
    respond: `${deps.appUrl}/r/${token}`,
    unsubscribe: `${deps.appUrl}/u/${token}`,
    report: `${deps.appUrl}/report/${token}`,
  };
  const email =
    job.kind === "calendar_confirm" && calendar
      ? await renderCalendarConfirmEmail({
          action: calendar.action,
          workspaceName: job.workspaceName,
          recipientName: job.contact.fullName,
          senderEmail: session.claim.connection.googleEmail,
          meeting: job.meeting,
          links,
        })
      : await renderMeetingInviteEmail({
          workspaceName: job.workspaceName,
          recipientName: job.contact.fullName,
          senderEmail: session.claim.connection.googleEmail,
          meeting: job.meeting,
          links,
        });
  const ics =
    job.kind === "calendar_confirm" && calendar
      ? buildMeetingIcs({
          method: calendar.action === "request" ? "REQUEST" : "CANCEL",
          uid: job.meeting.icsUid,
          sequence: calendar.sequence,
          stamp: new Date(deps.now()),
          start: new Date(job.meeting.startsAt),
          durationMinutes: job.meeting.durationMinutes,
          title: job.meeting.title,
          description: icsDescription(job.meeting),
          location: icsLocation(job.meeting),
          url: job.meeting.locationMode !== "in_person" && job.meeting.meetingUrl ? job.meeting.meetingUrl : null,
          organizer: { name: job.workspaceName, email: session.claim.connection.googleEmail },
          attendee: { name: job.contact.fullName, email: job.contact.email },
        })
      : null;
```

  and pass `calendar: ics ? { method: calendar.action === "request" ? "REQUEST" : "CANCEL", ics } : undefined` to `buildMeetingMime`. On `sent`, `summary.calendar += 1` for calendar jobs. Everything else (auth refresh, `thread_missing` retry, `unknown`, throttling, broken sender) is shared unchanged; `finish` already records the right thing per kind in SQL.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Integration test** (`run-dispatch.db.test.ts`, which already runs the dispatcher against the local DB and a fake Gmail endpoint): seed a sender, a scheduled meeting with one invitee, run once for the invite; then `token_submit_response` Going, set the calendar job's `run_after` to the past, run again → the fake Gmail got a second message with `threadId` equal to the first message's thread and a `text/calendar; method=REQUEST` part, and the invitee's `calendar_state` is `added`; then Absent → run → a `method=CANCEL` message; then Going → Absent → Going without a run in between, run → no new message (Review Focus 2).

- [ ] **Step 6: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db`

```bash
git add -A && git commit -m "feat: the dispatcher sends calendar confirmation emails (M5)"
```

- [ ] **Step 7: First local calendar email to the Owner (manual, Owner's own address only).** With the dev server on `.env.local` (preview DB) and the Owner's Gmail connected in a test workspace: send a test meeting to the Owner's own address, answer Going from the email link, then trigger the dispatcher (`curl -X POST -H "Authorization: Bearer $DISPATCH_SECRET" http://localhost:3000/api/internal/dispatch` with the secret read from `.env.local` by the shell, never printed) after a minute, or temporarily set `calendar_confirm_delay_seconds` to 0 on the preview DB **only if the Owner approves writing to the shared preview DB** (auto-mode may block it; ask once). Ask the Owner to confirm the email arrived in the same Sent thread and shows the calendar card. Record in the ledger.

---
### Task 12: Organizer API and hooks — results, people pages, history, attendance

**Labels:** `type:task`, `area:api`. Branch `feat/<issue>-results-api`.

**Files:**
- Modify: `src/shared/api/responses.ts` (+ test): results, people, history, attendance schemas; `periodQuerySchema`
- Create: `src/server/queries/results.ts`
- Create: `src/app/api/workspaces/[slug]/meetings/[id]/results/route.ts`, `…/meetings/[id]/people/route.ts`, `src/app/api/workspaces/[slug]/contacts/[id]/history/route.ts`, `src/app/api/workspaces/[slug]/attendance/route.ts`, `src/app/api/workspaces/[slug]/attendance/details/route.ts` (+ a `route.test.ts` each)
- Create: `src/hooks/use-results.ts` (+ test)

**Interfaces:**
- Consumes: Task 7's five functions; Task 5's pagination helpers; M4's `loadWorkspaceContext`, `loadMeetingContext`.
- Produces (schemas):
  ```ts
  export const meetingResultsSchema = z.object({
    responseMode: responseModeSchema,
    emails: z.object({ total: int, queued: int, sent: int, skipped: int, failed: int, unknown: int }),
    answers: z.object({ attending: int, late: int, absent: int, notAttending: int, noReply: int, calendarRequested: int }),
    paused: int,
    resumesAt: z.string().nullable(),
    senderState: z.enum(["ok", "missing", "broken"]),
  });
  export const peopleFilterSchema = z.enum(["all", "attending", "late", "absent", "not_attending", "no_reply", "not_delivered"]);
  export const personRowSchema = z.object({
    inviteeId: z.uuid(), contactId: z.uuid(), fullName: z.string(), email: z.string(), isAdhoc: z.boolean(),
    emailStatus: inviteeStatusSchema, emailError: z.string().nullable(), sentAt: z.string().nullable(),
    answer: answerSchema.omit({ respondedAt: true }).nullable(),
  });
  export const peoplePageSchema = pageSchema(personRowSchema);
  export const historyCountsSchema = z.object({ attending: int, late: int, absent: int, noReply: int });
  export const historyRowSchema = z.object({
    meetingId: z.uuid(), title: z.string(), startsAt: z.string(), timezone: z.string(),
    responseMode: responseModeSchema, emailStatus: inviteeStatusSchema,
    answer: answerSchema.omit({ respondedAt: true }).nullable(),
  });
  export const historyPageSchema = pageSchema(historyRowSchema).extend({ counts: historyCountsSchema });
  export const attendanceSummarySchema = z.object({
    meetings: int,
    rows: z.array(z.object({ contactId: z.uuid(), invited: int, attending: int, late: int, absent: int, noReply: int })),
  });
  export const attendanceDetailRowSchema = z.object({
    meetingId: z.uuid(), title: z.string(), startsAt: z.string(), timezone: z.string(), responseMode: responseModeSchema,
    inviteeId: z.uuid(), contactId: z.uuid(), fullName: z.string(), email: z.string(), emailStatus: inviteeStatusSchema,
    answer: answerSchema.omit({ respondedAt: true }).nullable(),
  });
  export const attendanceDetailsPageSchema = pageSchema(attendanceDetailRowSchema);
  /** `?from=&to=` (ISO instants; either may be absent = open). */
  export const periodQuerySchema = z.object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  }).refine((p) => !p.from || !p.to || p.from < p.to);
  export type PeriodRange = { from: string | null; to: string | null };
  ```
  (`int` = `z.number().int()`; `answerSchema.omit({ respondedAt: true })` because the organizer reads return `updated_at` only.)
- Produces (API, any member; `not_found` for other workspaces):
  - `GET …/meetings/[id]/results` → `MeetingResults`
  - `GET …/meetings/[id]/people?filter=&cursor=&limit=` → `Page<PersonRow>` (cursor `[sortName, inviteeId]`)
  - `GET …/contacts/[id]/history?from=&to=&cursor=&limit=` → `HistoryPage` (cursor `[startsAt, meetingId]`)
  - `GET …/attendance?from=&to=` → `AttendanceSummary`
  - `GET …/attendance/details?from=&to=&cursor=&limit=` → `Page<AttendanceDetailRow>` (cursor `[startsAt, meetingId, sortName, inviteeId]`)
- Produces (hooks, `src/hooks/use-results.ts`):
  - `useMeetingResults(slug, id, live: boolean)` — `refetchInterval: live ? RESULTS_POLL_MS : false`
  - `useMeetingPeople(slug, id, filter, live: boolean)` — `usePagedList` with the same interval
  - `useContactHistory(slug, contactId, range: PeriodRange)` — `usePagedList` over `historyPageSchema` (counts read from the first page)
  - `useAttendance(slug, range: PeriodRange)`
  - `fetchAllAttendanceDetails(slug, range): Promise<AttendanceDetailRow[]>` and `fetchAllMeetingPeople(slug, id): Promise<PersonRow[]>` — loop `nextCursor` with `limit=100` (exports, Task 15)
  - Query keys: `["meeting-results", slug, id]`, `["meeting-people", slug, id, filter]`, `["contact-history", slug, contactId, from, to]`, `["attendance", slug, from, to]`.

- [ ] **Step 1: Failing schema tests** — `periodQuerySchema` rejects `from >= to` and non-ISO values; `peopleFilterSchema` rejects `"maybe"`; `historyPageSchema` parses `{ counts, items, nextCursor }`.

- [ ] **Step 2: Query module** (`src/server/queries/results.ts`): one function per RPC, each parsing the snake_case JSON with zod and mapping to the shared camelCase shapes; pages built with `has_more` + the last row's keyset through `encodeCursor` (same pattern as `listMeetingsPage`). Pass every optional argument with `sqlNullable(...)`. Example:

```ts
/** One page of a meeting's people (`meeting_people`). */
export async function listMeetingPeople(
  client: Client,
  meetingId: string,
  filter: PeopleFilter,
  limit: number,
  after: [string, string] | null,
): Promise<Result<Page<PersonRow>>> {
  const { data, error } = await client.rpc("meeting_people", {
    p_meeting: meetingId,
    p_filter: filter,
    p_after_name: sqlNullable(after?.[0] ?? null),
    p_after_id: sqlNullable(after?.[1] ?? null),
    p_limit: limit,
  });
  if (error) {
    return { data: null, error };
  }
  const parsed = dbPeoplePageSchema.parse(data);
  const last = parsed.items.at(-1);
  return {
    data: {
      items: parsed.items.map(toPersonRow),
      nextCursor: parsed.has_more && last ? encodeCursor([last.sort_name, last.invitee_id]) : null,
    },
    error: null,
  };
}

/** Keyset of the people list: lower-cased name, then invitee id. */
export const peopleCursorSchema = z.tuple([z.string().max(200), z.uuid()]);
```

- [ ] **Step 3: Failing route tests**, one file per route, mocking the context loader and the query module like the M4 meeting routes: happy path; `?filter=maybe` / bad cursor / `from >= to` → 400; context failure passes through (404 for another workspace's meeting via `loadMeetingContext`; the contact history route checks the contact belongs to the slug's workspace by relying on `contact_history`'s `tn:not_found` and `fromDatabaseError`).

- [ ] **Step 4: Routes.** Pattern (people):

```ts
// src/app/api/workspaces/[slug]/meetings/[id]/people/route.ts
/** One page of a meeting's invitees with their answers (any member); `?filter=&cursor=&limit=`. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/people">,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const filter = peopleFilterSchema.safeParse(new URL(request.url).searchParams.get("filter") ?? "all");
  const page = readPageParams(request, peopleCursorSchema);
  if (!filter.success) {
    return apiError("invalid_input");
  }
  if (!page.ok) {
    return page.response;
  }
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await listMeetingPeople(context.supabase, id, filter.data, page.limit, page.after);
  return error ? fromDatabaseError(error) : NextResponse.json(data);
}
```

`results` and the attendance routes are plain GETs with `loadMeetingContext` / `loadWorkspaceContext`; `history` and `attendance*` read `from`/`to` with `periodQuerySchema` (a `readPeriod(request)` helper in `src/server/http/pagination.ts` returning `{ ok: true, range } | { ok: false, response }`, tested there).

- [ ] **Step 5: Hooks** (test: `useMeetingPeople` with `live=true` refetches on the interval — use fake timers or assert `refetchInterval` via `queryClient.getQueryCache().find(...)?.options`; `fetchAllAttendanceDetails` follows two cursors and concatenates)

```ts
/** A meeting's counts (tiles, email line, send progress); refreshed every 10 s while `live`. */
export function useMeetingResults(slug: string, id: string, live: boolean) {
  return useQuery({
    queryKey: ["meeting-results", slug, id],
    queryFn: () => apiRequest(`${meetingBase(slug, id)}/results`, { schema: meetingResultsSchema }),
    refetchInterval: live ? RESULTS_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** Every row of a paged endpoint, following `nextCursor` (exports only). */
async function fetchAll<T>(path: string, params: Record<string, string>, schema: z.ZodType<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ ...params, limit: String(PAGE_SIZE_MAX), ...(cursor ? { cursor } : {}) });
    const page: Page<T> = await apiRequest(`${path}?${query.toString()}`, { schema });
    rows.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}
```

Remove `useMeetingProgress` and the `/progress` route only in Task 13, once the meeting page no longer uses them.

- [ ] **Step 6: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:db`

```bash
git add -A && git commit -m "feat: organizer API for results, history and attendance (M5)"
```

---
### Task 13: Meeting page results — tiles, people list, delivery sheet, live refresh; Home next-meeting card

**Labels:** `type:task`, `area:frontend`, `area:i18n`. Branch `feat/<issue>-meeting-results-ui`.

**Files:**
- Modify: `src/app/w/[slug]/meetings/[id]/page.tsx` (+ `page.test.tsx`)
- Modify: `src/app/w/[slug]/meetings/[id]/send-progress.tsx` (+ test): reads `MeetingResults` instead of `MeetingProgress`
- Create: `src/app/w/[slug]/meetings/[id]/result-tiles.tsx`, `people-list.tsx`, `person-row.tsx`, `email-line.tsx`, `delivery-sheet.tsx` (+ tests)
- Create: `src/lib/responses/live-window.ts` (+ test)
- Delete: `src/app/w/[slug]/meetings/[id]/invitee-list.tsx` (+ test), `src/app/api/workspaces/[slug]/meetings/[id]/progress/route.ts` (+ test), `useMeetingProgress` / `progressQueryKey` / `progressSchema` and `getProgress` (grep for every use first; `useSendMeeting` may set or invalidate the progress key — switch it to the results key)
- Create: `src/app/w/[slug]/next-meeting-card.tsx` (+ test); Modify: `src/app/w/[slug]/page.tsx`
- Modify: `src/app/w/[slug]/meetings/meetings-list.tsx` (answers line component shared with the Home card)
- Modify: `messages/en.json` (`MeetingPage.results`, `WorkspaceHome.nextMeeting`)
- Create: `.superpowers/scripts/screens/meeting-results.spec.ts`

**Interfaces:**
- Consumes: Task 12's `useMeetingResults`, `useMeetingPeople`, `PersonRow`, `PeopleFilter`; Task 9's `useAnswerLabels`, `describeAnswer`; Task 5's `useMeetingsPage`, `ShowMore`.
- Produces: `isLive(meeting: { startsAt: string | null; durationMinutes: number }, now: Date): boolean` — true until `RESULTS_POLL_STOP_AFTER_END_MS` after the meeting's end.
- Produces: `<MeetingAnswersLine counts responseMode />` ("17 going · 4 late · 6 no reply"; RSVP "17 going · 3 not going · 6 no reply"; nothing for announcements) used by Meetings cards and the Home card.
- Produces: person links `href={`/w/${slug}/lists?person=${contactId}`}` for roster contacts (`!isAdhoc`); Task 14 makes the Lists page open that person's sheet.

**Layout (decided 2026-10-08, "tiles that filter"):** header → (while sending: the M4 progress card; otherwise one email line "Emails: 29 sent · 1 not delivered ▸" opening the delivery sheet) → tiles → the people list for the pressed tile (or everyone) → Invite more (Owner/Admin, before the start). From `md` up the list becomes a table (Name, Answer, Reason, Comment, Answered).

- [ ] **Step 1: Messages**

```json
"results": {
  "tilesLabel": "Answers",
  "attending": "Going",
  "late": "Late",
  "absent": "Absent",
  "not_attending": "Not going",
  "no_reply": "No reply",
  "everyone": "Everyone",
  "calendarRequested": "{count, plural, one {# person asked} other {# people asked}} for a calendar invite.",
  "emailLine": "Emails: {sent} sent",
  "emailLineIssues": "Emails: {sent} sent · {issues} not delivered",
  "deliveryTitle": "Email delivery",
  "afterDeadline": "after the deadline",
  "answeredAt": "Answered {time}",
  "notAnswered": "No answer yet",
  "notDelivered": "Email not delivered",
  "emptyFilter": "Nobody here yet.",
  "listEnd": "That's everyone",
  "columns": { "name": "Name", "answer": "Answer", "reason": "Reason", "comment": "Comment", "answered": "Answered" },
  "answersLine": "{attending} going · {late} late · {noReply} no reply",
  "answersLineRsvp": "{attending} going · {notGoing} not going · {noReply} no reply"
}
```

under `MeetingPage`, and `WorkspaceHome.nextMeeting: { "title": "Next meeting", "open": "Open meeting" }`.

- [ ] **Step 2: `isLive`** (failing test first: true one minute before the start, true 2 h 59 min after the end, false 3 h 1 min after the end, false for a null start)

```ts
// src/lib/responses/live-window.ts
import { addMinutes } from "date-fns";
import { RESULTS_POLL_STOP_AFTER_END_MS } from "@/config/responses";

/** Whether the meeting page keeps refreshing answers (spec §7.7: stops a few hours after the end). */
export function isLive(
  meeting: { startsAt: string | null; durationMinutes: number },
  now: Date,
): boolean {
  if (!meeting.startsAt) {
    return false;
  }
  const end = addMinutes(new Date(meeting.startsAt), meeting.durationMinutes);
  return now.getTime() < end.getTime() + RESULTS_POLL_STOP_AFTER_END_MS;
}
```

- [ ] **Step 3: Failing component tests**

`result-tiles.test.tsx`:
- attendance results `{ attending: 17, late: 4, absent: 3, noReply: 6 }` → four `button`s named "Going 17", "Late 4", "Absent 3", "No reply 6"; tapping "Late 4" calls `onFilter("late")` and it renders `aria-pressed="true"` when `filter="late"`; tapping it again calls `onFilter("all")`.
- RSVP → "Going", "Not going", "No reply" only; announcement → no buttons, the calendar-requested sentence.

`people-list.test.tsx` (fetch mock with two pages of `PersonRow`s):
- rows show name, `describeAnswer` pill, reason and comment **as text** (a reason `<b>x</b>` renders literally; `container.querySelector("b")` is null — Review Focus 4), "after the deadline" when flagged, "No answer yet" for no-reply rows;
- "Show more" loads page 2; the list end shows "That's everyone";
- a roster person's name is a link to `/w/<slug>/lists?person=<contactId>`; an ad-hoc guest's name is plain text;
- with `matchMedia` reporting `md`, a `table` with the five column headers renders instead of cards.

`page.test.tsx` (update): while `emails.queued > 0` the progress card shows; when done, the email line shows "Emails: 29 sent · 1 not delivered" and opens the delivery sheet listing that person with "Failed"; the tiles and the list render; `useMeetingResults` / `useMeetingPeople` are called with `live = true` for an upcoming meeting and `false` for one that ended 4 h ago.

- [ ] **Step 4: Implement.** Sketch of the page body:

```tsx
export default function MeetingPage() {
  const t = useTranslations("MeetingPage");
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const meeting = useMeeting(slug, id);
  const workspace = useWorkspace(slug);
  const live = meeting.data ? isLive(meeting.data, new Date()) : false;
  const results = useMeetingResults(slug, id, live && meeting.data?.status === "scheduled");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  useEffect(() => {
    if (meeting.data?.status === "draft") {
      router.replace(`/w/${slug}/meetings/${id}/edit`);
    }
  }, [id, meeting.data?.status, router, slug]);
  if (!meeting.data || !workspace.data || meeting.data.status === "draft") {
    return <Skeleton className="h-96 w-full" />;
  }
  const canEdit = workspace.data.myRole !== "viewer";
  const started = meeting.data.startsAt !== null && new Date(meeting.data.startsAt) <= new Date();
  const sending = results.data ? results.data.emails.queued > 0 || results.data.paused > 0 : false;
  return (
    <div className="flex flex-col gap-4">
      <MeetingHeader meeting={meeting.data} />
      {!results.data ? (
        <Skeleton className="h-32 w-full" />
      ) : sending ? (
        <SendProgress slug={slug} results={results.data} canConnect={workspace.data.myRole === "owner"} />
      ) : (
        <EmailLine emails={results.data.emails} onOpen={() => setDeliveryOpen(true)} />
      )}
      {results.data ? (
        <ResultTiles results={results.data} filter={filter} onFilter={setFilter} />
      ) : null}
      {results.data && results.data.responseMode !== "announcement" ? (
        <PeopleList slug={slug} meetingId={id} filter={filter} live={live} timezone={meeting.data.timezone} />
      ) : null}
      {canEdit && meeting.data.status === "scheduled" && !started ? (
        <Button asChild tone="primary" className="justify-center">
          <Link href={`/w/${slug}/meetings/${id}/edit?step=audience`}>{t("inviteMore")}</Link>
        </Button>
      ) : null}
      <DeliverySheet slug={slug} meetingId={id} open={deliveryOpen} onOpenChange={setDeliveryOpen} />
    </div>
  );
}
```

- `ResultTiles`: a `div role="group" aria-label={t("results.tilesLabel")}` with a 2×2 grid on phones (`grid-cols-2`), 4 columns from `md`; each tile a `button aria-pressed` with the status fill (`bg-fill-success`/`warning`/`danger`/`neutral`), label and the count in `font-display text-2xl`; pressed tiles sit down (`translate-y-0.5 shadow-none`) with an outline ring; counts animate with a small spring when they change (reduced motion: none).
- `PeopleList`: `useMeetingPeople(slug, meetingId, filter, live)`; cards (`PersonRow`) on phones, a `table` from `md` (`useMediaQuery(ROSTER_GRID_MEDIA)`); `ShowMore` with `endLabel={t("results.listEnd")}`; empty state `t("results.emptyFilter")`. Answered time: `format(new TZDate(updatedAt, timezone), "EEE d MMM, HH:mm")`.
- `EmailLine`: a full-width ghost button "Emails: N sent · M not delivered" (`issues = failed + skipped + unknown`), plus the M4 "bounces arrive in your Gmail" sentence under it when `failed + unknown > 0`.
- `DeliverySheet`: the M4 `Dialog` (bottom sheet on phones, centered from `md`) listing `useMeetingPeople(slug, id, "all", false)` rows with the M4 status labels and reasons (`MeetingPage.status.*`, `MeetingPage.reason.*`), `ShowMore` inside the scroll area.
- `SendProgress`: same UI as M4, fed from `results.emails`, `results.paused`, `results.resumesAt`, `results.senderState` (rename props; keep its tests' expectations).

- [ ] **Step 5: Meetings cards and Home card.** Extract `MeetingAnswersLine` (in `src/app/w/[slug]/meetings/meeting-answers-line.tsx`) from Task 5's inline line and use it in `MeetingsList` and in the new `NextMeetingCard`:

```tsx
/** Home: the next upcoming meeting with its live counts (spec §4 Navigation). */
export function NextMeetingCard({ slug }: { slug: string }) {
  const t = useTranslations("WorkspaceHome.nextMeeting");
  const next = useMeetingsPage(slug, "upcoming", 1);
  const meeting = next.items[0];
  if (!meeting?.startsAt) {
    return null;
  }
  const when = formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt });
  return (
    <Card as="section" className="flex flex-col gap-2">
      <h2 className="text-sm font-bold uppercase text-muted-ink">{t("title")}</h2>
      <Link href={`/w/${slug}/meetings/${meeting.id}`} className="font-display text-xl break-words underline-offset-4 hover:underline">
        {meeting.title}
      </Link>
      <p className="text-sm">{`${when.date}, ${when.start}–${when.end}`}</p>
      <MeetingAnswersLine counts={meeting.counts} responseMode={meeting.responseMode} />
    </Card>
  );
}
```

Render it on Home between `NeedsAttention` and `HomeChecklist`. Test: no card without an upcoming meeting; with one, title link, time and the answers line. (Its counts refresh on navigation; the meeting page is the live view.)

- [ ] **Step 6: Screenshots** (`meeting-results.spec.ts`; seed a sent meeting with 30 invitees and mixed answers incl. a 500-character reason, an after-deadline answer, two equal names, one failed email): the page with no tile pressed, "Late" pressed, the delivery sheet, the md table, an RSVP meeting, an announcement, the Home card — at 390 light / 320 dark / 1024. Check tile text contrast in dark mode, long reasons wrap, the table does not scroll sideways at 1024.

- [ ] **Step 7: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:e2e e2e/meetings.spec.ts`

```bash
git add -A && git commit -m "feat: live answers on the meeting page; next meeting on Home (M5)"
```

---
### Task 14: Person history in the person sheet; Lists → Attendance view

**Labels:** `type:task`, `area:frontend`, `area:i18n`. Branch `feat/<issue>-history-attendance`.

**Files:**
- Create: `src/lib/responses/periods.ts` (+ test)
- Create: `src/components/forms/period-chips.tsx` (+ test)
- Create: `src/app/w/[slug]/lists/contact-history.tsx` (+ test)
- Modify: `src/app/w/[slug]/lists/contact-sheet.tsx` (+ test): a History part under the fields (Owner/Admin/Viewer alike)
- Create: `src/app/w/[slug]/lists/attendance-view.tsx` (+ test)
- Modify: `src/app/w/[slug]/lists/roster-view.tsx` (+ test): People / Attendance switch (`?view=attendance`), `?person=<id>` opens that sheet
- Modify: `src/app/w/[slug]/lists/page.tsx` (`Suspense` around the view: it reads `useSearchParams`)
- Modify: `messages/en.json` (`History`, `Attendance` namespaces)
- Create: `.superpowers/scripts/screens/history-attendance.spec.ts`

**Interfaces:**
- Consumes: Task 12's `useContactHistory`, `useAttendance`, `PeriodRange`; Task 9's `useAnswerLabels`; Task 8's `HISTORY_PERIODS`, `HISTORY_DEFAULT_PERIOD`; M3's roster (`useRoster`), `ListChips`, `filterContacts`; M4's `DatePicker`.
- Produces: `type HistoryPeriod = (typeof HISTORY_PERIODS)[number]`; `periodRange(period: HistoryPeriod, now: Date, timezone: string, custom?: { from: string; to: string }): PeriodRange` (custom dates are `yyyy-MM-dd` in the workspace zone; `to` is inclusive, so the range ends at the start of the next day).
- Produces: `<PeriodChips value onChange custom onCustomChange timezone />`.
- Produces: `/w/[slug]/lists?view=attendance` and `/w/[slug]/lists?person=<contactId>` (used by Task 13's links).

- [ ] **Step 1: `periodRange`** (failing tests first)

```ts
// src/lib/responses/periods.test.ts
import { describe, expect, it } from "vitest";
import { periodRange } from "./periods";

const NOW = new Date("2026-10-08T10:00:00Z");

describe("periodRange", () => {
  it("covers the last 30 days and the last 3 months up to now", () => {
    expect(periodRange("30d", NOW, "Africa/Tunis")).toEqual({ from: "2026-09-08T10:00:00.000Z", to: null });
    expect(periodRange("3m", NOW, "Africa/Tunis")).toEqual({ from: "2026-07-08T10:00:00.000Z", to: null });
  });

  it("starts this year at local midnight on 1 January in the workspace zone", () => {
    expect(periodRange("year", NOW, "Africa/Tunis")).toEqual({ from: "2025-12-31T23:00:00.000Z", to: null });
  });

  it("is open for all time", () => {
    expect(periodRange("all", NOW, "Africa/Tunis")).toEqual({ from: null, to: null });
  });

  it("includes the whole last day of a custom range", () => {
    expect(periodRange("custom", NOW, "Africa/Tunis", { from: "2026-09-15", to: "2026-09-30" }))
      .toEqual({ from: "2026-09-14T23:00:00.000Z", to: "2026-09-30T23:00:00.000Z" });
  });
});
```

```ts
// src/lib/responses/periods.ts
import { TZDate } from "@date-fns/tz";
import { addDays, subDays, subMonths } from "date-fns";
import type { HISTORY_PERIODS } from "@/config/responses";
import type { PeriodRange } from "@/shared/api/responses";

/** A history period chip. */
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

const utc = (date: Date) => new Date(date.getTime()).toISOString();

function localMidnight(date: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new TZDate(year, month - 1, day, 0, 0, timezone);
}

/**
 * The instants a period covers (spec §7.7). Calendar boundaries ("this year", custom days) are
 * midnights in the workspace's zone, never the browser's.
 */
export function periodRange(
  period: HistoryPeriod,
  now: Date,
  timezone: string,
  custom?: { from: string; to: string },
): PeriodRange {
  switch (period) {
    case "30d":
      return { from: utc(subDays(now, 30)), to: null };
    case "3m":
      return { from: utc(subMonths(now, 3)), to: null };
    case "year":
      return { from: utc(new TZDate(new TZDate(now, timezone).getFullYear(), 0, 1, 0, 0, timezone)), to: null };
    case "all":
      return { from: null, to: null };
    case "custom":
      return custom
        ? { from: utc(localMidnight(custom.from, timezone)), to: utc(addDays(localMidnight(custom.to, timezone), 1)) }
        : { from: null, to: null };
  }
}
```

(`addDays` on a `TZDate` stays in that zone, so the custom end is the next local midnight even across a DST change; add a test with `Europe/Paris` and 25 Oct 2026 as the last day: `to` = `2026-10-25T23:00:00.000Z`.)

- [ ] **Step 2: Messages**

```json
"History": {
  "title": "History",
  "periods": { "30d": "Last 30 days", "3m": "Last 3 months", "year": "This year", "all": "All time", "custom": "From…" },
  "from": "From",
  "to": "To",
  "counts": { "attending": "Going", "late": "Late", "absent": "Absent", "noReply": "No reply" },
  "empty": "No meetings in this period.",
  "noReply": "No reply",
  "notDelivered": "Email not delivered",
  "end": "That's all"
},
"Attendance": {
  "view": { "label": "View", "people": "People", "attendance": "Attendance" },
  "meetings": "{count, plural, one {# meeting} other {# meetings}} in this period",
  "sortBy": "Sort by",
  "columns": { "name": "Name", "attending": "Going", "late": "Late", "absent": "Absent", "noReply": "No reply" },
  "empty": "No meetings in this period yet."
}
```

- [ ] **Step 3: `PeriodChips`** (test: tapping "This year" calls `onChange("year")`; "From…" reveals two `DatePicker` buttons labelled From / To; the chip row hides its scrollbar and every chip is ≥ 44 px). Implementation: a scrollable row of `Chip`s (`aria-pressed`), then, when `value === "custom"`, two `DatePicker`s (M4) side by side (stacked below 360 px). Disable dates after today in "To" and before "From".

- [ ] **Step 4: `ContactHistory`** (failing tests first, fetch mock): default period "Last 3 months" requests `from=` ≈ now − 3 months; the four count tiles show the first page's `counts`; rows show the meeting title, date in the meeting zone, `describeAnswer` pill, reason as text, "No reply" or "Email not delivered"; "Show more" loads the next page; switching to "All time" requests without `from`/`to`. Implementation: `useContactHistory(slug, contact.id, periodRange(period, now, workspace.timezone, custom))`; counts from `query.data?.pages[0]?.counts`; list items link to `/w/${slug}/meetings/${meetingId}`.

In `ContactSheet`, render `<ContactHistory slug contact workspaceTimezone />` below the existing fields and lists (for every role); the sheet becomes scrollable (`max-h-[85dvh] overflow-y-auto` on the content, as M3's import dialog does).

- [ ] **Step 5: Attendance view** (failing tests first)

- `RosterView` gets a `SegmentedControl` People / Attendance at the top, synced with `?view=` through `useSearchParams` + `router.replace` (keeps other params); `?person=<id>` sets `openContactId` once on load (a lazy `useState` initializer from the search param, not an effect: `react-hooks/set-state-in-effect`), and closing the sheet removes the param.
- `AttendanceView`: props `{ workspace, roster, onOpenContact }`; state `period` (default `HISTORY_DEFAULT_PERIOD`), `custom`, `listId` (same `ListFilter` as the People view, shared `ListChips`), `sort: { key: "name" | "attending" | "late" | "absent" | "noReply"; dir: "asc" | "desc" }` (default `noReply` desc).
  - Data: `useAttendance(slug, range)` rows joined by `contactId` to `roster.contacts` (name, email, listIds), then `filterContacts`-style list filter, then sort (ties by name).
  - Phones: one row per person (name, then three small pills "Late n · Absent n · No reply n") and a "Sort by" `SegmentedControl` (No reply / Late / Absent / Name). From `md`: a `table` with sortable header buttons (`aria-sort` on the `th`), virtualized with `@tanstack/react-virtual` like `RosterGrid` when more than 100 rows.
  - "N meetings in this period" above the list; empty state when `meetings === 0`.
  - Tapping a row calls `onOpenContact(contact)` (the person sheet with its History part).
- Tests: rows sorted by No reply desc by default; header "Late" toggles asc/desc and sets `aria-sort`; list chip "Design" narrows the rows; period chip "All time" refetches; a row tap opens the sheet; Viewers see the view (no edit controls).

- [ ] **Step 6: Screenshots** (`history-attendance.spec.ts`, seeded with 8 past meetings and 30 people): person sheet History (3 months, all time, custom range open), Attendance on a phone sorted by No reply, Attendance table at 1024 sorted by Late, with a list chip pressed — at 390 light / 320 dark / 1024. Check: the period chip row scrolls without a visible scrollbar, date pickers centered on desktop, the sheet scrolls on a 320 px phone.

- [ ] **Step 7: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run test:e2e e2e/roster.spec.ts`

```bash
git add -A && git commit -m "feat: person history and the Attendance view (M5)"
```

---
### Task 15: Export — meeting answers and Attendance (CSV, Excel)

**Labels:** `type:task`, `area:frontend`. Branch `feat/<issue>-export`.

**Files:**
- Add dependency: `bun add write-excel-file@4.1.1` (exact version; check `bun.lock` diff is only that package and `fflate`)
- Create: `src/lib/export/escape-cell.ts`, `src/lib/export/csv.ts`, `src/lib/export/xlsx.ts`, `src/lib/export/download.ts`, `src/lib/export/file-name.ts` (+ tests)
- Create: `src/lib/export/meeting-export.ts`, `src/lib/export/attendance-export.ts` (+ tests): rows and columns
- Create: `src/components/forms/export-menu.tsx` (+ test)
- Modify: `src/app/w/[slug]/meetings/[id]/meeting-header.tsx` (actions slot) and `page.tsx`; `src/app/w/[slug]/lists/attendance-view.tsx`
- Modify: `messages/en.json` (`Export` namespace)
- Modify: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` §7.7 if the ruling in Step 2 changes the escaping sentence

**Interfaces:**
- Consumes: Task 12's `fetchAllMeetingPeople`, `fetchAllAttendanceDetails`, `useAttendance` data; M3's roster (`queryClient.fetchQuery` with the roster query options, for list names); Task 9's `AnswerLabels`.
- Produces: `escapeCell(value: string): string`; `toCsv(columns: string[], rows: (string | number | null)[][]): string` (UTF-8 BOM, CRLF, every string cell escaped); `toXlsxBlob(sheets: XlsxSheet[]): Promise<Blob>` with `type XlsxSheet = { name: string; columns: { header: string; width: number }[]; rows: (string | number | Date | null)[][] }`; `downloadBlob(blob: Blob, fileName: string): void`; `exportFileName(parts: string[], extension: "csv" | "xlsx", today: Date): string`.
- Produces: `<ExportMenu label onExport={(format: "csv" | "xlsx") => Promise<void>} />`.

- [ ] **Step 1: Failing tests for escaping and CSV**

```ts
// src/lib/export/escape-cell.test.ts
import { describe, expect, it } from "vitest";
import { escapeCell } from "./escape-cell";

describe("escapeCell (Review Focus 4)", () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', `'=HYPERLINK("http://evil","x")`],
    ["+1 555", "'+1 555"],
    ["-2", "'-2"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tTab", "'\tTab"],
    ["\rCR", "'\rCR"],
  ])("prefixes %j", (input, output) => {
    expect(escapeCell(input)).toBe(output);
  });

  it("leaves ordinary text alone", () => {
    expect(escapeCell("Bus from campus, 20 min")).toBe("Bus from campus, 20 min");
    expect(escapeCell("Amira Ben Salah")).toBe("Amira Ben Salah");
  });
});
```

```ts
// src/lib/export/csv.test.ts
import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("starts with a BOM, quotes commas and quotes, uses CRLF, escapes formulas", () => {
    const csv = toCsv(["Name", "Reason"], [["Amira", 'Bus, "late"'], ["Omar", "=1+1"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿Name,Reason\r\nAmira,"Bus, ""late"""\r\nOmar,\'=1+1\r\n');
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/lib/export/escape-cell.ts
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Spreadsheet formula injection guard (OWASP "CSV Injection"): a cell that starts with = + - @ tab
 * or carriage return gets a leading apostrophe, so Excel and Sheets show it as text.
 */
export function escapeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}
```

```ts
// src/lib/export/csv.ts
import Papa from "papaparse";
import { escapeCell } from "./escape-cell";

/** A CSV file body: UTF-8 BOM (so Excel reads accents), CRLF line ends, formula-safe cells. */
export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  const safe = rows.map((row) => row.map((cell) => (typeof cell === "string" ? escapeCell(cell) : (cell ?? ""))));
  return `﻿${Papa.unparse({ fields: columns, data: safe }, { newline: "\r\n" })}\r\n`;
}
```

(Check how PapaParse quotes; adjust the expected string in the test to its exact output only if the meaning is the same: comma and quote quoting per RFC 4180.)

Ruling for the ledger: `Task 15: Ruling: the apostrophe prefix applies to CSV only; .xlsx cells are written as typed text (write-excel-file never writes formulas), where a prefix would show literally — Excel and Sheets never evaluate a text cell — none.` Update spec §7.7's escaping sentence to "CSV cells starting with … are prefixed with `'`; Excel cells are written as text".

```ts
// src/lib/export/xlsx.ts
import writeExcelFile from "write-excel-file/universal";

/** One sheet of an export. */
export type XlsxSheet = {
  name: string;
  columns: { header: string; width: number }[];
  rows: (string | number | Date | null)[][];
};

/** An .xlsx file built on the device (spec §7.7); text stays text, numbers stay numbers. */
export async function toXlsxBlob(sheets: XlsxSheet[]): Promise<Blob> {
  return writeExcelFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      columns: sheet.columns.map((column) => ({ width: column.width })),
      data: [
        sheet.columns.map((column) => ({ value: column.header, fontWeight: "bold" as const })),
        ...sheet.rows.map((row) => row.map((value) => (value === null ? null : { value }))),
      ],
    })),
  ).toBlob();
}
```

(Check `write-excel-file`'s TypeScript types for the multi-sheet form and the cell object shape (`{ value, type?, format?, fontWeight? }`); dates need `format: "yyyy-mm-dd hh:mm"`. Load it lazily: callers `await import("@/lib/export/xlsx")` so the library is not in the meeting page's first bundle.) Test with `vitest`: build a two-sheet blob, read it back with `read-excel-file` (already a dependency) and assert the sheet names, headers and one cell with `=1+1` comes back as the string `=1+1` (text, not evaluated).

```ts
// src/lib/export/download.ts
/** Saves a file from the browser (an object URL on a temporary link). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

`exportFileName(["gdg-issat", "weekly-sync", "answers"], "csv", today)` → `gdg-issat-weekly-sync-answers-2026-10-08.csv` (each part through the existing `slugify` in `src/lib/slug.ts`, empty parts dropped, at most 80 characters before the date).

- [ ] **Step 3: Rows** (failing tests first; fixtures of `PersonRow` / `AttendanceDetailRow` + a roster)

`meeting-export.ts`: `meetingAnswerColumns(t)` = Name, Email, Lists, Answer, Late by (min), Reason, Comment, Answered at, After the deadline, Email; `meetingAnswerRows(people, listNames, labels, timezone, t)` → one row per invitee in name order; Answer via `describeAnswer` (empty for no reply, "No reply" text for delivered no-replies); Answered at as `yyyy-MM-dd HH:mm` in the meeting's zone; After the deadline Yes / (empty); Email = the M4 status label.

`attendance-export.ts`: `attendanceSummaryRows(summary, roster)` (Name, Email, Lists, Invited, Going, Late, Absent, No reply) in the view's current sort; `attendanceDetailRows(details, roster, labels, t)` (Meeting, Date, Name, Email, Lists, Answer, Late by (min), Reason, Comment, After the deadline, Email).

Tests: a 600-character reason survives unchanged in the row (the CSV layer escapes, the row layer doesn't truncate); an ad-hoc guest without lists gets an empty Lists cell; names with accents and commas pass through.

- [ ] **Step 4: `ExportMenu` and wiring** (test: opening the menu shows "CSV" and "Excel (.xlsx)"; choosing one calls `onExport` with the format and shows "Preparing…" until it resolves; a rejection shows a toast "Couldn't export. Try again.")

Messages:

```json
"Export": {
  "button": "Export",
  "csv": "CSV",
  "xlsx": "Excel (.xlsx)",
  "preparing": "Preparing…",
  "failed": "Couldn't export. Try again.",
  "sheetSummary": "Summary",
  "sheetDetails": "Details",
  "sheetAnswers": "Answers",
  "yes": "Yes",
  "columns": {
    "name": "Name", "email": "Email", "lists": "Lists", "answer": "Answer", "lateBy": "Late by (min)",
    "reason": "Reason", "comment": "Comment", "answeredAt": "Answered at", "afterDeadline": "After the deadline",
    "emailStatus": "Email", "meeting": "Meeting", "date": "Date", "invited": "Invited",
    "attending": "Going", "late": "Late", "absent": "Absent", "noReply": "No reply"
  }
}
```

- Meeting page: `MeetingHeader` gains an optional `actions` node; the page passes `<ExportMenu label={t("button")} onExport={exportAnswers} />` for sent meetings that ask for answers. `exportAnswers(format)`: `fetchAllMeetingPeople(slug, id)` + roster list names (`queryClient.fetchQuery(rosterQueryOptions(slug))`) → rows → `toCsv` or `(await import("@/lib/export/xlsx")).toXlsxBlob([{ name: t("sheetAnswers"), … }])` → `downloadBlob`.
- Attendance view toolbar: `ExportMenu` → CSV = summary rows; Excel = Summary + Details (`fetchAllAttendanceDetails(slug, range)`).
- The menu is a Radix `DropdownMenu` with `p-1.5` inner padding, items ≥ 44 px.

- [ ] **Step 5: Manual check.** Export a seeded meeting and the Attendance view; open the `.csv` in LibreOffice (`libreoffice --headless --convert-to xlsx` is enough to prove it parses) and the `.xlsx` with `read-excel-file` in a bun one-off script; record row counts in the ledger. Ask the Owner, during their milestone test, to open both files in Excel on Windows (accents, the `=` reason shown as text).

- [ ] **Step 6: Verify and commit**

Run: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test`

```bash
git add -A && git commit -m "feat: CSV and Excel export of answers and attendance (M5)"
```

---
### Task 16: Rollout — e2e story, cleanup, S2 client checks, final review, production check, first real club send

**Labels:** `type:task`, `area:infra`, `area:calendar`. Branch `feat/<issue>-m5-rollout` (code parts); the checks themselves are owner-assisted.

**Files:**
- Create: `e2e/responses.spec.ts`; Modify: `e2e/meetings.spec.ts` (extract `sendMeetingThroughUi`), `e2e/helpers/fake-gmail.ts` (decode helpers if needed), `e2e/helpers/seed.ts` (`setAppLimit` via the local CLI, restoring after)
- Create: `supabase/migrations/<timestamp>_m5_cleanup.sql` (drop `meeting_progress`)
- Modify: `src/server/db/function-security.db.test.ts` (remove `meeting_progress`)
- Modify: `docs/spikes/S2.md` (M5 client results)
- Modify: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` §14 (M5 evidence), §9 (S2 results)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Cleanup migration.** `drop function public.meeting_progress(uuid); drop function private.meeting_progress(uuid);` (the `/progress` route went away in Task 13; `grep -rn meeting_progress src` must be empty first). Remove it from `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`. `bun run db:types`.

- [ ] **Step 2: e2e story** (`e2e/responses.spec.ts`, phone and desktop projects; filter fake-Gmail messages by this run's recipients)

```ts
test.beforeAll(() => setAppLimit("calendar_confirm_delay_seconds", 0));
test.afterAll(() => setAppLimit("calendar_confirm_delay_seconds", 60));

test("a member answers from the email and the organizers see it", async ({ page, browser, request }) => {
  const stamp = crypto.randomUUID().slice(0, 8);
  const { meetingUrl, memberEmail } = await sendMeetingThroughUi(page, { stamp, people: 1, mode: "attendance" });
  const [invite] = await messagesFor(stamp);
  const lateLink = linkFrom(invite.mime, "I'll be late");

  // A link scanner opens the link without a browser: nothing may be saved (Review Focus 1).
  expect((await request.get(lateLink)).status()).toBe(200);
  await page.goto(meetingUrl);
  await expect(page.getByRole("button", { name: /No reply 1/ })).toBeVisible();

  const member = await (await browser.newContext()).newPage();
  await member.goto(lateLink);
  await expect(member.getByRole("radio", { name: "I'll be late" })).toBeChecked();
  await member.getByRole("button", { name: "20 min" }).click();
  await member.getByLabel("Reason").fill("Bus from campus");
  await member.getByRole("button", { name: "Confirm: late by 20 min" }).click();
  await expect(member.getByText("CONFIRMED")).toBeVisible();

  await expect.poll(async () => (await messagesFor(stamp)).length, { timeout: 15_000 }).toBe(2);
  const calendar = (await messagesFor(stamp))[1];
  expect(calendar.mime).toMatch(/method=REQUEST/i);
  expect(calendar.threadId).toBe(invite.assignedThread);

  await expect(page.getByRole("button", { name: /Late 1/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Late 1/ }).click();
  await expect(page.getByText("Bus from campus")).toBeVisible();

  await member.getByRole("button", { name: "Change" }).click();
  await member.getByRole("radio", { name: "I can't come" }).click();
  await member.getByRole("button", { name: "Confirm: I can't come" }).click();
  await expect.poll(async () => (await messagesFor(stamp)).length, { timeout: 15_000 }).toBe(3);
  expect((await messagesFor(stamp))[2].mime).toMatch(/method=CANCEL/i);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "CSV" }).click();
  const csv = await (await download).path().then((path) => readFileSync(path ?? "", "utf8"));
  expect(csv).toContain("Bus from campus");
  expect(memberEmail).toContain(stamp);
});

test("a Viewer sees answers read-only and the Attendance view", async ({ page }) => {
  const stamp = crypto.randomUUID().slice(0, 8);
  const { slug, contactName } = await seedPastMeetingWithAnswers(stamp, {
    answers: [{ status: "late", delayMinutes: 10, reason: `Lab ${stamp}` }],
  });
  await signInAsNewViewer(page, slug);
  await page.goto(`/w/${slug}/lists?view=attendance`);
  await expect(page.getByText("1 meeting in this period")).toBeVisible();
  await page.getByRole("button", { name: contactName }).click();
  await expect(page.getByRole("dialog").getByText(`Lab ${stamp}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Import" })).toHaveCount(0);
});
```

(`seedPastMeetingWithAnswers` (admin client: workspace, contact, meeting answered through `token_submit_response` while upcoming, then moved 2 days into the past) and `signInAsNewViewer` (M2 helpers: create a user, `addMember` as viewer, email-code sign-in through Mailpit) go in `e2e/helpers/seed.ts` / `sign-in.ts`; `sendMeetingThroughUi` is extracted from the M4 story; `linkFrom(mime, label)` decodes the quoted-printable HTML part and returns the `href` of the button with that label; `setAppLimit` runs `update private.app_limits …` through `supabase db query --local --agent no`.) Run: stop any `next dev`, then `bun run test:e2e` — all green (M4's 62 + the new ones).

- [ ] **Step 3: Open the PR, merge, push the migration** (`merge-when-green.sh`, then `hosted-push.sh`).

- [ ] **Step 4: S2 client checks (owner-assisted, the Owner's own inboxes only).** On localhost (Gmail connect works there) with the Owner's Gmail connected in a test workspace, send one test meeting to the Owner's four addresses: a Gmail that never exchanged mail with the sender, an Outlook.com address, an iCloud address, the Owner's university address. For each inbox, the Owner answers Going from the email, then (after the calendar email arrives) switches to Absent, then back to Going. Ask the Owner to report per inbox, in plain words:
  1. Did the invite's buttons open the page with the choice pre-selected? (University mail: did anything get answered before you tapped Confirm? Check the meeting page shows "No reply" until then.)
  2. Did the calendar email show a calendar card? Did the event appear in the calendar by itself, or only after a tap? Were there Yes/No/Maybe buttons?
  3. Did switching to Absent remove the event? Did going back to Going add it again (no duplicate)?
  4. Apple Calendar on an iPhone/Mac if available.
  Record the answers in `docs/spikes/S2.md` ("M5 client checks", date, per-client table, no addresses) and the §9 summary. If a client fails to add/update/remove, stop and ask the Owner whether to add "Add to Google Calendar" / "Download .ics" links on the confirmation page (spec §9 fallback) as a follow-up task in this milestone.

- [ ] **Step 5: Final review.** Dispatch a fresh reviewer: Agent `feature-dev:code-reviewer`, `model: "opus"`. Give it: the M5 range (`git log --oneline <first M5 commit>^..main`), `git diff --stat` of the range, this plan's Global Constraints and Review Focus, the ledger rulings, and the instruction **not to read the whole diff at once** (per-path diffs: migrations, `src/server`, `src/app/api`, `src/app/r`, `src/app/w`, `src/lib`, `src/emails`). Ask for Critical / Important / Minor with file:line. Usage limits can stop it; relaunch after the hourly reset. Fix Critical and Important test-first (one PR each, `fix/<issue>-…`); minors go into a new issue under epic #8 (M6).

- [ ] **Step 6: Production check (Owner's test workspace, Owner's own address).** Every migration is on production (`supabase migration list --linked`); `supabase db advisors --linked` shows only `auth_leaked_password_protection`; Sentry is clean for the new routes (`mcp__plugin_sentry_sentry__search_issues`). The Owner sends a meeting from the "M4 test" workspace to their own address on production, answers from their Android phone, checks the calendar email (arrives within about 2 minutes: 60 s delay + the next cron tick), watches the meeting page update on Windows desktop, opens the Attendance view and exports both files. Collect their feedback in plain words; follow-up fixes are their own PRs.

- [ ] **Step 7: First real club send — explicit go-ahead required.** Ask with AskUserQuestion: "Ready to send <meeting> to the club's <N> members from <club Gmail> on production?" (recommended: yes once Steps 4–6 are clean). Only after "yes": the Owner (or an Admin) sends from the club workspace; watch the send progress and Sentry; the next day, review answers, calendar emails and the committee's export with the Owner. This is the milestone's done-when.

- [ ] **Step 8: Close M5.** Spec §14 M5 row: "**Done YYYY-MM-DD:** …" with evidence (club meeting sent to N members, answers received, calendar emails, S2 client results, e2e/DB/unit counts, advisors, Sentry, final review outcome, follow-up PRs). Epic #7 comment with every ruling from the ledger; close #7, #51, #168, #174 (if not already) and the milestone; move reusable helpers from the plan workspace to `.superpowers/scripts/`; delete `.superpowers/sdd/2026-10-08-m5-responses/`; `commit-commands:clean_gone`.

---

## Self-review notes (plan author)

- **Spec coverage:** §4 rows → Tasks 3 (rules, soft deadline), 8–9 (pre-select only, reasons), 10–11 (automatic calendar email, announcement button), 13–14 (tiles, history, Attendance), 15 (export), 5–6 (pagination). §6 tables and access pattern → Tasks 3, 4, 7. §7.3 → Tasks 8, 9, 10. §7.7 → Tasks 12–15. §7.10 "your time" → Task 9 (public card). §8 calendar job and #168 → Tasks 2, 3, 4, 11. §9 calendar files, email, S2 checks → Tasks 10, 11, 16. §10 routes, APIs, pagination contract, libraries → Tasks 5, 6, 8, 12, 15. §11 token route rules → Task 8. §12 M5 tests → spread, e2e in Task 16. §14 done-when → Task 16 Steps 6–8.
- **Spec text adjusted in this plan's docs PR:** §6 Access pattern (M5) names `private.submit_response(…)` → `public.token_submit_response(…)` / `public.token_request_calendar(…)` (service role only), and the organizer read functions are definer bodies behind invoker wrappers; §8 "unique partial index" → "the invitee row lock keeps one pending (or paused) job per person; retried duplicates are harmless because each job re-decides" (Task 3 ruling); §7.7 export escaping sentence → CSV only (Task 15 ruling).
- **Known judgment calls for the grilling:** dispatch budget 50 s → 35 s (Task 2); members/invites paged rather than capped (Task 6); the Attendance view's phone layout (rows + "Sort by" instead of a 5-column table); `rows`-free CTE naming; `psql` in CI for plan tests (Task 7).
- **Type consistency checked:** `Page<T>`/`pageSchema` (Task 5) used by Tasks 6, 12; `PeriodRange` (Task 12) used by Tasks 14, 15; `AnswerStatus`/`Answer` (Task 8) used by Tasks 9, 12–15; `describeAnswer(labels, answer)` + `useAnswerLabels()` (Task 9) used by Tasks 13–15; `ReserveResult.calendar` (Task 11) matches Task 4's JSON; `isLive` (Task 13) uses Task 8's `RESULTS_POLL_STOP_AFTER_END_MS`.
