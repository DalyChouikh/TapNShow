# Workspace Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home answers "what's next and who's coming", "what needs me" and "how is my group doing" at a glance, for every role, on phones and computers.

**Architecture:**
- One new set-based SQL read, `private.workspace_insights`, reuses `private.effective_status` and Attendance's counted-meeting rule. It is served by `GET /api/workspaces/[slug]/insights` and read with TanStack Query.
- The next-meeting card reuses the meeting page's endpoints and components (`ResultTiles`, `NudgeButton`). The setup card gets Done states and goes away.
- "How it's going" (numbers and a chart) and "Often missing" (opening `ContactHistory` in a dialog) read the new endpoint.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript 5, Postgres 17 (Supabase CLI 2.119.0), TanStack Query 5, Zod 4, next-intl 4, date-fns 4 with `@date-fns/tz`, Vitest 5.0.3, Playwright 1.63.0.

**Spec:** `docs/superpowers/specs/2026-10-17-workspace-home-design.md` (binding; §2 behaviour, §3 data, §4 edge cases). Parent: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` §4, §7.1, §7.7.

## Global Constraints

- Everything in `AGENTS.md`: bun; no `any` and no `unknown`; JSDoc on every export; no `console.*`; imports at the top; no hardcoded values; every string in `messages/en.json`; no emojis; no native form controls; no technical words for users; ≥ 44 px targets; no sideways scroll at 320 px.
- **DRY, named:**
  - the counting rule is `private.effective_status` plus Attendance's counted-meeting predicate (`status = 'scheduled'`, `response_mode <> 'announcement'`, `starts_at <= now()`, inside the period); a DB test pins the new function to `private.attendance_summary`;
  - the tiles are `ResultTiles`, the reminder is `NudgeButton`, the periods are `PeriodChips`, `usePeriod` and `periodRange`, and the person view is `ContactHistory`;
  - "hide for N days on this device" is one hook used by both the reminders card and the Sheets tip.
- **Performance:**
  - the SQL is one statement, set-based, with `materialized` CTEs;
  - measured on a volume seed (one workspace with 2,000 contacts × 150 past meetings, plus 200 small workspaces);
  - budget: `INSIGHTS_BUDGET_MS = 100` warm, asserted in the DB plan test;
  - the client asks once per period change (TanStack cache key by period), and the next-meeting card polls only while visible (`RESULTS_POLL_MS`);
  - each card has its own query, skeleton and retry.
- Security: a `SECURITY DEFINER` body in `private` with `search_path = ''` and an `is_member` check; a `public` invoker wrapper; both granted to `authenticated` only and listed in `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`.
- **Process:**
  - one branch and PR per task, an issue per task under `[epic] Workspace Home`;
  - TDD;
  - the full chain before each PR (`AGENTS.md`), with the database steps for Task 1 and e2e for Tasks 3–4;
  - hosted push right after Task 1 merges;
  - screenshots (390 light, 320 dark, 1024) sent to the Owner, who must say "Looks right?" yes before Tasks 3 and 4 merge.

## Review Focus

1. **A busy workspace on "All time":** hundreds of meetings × 2,000 invitees. The read stays under budget and the chart stays at 12 bars. Pinned in Task 1 Step 5 (volume plan test) and Task 4 Step 1 ("The latest 12 of N").
2. **The next meeting changes state while Home is open:** it starts (the reminder disappears, "Now"), it ends (the card moves on), or invites finish sending. Pinned in Task 3 Step 1 (state tests driven by `now` and results).
3. **The numbers disagree with Lists → Attendance or a member's history** for the same period. Pinned in Task 1 Step 1 (twin test against `attendance_summary`).
4. **A Viewer, an Admin and an Owner each see the right actions:** no reminder or setup card for Viewers, and "Ask <Owner>" for Admins. Pinned in Task 3 Step 1.
5. **Time zones:** a meeting in a zone other than the browser's shows its own date, and "This year" starts at the workspace's midnight. Pinned in Task 4 Step 1 (labels in the meeting zone) and the existing `periodRange` tests.

---

### Task 1: The insights read (database)

**Files:**
- Create: `supabase/migrations/<timestamp>_home_insights.sql` (`supabase migration new home_insights`)
- Modify: `src/server/db/function-security.db.test.ts` (`PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` gains `workspace_insights`)
- Create: `src/server/db/home-insights.db.test.ts`, `src/server/db/home-insights-plans.db.test.ts`
- Regenerate: `src/server/db/database.types.ts`
- Add to the first commit: the design doc and this plan

**Interfaces:**
- Produces: `public.workspace_insights(p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null) returns jsonb`, shaped (snake case):

```json
{ "roster": { "members": 0, "lists": 0, "committee": 0 },
  "period": { "meetings": 0, "came_average": 0, "invited_average": 0, "answered_before_start": null },
  "chart": [{ "id": "", "title": "", "starts_at": "", "timezone": "", "attending": 0, "late": 0, "absent": 0, "no_reply": 0 }],
  "often_missing": [{ "contact_id": "", "full_name": "", "invited": 0, "missed": 0, "absent": 0, "no_reply": 0 }] }
```

- [ ] **Step 1: Write the failing DB tests in `home-insights.db.test.ts`** (helpers from `src/test/db/*`, a per-run stamp)

  - `it("counts only started, scheduled, non-announcement meetings in the period")`: a draft, a cancelled meeting, an announcement, an upcoming meeting and one outside the period all leave `period.meetings` and `chart` unchanged.
  - `it("uses the check-in where there is one, else the answer")`: answered Going but marked Absent → `absent` 1, `attending` 0.
  - `it("counts no reply only for reachable invitees")`: email `skipped` or `failed` and unanswered → not in `no_reply`.
  - `it("answered before the start uses the first answer")`: one first answer before the start, one after (both answered) → `answered_before_start` 0.5. With no reachable invitee → `null`.
  - `it("averages came and invited over the counted meetings")`: two meetings of 10 invited with (6 attending + 2 late) and (4 + 0) → `came_average` 6, `invited_average` 10.
  - `it("charts the newest 12 meetings, oldest first")`: 14 counted meetings → 12 entries, the oldest two left out, ascending `starts_at`.
  - `it("lists up to 3 roster members who missed the most; ties by absent, then name")`, which also checks:
    - an ad hoc contact with the most misses is never listed;
    - a member with 0 missed is never listed;
    - `missed = absent + no_reply`.
  - `it("matches attendance_summary for the same period")` (the twin): for every `often_missing` row, `invited`, `absent` and `no_reply` equal that contact's `attendance_summary` row. The sums over all roster rows of `attending + late` equal the sum over `chart` of the same, when the period has ≤ 12 meetings and no ad hoc invitees.
  - `it("counts roster members, lists, and committee (admins, viewers, pending invites)")`: an expired, revoked or accepted invite is not counted, and the owner is not counted.
  - `it("lets members and viewers read it, and refuses others")`: a non-member gets `tn:forbidden`; anon has no execute.

- [ ] **Step 2: Run them and watch them fail**

Run: `supabase db reset --local </dev/null && bun run test:db -- src/server/db/home-insights.db.test.ts`
Expected: FAIL: `function public.workspace_insights(...) does not exist`.

- [ ] **Step 3: Write the migration**

  - `private.workspace_insights(p_workspace uuid, p_from timestamptz, p_to timestamptz) returns jsonb`: `language plpgsql stable security definer set search_path = ''`; raises `tn:forbidden` (`P0001`) unless `private.is_member(p_workspace)`.
  - One statement with `materialized` CTEs:
    - `counted`: Attendance's predicate;
    - `outcomes`: invitee × `counted`, joined to `contacts` for `is_adhoc`, left-joined to `responses` and `attendance_marks`, with `private.effective_status(am.actual, r.status)` as `status`, `reachable` (email `sent` or `unknown`) and `before` (`r.responded_at < m.starts_at`);
    - `per_meeting` and `per_contact` (`not is_adhoc`): grouped counts.
  - Then `jsonb_build_object` of:
    - `roster`;
    - `period`: averages over `counted` left-joined to `per_meeting` (a counted meeting with no invitee counts 0), rounded to 1 decimal;
    - `chart`: the newest 12 by `(starts_at, id)`, re-sorted ascending;
    - `often_missing`: `missed > 0`, ordered by `missed desc, absent desc, lower(full_name), id`, limit 3.
  - `public.workspace_insights(...)`: `language sql stable security invoker set search_path = ''`, calling the private one. Revoke both from `public, anon` and grant both to `authenticated`, as in `20261008215854_m5_results_reads.sql`.

- [ ] **Step 4: Run the tests; regenerate types**

Run: `supabase db reset --local </dev/null && bun run db:types && bun run test:db -- src/server/db/home-insights.db.test.ts src/server/db/function-security.db.test.ts`
Expected: PASS.

- [ ] **Step 5: The volume plan test, `home-insights-plans.db.test.ts`** (pattern: `m9-admin-reads-plans.db.test.ts`, `runLocalScript`, `explainCall`, `timeCall`)

  - `const INSIGHTS_BUDGET_MS = 100;`
  - Seed in one transaction: 1 workspace with 2,000 contacts, 150 past meetings with every contact invited (300,000 invitees), answers on 80% and check-ins on half the meetings; plus 200 workspaces of 50 contacts × 10 meetings.
  - `it("reads All time and Last 3 months on the big workspace within the budget")`: `timeCall` (warm, the median of 5) for both periods is ≤ `INSIGHTS_BUDGET_MS`.
  - `it("uses the workspace's meetings index, not a scan of every meeting")`: `planUsesIndex` on the meetings access.
  - If the budget fails, add only a partial index this reader needs, and put the `EXPLAIN` before and after in the ledger.

Run: `bun run test:db -- src/server/db/home-insights-plans.db.test.ts`. Expected: PASS. Then `supabase db reset --local </dev/null`.

- [ ] **Step 6: Advisors, chain, commit, PR**

Run: `supabase db advisors --local </dev/null` (no new warning), then the full chain. Commit: `feat(db): one set-based read for Home's insights`. PR: `Closes #<task 1>`, `Part of #<epic>`, labels `type:task`, `area:db`. After the merge: `.superpowers/scripts/hosted-push.sh`.

---

### Task 2: The insights API

**Files:**
- Create: `src/shared/api/insights.ts`, `src/shared/api/insights.test.ts`
- Modify: `src/server/queries/results.ts` (add `getWorkspaceInsights`), `src/hooks/use-results.ts` (add `useWorkspaceInsights`), `src/server/http/route-registry.ts`
- Create: `src/app/api/workspaces/[slug]/insights/route.ts`, `route.test.ts`

**Interfaces:**
- Consumes: `public.workspace_insights` (Task 1).
- Produces:
  - `workspaceInsightsSchema` and `type WorkspaceInsights = { roster: { members; lists; committee }; period: { meetings; cameAverage; invitedAverage; answeredBeforeStart: number | null }; chart: InsightsMeeting[]; oftenMissing: MissingMember[] }` (camelCase; counts are non-negative integers; the averages are non-negative numbers; `startsAt` is an ISO instant).
  - `getWorkspaceInsights(client: Client, workspaceId: string, range: PeriodRange): Promise<Result<WorkspaceInsights>>`.
  - `useWorkspaceInsights(slug: string, range: PeriodRange)`, with query key `["insights", slug, from ?? "", to ?? ""]`.
  - `GET /api/workspaces/[slug]/insights?from=&to=`.

- [ ] **Step 1: Failing tests**
  - `insights.test.ts`: `it("accepts the documented response and rejects negative counts or more than 12 chart entries or 3 people")`.
  - `route.test.ts` (mirror `attendance/route.test.ts`): `it("returns the insights for the period")`, `it("400s on an invalid period")` (`readPeriod`), `it("passes a refused workspace through")`, `it("maps a database error")`.
- [ ] **Step 2: Run them, watch them fail.** `bun run test -- --run src/shared/api/insights src/app/api/workspaces` → FAIL (missing modules).
- [ ] **Step 3: Implement** (mirror `getAttendanceSummary`, the attendance route, `useAttendance`). Add the `ROUTES` entry `"workspaces/[slug]/insights": { GET: { limits: [SIGNED_IN_READ], list: bounded("aggregate counts") } }`.
- [ ] **Step 4: Run.** `bun run test -- --run src/shared/api src/app/api/workspaces src/server/http/route-registry` → PASS.
- [ ] **Step 5: Chain, commit (`feat(api): Home's insights endpoint`), PR** (`area:api`).

---

### Task 3: Home's frame, the next meeting, and setup

**Files:**
- Modify: `src/app/(app)/w/[slug]/page.tsx`, `next-meeting-card.tsx`, `home-checklist.tsx`, and their tests
- Create: `src/app/(app)/w/[slug]/home-greeting.tsx`, `sheets-tip.tsx`, plus tests
- Modify: `src/app/(app)/w/[slug]/meetings/[id]/result-tiles.tsx` (`onFilter` optional) and its test
- Create: `src/lib/device/use-hidden-until.ts` and its test. Modify: `src/components/members/reminders-card.tsx` to use it. Add `DEVICE_KEYS.sheetsTipHiddenUntil` (`src/config/members.ts`).
- Modify: `messages/en.json` (`WorkspaceHome`); `e2e/workspace.spec.ts` (Home story); parent spec §4 and §7.1

**Interfaces:**
- Consumes: `useWorkspaceInsights` (Task 2) for the roster counts (greeting, setup Done states); `useMeetingsPage`, `useMeeting`, `useMeetingResults`, `useWorkspaceSender`, `useWorkspaceSheet`.
- Produces:
  - `useHiddenUntil(key: DeviceKey, days: number, now: Date): { hidden: boolean; hide: () => void }`;
  - `ResultTiles` with `onFilter?: (filter: PeopleFilter) => void` and `filter?: PeopleFilter`; without `onFilter` it renders non-interactive boxes;
  - a two-column frame with `data-slot` regions (`main`, `side`) that Task 4 fills.

- [ ] **Step 1: Failing tests**

  - **`next-meeting-card.test.tsx`:**
    - `it("shows when, how long until, where, the tiles and how many answered")`;
    - `it("says Now and hides the reminder while the meeting is in progress")`;
    - `it("shows Sending invites while invites are queued")`;
    - `it("shows RSVP tiles and no tiles for an announcement")`;
    - `it("offers New meeting when nothing is coming up, but not to Viewers")`;
    - `it("shows the reminder only to Owners and Admins")`.
  - **`home-checklist.test.tsx`:**
    - `it("marks each step Done from the roster, committee, sender and sheet")`;
    - `it("disappears once members and Gmail are done")`;
    - `it("asks Admins to ask the Owner for Gmail and Sheets")`;
    - `it("shows Viewers the short welcome")`.
  - **`sheets-tip.test.tsx`:**
    - `it("shows to the Owner when setup is done and Sheets isn't connected")`;
    - `it("Not now hides it for REMINDERS_NOT_NOW_DAYS days on this device")`.
  - **`use-hidden-until.test.ts`:** hidden until the stored instant, shown after it, and an invalid stored value is treated as not hidden.
  - **`reminders-card.test.tsx`:** the existing tests still pass after the refactor.
  - **`result-tiles.test.tsx`:** `it("renders plain boxes without onFilter")`.
  - **`home-greeting.test.tsx`:** the greeting by time of day (fixed `now`), the counts line, the "Welcome to" variant while setup isn't done.
  - **`page.test.tsx`:** each card's loading skeleton and error retry are independent.

- [ ] **Step 2: Run them, watch them fail** for the missing behaviour, not imports.
- [ ] **Step 3: Implement**
  - the frame: phones one column; from `lg`, `grid-cols-[3fr_2fr]` with `max-w-5xl`;
  - the greeting, the card states, the checklist's Done states, the Sheets tip and `useHiddenUntil`;
  - the reminders card refactored onto `useHiddenUntil`;
  - the time-left chip with `formatDistanceToNowStrict`, its copy in messages.
- [ ] **Step 4: Run** the unit tests for `src/app/(app)/w/[slug]`, `src/lib/device` and `src/components/members` → PASS.
- [ ] **Step 5: e2e** (`e2e/workspace.spec.ts`): `test("Home shows the next meeting with its answers and reminds who hasn't answered")`, seeded with the existing helpers. It covers the confirm dialog, the reminded state, and a new workspace showing Get set up with Done states.
- [ ] **Step 6: Screenshots** (`.superpowers/scripts/screens/home-current.spec.ts` plus a viewer and a new workspace) at 390 light, 320 dark and 1024. Look, send, "Looks right?".
- [ ] **Step 7: Docs, chain, commit (`feat(home): the next meeting leads, setup that finishes`), PR** (`area:frontend`).

---

### Task 4: How it's going and Often missing

**Files:**
- Create: `src/app/(app)/w/[slug]/how-its-going.tsx`, `insights-chart.tsx`, `often-missing.tsx`, `person-history-dialog.tsx`, plus tests
- Move: `src/app/(app)/w/[slug]/lists/contact-history.tsx` and its test → `src/components/members/`; update the Lists import
- Modify: `messages/en.json`; `e2e/workspace.spec.ts`; parent spec §7.7

**Interfaces:**
- Consumes: `useWorkspaceInsights` (Task 2), `usePeriod`, `PeriodChips`, `ContactHistory`, `Dialog`.
- Produces: `InsightsChart({ meetings, slug })`, a pure SVG with no new dependency.

- [ ] **Step 1: Failing tests**

  - **`how-its-going.test.tsx`:**
    - `it("shows the three numbers for the period")`;
    - `it("refetches when the period chip changes")`;
    - `it("says No meetings in this period")`;
    - `it("explains what will appear before the first meeting")`;
    - `it("says The latest 12 of N when the period has more")`.
  - **`insights-chart.test.tsx`:**
    - `it("draws one linked bar per meeting with a label naming every count")`;
    - `it("labels dates in each meeting's own time zone")`;
    - `it("thins labels below 400 px")`;
    - `it("segments use the tile tones")`.
  - **`often-missing.test.tsx`:**
    - `it("lists up to 3 with Missed X of Y and the split")`;
    - `it("hides when nobody missed anything")`;
    - `it("opens the person's history in a dialog")`;
    - `it("links to everyone's attendance")`.
  - **`contact-history.test.tsx`:** moved; still passes.

- [ ] **Step 2: Run them, watch them fail.**
- [ ] **Step 3: Implement.**
  - The chart is SVG: one `<a>` per bar to `/w/[slug]/meetings/[id]`, with an `aria-label` per bar, outline strokes, tones from the tokens' CSS variables, and a y scale with max = the largest bar.
  - The chips use `CHIP_ROW_CLASS` (through `PeriodChips`).
  - The dialog is centred at 1024 px and padded.
- [ ] **Step 4: Run** the unit tests → PASS.
- [ ] **Step 5: e2e:** `test("Home shows how the group is doing and who often misses")`, seeded through the DB helpers.
- [ ] **Step 6: Screenshots,** including All time with more than 12 meetings and a 320 px dark run. Look, send, "Looks right?".
- [ ] **Step 7: Docs, chain, commit (`feat(home): how it's going and who often misses`), PR.** Then the final whole-branch review, the production check on the Owner's test workspace (read-only), and the close-out.
