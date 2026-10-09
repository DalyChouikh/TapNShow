# TapNShow M6 (Lifecycle & reminders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An organizer can change a sent meeting (members get one update email that also moves their calendar event, and are asked to reconfirm after a time change), cancel it (cancellation email, event removed) and delete it once cancelled; reminders go out on their own (people who haven't answered, then Going and Late) and by hand (Nudge, every 12 h at most); after the start, the committee checks people in and History, Attendance and exports show what actually happened next to what people said; any meeting can be duplicated into a new draft.

**Architecture:** Everything new rides on the M4/M5 outbox. Edits, cancels and nudges are `private` `SECURITY DEFINER` functions behind `public` invoker wrappers that write the meeting, the `meeting_changes` log and per-person jobs in one transaction. `update` jobs are final-state like `calendar_confirm` (one pending per person, merged by later edits, 60 s delay); `cancel` jobs carry `METHOD:CANCEL` for calendar holders; reminders are two per-meeting **timer** jobs (`invitee_id` null, `meeting_id` set) that `dispatch_claim` expands into per-person `reminder` jobs when due, before it claims anything. `dispatch_reserve` decides per kind at run time (eligibility, calendar add/update/remove, nothing to send) and stores the calendar decision in the job payload; `dispatch_finish` records `calendar_state`/`calendar_sequence` for every calendar-bearing kind. Check-in marks live in `attendance_marks` (one row per invited person); one SQL function maps a mark or an answer to the counted status, used by every read. The client edits a sent meeting through the existing wizard in an edit mode whose changes are held in session storage until **Review changes** saves them.

**Tech Stack:** Next.js 16.3.8 (`after()`, `maxDuration`), React 19.2.8, TypeScript 5, bun 1.3.11, `@supabase/supabase-js` 2.117.2 + `@supabase/ssr` 0.12.7, Supabase CLI 2.119.0 (local ports 44320–44329), Postgres 17, `zod` 4.6, `@tanstack/react-query` 5.104, `motion`, `date-fns` 4 + `@date-fns/tz` 1.5, `react-email` 6.11, `nodemailer` 10.0.15 (`MailComposer` `icalEvent`), PapaParse 5, `write-excel-file` 4.1.1. Vitest 5, Playwright 1.63. **No new dependency.**

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md` — read §4 (Edits after sending (M6), Cancel and delete (M6), Reminders (M6), Check-in (M6), Meeting wizard), §6 (`workspaces`, `meetings`, `meeting_changes`, `attendance_marks`, `outbox_jobs`, Access pattern (M6)), §7.2 (Responses), §7.3 (states), §7.5, §7.6, §7.7, §7.8, §7.9, §8 (`calendar_confirm`, `update` and `cancel` (M6), `reminder` (M6), Errors, Idempotency), §12 (M6 tests) and §14 (M6 row) before starting. Design approved 2026-10-09 (#222). Epic #8; #213 folded in.

## Global Constraints

- Everything from the M0+M1, M2, M3, M4 and M5 plans' Global Constraints still applies: free only; bun; **no Server Actions** and no RSC data reads (every read and write through `src/app/api/**/route.ts` + TanStack Query); no emojis anywhere (UI, emails, `.ics`); no `any`/`unknown` (the ESLint rule bans the `unknown` keyword, including `as unknown as`); no `console.*`; JSDoc on every export; imports at the top of the file only; no hardcoded values (limits in `private.app_limits`, client tuning in `src/config/*`, each client constant names its DB twin in its JSDoc); SQL only in `supabase/migrations/*` and `src/server/queries/*`; every UI and email string through next-intl (`messages/en.json`); Soft Neobrutalism; Expressive motion with a reduced-motion fallback; WCAG 2.2 AA; ≥ 44 px tap targets; one branch + PR per task with the repo template, CI green including `db`, squash merge, commit trailer from the session's attribution reminder.
- **Owner rules (memories):** no native form controls (styled `Chip`, `Switch`, `SegmentedControl`, `DropdownMenu` only); **an "Are you sure?" dialog naming the consequence before every send, cancel, delete, nudge, edit that emails people, and "Mark the rest as they said"**; no technical text for users (never "job", "payload", "sequence", "tn:"); paginate every growing list (the check-in list is paged); padded menus (`p-1.5`, `collisionPadding` 16); dialogs centered at 1024 px; chip rows use `CHIP_ROW_CLASS`.
- **DRY rules for M6 (owner emphasis 2026-10-09):**
  - **The deadline rule** is `private.response_deadline_problem(deadline, starts_at)` in SQL and `responseDeadlineProblem` in `src/lib/meetings/deadline.ts` (#220). `send_meeting` (first send only) and `edit_sent_meeting` call the SQL one; the wizard's Answers and Review steps call the TS one. Never a third copy.
  - **"Is this draft complete"** is `private.meeting_incomplete(meeting)`, used by `send_meeting` and `edit_sent_meeting`.
  - **"Who gets a reminder"** is `private.reminder_eligible(audience, answer, needs_reconfirmation)`, used at fan-out, at reserve time and for the Nudge count in `meeting_results`.
  - **"Which status counts"** is `private.effective_status(mark, answer)`, used by `contact_history`, `attendance_summary` and `attendance_details`; its TS twin `effectiveStatus` (`src/lib/responses/effective-status.ts`) is used only for labels.
  - **"Declared answer → check-in hint"** is `declaredActual` in `src/lib/responses/check-in.ts` and the `case` in `private.mark_rest_as_declared`; the JSDoc of each names the other.
  - **Edit field groups** (`EDITABLE`, `MEMBER_VISIBLE`, `SCHEDULE`, `PLACE`, `CALENDAR`) live in `src/config/meeting-edit.ts` and as `constant text[]` in `private.edit_sent_meeting`; the JSDoc names the twin; Task 6 has a DB test that compares the two lists.
  - **Reminder choices** live in `src/config/reminders.ts` (`REMINDER_PENDING_CHOICES` 1, 2, 6, 24, 48; `REMINDER_GOING_CHOICES` 1, 2, 6, 24; defaults 24 and 2); the DB twin is the `check` constraints in Task 4.
  - **Emails** reuse `EmailLayout`, `MeetingWhenWhere`, `MeetingFooter` and a new `AnswerButtons` block extracted from the invite email (Task 2); the `.ics` comes from `buildMeetingIcs` and the dispatcher's `calendarFile` only.
  - **Wizard steps** save through one `saveStep` prop (Task 10), so the draft wizard (PATCH) and the edit mode (session draft) share every step component.
- **Answers are kept after a time change**: `responses.needs_reconfirmation = true`; tiles show **To reconfirm** and leave those people out of Going/Late/Absent; History keeps the latest answer; a same-answer save from `/r/[token]` clears the flag and writes one history row.
- **Recipients of an update** (one SQL function, `private.update_targets`): invite `sent`/`unknown` and not unsubscribed; date/time/duration change → everyone; place change → everyone except `absent`/`not_attending`; member-visible text only → everyone when "Email everyone about this change" is on, else nobody; calendar holders (`calendar_state = 'added'`) whose event content changed get a calendar-only update even when nobody else is emailed.
- **Function security (spec §11):** new organizer writes (`edit_sent_meeting`, `cancel_meeting`, `delete_cancelled_meeting`, `nudge_meeting`, `mark_attendance`, `mark_rest_as_declared`, `duplicate_meeting`) are `private` definer bodies granted to `authenticated` behind `public` invoker wrappers; each is added to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted) in `src/server/db/function-security.db.test.ts` in the same PR. Internal helpers (`fold`, `like_contains`, `response_deadline_problem`, `meeting_incomplete`, `require_active_sender`, `sync_reminder_timers`, `reminder_eligible`, `enqueue_reminders`, `fan_out_reminders`, `update_targets`, `merge_update_payload`, `effective_status`, `can_check_in`) are `revoke execute … from public, anon, authenticated`; the ones the invoker dispatcher calls are `grant execute … to service_role`. Run `supabase db advisors --local </dev/null` after every migration; expected: no WARN or ERROR.
- **Changing an existing function:** copy the latest body from **the newest migration that defines it** and change only what the task says: `send_meeting` and `create_meeting` → `20261008152332_m4_online_place.sql`; `dispatch_claim`, `dispatch_reserve`, `dispatch_finish`, `dispatch_retry` → `20261008182630_m5_calendar_dispatch.sql`; `token_submit_response`, `token_invitee` → `20261008181825_m5_responses.sql`; `meeting_results`, `meeting_people`, `contact_history`, `attendance_summary`, `attendance_details` → `20261008215854_m5_results_reads.sql`. A signature change is `drop function … (old args)` + `create function` + re-grant (grants are per signature). After each M6 migration merges, the next task copies from **that** migration.
- **PostgREST resolves functions by argument names:** pass SQL null with `sqlNullable()` (`src/server/db/rpc-args.ts`); a new optional argument needs `default null` in SQL.
- **New error codes** (Task 4 adds the first two, Task 9 the rest; each goes in `API_ERROR_CODES`, `API_ERROR_STATUS` and `messages/en.json` `ApiErrors`, plain words): `deadline_in_past` (400) "Pick a deadline in the future.", `deadline_after_start` (400) "The answer deadline must be before the meeting starts.", `meeting_started` (409) "The meeting has started, so it can't be changed.", `meeting_cancelled` (409) "This meeting was cancelled.", `nudge_too_soon` (409) "You can remind people again later.", `cancel_emails_pending` (409) "The cancellation emails are still going out. Try again in a few minutes.", `check_in_closed` (409) "Check-in opens when the meeting starts."
- **New limits** (`private.app_limits`, Task 4): `nudge_interval_hours` 12. New client config: `src/config/reminders.ts` (Task 4), `src/config/meeting-edit.ts` (Task 2).
- **No rollout flag.** M6 changes sent meetings; the only sent meetings in production are the Owner's own 31-member meeting (2026-10-09, started) and test meetings. Every task ships complete.
- **Sends during development:** fake Gmail in tests and e2e. The Task 15 production check sends from the Owner's test workspace **only to the Owner's own four inboxes**; never the club roster without an explicit AskUserQuestion go-ahead in that session.
- UI verification: Playwright screenshots through `.superpowers/scripts/screens/pw.config.ts` (`bun run test:e2e -c .superpowers/scripts/screens/pw.config.ts <spec>`; specs import `./shots`) at **390 px light, 320 px dark and 1024 px** for every new or changed screen and dialog; look at them before claiming done; no horizontal page scroll at 320 px; dialogs centered at 1024 px. `toBeVisible()` passes at opacity 0, so look.
- Local stack: `supabase start` (API 44321, DB 44322, Studio 44323, Mailpit 44324/44325). Run the CLI with `</dev/null`. If `test:db` fails with a ZodError on `API_URL`, `supabase stop </dev/null && supabase start </dev/null`. The local DB is shared by every branch: `supabase db reset --local </dev/null` aligns it with the branch. Multi-statement SQL by hand: `psql postgresql://postgres:postgres@127.0.0.1:44322/postgres -v ON_ERROR_STOP=1 -f file`. Stop any `next start`/`next dev` before `bun run test:e2e` (`ss -ltnp | grep :3000`, kill by PID; never `pkill -f`). Regenerate types with `bun run db:types` after each migration. Escape `[slug]`/`[id]`/`[token]` in vitest filters (or filter by a substring without brackets).
- **Before every commit, chained:** `bunx prettier --write <touched files, not .sql> && bun run format:check && bun run lint && bun run typecheck && bun run test` (+ `bun run test:db` for DB work, + `bun run test:e2e` when a flow changes). Scripted edits: assert the old text exists and re-read the file after Prettier.
- **Merging and hosted migrations** (owner-approved): open the PR, then `bash .superpowers/scripts/merge-when-green.sh <pr>` with `run_in_background`; verify `gh pr view <pr> --json state` is `MERGED` (the script sometimes says "gave up" for a PR that merges seconds later). **Right after a PR with a migration merges, `bash .superpowers/scripts/hosted-push.sh`** from the clean `origin/main` worktree (`/tmp/tapnshow-main-wt`; recreate with `git worktree add` if gone); record the advisor output in the ledger. Migrations land in timestamp order: Tasks 4 → 5 → 6 → 7 → 8 merge one after another (create each migration file only when its task starts).
- Every deviation from this plan becomes a ledger line `Task N: Ruling: <what> — <why> — <cost if wrong>` in `.superpowers/sdd/2026-10-09-m6-lifecycle-reminders/progress.md`.

## Review Focus

1. **Three quick edits inside a minute, including moving the time and moving it back** — each person gets exactly one email, describing the net change; when the time ends where it started, the email has no "Time" line but still asks people to confirm (their answers were flagged by the first edit and stay flagged, see Task 6 ruling); a person whose only change was hidden settings (reason, comments, reminders) gets nothing. Pinned in Task 6 (`merge_update_payload` keeps the oldest "old" and newest "new", drops net-zero fields, ORs `notify`/`reconfirm`; three `edit_sent_meeting` calls leave one pending `update` job per person) and Task 3 (an update job with empty changes and `reconfirm=true` renders the "please confirm" email; empty changes and `reconfirm=false` sends nothing).
2. **Editing or cancelling while a 500-person invite run is still going out** — people whose invite hasn't gone yet get the invite with the new details and no separate update; a cancel stops every unsent invite (shown as skipped) and only people whose invite went out get the cancellation. Pinned in Task 6 (`update_targets` ignores `queued` invitees; `cancel_meeting` marks pending invite jobs done and queued invitees `skipped`, and enqueues `cancel` only for `sent`/`unknown`).
3. **A deadline that has already passed when the organizer edits something else** (title typo two hours before the meeting) — the save works; moving the start to before that passed deadline is refused with "The answer deadline must be before the meeting starts."; changing the deadline itself to a past time is refused. Pinned in Task 6 (SQL) and Task 10 (`editDeadlineProblem` in the Answers step, same cases).
4. **No sender or a broken Gmail at the moment of an edit, a cancel or a nudge** — the edit and the cancel still save and their emails wait (paused) until Gmail is reconnected, then go out unless the meeting has started; the nudge is refused in plain words ("Ask <Owner> to connect Gmail", reused copy). Pinned in Task 5 (`nudge_meeting` raises `sender_not_connected`/`sender_broken`) and Task 6 (`cancel_meeting` with no sender creates `cancel` jobs that `dispatch_claim` pauses; reconnect resumes them).
5. **A meeting sent shortly before it starts, and reminders held back by a full Gmail quota** — sending 90 minutes before the start creates no 24 h or 2 h timer (both already past); a reminder still waiting for quota when the meeting starts is dropped, never sent late. Pinned in Task 5 (`sync_reminder_timers` skips due times in the past) and Task 5 (`dispatch_reserve` marks a `reminder` job done with `meeting_started` once `starts_at <= now()`).

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge this plan (docs PR); create the agent-task issues (Tracking) | — |
| 1 | Task 1 — #213: M5 minors | 0 |
| 2 | Task 2 — Emails: update, cancellation, reminders; `AnswerButtons`; invite deadline only while in the future | 0 |
| 3 | Task 3 — Dispatcher (TypeScript) understands and sends `update`, `cancel`, `reminder` | 2 |
| 4 | Task 4 — DB: reminder settings, `meeting_changes`, `attendance_marks`, deadline/complete/sender helpers | 0 |
| 5 | Task 5 — DB: reminder timers at the first send, timer fan-out, `update`/`cancel`/`reminder` in the dispatcher functions, `nudge_meeting` | 3, 4 |
| 6 | Task 6 — DB: `edit_sent_meeting`, `cancel_meeting`, `delete_cancelled_meeting`, reconfirmation, `meeting_results`/`meeting_people`/`token_invitee` | 5 |
| 7 | Task 7 — DB: check-in writes, `effective_status`, History/Attendance reads | 6 |
| 8 | Task 8 — Duplicate meeting (DB, API, hook, menus) | 7 |
| 9 | Task 9 — API + hooks: edit (preview + save), cancel, delete, nudge, reminder fields, results/token schemas, error codes | 6 |
| 10 | Task 10 — Wizard edit mode + Review changes; reminder rows in Answers and Meeting defaults | 9 |
| 11 | Task 11 — Meeting page: "…" menu, Cancel/Delete dialogs, Nudge, To reconfirm tile, Cancelled label | 9 |
| 12 | Task 12 — Answer page: time changed, "Yes, still going" | 9 |
| 13 | Task 13 — Check-in: API, hooks, Results / Check-in switch | 7, 11 |
| 14 | Task 14 — History, Attendance and exports with check-in | 7, 13 |
| 15 | Task 15 — Rollout: e2e story, final review, production check, spec §14 evidence | 1–14 |

**Why this order:** the TypeScript dispatcher parses every claimed job with a fixed list of kinds. Tasks 2 and 3 land first, so the moment Task 5's migration creates the first reminder, update or cancel job in production, the dispatcher already knows how to send it; otherwise one unknown job would make the whole claim fail and stall every email of that Gmail. Tasks 4 → 5 → 6 → 7 → 8 are a migration chain (merge in that order, push each right after its merge); 9 → 10/11/12 and 11 → 13 → 14 are chains; Task 1 is independent.

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–15 with the agent-task template, labels `type:task` + the area labels named in each task, milestone `M6 Lifecycle & reminders`, and add each as a sub-issue of epic #8:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/8/sub_issues -F sub_issue_id="$id"
```
- [ ] Tick "Plan written for M6" in epic #8's body.
- [ ] #213 → Task 1: comment with the task issue number; close #213 when Task 1 merges.
- [ ] Ledger: create `.superpowers/sdd/2026-10-09-m6-lifecycle-reminders/progress.md` with `bash ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/sdd-workspace docs/superpowers/plans/2026-10-09-m6-lifecycle-reminders.md`; one line per task and every `Ruling:`. Per task: `task-start` / `task-done` (`…/executing-plans/scripts/`), `task-done` only on an up-to-date `main` after verifying the merge.
- [ ] **Design rulings (2026-10-09)**, copied into the ledger: answers kept + "to reconfirm" after a time change; update email to everyone for date/time/duration, everyone but "can't come" for place, nobody for text unless switched on; one combined email for calendar holders; wizard edit mode + Review changes; answer type and delays fixed once sent; cancel keeps the meeting (not counted), delete for cancelled; reminders 24 h (not answered) and 2 h (Going/Late), per-meeting timers; nudge every 12 h; check-in by tap, "Mark the rest as they said", check-in wins in counts; no check-in for announcements; invite more allowed after the deadline; `attendance_marks` keyed by invitee; plan review: cards count the last answer, no count on "Mark the rest", accent-insensitive check-in search, reminders scheduled again after a move.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/emails/answer-buttons.tsx`, `meeting-update-email.tsx`, `meeting-cancel-email.tsx`, `meeting-reminder-email.tsx` | shared answer buttons; the three new emails | 2 |
| `src/lib/meetings/changes.ts` | change summary lines for the update email and Review changes | 2 |
| `src/server/queries/dispatch.ts`, `src/server/dispatch/run-dispatch.ts` | claim/reserve schemas and rendering per kind | 3 |
| `supabase/migrations/<ts>_m6_foundation.sql` | columns, `meeting_changes`, `attendance_marks`, `outbox_jobs.meeting_id`, helpers, `send_meeting`/`create_meeting` | 4 |
| `src/config/reminders.ts` | reminder choices and defaults (DB twin: Task 4 checks) | 4 |
| `supabase/migrations/<ts>_m6_dispatch_kinds.sql` | `sync_reminder_timers`, `send_meeting` (timers), `reminder_eligible`, `enqueue_reminders`, `fan_out_reminders`, `dispatch_claim/reserve/finish`, `nudge_meeting` | 5 |
| `supabase/migrations/<ts>_m6_edit_cancel.sql` | `update_targets`, `merge_update_payload`, `edit_sent_meeting`, `cancel_meeting`, `delete_cancelled_meeting`, `token_submit_response`, `token_invitee`, `meeting_results`, `meeting_people` | 6 |
| `src/config/meeting-edit.ts` | edit field groups (DB twin: `edit_sent_meeting` constants) | 2 |
| `supabase/migrations/<ts>_m6_check_in.sql` | `can_check_in`, `mark_attendance`, `mark_rest_as_declared`, `effective_status`, `contact_history`, `attendance_summary`, `attendance_details` | 7 |
| `supabase/migrations/<ts>_m6_duplicate.sql`, `…/[id]/duplicate/route.ts`, `src/app/w/[slug]/meetings/meeting-card-menu.tsx` (replaces `draft-menu.tsx`) | Duplicate | 8 |
| `src/server/queries/meetings.ts`, `src/shared/api/meetings.ts`, `responses.ts`, `tokens.ts`, `meeting-settings.ts`, `errors.ts` | RPC wrappers, shared Zod schemas, error codes | 4, 9 |
| `src/app/api/workspaces/[slug]/meetings/[id]/{changes,cancel,nudge}/route.ts`, `…/[id]/route.ts` (DELETE) | routes | 9 |
| `src/hooks/use-meeting-lifecycle.ts` | edit/cancel/delete/nudge mutations and keys | 9 |
| `src/lib/meetings/deadline.ts` | + `editDeadlineProblem` | 10 |
| `src/app/w/[slug]/meetings/[id]/edit/*` | `saveStep`, edit mode, `changes-step.tsx`, `use-edit-draft.ts`, `reminder-choice.tsx` | 10 |
| `src/app/w/[slug]/settings/meeting-defaults-section.tsx` | reminder rows | 10 |
| `src/app/w/[slug]/meetings/[id]/meeting-menu.tsx`, `nudge-button.tsx`, `result-tiles.tsx`, `person-row.tsx`, `page.tsx` | meeting page actions | 11 |
| `src/app/r/[token]/reconfirm-banner.tsx`, `answer-view.tsx` | reconfirmation | 12 |
| `src/server/queries/check-in.ts`, `…/[id]/check-in/route.ts`, `…/[id]/check-in/rest/route.ts`, `src/hooks/use-check-in.ts`, `src/lib/responses/check-in.ts`, `src/app/w/[slug]/meetings/[id]/check-in-list.tsx`, `check-in-row.tsx` | check-in | 13 |
| `src/lib/responses/effective-status.ts`, `src/app/w/[slug]/lists/*` (person sheet history, Attendance), `src/lib/export/rows.ts`, `use-export-answers.ts` | declared vs actual | 14 |
| `e2e/m6-lifecycle.spec.ts` | the M6 story | 15 |

---|---|---|
| `supabase/migrations/<ts>_m6_foundation.sql` | columns, `meeting_changes`, `attendance_marks`, `outbox_jobs.meeting_id`, helpers, `send_meeting`/`create_meeting` | 2 |
| `supabase/migrations/<ts>_m6_dispatch_kinds.sql` | `reminder_eligible`, `enqueue_reminders`, `fan_out_reminders`, `dispatch_claim/reserve/finish`, `nudge_meeting` | 3 |
| `supabase/migrations/<ts>_m6_edit_cancel.sql` | `update_targets`, `merge_update_payload`, `edit_sent_meeting`, `cancel_meeting`, `delete_cancelled_meeting`, `token_submit_response`, `token_invitee`, `meeting_results`, `meeting_people` | 4 |
| `supabase/migrations/<ts>_m6_check_in.sql` | `can_check_in`, `mark_attendance`, `mark_rest_as_declared`, `effective_status`, `contact_history`, `attendance_summary`, `attendance_details` | 5 |
| `supabase/migrations/<ts>_m6_duplicate.sql` | `duplicate_meeting` | 6 |
| `src/config/reminders.ts` | reminder choices and defaults (DB twin: Task 4 checks) | 2 |
| `src/config/meeting-edit.ts` | edit field groups (DB twin: `edit_sent_meeting` constants) | 4 |
| `src/lib/meetings/deadline.ts` | + `editDeadlineProblem` | 10 |
| `src/lib/meetings/changes.ts` | change summary lines for the email and Review changes | 7 |
| `src/lib/responses/check-in.ts`, `effective-status.ts` | declared → hint; mark/answer → counted status | 13, 14 |
| `src/emails/meeting-update-email.tsx`, `meeting-cancel-email.tsx`, `meeting-reminder-email.tsx`, `answer-buttons.tsx` | new emails, shared answer buttons | 7 |
| `src/server/queries/dispatch.ts`, `src/server/dispatch/run-dispatch.ts` | claim/reserve schemas and rendering per kind | 8 |
| `src/server/queries/meetings.ts`, `src/server/queries/check-in.ts` | RPC wrappers | 9, 13 |
| `src/shared/api/meetings.ts`, `responses.ts`, `tokens.ts`, `meeting-settings.ts`, `errors.ts` | shared Zod schemas, error codes | 2, 9, 13 |
| `src/app/api/workspaces/[slug]/meetings/[id]/{changes,cancel,nudge,duplicate}/route.ts`, `…/[id]/route.ts` (DELETE), `…/[id]/check-in/route.ts`, `…/[id]/check-in/rest/route.ts` | routes | 6, 9, 13 |
| `src/hooks/use-meeting-lifecycle.ts`, `src/hooks/use-check-in.ts` | mutations and keys | 9, 13 |
| `src/app/w/[slug]/meetings/[id]/edit/*` | `saveStep`, edit mode, `changes-step.tsx`, `use-edit-draft.ts`, `reminder-choice.tsx` | 10 |
| `src/app/w/[slug]/settings/meeting-defaults-section.tsx` | reminder rows | 10 |
| `src/app/w/[slug]/meetings/[id]/meeting-menu.tsx`, `nudge-button.tsx`, `result-tiles.tsx`, `person-row.tsx`, `page.tsx` | meeting page actions | 11 |
| `src/app/w/[slug]/meetings/meeting-card-menu.tsx` (replaces `draft-menu.tsx`) | card "…" with Duplicate | 6 |
| `src/app/r/[token]/reconfirm-banner.tsx`, `answer-view.tsx` | reconfirmation | 12 |
| `src/app/w/[slug]/meetings/[id]/check-in-list.tsx`, `check-in-row.tsx` | check-in | 13 |
| `src/app/w/[slug]/lists/*` (person sheet history, Attendance), `src/lib/export/rows.ts`, `use-export-answers.ts` | declared vs actual | 14 |
| `e2e/m6-lifecycle.spec.ts` | the M6 story | 15 |

---
### Task 1: #213 — M5 minors

Labels: `area:frontend`, `area:api`, `area:db`. Branch `fix/<issue>-m5-minors`.

**Files:**
- Modify: `src/app/r/[token]/answer-view.tsx` (`ClosedState`), `src/app/r/[token]/answer-view.test.tsx`
- Modify: `src/shared/api/responses.ts` (`submitAnswerBodySchema`), `src/shared/api/responses.test.ts`
- Modify: `src/server/http/errors.ts` (`POSTGRES_CODES`), `src/server/http/errors.test.ts` (create if absent)
- Modify: `src/hooks/use-results.ts` (export `meetingPeopleKey`), `src/hooks/use-meetings.ts` (`useSendMeeting`), `src/hooks/use-meetings.test.tsx`
- Modify: `src/components/ui/segmented-control.tsx` (+ `compact`), `src/components/ui/segmented-control.test.tsx`, `src/app/w/[slug]/lists/attendance-view.tsx`
- Modify: `src/server/db/outbox.db.test.ts` (the flaky test), `e2e/global-setup.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `meetingPeopleKey(slug: string, id: string): readonly ["meeting-people", string, string]` in `src/hooks/use-results.ts` (Tasks 11 and 13 invalidate it); `SegmentedControl` prop `compact?: boolean`.

- [ ] **Step 1: Failing tests**

`answer-view.test.tsx` — a started announcement shows no answer line:

```tsx
it("leaves out the answer line on a started announcement", async () => {
  mockToken({
    ...tokenInfoFixture,
    meeting: { ...tokenInfoFixture.meeting, startsAt: "2026-10-01T17:00:00.000Z" },
    answers: { ...tokenInfoFixture.answers, responseMode: "announcement" },
    answer: null,
  });
  renderAnswerView();
  expect(await screen.findByText("Answers are closed.")).toBeInTheDocument();
  expect(screen.queryByText("You didn't answer.")).toBeNull();
});
```

(Use the file's existing token mock and render helpers; the copy keys are `AnswerPage.closed` and `AnswerPage.noAnswerYet` — assert on their current English text.)

`responses.test.ts` — NUL characters are stripped:

```ts
it("strips NUL characters from the reason and the comment", () => {
  const body = submitAnswerBodySchema.parse({
    status: "absent",
    delayMinutes: null,
    reason: "Sick\u0000 today",
    comment: "\u0000",
  });
  expect(body.reason).toBe("Sick today");
  expect(body.comment).toBe("");
});
```

`errors.test.ts` — Postgres 22P05 maps to `invalid_input`:

```ts
it("maps an untranslatable character (22P05) to invalid_input", async () => {
  const response = fromDatabaseError({ code: "22P05", message: "unsupported Unicode escape sequence" });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_input" });
});
```

(Match the JSON shape `apiError` already returns; read `errors.ts` first.)

`use-meetings.test.tsx` — Send refreshes the people list:

```tsx
it("refreshes the meeting's people after Send", async () => {
  const { queryClient } = renderSendHook();
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  await act(() => result.current.mutateAsync());
  expect(spy).toHaveBeenCalledWith({ queryKey: ["meeting-people", "robotics-cd34", MEETING_IDS.meeting] });
});
```

`segmented-control.test.tsx` — compact keeps labels on one line:

```tsx
it("keeps labels on one line when compact", () => {
  renderWithProviders(
    <SegmentedControl label="Sort by" compact value="a" onValueChange={vi.fn()}
      options={[{ value: "a", label: "No reply" }, { value: "b", label: "Late" }]} />,
  );
  expect(screen.getByRole("radio", { name: "No reply" }).className).toContain("whitespace-nowrap");
});
```

- [ ] **Step 2: Run them; expect 5 failures**

Run: `bunx vitest run answer-view responses.test errors.test use-meetings segmented-control`
Expected: FAIL (answer line shown, NUL kept, 22P05 → internal, no people invalidation, no `compact`).

- [ ] **Step 3: Implement**

`answer-view.tsx` `ClosedState`: render the answer paragraph only when `info.answers.responseMode !== "announcement"`.

`responses.ts`:

```ts
/** Postgres text cannot hold NUL (22P05); a pasted one is dropped rather than failing the save. */
const answerText = (max: number) =>
  z.string().max(max).transform((value) => value.replaceAll("\u0000", ""));

export const submitAnswerBodySchema = z.object({
  status: answerStatusSchema,
  delayMinutes: z.number().int().min(1).max(240).nullable(),
  reason: answerText(REASON_MAX),
  comment: answerText(COMMENT_MAX),
});
```

`errors.ts` `POSTGRES_CODES`: add `"22P05": "invalid_input"` (any other text field with a NUL now gives a plain "check your input" instead of a 500).

`use-results.ts`: export `export const meetingPeopleKey = (slug: string, id: string) => ["meeting-people", slug, id] as const;` and build the `useMeetingPeople` key as `[...meetingPeopleKey(slug, id), filter]`. `use-meetings.ts` `useSendMeeting.onSettled`: add `meetingPeopleKey(slug, id)` to the invalidated keys.

`segmented-control.tsx`: add `compact?: boolean` (JSDoc: "Smaller one-line labels for four options on 320 px phones."); when set, each option gets `whitespace-nowrap px-2 text-xs min-[360px]:text-sm`. `attendance-view.tsx`: pass `compact` to the Sort control.

- [ ] **Step 4: The flaky DB test (use `superpowers:systematic-debugging`)**

Hypothesis to confirm first: the polling loop in "calls the dispatcher only when jobs are due…" calls `queryLocalSql` (a `supabase db query` CLI spawn, ~0.5–1 s each) up to 25 times, so a slow machine passes the 20 s `testTimeout`. Measure one `requests()` call with `performance.now()` in a scratch run. If confirmed: bound the loop by elapsed time instead of count and give the test its own timeout:

```ts
const eventually = async (check: () => boolean, withinMs = 10_000) => {
  const until = Date.now() + withinMs;
  while (!check()) {
    if (Date.now() > until) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return true;
};
// …
}, 40_000);
```

If the measurement says otherwise, record what it showed as a `Ruling:` and fix that cause instead. Run `bun run test:db -- outbox` five times in a row; all must pass.

- [ ] **Step 5: e2e global setup restores limits on failure**

Wrap everything after reading the originals in `try { … } catch (error) { setAppLimit("otp_send_per_ip_per_hour", original); setAppLimit("calendar_confirm_delay_seconds", calendarDelay); throw error; }` so a crash while starting the fake Gmail never leaves the OTP limit at 1000.

- [ ] **Step 6: Verify, screenshots, commit, PR, merge**

Run the chained check plus `bun run test:db` and `bun run test:e2e`. Screenshots: Lists → Attendance on a phone at 320 px dark (the Sort control on one line) and a started announcement's `/r/[token]` at 390 light. Commit `fix: M5 minors (#213)`; PR closes the task issue and references #213; merge with `merge-when-green.sh`; close #213.

---

### Task 2: Emails — update, cancellation, reminders; shared answer buttons; the invite's deadline only while it is ahead

Labels: `area:email`, `area:calendar`. Branch `feat/<issue>-m6-emails`.

**Files:**
- Create: `src/config/meeting-edit.ts`, `src/config/meeting-edit.test.ts`
- Create: `src/shared/api/meeting-changes.ts`, `src/shared/api/meeting-changes.test.ts`
- Create: `src/lib/meetings/changes.ts`, `src/lib/meetings/changes.test.ts`
- Create: `src/emails/answer-buttons.tsx`
- Create: `src/emails/meeting-update-email.tsx`, `meeting-update-email.test.tsx`
- Create: `src/emails/meeting-cancel-email.tsx`, `meeting-cancel-email.test.tsx`
- Create: `src/emails/meeting-reminder-email.tsx`, `meeting-reminder-email.test.tsx`
- Modify: `src/emails/meeting-invite-email.tsx` (use `AnswerButtons`; deadline line only while ahead), `meeting-invite-email.test.tsx`
- Modify: `messages/en.json` (`Email.meetingUpdate`, `Email.meetingCancel`, `Email.meetingReminder`, `Email.changes`)

**Interfaces:**
- Consumes: `EmailLayout`, `MeetingWhenWhere`, `MeetingFooter`, `bodyStyle`, `labelStyle`, `brutalBox`, `emailTheme`, `getEmailTranslator` (`src/emails/*`); `formatMeetingWhen`, `formatDeadline`, `meetingSubject` (`src/lib/meetings/format.ts`); `RESPONSE_CHOICES`, `ResponseChoice` (`src/config/meetings.ts`).
- Produces:
  - `src/config/meeting-edit.ts`: `EDITABLE_FIELDS`, `MEMBER_VISIBLE_FIELDS`, `SCHEDULE_FIELDS`, `PLACE_FIELDS`, `CALENDAR_FIELDS` (readonly tuples of snake_case column names) and types `EditableField`, `MemberVisibleField`.
  - `src/shared/api/meeting-changes.ts`: `changeValueSchema`, `changeSetSchema` (`Record<string, [old, new]>`), type `ChangeSet`.
  - `src/lib/meetings/changes.ts`: `type ChangeLine = { field: MemberVisibleField; kind: "diff"; from: string; to: string } | { field: MemberVisibleField; kind: "updated" }`, `type ChangeText = { label(field: MemberVisibleField): string; none: string; minutes(total: number): string; place(mode: LocationMode): string }`, `changeLines(changes: ChangeSet, timezone: string, text: ChangeText): ChangeLine[]`.
  - `AnswerButtons({ responseMode, respondUrl }: { responseMode: Exclude<ResponseMode, "announcement">; respondUrl: string })`.
  - `renderMeetingUpdateEmail(props: MeetingUpdateEmailProps)`, `renderMeetingCancelEmail(props: MeetingCancelEmailProps)`, `renderMeetingReminderEmail(props: MeetingReminderEmailProps)`, each `→ Promise<{ subject: string; html: string; text: string }>`; props types exported (see Step 3).

- [ ] **Step 1: Failing tests**

`src/config/meeting-edit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CALENDAR_FIELDS, EDITABLE_FIELDS, MEMBER_VISIBLE_FIELDS, PLACE_FIELDS, SCHEDULE_FIELDS } from "./meeting-edit";

describe("edit field groups", () => {
  it("only groups fields that can be edited", () => {
    for (const field of [...MEMBER_VISIBLE_FIELDS, ...SCHEDULE_FIELDS, ...PLACE_FIELDS, ...CALENDAR_FIELDS]) {
      expect(EDITABLE_FIELDS).toContain(field);
    }
  });
  it("never lets the answer type or the delays change after sending", () => {
    expect(EDITABLE_FIELDS).not.toContain("response_mode");
    expect(EDITABLE_FIELDS).not.toContain("delay_options");
  });
});
```

`src/lib/meetings/changes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { changeLines, type ChangeText } from "./changes";

const text: ChangeText = {
  label: (field) => ({ starts_at: "Time", duration_minutes: "Length", location_text: "Place", agenda_md: "Agenda",
    response_deadline: "Answer by", title: "Title", timezone: "Time zone", location_mode: "Where",
    online_text: "Online", meeting_url: "Link", footer_note: "Note" })[field],
  none: "None",
  minutes: (total) => `${total} min`,
  place: (mode) => mode,
};

describe("changeLines", () => {
  it("shows times in the meeting's zone, in field order, and skips hidden settings", () => {
    expect(changeLines({
      reason_required: [true, false],
      location_text: ["Room B12", "Hall A"],
      starts_at: ["2026-10-09T17:00:00+00:00", "2026-10-10T17:00:00+00:00"],
    }, "Africa/Tunis", text)).toEqual([
      { field: "starts_at", kind: "diff", from: "Fri 9 Oct, 18:00", to: "Sat 10 Oct, 18:00" },
      { field: "location_text", kind: "diff", from: "Room B12", to: "Hall A" },
    ]);
  });
  it("says 'updated' for long text and 'None' for a removed deadline", () => {
    expect(changeLines({
      agenda_md: ["a", "b"],
      response_deadline: ["2026-10-09T15:00:00+00:00", null],
      duration_minutes: [60, 90],
    }, "Africa/Tunis", text)).toEqual([
      { field: "duration_minutes", kind: "diff", from: "60 min", to: "90 min" },
      { field: "agenda_md", kind: "updated" },
      { field: "response_deadline", kind: "diff", from: "Fri 9 Oct, 16:00", to: "None" },
    ]);
  });
});
```

`src/emails/meeting-update-email.test.tsx` (props built like `calendar-confirm-email.test.tsx`'s `PROPS`, plus `changes`, `notify`, `reconfirm`, `calendar`, `now: new Date("2026-10-08T10:00:00Z")`):

```tsx
it("lists what changed and asks again after a time change", async () => {
  const email = await renderMeetingUpdateEmail({
    ...PROPS,
    changes: { starts_at: ["2026-10-09T17:00:00+00:00", "2026-10-10T17:00:00+00:00"] },
    notify: true, reconfirm: true, calendar: true,
  });
  expect(email.subject).toBe("Changed: Weekly sync · Fri 9 Oct, 18:00");
  expect(email.text).toContain("Time: Fri 9 Oct, 18:00 → Sat 10 Oct, 18:00");
  expect(email.text).toContain("Can you still come at the new time?");
  expect(email.html).toContain("https://app.test/r/TOKEN?choice=attending");
  expect(email.text).toContain("Your calendar is updated too.");
});
it("offers Change my answer, not the choice buttons, when the time stayed", async () => {
  const email = await renderMeetingUpdateEmail({
    ...PROPS, changes: { location_text: ["Room B12", "Hall A"] }, notify: true, reconfirm: false, calendar: false,
  });
  expect(email.html).not.toContain("?choice=");
  expect(email.text).toContain("Change my answer");
});
it("asks people to confirm when the time moved and moved back", async () => {
  const email = await renderMeetingUpdateEmail({ ...PROPS, changes: {}, notify: true, reconfirm: true, calendar: false });
  expect(email.subject).toBe("Please confirm: Weekly sync · Fri 9 Oct, 18:00");
  expect(email.text).not.toContain("→");
});
it("is a short calendar note when only the calendar copy changes", async () => {
  const email = await renderMeetingUpdateEmail({
    ...PROPS, changes: { agenda_md: ["a", "b"] }, notify: false, reconfirm: false, calendar: true,
  });
  expect(email.subject).toBe("Updated in your calendar: Weekly sync · Fri 9 Oct, 18:00");
  expect(email.text).toContain("Your calendar copy of this meeting is updated.");
});
```

`meeting-cancel-email.test.tsx`:

```tsx
it("says the meeting is cancelled and the event removed", async () => {
  const email = await renderMeetingCancelEmail({ ...PROPS, calendar: true });
  expect(email.subject).toBe("Cancelled: Weekly sync · Fri 9 Oct, 18:00");
  expect(email.text).toContain("GDG ISSAT cancelled Weekly sync on Fri 9 Oct at 18:00.");
  expect(email.text).toContain("It's removed from your calendar.");
  expect(email.html).not.toContain("?choice=");
});
```

`meeting-reminder-email.test.tsx`:

```tsx
it("asks someone who hasn't answered, with the deadline while it is ahead", async () => {
  const email = await renderMeetingReminderEmail({
    ...PROPS, audience: "pending",
    meeting: { ...PROPS.meeting, responseDeadline: "2026-10-09T12:00:00Z" },
  });
  expect(email.subject).toBe("Reminder: Weekly sync · Fri 9 Oct, 18:00");
  expect(email.text).toContain("Please answer by Fri 9 Oct, 13:00.");
  expect(email.html).toContain("?choice=late");
});
it("drops the deadline once it has passed", async () => {
  const email = await renderMeetingReminderEmail({
    ...PROPS, audience: "pending", now: new Date("2026-10-09T13:00:00Z"),
    meeting: { ...PROPS.meeting, responseDeadline: "2026-10-09T12:00:00Z" },
  });
  expect(email.text).toContain("Please let GDG ISSAT know if you're coming.");
  expect(email.text).not.toContain("Please answer by");
});
it("tells Going people when and where", async () => {
  const email = await renderMeetingReminderEmail({ ...PROPS, audience: "going" });
  expect(email.subject).toBe("See you at 18:00: Weekly sync");
  expect(email.text).toContain("See you on Fri 9 Oct at 18:00.");
  expect(email.text).toContain("Room B12");
  expect(email.html).not.toContain("?choice=");
});
```

`meeting-invite-email.test.tsx` — add: with `now` after the deadline, the invite has no "Please answer by" line (Invite more after the deadline, #220).

Every new email test file also gets the M5 "uses no emojis and escapes user text" case (copy it from `calendar-confirm-email.test.tsx` and point it at the new renderer).

- [ ] **Step 2: Run; expect failures** — `bunx vitest run meeting-edit changes meeting-update meeting-cancel meeting-reminder meeting-invite` → modules missing.

- [ ] **Step 3: Implement**

`src/config/meeting-edit.ts`:

```ts
/**
 * Fields an organizer can change after sending (spec §4 Edits after sending). The answer type and
 * the Late delays are fixed once sent. DB twin: `c_editable` in `private.edit_sent_meeting`.
 */
export const EDITABLE_FIELDS = [
  "title", "agenda_md", "starts_at", "duration_minutes", "timezone", "location_mode", "location_text",
  "online_text", "meeting_url", "response_deadline", "reason_required", "comments_enabled", "footer_note",
  "reminder_pending_hours", "reminder_going_hours",
] as const;
/** What members see, in the order a change summary lists them. DB twin: `c_visible`. */
export const MEMBER_VISIBLE_FIELDS = [
  "title", "starts_at", "duration_minutes", "timezone", "location_mode", "location_text", "online_text",
  "meeting_url", "agenda_md", "response_deadline", "footer_note",
] as const;
/** A change here emails everyone and (starts_at) asks them to reconfirm. DB twin: `c_schedule`. */
export const SCHEDULE_FIELDS = ["starts_at", "duration_minutes"] as const;
/** A change here emails everyone but people who said they can't come. DB twin: `c_place`. */
export const PLACE_FIELDS = ["location_mode", "location_text", "online_text", "meeting_url"] as const;
/** What the calendar event shows; a change updates calendar copies. DB twin: `c_calendar`. */
export const CALENDAR_FIELDS = [
  "title", "agenda_md", "starts_at", "duration_minutes", "location_mode", "location_text", "online_text", "meeting_url",
] as const;
/** One editable column. */
export type EditableField = (typeof EDITABLE_FIELDS)[number];
/** One member-visible column. */
export type MemberVisibleField = (typeof MEMBER_VISIBLE_FIELDS)[number];
```

`src/shared/api/meeting-changes.ts`:

```ts
import { z } from "zod";

/** One side of a change as the database writes it (`to_jsonb` of the column). */
export const changeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
/** `{ column: [old, new] }` (spec §6 `meeting_changes.changes`, `update` job payloads). */
export const changeSetSchema = z.record(z.string(), z.tuple([changeValueSchema, changeValueSchema]));
/** A set of field changes. */
export type ChangeSet = z.infer<typeof changeSetSchema>;
```

`src/lib/meetings/changes.ts`:

```ts
import { MEMBER_VISIBLE_FIELDS, type MemberVisibleField } from "@/config/meeting-edit";
import { type LocationMode, locationModeSchema } from "@/shared/api/meeting-settings";
import type { ChangeSet } from "@/shared/api/meeting-changes";
import { formatDeadline } from "./format";

/** One line of a change summary: old → new, or just "updated" for long text. */
export type ChangeLine =
  | { field: MemberVisibleField; kind: "diff"; from: string; to: string }
  | { field: MemberVisibleField; kind: "updated" };

/** Words the summary needs (the caller translates: next-intl in the app, the email translator in emails). */
export type ChangeText = {
  label: (field: MemberVisibleField) => string;
  none: string;
  minutes: (total: number) => string;
  place: (mode: LocationMode) => string;
};

const LONG_TEXT: readonly MemberVisibleField[] = ["agenda_md", "footer_note"];
const INSTANTS: readonly MemberVisibleField[] = ["starts_at", "response_deadline"];

function show(field: MemberVisibleField, value: string | number | boolean | null, timezone: string, text: ChangeText): string {
  if (value === null || value === "") {
    return text.none;
  }
  if (INSTANTS.includes(field) && typeof value === "string") {
    return formatDeadline(value, timezone);
  }
  if (field === "duration_minutes" && typeof value === "number") {
    return text.minutes(value);
  }
  const mode = field === "location_mode" ? locationModeSchema.safeParse(value) : null;
  if (mode?.success) {
    return text.place(mode.data);
  }
  return String(value);
}

/**
 * The member-visible part of a change set, in display order (spec §7.5 update email, Review
 * changes). Times are shown in the meeting's current zone.
 */
export function changeLines(changes: ChangeSet, timezone: string, text: ChangeText): ChangeLine[] {
  return MEMBER_VISIBLE_FIELDS.flatMap((field): ChangeLine[] => {
    const change = changes[field];
    if (!change) {
      return [];
    }
    if (LONG_TEXT.includes(field)) {
      return [{ field, kind: "updated" }];
    }
    return [{ field, kind: "diff", from: show(field, change[0], timezone, text), to: show(field, change[1], timezone, text) }];
  });
}
```



`src/emails/answer-buttons.tsx` — move the `CHOICE_FILL` map and the `choices.map(...)` button row out of `meeting-invite-email.tsx` unchanged:

```tsx
import { Button, Section } from "react-email";
import { RESPONSE_CHOICES, type ResponseChoice } from "@/config/meetings";
import type { ResponseMode } from "@/shared/api/meeting-settings";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

const CHOICE_FILL: Record<ResponseChoice, string> = {
  attending: t.success, going: t.success, late: t.warning, absent: t.danger, not_going: t.danger,
};

/** The answer buttons of a mode; each only pre-selects its choice on `/r/[token]` (spec §4). */
export function AnswerButtons({
  responseMode,
  respondUrl,
}: {
  responseMode: Exclude<ResponseMode, "announcement">;
  respondUrl: string;
}) {
  const tr = getEmailTranslator();
  return (
    <Section style={{ margin: "20px 0 8px" }}>
      {RESPONSE_CHOICES[responseMode].map((choice) => (
        <Button
          key={choice}
          href={`${respondUrl}?choice=${choice}`}
          style={{
            ...brutalBox(CHOICE_FILL[choice], t.radiusControl),
            color: t.ink, display: "inline-block", fontFamily: t.fontDisplay, fontSize: "15px",
            margin: "0 8px 8px 0", padding: "12px 18px", textDecoration: "none",
          }}
        >
          {tr(`meetingInvite.choice.${choice}`)}
        </Button>
      ))}
    </Section>
  );
}
```

Also extract the single "primary" link button (used by the calendar email's "Change your answer" and the new emails' "Change my answer") into `answer-buttons.tsx` as `export function PrimaryLinkButton({ href, label }: { href: string; label: string })` with the calendar email's existing style, and use it in `calendar-confirm-email.tsx` too.

`meeting-invite-email.tsx`: replace the choices branch with `<AnswerButtons responseMode={meeting.responseMode} respondUrl={links.respond} />` (guarded by `meeting.responseMode !== "announcement"`); add `now?: Date` to `MeetingInviteEmailProps` and show the deadline line only when `new Date(meeting.responseDeadline) > (now ?? new Date())`.

`src/emails/meeting-update-email.tsx`:

```tsx
import { render, Text } from "react-email";
import { changeLines, type ChangeText } from "@/lib/meetings/changes";
import { durationText, formatMeetingWhen } from "@/lib/meetings/format";
import type { ChangeSet } from "@/shared/api/meeting-changes";
import type { MeetingInviteEmailProps } from "./meeting-invite-email";
import { AnswerButtons, PrimaryLinkButton } from "./answer-buttons";
import { EmailLayout } from "./email-layout";
import { bodyStyle as body, MeetingFooter, MeetingWhenWhere } from "./meeting-blocks";
import { getEmailTranslator } from "./translator";

/** One person's update after a sent meeting changed (spec §7.5). */
export type MeetingUpdateEmailProps = Omit<MeetingInviteEmailProps, "now"> & {
  changes: ChangeSet;
  /** false: only the calendar copy changes (a calendar-only note). */
  notify: boolean;
  /** The time moved: ask again with the answer buttons. */
  reconfirm: boolean;
  /** The email carries a calendar update (`.ics` attached by the MIME builder). */
  calendar: boolean;
};

function changeText(tr: ReturnType<typeof getEmailTranslator>): ChangeText {
  return {
    label: (field) => tr(`changes.fields.${field}`),
    none: tr("changes.none"),
    minutes: (total) =>
      durationText(total, {
        minutes: (count) => tr("changes.minutes", { count }),
        hours: (hours) => tr("changes.hours", { hours }),
        hoursMinutes: (hours, minutes) => tr("changes.hoursMinutes", { hours, minutes }),
      }),
    place: (mode) => tr(`changes.place.${mode}`),
  };
}

/** The update email: what changed, the meeting card, and either the answer buttons or "Change my answer". */
export function MeetingUpdateEmail(props: MeetingUpdateEmailProps) {
  const { workspaceName, senderEmail, meeting, links, changes, notify, reconfirm, calendar } = props;
  const tr = getEmailTranslator();
  const lines = notify ? changeLines(changes, meeting.timezone, changeText(tr)) : [];
  const answers = meeting.responseMode !== "announcement";
  return (
    <EmailLayout
      sticker={workspaceName}
      preview={tr("meetingUpdate.preview", { workspace: workspaceName })}
      heading={meeting.title}
      footer={<MeetingFooter workspaceName={workspaceName} senderEmail={senderEmail} links={links} />}
    >
      <Text style={body}>
        {notify ? tr("meetingUpdate.intro", { workspace: workspaceName }) : tr("meetingUpdate.calendarOnly")}
      </Text>
      {lines.map((line) => (
        <Text key={line.field} style={{ ...body, marginTop: "8px" }}>
          {line.kind === "diff"
            ? tr("meetingUpdate.line", { label: tr(`changes.fields.${line.field}`), from: line.from, to: line.to })
            : tr("meetingUpdate.updated", { label: tr(`changes.fields.${line.field}`) })}
        </Text>
      ))}
      <MeetingWhenWhere meeting={meeting} />
      {answers && notify && reconfirm ? (
        <>
          <Text style={{ ...body, marginTop: "16px" }}>{tr("meetingUpdate.reconfirm")}</Text>
          <AnswerButtons responseMode={meeting.responseMode} respondUrl={links.respond} />
        </>
      ) : answers && notify ? (
        <PrimaryLinkButton href={links.respond} label={tr("meetingUpdate.change")} />
      ) : null}
      {calendar ? <Text style={{ ...body, fontSize: "14px", marginTop: "12px" }}>{tr("meetingUpdate.calendar")}</Text> : null}
    </EmailLayout>
  );
}

/** Subject + HTML + text. Subjects: "Changed: …", "Please confirm: …" (time moved and back), "Updated in your calendar: …". */
export async function renderMeetingUpdateEmail(props: MeetingUpdateEmailProps) {
  const tr = getEmailTranslator();
  const when = formatMeetingWhen(props.meeting);
  const values = { title: props.meeting.title, date: when.date, time: when.start };
  const visible = changeLines(props.changes, props.meeting.timezone, changeText(tr)).length > 0;
  const subject = !props.notify
    ? tr("meetingUpdate.subjectCalendar", values)
    : visible ? tr("meetingUpdate.subject", values) : tr("meetingUpdate.subjectConfirm", values);
  const element = <MeetingUpdateEmail {...props} />;
  return { subject, html: await render(element), text: await render(element, { plainText: true }) };
}
```

`meeting-cancel-email.tsx` (same imports; `MeetingCancelEmailProps = Omit<MeetingInviteEmailProps, "now"> & { calendar: boolean }`): body `tr("meetingCancel.body", { workspace, title, date: when.date, time: when.start })`, then `tr("meetingCancel.calendar")` when `calendar`; no `MeetingWhenWhere`, no buttons; subject `tr("meetingCancel.subject", values)`.

`meeting-reminder-email.tsx` (`MeetingReminderEmailProps = MeetingInviteEmailProps & { audience: "pending" | "going" }`):
- `pending`: `tr("meetingReminder.answerBy", { deadline })` when a deadline is ahead of `now ?? new Date()`, else `tr("meetingReminder.answer", { workspace })`; `MeetingWhenWhere`; `AnswerButtons` (an announcement never gets a reminder, but guard with `responseMode !== "announcement"`). Subject `tr("meetingReminder.subjectPending", values)`.
- `going`: `tr("meetingReminder.seeYou", { date, time })`; `MeetingWhenWhere`; `PrimaryLinkButton` "Change my answer". Subject `tr("meetingReminder.subjectGoing", { title, time })`.

`messages/en.json` under `Email` (next to `calendarConfirm`):

```json
"changes": {
  "none": "None",
  "minutes": "{count} min",
  "hours": "{hours} h",
  "hoursMinutes": "{hours} h {minutes}",
  "fields": { "title": "Title", "starts_at": "Time", "duration_minutes": "Length", "timezone": "Time zone",
    "location_mode": "Where", "location_text": "Place", "online_text": "Online", "meeting_url": "Link",
    "agenda_md": "Agenda", "response_deadline": "Answer by", "footer_note": "Note" },
  "place": { "in_person": "In person", "online": "Online", "hybrid": "In person and online" }
},
"meetingUpdate": {
  "preview": "{workspace} changed this meeting.",
  "intro": "{workspace} changed this meeting.",
  "calendarOnly": "Your calendar copy of this meeting is updated.",
  "line": "{label}: {from} → {to}",
  "updated": "{label}: updated",
  "reconfirm": "Can you still come at the new time?",
  "change": "Change my answer",
  "calendar": "Your calendar is updated too.",
  "subject": "Changed: {title} · {date}, {time}",
  "subjectConfirm": "Please confirm: {title} · {date}, {time}",
  "subjectCalendar": "Updated in your calendar: {title} · {date}, {time}"
},
"meetingCancel": {
  "preview": "{workspace} cancelled this meeting.",
  "body": "{workspace} cancelled {title} on {date} at {time}.",
  "calendar": "It's removed from your calendar.",
  "subject": "Cancelled: {title} · {date}, {time}"
},
"meetingReminder": {
  "preview": "A reminder from {workspace}.",
  "answerBy": "Please answer by {deadline}.",
  "answer": "Please let {workspace} know if you're coming.",
  "seeYou": "See you on {date} at {time}.",
  "change": "Change my answer",
  "subjectPending": "Reminder: {title} · {date}, {time}",
  "subjectGoing": "See you at {time}: {title}"
}
```

Durations read like the wizard's chips ("45 min", "1 h", "1 h 30"): add `export function durationText(total: number, words: { minutes(count: number): string; hours(hours: number): string; hoursMinutes(hours: number, minutes: number): string }): string` to `src/lib/meetings/format.ts`, make `details-step.tsx`'s and `meeting-defaults-section.tsx`'s local `hoursLabel`/`minutes` helpers call it (DRY), and build `ChangeText.minutes` from it with the three `changes.*` keys above. Test "1 h 30" in `format.test.ts`.

- [ ] **Step 4: Run; expect PASS** — the same `bunx vitest run …` command, then the chained check. Render each new email once to a file (`bun -e` script in the scratchpad that writes the HTML) and look at it in a browser at 390 px: plain words, no "→" when nothing changed, buttons tappable.

- [ ] **Step 5: Commit, PR, merge** — `feat: update, cancellation and reminder emails`.

---

### Task 3: Dispatcher (TypeScript) — understands and sends `update`, `cancel`, `reminder`

Labels: `area:pipeline`, `area:email`, `area:calendar`. Branch `feat/<issue>-m6-dispatcher`.

**Why now:** Task 5's migration makes production create these job kinds. This task must be merged and deployed first, or one unknown kind in a claim makes `claimSchema.parse` throw and stalls every email of that Gmail.

**Files:**
- Modify: `src/server/queries/dispatch.ts` (claim schema: kinds, `payload`), `src/server/dispatch/run-dispatch.ts` (render per kind, summary)
- Modify: `src/server/dispatch/run-dispatch.test.ts` (fake-store tests)

**Interfaces:**
- Consumes (Task 2): `renderMeetingUpdateEmail`, `renderMeetingCancelEmail`, `renderMeetingReminderEmail`, `changeSetSchema`.
- Produces: `ClaimedJob.kind: "invite" | "calendar_confirm" | "update" | "cancel" | "reminder"`; `ClaimedJob.payload: { changes: ChangeSet; notify: boolean; reconfirm: boolean; audience: "pending" | "going" }` (defaults `{}`, `false`, `false`, `"pending"` so an `invite` row with `payload = {}` parses); `DispatchSummary` gains `updates`, `cancellations`, `reminders` (each also counted in `sent`). The DB side of these kinds (`dispatch_claim` returning `payload`, `dispatch_reserve` deciding) is Task 5; until then the claim simply never contains them, and `payload` is absent (the schema defaults it).

- [ ] **Step 1: Failing tests** (`run-dispatch.test.ts`, with the file's `job(n)`, `setup({ jobs, reserve })` and `decoded(raw)` helpers)

Widen the `job()` helper: `kind` typed as `ClaimedJob["kind"]` and a `payload` with the schema's defaults (`{ changes: {}, notify: false, reconfirm: false, audience: "pending" }`), so the M5 cases keep passing unchanged. Then:

```ts
const unfold = (mime: string) => mime.replace(/\r\n[ \t]/g, "");
const rawOf = (deps: DispatchDeps, call = 0) => decoded(vi.mocked(deps.gmail).mock.calls[call][0].raw);

it("sends an update with the calendar request inside for a calendar holder", async () => {
  const { deps } = setup({
    jobs: [{ ...job(1, undefined, "t-1"), kind: "update", payload: {
      changes: { starts_at: ["2026-10-09T17:00:00+00:00", "2026-10-10T17:00:00+00:00"] },
      notify: true, reconfirm: true, audience: "pending",
    } }],
    reserve: [{ kind: "ok", calendar: { action: "request", sequence: 1 } }],
  });
  const summary = await runDispatch(deps, OPTIONS);
  expect(summary).toMatchObject({ sent: 1, updates: 1, calendar: 1 });
  const raw = unfold(rawOf(deps));
  expect(raw).toContain("Subject: Changed: Weekly sync");
  expect(raw).toContain("METHOD:REQUEST");
  expect(raw).toContain("SEQUENCE:1");
});

it("sends a cancellation with METHOD:CANCEL only for a calendar holder", async () => {
  const holder = setup({
    jobs: [{ ...job(1, undefined, "t-1"), kind: "cancel" }],
    reserve: [{ kind: "ok", calendar: { action: "cancel", sequence: 2 } }],
  });
  await runDispatch(holder.deps, OPTIONS);
  expect(unfold(rawOf(holder.deps))).toContain("METHOD:CANCEL");
  const other = setup({ jobs: [{ ...job(2, undefined, "t-1"), kind: "cancel" }] });
  await runDispatch(other.deps, OPTIONS);
  expect(rawOf(other.deps)).not.toContain("text/calendar");
  expect(rawOf(other.deps)).toContain("Subject: Cancelled: Weekly sync");
});

it("sends a reminder with the answer buttons to someone who hasn't answered", async () => {
  const { deps } = setup({ jobs: [{ ...job(1, undefined, "t-1"), kind: "reminder" }] });
  const summary = await runDispatch(deps, OPTIONS);
  expect(summary).toMatchObject({ sent: 1, reminders: 1 });
  expect(rawOf(deps)).toContain("?choice=3Dattending");
});

it("still parses an invite claimed before the M6 migration (no payload)", () => {
  expect(() => parseClaim(dbClaimRow({ kind: "invite" }))).not.toThrow();
});
```

(`parseClaim`: export the claim parser from `dispatch.ts` as `parseClaim(data: object | null): Claim | null` and use it inside `createDispatchStore().claim`; `dbClaimRow` builds one snake_case claim like the M5 DB test's JSON, without `payload`. Quoted-printable turns `=` into `=3D` in the HTML part, as `answerLinkFrom` handles in e2e.)

Run: `bunx vitest run run-dispatch` → FAIL.

- [ ] **Step 2: Claim schema** (`dispatch.ts`)

```ts
import { changeSetSchema } from "@/shared/api/meeting-changes";

const jobKindSchema = z.enum(["invite", "calendar_confirm", "update", "cancel", "reminder"]);
/** What a job carries besides the invitee (spec §8; Task 5 writes it). Defaults keep M5 rows parsing. */
const jobPayloadSchema = z
  .object({
    changes: changeSetSchema.default({}),
    notify: z.boolean().default(false),
    reconfirm: z.boolean().default(false),
    audience: z.enum(["pending", "going"]).default("pending"),
  })
  .loose()
  .default({ changes: {}, notify: false, reconfirm: false, audience: "pending" });
```

Use `kind: jobKindSchema` and `payload: jobPayloadSchema` in the job object, and carry `payload: { changes, notify, reconfirm, audience }` through the transform.

- [ ] **Step 3: Rendering per kind** (`run-dispatch.ts`)

Replace the `const email = decision ? … : …` expression with a `renderJob(job, decision, common)` switch:

```ts
async function renderJob(
  job: ClaimedJob,
  decision: CalendarDecision | null,
  common: Parameters<typeof renderMeetingInviteEmail>[0],
): Promise<{ subject: string; html: string; text: string }> {
  switch (job.kind) {
    case "invite":
      return renderMeetingInviteEmail(common);
    case "calendar_confirm":
      // drainSender never reaches here without a decision for a calendar job.
      return renderCalendarConfirmEmail({ ...common, action: decision?.action ?? "request" });
    case "update":
      return renderMeetingUpdateEmail({
        ...common, changes: job.payload.changes, notify: job.payload.notify,
        reconfirm: job.payload.reconfirm, calendar: decision !== null,
      });
    case "cancel":
      return renderMeetingCancelEmail({ ...common, calendar: decision !== null });
    case "reminder":
      return renderMeetingReminderEmail({ ...common, audience: job.payload.audience });
  }
}
```

Keep `calendarFile(…)` for any job with a decision. In the `"sent"` branch, after `summary.sent += 1`, count `updates`/`cancellations`/`reminders` by kind (and `calendar` when `decision` is set, as now). Add the three counters to `DispatchSummary` and its initial value.

- [ ] **Step 4: Run; expect PASS** — `bunx vitest run run-dispatch dispatch`, then the chained check and `bun run test:db -- run-dispatch` (the M5 integration tests must pass unchanged: invites and calendar jobs still render exactly as before).

- [ ] **Step 5: Commit, PR, merge** — `feat: the dispatcher sends updates, cancellations and reminders`. Confirm the Production deployment is Ready (`vercel ls tapnshow --scope dalychouikhs-projects`) before Task 5's migration is pushed.

---

### Task 4: DB — reminder settings, `meeting_changes`, `attendance_marks`, shared helpers

Labels: `area:db`, `area:pipeline`, `area:api`. Branch `feat/<issue>-m6-foundation`.

**Files:**
- Create: `supabase/migrations/<ts>_m6_foundation.sql` (`supabase migration new m6_foundation </dev/null`)
- Create: `src/server/db/m6-foundation.db.test.ts`
- Create: `src/config/reminders.ts`, `src/config/reminders.test.ts`
- Modify: `src/server/db/database.types.ts` (`bun run db:types`)
- Modify: `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors.deadline_in_past`, `ApiErrors.deadline_after_start`)
- Modify: `src/test/db/meetings.ts` (`seedMeeting` overrides: `response_deadline`, `reminder_pending_hours`, `reminder_going_hours`, `response_mode`)

**Interfaces:**
- Consumes: `private.is_member`, `private.app_limit`, `private.audience_members`, `private.hit_user_rate_limit` (M2–M4).
- Produces (SQL): columns `workspaces.default_reminder_pending_hours`/`default_reminder_going_hours`, `meetings.reminder_pending_hours`/`reminder_going_hours`/`last_nudged_at`/`last_nudged_count`/`cancelled_at`, `outbox_jobs.meeting_id`; tables `meeting_changes`, `attendance_marks`; types `meeting_change_kind`, `attendance_actual`; functions `private.response_deadline_problem(timestamptz, timestamptz) → text` (`'deadline_in_past' | 'deadline_after_start' | null`), `private.meeting_incomplete(public.meetings) → boolean`, `private.require_active_sender(uuid)` (raises `sender_not_connected`/`sender_broken`); limit `nudge_interval_hours` = 12.
- Produces (TS): `REMINDER_PENDING_CHOICES = [1, 2, 6, 24, 48] as const`, `REMINDER_GOING_CHOICES = [1, 2, 6, 24] as const`, `REMINDER_PENDING_DEFAULT = 24`, `REMINDER_GOING_DEFAULT = 2`, types `ReminderPendingHours`, `ReminderGoingHours`.

- [ ] **Step 1: Failing DB tests** (`src/server/db/m6-foundation.db.test.ts`)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { queryLocalSql } from "@/test/db/sql";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let contact: string;

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

async function sendTo(meeting: string, contactIds: string[]) {
  const audience = await owner.client.rpc("set_meeting_audience", {
    p_meeting: meeting, p_list_ids: [], p_include: contactIds, p_exclude: [],
  });
  if (audience.error) throw audience.error;
  return owner.client.rpc("send_meeting", { p_meeting: meeting });
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "M6 Club");
  await setSender(workspace.id, await seedConnection(owner.id));
  [contact] = await seedContacts(workspace.id, 1, `m6-${crypto.randomUUID().slice(0, 6)}`);
});

describe("response_deadline_problem", () => {
  const problem = (deadline: string | null, start: string | null) =>
    queryLocalSql(
      `select private.response_deadline_problem(${deadline ? `'${deadline}'` : "null"}, ${start ? `'${start}'` : "null"}) as p`,
      z.array(z.object({ p: z.string().nullable() })),
    )[0].p;

  it("accepts a deadline later the same day, before the start", () => {
    expect(problem(hoursFromNow(1), hoursFromNow(2))).toBeNull();
  });
  it("refuses a deadline at or after the start, and one in the past", () => {
    const start = hoursFromNow(2);
    expect(problem(start, start)).toBe("deadline_after_start");
    expect(problem(hoursFromNow(3), start)).toBe("deadline_after_start");
    expect(problem(hoursFromNow(-1), start)).toBe("deadline_in_past");
  });
  it("has nothing to say without a deadline", () => {
    expect(problem(null, hoursFromNow(2))).toBeNull();
  });
});

describe("send_meeting (M6)", () => {
  it("refuses a first send whose deadline is at the start, with the deadline code", async () => {
    const start = hoursFromNow(5);
    const meeting = await seedMeeting(workspace.id, { starts_at: start, response_deadline: start });
    await expectAppError(sendTo(meeting, [contact]), "deadline_after_start");
  });

  it("lets Invite more go out after the deadline has passed", async () => {
    const meeting = await seedMeeting(workspace.id, { starts_at: hoursFromNow(5), response_deadline: hoursFromNow(1) });
    const first = await sendTo(meeting, [contact]);
    expect(first.error).toBeNull();
    await adminClient().from("meetings").update({ response_deadline: hoursFromNow(-1) }).eq("id", meeting);
    const [later] = await seedContacts(workspace.id, 1, `late-${crypto.randomUUID().slice(0, 6)}`);
    const more = await sendTo(meeting, [contact, later]);
    expect(more.error).toBeNull();
  });

});

describe("create_meeting copies the reminder defaults", () => {
  it("uses the workspace's defaults (24 h and 2 h unless changed)", async () => {
    await adminClient().from("workspaces").update({ default_reminder_going_hours: null }).eq("id", workspace.id);
    const { data: id } = await owner.client.rpc("create_meeting", { p_workspace: workspace.id });
    const { data } = await adminClient().from("meetings")
      .select("reminder_pending_hours, reminder_going_hours").eq("id", id ?? "").single();
    expect(data).toEqual({ reminder_pending_hours: 24, reminder_going_hours: null });
  });
});

describe("meeting_changes and attendance_marks access", () => {
  it("lets members read and nobody write directly", async () => {
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    const meeting = await seedMeeting(workspace.id, { status: "scheduled" });
    await adminClient().from("meeting_changes").insert({
      workspace_id: workspace.id, meeting_id: meeting, kind: "edit", changes: {}, notified: false,
    });
    expect((await viewer.client.from("meeting_changes").select("id").eq("meeting_id", meeting)).data).toHaveLength(1);
    const write = await owner.client.from("meeting_changes").insert({
      workspace_id: workspace.id, meeting_id: meeting, kind: "edit", changes: {}, notified: false,
    });
    expect(write.error?.code).toBe("42501");
    const outsider = await createTestUser();
    expect((await outsider.client.from("meeting_changes").select("id").eq("meeting_id", meeting)).data).toEqual([]);
    const mark = await owner.client.from("attendance_marks").insert({
      invitee_id: crypto.randomUUID(), workspace_id: workspace.id, meeting_id: meeting, actual: "present",
    });
    expect(mark.error?.code).toBe("42501");
  });
});
```

`src/config/reminders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REMINDER_GOING_CHOICES, REMINDER_GOING_DEFAULT, REMINDER_PENDING_CHOICES, REMINDER_PENDING_DEFAULT } from "./reminders";

describe("reminder choices", () => {
  it("offers the defaults among the choices", () => {
    expect(REMINDER_PENDING_CHOICES).toContain(REMINDER_PENDING_DEFAULT);
    expect(REMINDER_GOING_CHOICES).toContain(REMINDER_GOING_DEFAULT);
  });
});
```

- [ ] **Step 2: Run; expect failures** — `bun run test:db -- m6-foundation` (columns/functions missing) and `bunx vitest run reminders` (module missing).

- [ ] **Step 3: Migration** (`<ts>_m6_foundation.sql`)

```sql
-- M6 foundation (spec §6, §7.5, §7.6): reminder settings, the change log, check-in marks, the
-- shared rules (deadline, complete meeting, active sender). Reminder timers come with Task 5.

insert into private.app_limits (name, value) values ('nudge_interval_hours', 12);

-- Reminder choices: the TS twin is src/config/reminders.ts. Null = off.
alter table public.workspaces
  add column default_reminder_pending_hours smallint default 24
    check (default_reminder_pending_hours in (1, 2, 6, 24, 48)),
  add column default_reminder_going_hours smallint default 2
    check (default_reminder_going_hours in (1, 2, 6, 24));
grant update (default_reminder_pending_hours, default_reminder_going_hours) on table public.workspaces to authenticated;

alter table public.meetings
  add column reminder_pending_hours smallint check (reminder_pending_hours in (1, 2, 6, 24, 48)),
  add column reminder_going_hours smallint check (reminder_going_hours in (1, 2, 6, 24)),
  add column last_nudged_at timestamptz,
  add column last_nudged_count integer check (last_nudged_count >= 0),
  add column cancelled_at timestamptz;
grant update (reminder_pending_hours, reminder_going_hours) on table public.meetings to authenticated;

-- Per-meeting jobs (reminder timers) have no invitee; per-person M6 jobs set it too, so deleting
-- a meeting removes every job that belongs to it.
alter table public.outbox_jobs
  add column meeting_id uuid references public.meetings (id) on delete cascade;
create index outbox_jobs_meeting_idx on public.outbox_jobs (meeting_id, kind, status) where meeting_id is not null;

create type public.meeting_change_kind as enum ('edit', 'cancel');
create table public.meeting_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  meeting_id uuid not null,
  kind public.meeting_change_kind not null,
  changes jsonb not null default '{}' check (pg_catalog.jsonb_typeof(changes) = 'object'),
  notified boolean not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade
);
create index meeting_changes_meeting_idx on public.meeting_changes (meeting_id, workspace_id, changed_at);
create index meeting_changes_workspace_idx on public.meeting_changes (workspace_id);
create index meeting_changes_changed_by_idx on public.meeting_changes (changed_by);

create type public.attendance_actual as enum ('present', 'late', 'absent');
create table public.attendance_marks (
  invitee_id uuid primary key references public.meeting_invitees (id) on delete cascade,
  workspace_id uuid not null,
  meeting_id uuid not null,
  actual public.attendance_actual not null,
  marked_by uuid references auth.users (id) on delete set null,
  marked_at timestamptz not null default now(),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade
);
create index attendance_marks_meeting_idx on public.attendance_marks (meeting_id, workspace_id);
create index attendance_marks_workspace_idx on public.attendance_marks (workspace_id);
create index attendance_marks_marked_by_idx on public.attendance_marks (marked_by);

alter table public.meeting_changes enable row level security;
alter table public.attendance_marks enable row level security;
revoke all on table public.meeting_changes, public.attendance_marks from anon, authenticated;
grant select on table public.meeting_changes, public.attendance_marks to authenticated;
grant all on table public.meeting_changes, public.attendance_marks to service_role;
create policy meeting_changes_select_members on public.meeting_changes
  for select to authenticated using (private.is_member(workspace_id));
create policy attendance_marks_select_members on public.attendance_marks
  for select to authenticated using (private.is_member(workspace_id));

-- The answer-deadline rule (spec §7.2, #220): now < deadline < start. TS twin:
-- responseDeadlineProblem (src/lib/meetings/deadline.ts). The result is an error code.
create function private.response_deadline_problem(p_deadline timestamptz, p_starts_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_deadline is null then null
    when p_deadline <= pg_catalog.now() then 'deadline_in_past'
    when p_starts_at is not null and p_deadline >= p_starts_at then 'deadline_after_start'
  end
$$;

-- What a meeting needs before it can be sent or saved after sending (spec §7.2).
create function private.meeting_incomplete(p_meeting public.meetings)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_meeting.title = ''
    or p_meeting.starts_at is null
    or (p_meeting.location_mode in ('in_person', 'hybrid') and p_meeting.location_text = '')
    or (p_meeting.location_mode in ('online', 'hybrid') and p_meeting.meeting_url = '' and p_meeting.online_text = '')
    or (p_meeting.response_mode = 'attendance' and pg_catalog.cardinality(p_meeting.delay_options) = 0)
$$;

create function private.require_active_sender(p_workspace uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status public.connection_status;
  v_connected boolean;
begin
  select c.id is not null, c.status into v_connected, v_status
  from public.workspaces w
  left join public.google_connections c on c.id = w.sender_connection_id
  where w.id = p_workspace;
  if not coalesce(v_connected, false) then
    raise exception 'tn:sender_not_connected' using errcode = 'P0001';
  end if;
  if v_status <> 'active' then
    raise exception 'tn:sender_broken' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function private.response_deadline_problem(timestamptz, timestamptz),
  private.meeting_incomplete(public.meetings), private.require_active_sender(uuid)
  from public, anon, authenticated;

-- create_meeting: latest body from 20261008152332_m4_online_place.sql plus the reminder defaults.
create or replace function private.create_meeting(p_workspace uuid)
returns uuid
language plpgsql
security definer
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
    comments_enabled, footer_note, online_text, meeting_url, reminder_pending_hours, reminder_going_hours, created_by
  )
  select w.id, w.default_duration_minutes, w.timezone, w.default_response_mode, w.default_delay_options,
    w.default_reason_required, w.default_comments_enabled, w.default_footer_note,
    w.default_online_text, w.default_meeting_url, w.default_reminder_pending_hours, w.default_reminder_going_hours,
    auth.uid()
  from public.workspaces w
  where w.id = p_workspace
  returning id into v_id;
  return v_id;
end;
$$;

-- send_meeting: latest body from 20261008152332_m4_online_place.sql, with the shared rules; the
-- deadline is checked only at the first send (Invite more after the deadline is allowed, #220).
create or replace function private.send_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_problem text;
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
  if private.meeting_incomplete(v_meeting) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'draft' then
    v_problem := private.response_deadline_problem(v_meeting.response_deadline, v_meeting.starts_at);
    if v_problem is not null then
      raise exception 'tn:%', v_problem using errcode = 'P0001';
    end if;
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  perform private.require_active_sender(v_meeting.workspace_id);

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
```


- [ ] **Step 4: `src/config/reminders.ts`**

```ts
/** "People who haven't answered" reminder choices in hours (DB twin: the `reminder_pending_hours` checks). */
export const REMINDER_PENDING_CHOICES = [1, 2, 6, 24, 48] as const;
/** "Going and Late" reminder choices in hours (DB twin: the `reminder_going_hours` checks). */
export const REMINDER_GOING_CHOICES = [1, 2, 6, 24] as const;
/** Default for new workspaces (DB twin: `workspaces.default_reminder_pending_hours` default). */
export const REMINDER_PENDING_DEFAULT = 24;
/** Default for new workspaces (DB twin: `workspaces.default_reminder_going_hours` default). */
export const REMINDER_GOING_DEFAULT = 2;
/** One "not answered" choice. */
export type ReminderPendingHours = (typeof REMINDER_PENDING_CHOICES)[number];
/** One "Going and Late" choice. */
export type ReminderGoingHours = (typeof REMINDER_GOING_CHOICES)[number];
```

- [ ] **Step 5: Error codes** — add `deadline_in_past` (400) and `deadline_after_start` (400) to `API_ERROR_CODES`/`API_ERROR_STATUS` and `messages/en.json` `ApiErrors` ("Pick a deadline in the future.", "The answer deadline must be before the meeting starts."). The Review step (#220) already holds Send for these, so the codes only show if a stale page sends.

- [ ] **Step 6: Apply, types, run** — `supabase migration up --local </dev/null && bun run db:types`; `bun run test:db -- m6-foundation` → PASS; then the whole `bun run test:db` (the M4/M5 `send_meeting` tests must still pass; a test that expected `meeting_incomplete` for a bad deadline now expects `deadline_after_start` or `deadline_in_past` — update it and note it as a `Ruling:`). `supabase db advisors --local </dev/null` → no WARN/ERROR.

- [ ] **Step 7: Commit, PR, merge, hosted push** — `feat: M6 foundation (reminder settings, change log, check-in table, shared rules)`; after the merge, run `hosted-push.sh` at once.

---
### Task 5: DB — reminder timers at the first send, timer fan-out, `update` / `cancel` / `reminder` in the dispatcher functions, `nudge_meeting`

Labels: `area:db`, `area:pipeline`. Branch `feat/<issue>-m6-dispatch-kinds`.

**Files:**
- Create: `supabase/migrations/<ts>_m6_dispatch_kinds.sql`
- Create: `src/server/db/m6-dispatch.db.test.ts`
- Modify: `src/server/db/database.types.ts`, `src/server/db/function-security.db.test.ts` (+ `nudge_meeting`)
- Modify: `src/test/db/outbox.ts` (+ `timersOf(meetingId)`)

**Interfaces:**
- Consumes (Task 4): `outbox_jobs.meeting_id`, `private.require_active_sender`, `nudge_interval_hours`, `meetings.last_nudged_at/last_nudged_count`; (M5) `responses.needs_reconfirmation`, `meeting_invitees.calendar_state/calendar_sequence`.
- Produces (SQL):
  - `private.sync_reminder_timers(p_meeting uuid)`: one pending timer per audience (`pending`, `going`) whose due time is still ahead, none otherwise; `send_meeting` calls it at the first send and Task 6's `edit_sent_meeting` after a change of time, deadline or reminder settings (`cancel_meeting` marks the timers done with every other pending job)
  - `private.reminder_eligible(p_audience text, p_answer public.response_status, p_reconfirm boolean) → boolean`
  - `private.enqueue_reminders(p_meeting uuid, p_audience text, p_source text) → integer`
  - `private.fan_out_reminders() → integer` (called first in `dispatch_claim`)
  - `public.dispatch_claim` jobs now include `payload` and kinds `update`, `cancel`, `reminder`
  - `public.dispatch_reserve` returns `{kind: 'ok', calendar?: {action: 'request' | 'cancel', sequence}}` for `calendar_confirm`, `update`, `cancel`; `{kind: 'done'}` with `last_error` `unsubscribed | meeting_started | meeting_cancelled | not_cancelled | not_eligible | nothing_to_send`
  - `public.dispatch_finish` records the calendar state for every kind but `invite`
  - `public.nudge_meeting(p_meeting uuid) → jsonb {reminded: int, next_at: timestamptz}`; errors `not_found`, `forbidden`, `meeting_cancelled`, `invalid_input` (announcement), `meeting_started`, `nudge_too_soon`, `sender_not_connected`, `sender_broken`, `nothing_to_send`.
- Job payloads: `update` → `{changes: {field: [old, new]}, notify: boolean, reconfirm: boolean}` (+ `action`, `sequence` after reserve); `cancel` → `{}` (+ `action`, `sequence`); per-person `reminder` → `{audience: 'pending' | 'going'}`; timer `reminder` → `{audience}` with `invitee_id` null and `meeting_id` set.

- [ ] **Step 1: Failing DB tests** (`src/server/db/m6-dispatch.db.test.ts`)

Reuse the M5 calendar-dispatch test's helpers (copy `claimSchema` with `kind: z.enum(["invite", "calendar_confirm", "update", "cancel", "reminder"])` and `payload: z.record(z.string(), z.json()).optional()`, and `reserveSchema`). Setup: an Owner with a sender, two contacts, a scheduled meeting tomorrow 18:00 UTC, two `sent` invitees (`seedInvitee`). Helpers:

```ts
async function insertJob(kind: "update" | "cancel" | "reminder", inviteeId: string, payload: object) {
  const { data, error } = await adminClient().from("outbox_jobs").insert({
    kind, workspace_id: workspace.id, invitee_id: inviteeId, meeting_id: meeting, payload,
    idempotency_key: `${kind}:${inviteeId}:${crypto.randomUUID()}`, run_after: new Date(Date.now() - 1000).toISOString(),
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

/** Claims everything due and reserves `jobId`; returns the reserve result and the job's last_error. */
async function reserveOne(jobId: string) {
  const run = crypto.randomUUID();
  await serviceRpc("dispatch_claim", { p_run: run, p_limit: 50, p_lease_seconds: 70 });
  const reserved = reserveSchema.parse(await serviceRpc("dispatch_reserve", { p_job: jobId, p_token_hash: null }));
  await serviceRpc("dispatch_release", { p_run: run });
  const { data } = await adminClient().from("outbox_jobs").select("status, last_error, payload").eq("id", jobId).single();
  return { reserved, job: data };
}
```

Tests (one `it` each):

1. **Timer fan-out picks eligible people only:** answer person A Going (via `token_submit_response`), leave B without an answer; insert a due timer (`kind: 'reminder'`, `invitee_id: null`, `meeting_id: meeting`, `payload: {audience: 'pending'}`); call `dispatch_claim`; expect the timer `done` and exactly one per-person `reminder` job, for B, with `payload.audience = 'pending'`. Same with `{audience: 'going'}` → one job, for A.
2. **A person still to reconfirm counts as not answered:** set A's `needs_reconfirmation = true`; a `pending` timer queues A and B; a `going` timer queues nobody.
3. **No reminder to an unsubscribed person, a failed invite, or after the start:** set B unsubscribed and C `email_status = 'failed'` → not queued; set the meeting's `starts_at` 1 minute ago → a `pending` timer queues nobody.
4. **Reserve re-checks eligibility:** queue a `pending` reminder for B, then answer B Going, then `reserveOne` → `{kind: 'done'}`, `last_error = 'not_eligible'`, and no `send_log` row for that job.
5. **A reminder held by the quota is dropped at the start:** queue a reminder for B, set `starts_at` 1 minute ago, `reserveOne` → `done`, `last_error = 'meeting_started'` (Review Focus 5).
6. **Update for a calendar holder carries the calendar request:** set A `calendar_state = 'added'`, `calendar_sequence = 1`, answer Going; `insertJob('update', A, {changes: {title: ["Old", "New"]}, notify: true, reconfirm: false})` → reserve `{kind: 'ok', calendar: {action: 'request', sequence: 1}}`; `dispatch_finish(job, 'sent', null, null)` → A's `calendar_sequence = 2`, `calendar_state = 'added'`, and A's `email_status` unchanged.
7. **Update with nothing to say is done unsent:** for B (no calendar) `{changes: {}, notify: true, reconfirm: false}` → `done`, `nothing_to_send`; `{changes: {title: ["a", "b"]}, notify: false, reconfirm: false}` → `done`, `nothing_to_send`; `{changes: {}, notify: true, reconfirm: true}` → `ok` without `calendar` (the "please confirm" email, Review Focus 1).
8. **Cancel removes the event and needs a cancelled meeting:** with the meeting still `scheduled`, a `cancel` job → `done`, `not_cancelled`. Set the meeting `cancelled`; A `added` → `ok` with `{action: 'cancel', sequence: …}`; finish `sent` → A `calendar_state = 'none'`. B (`none`) → `ok` without `calendar`.
9. **An expired lease after the send started records the calendar decision for update/cancel too:** reserve an `update` for A (calendar request), set `locked_until` to the past, call `dispatch_claim` → job `failed` with `delivery_unknown`, A's `calendar_sequence` raised (same as M5 `calendar_confirm`).
10. **Timers are never claimed as sendable jobs:** with only a future timer (`run_after` +1 h) and no other job, `dispatch_claim` returns null and the timer stays `pending`.
11. **`nudge_meeting`:** as the Owner, with B unanswered → `{reminded: 1, next_at ≈ now + 12 h}` and one `reminder` job for B; a second call → `nudge_too_soon`; with `overrideLimit("nudge_interval_hours", 0)` it works again; a Viewer → `forbidden`; an announcement → `invalid_input`; started → `meeting_started`; cancelled → `meeting_cancelled`; everyone answered → `nothing_to_send`; sender removed (`setSender(workspace.id, null)`) → `sender_not_connected` (Review Focus 4).

12. **Timers at the first send** (Review Focus 5) — in a `describe("send_meeting timers")` block with Task 4's `sendTo` and `hoursFromNow` helpers copied in:

```ts
  it("creates the two reminder timers at the first send, at the right times", async () => {
    const start = hoursFromNow(72);
    const deadline = hoursFromNow(48);
    const meeting = await seedMeeting(workspace.id, {
      starts_at: start, response_deadline: deadline, reminder_pending_hours: 24, reminder_going_hours: 2,
    });
    expect((await sendTo(meeting, [contact])).error).toBeNull();
    const timers = await timersOf(meeting);
    const at = (audience: string) => timers.find((t) => t.payload.audience === audience)?.run_after;
    expect(new Date(at("pending") ?? "").getTime()).toBe(new Date(deadline).getTime() - 24 * 3600_000);
    expect(new Date(at("going") ?? "").getTime()).toBe(new Date(start).getTime() - 2 * 3600_000);
  });

  it("creates no timer whose time has already passed (sent 90 minutes before the start)", async () => {
    const meeting = await seedMeeting(workspace.id, {
      starts_at: hoursFromNow(1.5), reminder_pending_hours: 24, reminder_going_hours: 2,
    });
    expect((await sendTo(meeting, [contact])).error).toBeNull();
    expect(await timersOf(meeting)).toEqual([]);
  });

  it("creates no timer for an announcement or with reminders off", async () => {
    const off = await seedMeeting(workspace.id, { starts_at: hoursFromNow(72) });
    const announcement = await seedMeeting(workspace.id, {
      starts_at: hoursFromNow(72), response_mode: "announcement", reminder_pending_hours: 24, reminder_going_hours: 2,
    });
    await sendTo(off, [contact]);
    await sendTo(announcement, [contact]);
    expect(await timersOf(off)).toEqual([]);
    expect(await timersOf(announcement)).toEqual([]);
  });

  it("does not add timers again on Invite more", async () => {
    const meeting = await seedMeeting(workspace.id, { starts_at: hoursFromNow(72), reminder_pending_hours: 24 });
    await sendTo(meeting, [contact]);
    const [later] = await seedContacts(workspace.id, 1, `more-${crypto.randomUUID().slice(0, 6)}`);
    await sendTo(meeting, [contact, later]);
    expect(await timersOf(meeting)).toHaveLength(1);
  });
```

`src/test/db/outbox.ts` (+ `timersOf`):

```ts
/** A meeting's reminder timers (jobs with no invitee; service role). */
export async function timersOf(meetingId: string) {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .select("id, run_after, status, payload")
    .eq("meeting_id", meetingId)
    .eq("kind", "reminder")
    .is("invitee_id", null)
    .in("status", ["pending", "paused"]);
  if (error) {
    throw error;
  }
  return z.array(z.object({
    id: z.uuid(), run_after: z.string(), status: z.string(), payload: z.object({ audience: z.string() }),
  })).parse(data);
}
```

Run: `bun run test:db -- m6-dispatch` → FAIL (functions missing / old dispatcher behaviour).

- [ ] **Step 2: Migration** (`<ts>_m6_dispatch_kinds.sql`)

```sql
-- Keeps a sent meeting's two reminder timers (spec §7.6) in line with its time, deadline and
-- settings: one pending timer per audience whose due time is still ahead, none otherwise.
create function private.sync_reminder_timers(p_meeting uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.meetings;
  v_audience text;
  v_due timestamptz;
begin
  select * into v from public.meetings m where m.id = p_meeting;
  foreach v_audience in array array['pending', 'going'] loop
    v_due := case
      when v.status <> 'scheduled' or v.response_mode = 'announcement' or v.starts_at is null then null
      when v_audience = 'pending' then
        coalesce(v.response_deadline, v.starts_at) - pg_catalog.make_interval(hours => v.reminder_pending_hours)
      else v.starts_at - pg_catalog.make_interval(hours => v.reminder_going_hours)
    end;
    if v_due is null or v_due <= pg_catalog.now() then
      delete from public.outbox_jobs j
      where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
        and j.status in ('pending', 'paused') and j.payload ->> 'audience' = v_audience;
    else
      update public.outbox_jobs j set run_after = v_due, status = 'pending', last_error = null
      where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
        and j.status in ('pending', 'paused') and j.payload ->> 'audience' = v_audience;
      if not found then
        insert into public.outbox_jobs (kind, workspace_id, meeting_id, payload, idempotency_key, run_after)
        values ('reminder', v.workspace_id, p_meeting, pg_catalog.jsonb_build_object('audience', v_audience),
          'reminder:' || p_meeting::text || ':' || v_audience || ':' || gen_random_uuid()::text, v_due);
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function private.sync_reminder_timers(uuid) from public, anon, authenticated;

-- send_meeting: the complete body from Task 4's <ts>_m6_foundation.sql, with one addition right
-- after `update public.meetings set status = 'scheduled', …` (the first send creates the timers):
--   if v_meeting.status = 'draft' then
--     perform private.sync_reminder_timers(p_meeting);
--   end if;
-- Write the whole `create or replace function private.send_meeting` here; this comment only marks
-- the change.

-- M6 job kinds in the dispatcher (spec §7.6, §8): reminder timers fan out into per-person jobs
-- before anything is claimed; update / cancel / reminder decide at reserve time like
-- calendar_confirm, and any calendar decision is recorded the same way.

-- Who a reminder is for (spec §7.6); used at fan-out, at reserve time and for the Nudge count.
create function private.reminder_eligible(p_audience text, p_answer public.response_status, p_reconfirm boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_audience
    when 'pending' then p_answer is null or coalesce(p_reconfirm, false)
    when 'going' then p_answer in ('attending', 'late') and not coalesce(p_reconfirm, false)
    else false
  end
$$;

-- Queues one reminder per eligible invitee; `p_source` (a timer id or a nudge id) makes a repeat
-- of the same fan-out a no-op. Returns how many were queued.
create function private.enqueue_reminders(p_meeting uuid, p_audience text, p_source text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with eligible as (
    select i.id, i.workspace_id
    from public.meeting_invitees i
    join public.meetings m on m.id = i.meeting_id
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and m.status = 'scheduled' and m.starts_at > pg_catalog.now()
      and m.response_mode <> 'announcement' and i.email_status in ('sent', 'unknown')
      and c.unsubscribed_at is null
      and private.reminder_eligible(p_audience, r.status, r.needs_reconfirmation)
  ), inserted as (
    insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, payload, idempotency_key)
    select 'reminder', e.workspace_id, e.id, p_meeting, pg_catalog.jsonb_build_object('audience', p_audience),
      'reminder:' || e.id::text || ':' || p_source
    from eligible e
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

-- Due timers become per-person jobs; the timer itself is done. Runs at the top of dispatch_claim.
create function private.fan_out_reminders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timer record;
  v_total integer := 0;
begin
  for v_timer in
    update public.outbox_jobs j
    set status = 'done', last_error = null
    where j.id in (
      select t.id from public.outbox_jobs t
      where t.kind = 'reminder' and t.invitee_id is null and t.status = 'pending'
        and t.run_after <= pg_catalog.now()
      for update skip locked
    )
    returning j.id, j.meeting_id, j.payload ->> 'audience' as audience
  loop
    v_total := v_total + private.enqueue_reminders(v_timer.meeting_id, v_timer.audience, 'timer-' || v_timer.id::text);
  end loop;
  return v_total;
end;
$$;

revoke execute on function private.reminder_eligible(text, public.response_status, boolean),
  private.enqueue_reminders(uuid, text, text), private.fan_out_reminders()
  from public, anon, authenticated;
grant execute on function private.reminder_eligible(text, public.response_status, boolean),
  private.enqueue_reminders(uuid, text, text), private.fan_out_reminders()
  to service_role;
```

Then `create or replace function public.dispatch_claim(…)` with the **complete** M5 body and these changes only:
- first statement after `begin`: `perform private.fan_out_reminders();`
- the lost-lease loop's `elsif v_lost.kind = 'calendar_confirm' and v_lost.payload ? 'action' then` becomes `elsif v_lost.kind <> 'invite' and v_lost.payload ? 'action' then`
- add `and j.invitee_id is not null` to the "pause jobs without a sender" `update`, to the sender-selection `select … limit 1`, and to the `picked` CTE (a timer is never paused, picked or claimed)
- in the `jsonb_build_object` per job add `'payload', j.payload,` after `'attempts', j.attempts,`

`create or replace function public.dispatch_reserve(p_job uuid, p_token_hash text default null)`:

```sql
create or replace function public.dispatch_reserve(p_job uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_wanted boolean;
  v_action text;
  v_skip text;
  v_count integer;
  v_oldest timestamptz;
  v_retry timestamptz;
begin
  select j.id, j.kind, j.status, j.workspace_id, j.invitee_id, j.payload, c.google_sub, m.status as meeting_status,
    m.starts_at, m.response_mode, ct.unsubscribed_at, i.calendar_state, i.calendar_sequence,
    i.calendar_requested_at, r.status as answer, r.needs_reconfirmation
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

  if v_job.kind = 'invite' then
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
  else
    -- Should this person have the event in their calendar right now? (spec §8 calendar_confirm)
    v_wanted := v_job.meeting_status = 'scheduled'
      and (v_job.answer in ('attending', 'late')
           or (v_job.response_mode = 'announcement' and v_job.calendar_requested_at is not null));
    v_action := case v_job.kind
      when 'calendar_confirm' then case
        when v_wanted and v_job.calendar_state = 'none' then 'request'
        when not v_wanted and v_job.calendar_state = 'added' then 'cancel' end
      when 'update' then case when v_wanted and v_job.calendar_state = 'added' then 'request' end
      when 'cancel' then case when v_job.calendar_state = 'added' then 'cancel' end
    end;
    v_skip := case
      when v_job.unsubscribed_at is not null then 'unsubscribed'
      when v_job.starts_at <= pg_catalog.now() then 'meeting_started'
      when v_job.kind = 'cancel' and v_job.meeting_status <> 'cancelled' then 'not_cancelled'
      when v_job.kind in ('update', 'reminder') and v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
      when v_job.kind = 'reminder'
        and not private.reminder_eligible(v_job.payload ->> 'audience', v_job.answer, v_job.needs_reconfirmation)
        then 'not_eligible'
      when v_job.kind = 'calendar_confirm' and v_action is null then 'nothing_to_send'
      when v_job.kind = 'update' and v_action is null
        and (not coalesce((v_job.payload ->> 'notify')::boolean, false)
             or (v_job.payload -> 'changes' = '{}'::jsonb and not coalesce((v_job.payload ->> 'reconfirm')::boolean, false)))
        then 'nothing_to_send'
    end;
    if v_skip is not null then
      update public.outbox_jobs set status = 'done', locked_until = null, last_error = v_skip where id = p_job;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
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
    payload = case when v_action is not null
      then payload || pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence)
      else payload end
  where id = p_job;
  -- The personal links must work in any email that may have gone out, including one whose outcome
  -- ends up "unknown" (the token is derived from the invitee id, so storing it early is safe).
  if p_token_hash is not null then
    update public.meeting_invitees set token_hash = coalesce(token_hash, p_token_hash) where id = v_job.invitee_id;
  end if;
  if v_action is not null then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;
```

`create or replace function public.dispatch_finish(…)`: the M5 body with the `if v_kind = 'calendar_confirm' then … return; end if;` block changed to `if v_kind <> 'invite' then` (same inner body: record `calendar_state`/`calendar_sequence + 1` when `p_outcome in ('sent', 'unknown') and v_payload ? 'action'`, then `return`). `dispatch_retry` needs no change (it touches `email_status` only for `invite`).

```sql
create function private.nudge_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_next timestamptz;
  v_count integer;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'cancelled' then
    raise exception 'tn:meeting_cancelled' using errcode = 'P0001';
  end if;
  if v_meeting.status <> 'scheduled' or v_meeting.response_mode = 'announcement' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_started' using errcode = 'P0001';
  end if;
  v_next := v_meeting.last_nudged_at
    + pg_catalog.make_interval(hours => private.app_limit('nudge_interval_hours'));
  if v_next > pg_catalog.now() then
    raise exception 'tn:nudge_too_soon' using errcode = 'P0001';
  end if;
  perform private.require_active_sender(v_meeting.workspace_id);
  v_count := private.enqueue_reminders(p_meeting, 'pending', 'nudge-' || gen_random_uuid()::text);
  if v_count = 0 then
    raise exception 'tn:nothing_to_send' using errcode = 'P0001';
  end if;
  update public.meetings set last_nudged_at = pg_catalog.now(), last_nudged_count = v_count where id = p_meeting;
  return pg_catalog.jsonb_build_object(
    'reminded', v_count,
    'next_at', pg_catalog.now() + pg_catalog.make_interval(hours => private.app_limit('nudge_interval_hours'))
  );
end;
$$;
revoke execute on function private.nudge_meeting(uuid) from public, anon;
grant execute on function private.nudge_meeting(uuid) to authenticated;

create function public.nudge_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.nudge_meeting(p_meeting) $$;
revoke execute on function public.nudge_meeting(uuid) from public, anon;
grant execute on function public.nudge_meeting(uuid) to authenticated;
```

- [ ] **Step 3: Apply, types, run** — `supabase migration up --local </dev/null && bun run db:types`; `bun run test:db -- m6-dispatch` → PASS; full `bun run test:db` (the M5 `calendar-dispatch` and `outbox` tests must still pass unchanged); add `nudge_meeting` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`; `supabase db advisors --local </dev/null`.

- [ ] **Step 4: Commit, PR, merge, hosted push** — `feat: reminder timers, update/cancel/reminder jobs and the nudge in the database`. Check first that Task 3 is merged and deployed (`vercel ls tapnshow --scope dalychouikhs-projects`: the newest Production deployment is Ready and contains Task 3's commit): from the moment this migration is pushed, production creates reminder, update and cancel jobs, and only Task 3's dispatcher can send them.

---
### Task 6: DB — `edit_sent_meeting`, `cancel_meeting`, `delete_cancelled_meeting`, reconfirmation, `meeting_results` / `meeting_people` / `token_invitee`

Labels: `area:db`, `area:pipeline`. Branch `feat/<issue>-m6-edit-cancel-db`.

**Files:**
- Create: `supabase/migrations/<ts>_m6_edit_cancel.sql`
- Create: `src/server/db/m6-edit-cancel.db.test.ts`, `src/server/db/m6-reads.db.test.ts`
- Modify: `src/server/db/database.types.ts`, `src/server/db/function-security.db.test.ts` (+ `cancel_meeting`, `delete_cancelled_meeting`, `edit_sent_meeting`)

**Interfaces:**
- Consumes (Task 4): `meeting_changes`, `attendance_marks`, `private.meeting_incomplete`, `private.response_deadline_problem`; (Task 5): `private.sync_reminder_timers`, `private.reminder_eligible`, `outbox_jobs.meeting_id`; (Task 2): the field groups in `src/config/meeting-edit.ts` (twins).
- Produces (SQL):
  - `public.edit_sent_meeting(p_meeting uuid, p_fields jsonb, p_notify boolean default false, p_dry_run boolean default false) → jsonb {changed: boolean, changes: {col: [old, new]}, emails: int, calendar_only: int, reconfirm: boolean}`. `p_fields` keys are snake_case columns from `EDITABLE_FIELDS`; anything else → `invalid_input`. Errors: `not_found`, `forbidden`, `meeting_cancelled`, `invalid_input`, `meeting_started`, `meeting_incomplete`, `meeting_in_past`, `deadline_in_past`, `deadline_after_start`.
  - `public.cancel_meeting(p_meeting uuid) → jsonb {emails: int}`. Errors: `not_found`, `forbidden`, `meeting_cancelled`, `invalid_input` (a draft), `meeting_started`.
  - `public.delete_cancelled_meeting(p_meeting uuid) → void`. Errors: `not_found`, `forbidden`, `invalid_input` (not cancelled), `cancel_emails_pending`.
  - `private.update_targets(p_meeting uuid, p_rule text, p_calendar boolean) → table (invitee_id uuid, workspace_id uuid, notify boolean)`; `private.merge_update_payload(p_old jsonb, p_new jsonb) → jsonb`; `private.like_contains(p_text text) → text` (a safe `like` pattern); `private.fold(p_text text) → text` (lower case without accents, `unaccent` extension; owner decision 2026-10-09: the check-in search ignores accents like the roster search).
  - `token_submit_response`: a same-answer save while `needs_reconfirmation` clears it and writes one history row; any new answer clears it.
  - `token_invitee`: `answer.needs_reconfirmation`.
  - `meeting_results`: `answers.to_reconfirm`, `answers.remindable` (who a Nudge would email), `answers.reachable` (who a Cancel would email), `checked_in`, `nudge: {last_at, last_count, next_at}`; Going/Late/Absent/Not going exclude people still to reconfirm.
  - `meeting_people(p_meeting, p_filter, p_after_name, p_after_id, p_limit, p_search text default null)`: filter `to_reconfirm`; rows add `answer.needs_reconfirmation` and `mark: {actual, marked_at, marked_by_name} | null`.

- [ ] **Step 1: Failing DB tests**

`m6-edit-cancel.db.test.ts` — setup: Owner + sender, a scheduled attendance meeting 3 days ahead with `reminder_pending_hours: 24`, three `sent` invitees A, B, C (`seedInvitee`), A answered Going with `calendar_state = 'added'`, B answered Absent, C no answer; plus one `queued` invitee D with a pending `invite` job. Helper:

```ts
const edit = (fields: Record<string, string | number | boolean | null>, notify = false, dryRun = false) =>
  owner.client.rpc("edit_sent_meeting", { p_meeting: meeting, p_fields: fields, p_notify: notify, p_dry_run: dryRun });
const updateJobs = async () =>
  (await adminClient().from("outbox_jobs").select("invitee_id, payload, status, run_after")
    .eq("meeting_id", meeting).eq("kind", "update").in("status", ["pending", "paused"])).data ?? [];
```

Tests:
1. **Time change:** `edit({ starts_at: plus4days })` → `{changed: true, emails: 3, calendar_only: 0, reconfirm: true}`; A and B `needs_reconfirmation = true`; one `update` job each for A, B, C with `payload.reconfirm = true`, `payload.notify = true` and `payload.changes.starts_at` = [old ISO, new ISO]; D gets none (Review Focus 2); a `meeting_changes` row `kind = 'edit'`, `notified = true`, `changed_by = owner.id`; the `pending` reminder timer moved to the new time; `ics_sequence` raised by 1.
2. **Dry run writes nothing:** `edit({ starts_at: plus4days }, false, true)` → same counts; no `update` job, no `meeting_changes` row, `starts_at` unchanged.
3. **Place change:** `edit({ location_text: "Hall A" })` → `emails: 2` (A and C; B said Absent), answers not flagged.
4. **Text only:** `edit({ title: "New title" })` → `emails: 0, calendar_only: 1` (A's calendar copy); A's job has `notify = false`. `edit({ title: "Newer" }, true)` → `emails: 3`.
5. **Hidden setting only:** `edit({ reason_required: false })` → `emails: 0, calendar_only: 0`, no job, a `meeting_changes` row with `notified = false`.
6. **No change:** `edit({ title: <current title> })` → `{changed: false}`, nothing written.
7. **Quick edits merge (Review Focus 1):** `edit({ starts_at: t1 })`, `edit({ location_text: "Hall A" })`, `edit({ starts_at: original })` → still one pending `update` per person; A's payload `changes` has `location_text` and no `starts_at`; `reconfirm` stays true; `notify` true.
8. **Locked fields and bad input:** `edit({ response_mode: "rsvp" })`, `edit({ delay_options: [5] })`, `edit({ nonsense: 1 })` → `invalid_input`.
9. **Rules:** `edit({ location_text: "" })` (in person) → `meeting_incomplete`; `edit({ starts_at: past })` → `meeting_in_past`; `edit({ response_deadline: past })` → `deadline_in_past`; with a saved deadline already passed (set directly), `edit({ title: "Typo fix" })` works and `edit({ starts_at: <before that deadline> })` → `deadline_after_start` (Review Focus 3); started meeting → `meeting_started`; cancelled → `meeting_cancelled`; a Viewer → `forbidden`; another workspace's member → `not_found`.
10. **Cancel:** `cancel_meeting` → `{emails: 3}`; meeting `cancelled` with `cancelled_at`; D's invite job `done` with `meeting_cancelled` and D `email_status = 'skipped'`; the timer and any pending `update`/`reminder`/`calendar_confirm` jobs done; three `cancel` jobs (A, B, C); a `meeting_changes` row `kind = 'cancel'`. A second cancel → `meeting_cancelled`; a draft → `invalid_input`; started → `meeting_started`.
11. **Cancel without a sender (Review Focus 4):** `setSender(workspace.id, null)` then cancel → works; `dispatch_claim` moves the `cancel` jobs to `paused`; `setSender` back → `pending` again.
12. **Delete:** right after cancel → `cancel_emails_pending`; mark the `cancel` jobs `done`, delete → the meeting, invitees, responses, history, marks and changes are gone (`select count(*)` on each by `meeting_id` = 0); deleting a scheduled meeting → `invalid_input`.
14. **Reminded again after a move (owner decision):** mark the meeting's `pending` timer `done` (as if it fired), then `edit({ starts_at: plus7days })` → a new `pending` timer exists at the new due time.
13. **Twin lists:** read `c_editable`, `c_visible`, `c_place`, `c_calendar` from the function source (`select pg_get_functiondef('private.edit_sent_meeting(uuid, jsonb, boolean, boolean)'::regprocedure)`) and compare each with the TS constants in `src/config/meeting-edit.ts` (sorted).

`m6-reads.db.test.ts`:
1. **Reconfirm through the token:** after a time change, `token_submit_response(A.hash, 'attending')` (same answer) → A's flag cleared, `updated_at` moved, one new `response_history` row; the same call again → nothing new. A different answer from B clears B's flag too.
2. **`token_invitee`** returns `answer.needs_reconfirmation`.
3. **`meeting_results`** after a time change: `answers.attending = 0`, `to_reconfirm = 2`, `remindable = 3` (A, B to reconfirm + C no answer), `reachable = 3`, `nudge.next_at` null; after `nudge_meeting`: `nudge.last_count`, `nudge.next_at` ≈ +12 h.
4. **`meeting_people`:** filter `to_reconfirm` → A and B; filter `attending` → nobody; `p_search: "ami"` finds "Amira", `p_search: "sarra"` finds "Sârra" (accents ignored), and `p_search: "%"` matches only names containing a literal `%`; a mark inserted for C (`attendance_marks`, service role) shows as `mark.actual = 'present'` with the marker's display name.
5. **Plans** (2,000 contacts, 1,000 invitees, half answered, `analyze`): `explainCall("public.meeting_people('<id>', 'all', null, null, 50, null)", owner.id)` uses `meeting_invitees_meeting_ws_idx` (or another index on `meeting_invitees(meeting_id, …)`); `explainCall("public.meeting_results('<id>')", owner.id)` has no `Seq Scan on responses` once analyzed; `edit_sent_meeting` with a time change on that meeting finishes in under 1 s (measure with `performance.now()` around the RPC).

Run: `bun run test:db -- m6-edit-cancel m6-reads` → FAIL.

- [ ] **Step 2: Migration** (`<ts>_m6_edit_cancel.sql`)

```sql
-- M6 edits, cancel and delete of a sent meeting (spec §7.5); reconfirmation (spec §7.3); the
-- results reads learn "to reconfirm", the Nudge count and check-in marks.

create extension if not exists unaccent with schema extensions;

-- Lower case without accents, so "sarra" finds "Sârra" (the roster search does the same on the
-- device). unaccent() is only STABLE; naming the dictionary makes this wrapper safe as IMMUTABLE.
create function private.fold(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text))
$$;

create function private.like_contains(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

-- Who gets an update (spec §7.5 Recipients): rule 'all', 'not_declined' or 'none'; calendar
-- holders also get one when the event's content changed (`p_calendar`).
create function private.update_targets(p_meeting uuid, p_rule text, p_calendar boolean)
returns table (invitee_id uuid, workspace_id uuid, notify boolean)
language sql
stable
set search_path = ''
as $$
  select x.invitee_id, x.workspace_id, x.notify
  from (
    select i.id as invitee_id, i.workspace_id, i.calendar_state,
      case p_rule
        when 'all' then true
        when 'not_declined' then r.status is null or r.status not in ('absent', 'not_attending')
        else false
      end as notify
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and i.email_status in ('sent', 'unknown') and c.unsubscribed_at is null
  ) x
  where x.notify or (p_calendar and x.calendar_state = 'added')
$$;

-- One pending update per person (spec §8): a later edit keeps the oldest "old" and the newest
-- "new" of each field, drops fields that ended where they started, and ORs notify / reconfirm.
create function private.merge_update_payload(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'changes', coalesce((
      select pg_catalog.jsonb_object_agg(k.key, pg_catalog.jsonb_build_array(k.old_value, k.new_value))
      from (
        select t.key,
          coalesce(p_old -> 'changes' -> t.key -> 0, p_new -> 'changes' -> t.key -> 0) as old_value,
          coalesce(p_new -> 'changes' -> t.key -> 1, p_old -> 'changes' -> t.key -> 1) as new_value
        from pg_catalog.jsonb_object_keys(coalesce(p_old -> 'changes', '{}'::jsonb) || coalesce(p_new -> 'changes', '{}'::jsonb)) as t(key)
      ) k
      where k.old_value is distinct from k.new_value
    ), '{}'::jsonb),
    'notify', coalesce((p_old ->> 'notify')::boolean, false) or coalesce((p_new ->> 'notify')::boolean, false),
    'reconfirm', coalesce((p_old ->> 'reconfirm')::boolean, false) or coalesce((p_new ->> 'reconfirm')::boolean, false)
  )
$$;

revoke execute on function private.fold(text), private.like_contains(text), private.update_targets(uuid, text, boolean),
  private.merge_update_payload(jsonb, jsonb)
  from public, anon, authenticated;

create function private.edit_sent_meeting(p_meeting uuid, p_fields jsonb, p_notify boolean, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Field groups: TS twins in src/config/meeting-edit.ts (a DB test compares them).
  c_editable constant text[] := array['title', 'agenda_md', 'starts_at', 'duration_minutes', 'timezone',
    'location_mode', 'location_text', 'online_text', 'meeting_url', 'response_deadline', 'reason_required',
    'comments_enabled', 'footer_note', 'reminder_pending_hours', 'reminder_going_hours'];
  c_visible constant text[] := array['title', 'starts_at', 'duration_minutes', 'timezone', 'location_mode',
    'location_text', 'online_text', 'meeting_url', 'agenda_md', 'response_deadline', 'footer_note'];
  c_schedule constant text[] := array['starts_at', 'duration_minutes'];
  c_place constant text[] := array['location_mode', 'location_text', 'online_text', 'meeting_url'];
  c_calendar constant text[] := array['title', 'agenda_md', 'starts_at', 'duration_minutes', 'location_mode',
    'location_text', 'online_text', 'meeting_url'];
  v_old public.meetings;
  v_new public.meetings;
  v_old_json jsonb;
  v_new_json jsonb;
  v_changes jsonb;
  v_visible jsonb;
  v_keys text[];
  v_problem text;
  v_rule text;
  v_time boolean;
  v_calendar boolean;
  v_due timestamptz;
  v_emails integer;
  v_calendar_only integer;
begin
  if p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object'
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_fields) k where k <> all (c_editable)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  select * into v_old from public.meetings m where m.id = p_meeting for update;
  if v_old.id is null or not private.is_member(v_old.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_old.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'tn:meeting_cancelled' using errcode = 'P0001';
  end if;
  if v_old.status <> 'scheduled' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if v_old.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_started' using errcode = 'P0001';
  end if;

  v_new := pg_catalog.jsonb_populate_record(v_old, p_fields);
  if private.meeting_incomplete(v_new) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  if v_new.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  if v_new.response_mode = 'announcement' and v_new.response_deadline is not null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  -- A deadline that already passed may stay as it is (spec Review Focus 3); a changed one must
  -- follow the full rule, and the start may never move to before it.
  if v_new.response_deadline is distinct from v_old.response_deadline then
    v_problem := private.response_deadline_problem(v_new.response_deadline, v_new.starts_at);
  elsif v_new.response_deadline is not null and v_new.response_deadline >= v_new.starts_at then
    v_problem := 'deadline_after_start';
  end if;
  if v_problem is not null then
    raise exception 'tn:%', v_problem using errcode = 'P0001';
  end if;

  v_old_json := pg_catalog.to_jsonb(v_old);
  v_new_json := pg_catalog.to_jsonb(v_new);
  select pg_catalog.jsonb_object_agg(k, pg_catalog.jsonb_build_array(v_old_json -> k, v_new_json -> k)),
    pg_catalog.array_agg(k)
  into v_changes, v_keys
  from pg_catalog.unnest(c_editable) as k
  where (v_old_json -> k) is distinct from (v_new_json -> k);
  if v_keys is null then
    return pg_catalog.jsonb_build_object('changed', false, 'changes', '{}'::jsonb, 'emails', 0,
      'calendar_only', 0, 'reconfirm', false);
  end if;
  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_visible
  from pg_catalog.jsonb_each(v_changes) e where e.key = any (c_visible);

  v_time := 'starts_at' = any (v_keys);
  v_calendar := v_keys && c_calendar;
  v_rule := case
    when v_keys && c_schedule then 'all'
    when v_keys && c_place then 'not_declined'
    when coalesce(p_notify, false) and v_keys && c_visible then 'all'
    else 'none'
  end;
  select count(*) filter (where t.notify), count(*) filter (where not t.notify)
  into v_emails, v_calendar_only
  from private.update_targets(p_meeting, v_rule, v_calendar) t;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
      'calendar_only', v_calendar_only, 'reconfirm', v_time);
  end if;

  update public.meetings set
    title = v_new.title, agenda_md = v_new.agenda_md, starts_at = v_new.starts_at,
    duration_minutes = v_new.duration_minutes, timezone = v_new.timezone, location_mode = v_new.location_mode,
    location_text = v_new.location_text, online_text = v_new.online_text, meeting_url = v_new.meeting_url,
    response_deadline = v_new.response_deadline, reason_required = v_new.reason_required,
    comments_enabled = v_new.comments_enabled, footer_note = v_new.footer_note,
    reminder_pending_hours = v_new.reminder_pending_hours, reminder_going_hours = v_new.reminder_going_hours,
    ics_sequence = ics_sequence + 1
  where id = p_meeting;
  if v_time then
    update public.responses set needs_reconfirmation = true
    where meeting_id = p_meeting and workspace_id = v_old.workspace_id;
  end if;
  if v_keys && array['starts_at', 'response_deadline', 'reminder_pending_hours', 'reminder_going_hours'] then
    perform private.sync_reminder_timers(p_meeting);
  end if;
  insert into public.meeting_changes (workspace_id, meeting_id, kind, changes, notified, changed_by)
  values (v_old.workspace_id, p_meeting, 'edit', v_changes, v_rule <> 'none', auth.uid());

  v_due := pg_catalog.now() + pg_catalog.make_interval(secs => private.app_limit('calendar_confirm_delay_seconds'));
  with targets as materialized (
    select * from private.update_targets(p_meeting, v_rule, v_calendar)
  ), merged as (
    update public.outbox_jobs j
    set payload = private.merge_update_payload(j.payload,
          pg_catalog.jsonb_build_object('changes', v_visible, 'notify', t.notify, 'reconfirm', v_time)),
      run_after = v_due, last_error = null
    from targets t
    where j.invitee_id = t.invitee_id and j.kind = 'update' and j.status in ('pending', 'paused')
    returning j.invitee_id
  )
  insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, payload, idempotency_key, run_after)
  select 'update', t.workspace_id, t.invitee_id, p_meeting,
    pg_catalog.jsonb_build_object('changes', v_visible, 'notify', t.notify, 'reconfirm', v_time),
    'update:' || t.invitee_id::text || ':' || gen_random_uuid()::text, v_due
  from targets t
  where t.invitee_id not in (select merged.invitee_id from merged);

  return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
    'calendar_only', v_calendar_only, 'reconfirm', v_time);
end;
$$;

create function private.cancel_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_count integer;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'cancelled' then
    raise exception 'tn:meeting_cancelled' using errcode = 'P0001';
  end if;
  if v_meeting.status <> 'scheduled' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_started' using errcode = 'P0001';
  end if;

  update public.meetings set status = 'cancelled', cancelled_at = pg_catalog.now(), ics_sequence = ics_sequence + 1
  where id = p_meeting;
  -- Nothing else of this meeting goes out: unsent invites, updates, reminders (timers included)
  -- and calendar emails. The cancellation below carries any calendar removal.
  update public.outbox_jobs j
  set status = 'done', last_error = 'meeting_cancelled', locked_until = null
  where j.status in ('pending', 'paused')
    and j.kind in ('invite', 'update', 'reminder', 'calendar_confirm')
    and (j.meeting_id = p_meeting
         or j.invitee_id in (select i.id from public.meeting_invitees i where i.meeting_id = p_meeting));
  update public.meeting_invitees
  set email_status = 'skipped', email_error = 'meeting_cancelled'
  where meeting_id = p_meeting and email_status = 'queued';

  with inserted as (
    insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, idempotency_key)
    select 'cancel', i.workspace_id, i.id, p_meeting, 'cancel:' || i.id::text
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    where i.meeting_id = p_meeting and i.email_status in ('sent', 'unknown') and c.unsubscribed_at is null
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  insert into public.meeting_changes (workspace_id, meeting_id, kind, changes, notified, changed_by)
  values (v_meeting.workspace_id, p_meeting, 'cancel',
    pg_catalog.jsonb_build_object('status', pg_catalog.jsonb_build_array('scheduled', 'cancelled')),
    v_count > 0, auth.uid());
  return pg_catalog.jsonb_build_object('emails', v_count);
end;
$$;

create function private.delete_cancelled_meeting(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status <> 'cancelled' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.outbox_jobs j
    where j.meeting_id = p_meeting and j.kind = 'cancel' and j.status in ('pending', 'processing', 'paused')
  ) then
    raise exception 'tn:cancel_emails_pending' using errcode = 'P0001';
  end if;
  delete from public.meetings where id = p_meeting;
end;
$$;

revoke execute on function private.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  private.cancel_meeting(uuid), private.delete_cancelled_meeting(uuid) from public, anon;
grant execute on function private.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  private.cancel_meeting(uuid), private.delete_cancelled_meeting(uuid) to authenticated;

create function public.edit_sent_meeting(
  p_meeting uuid, p_fields jsonb, p_notify boolean default false, p_dry_run boolean default false
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.edit_sent_meeting(p_meeting, p_fields, p_notify, p_dry_run) $$;
create function public.cancel_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_meeting(p_meeting) $$;
create function public.delete_cancelled_meeting(p_meeting uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_cancelled_meeting(p_meeting) $$;
revoke execute on function public.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  public.cancel_meeting(uuid), public.delete_cancelled_meeting(uuid) from public, anon;
grant execute on function public.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  public.cancel_meeting(uuid), public.delete_cancelled_meeting(uuid) to authenticated;
```

`create or replace function public.token_submit_response(…)`: the complete M5 body; replace the "identical answer" branch and the upsert like this (everything else unchanged):

```sql
  select * into v_old from public.responses r where r.invitee_id = v.invitee_id;
  if v_old.id is not null
    and v_old.status = p_status
    and v_old.delay_minutes is not distinct from v_delay
    and v_old.reason = v_reason
    and v_old.comment = v_comment then
    if v_old.needs_reconfirmation then
      -- "Yes, still going" after a time change (spec §7.3): the same answer, confirmed again.
      update public.responses set needs_reconfirmation = false, updated_at = pg_catalog.now()
      where id = v_old.id
      returning * into v_new;
      insert into public.response_history (workspace_id, meeting_id, invitee_id, response_id, status, delay_minutes,
        reason, comment, after_deadline)
      values (v.workspace_id, v.meeting_id, v.invitee_id, v_new.id, v_new.status, v_new.delay_minutes, v_new.reason,
        v_new.comment, v_new.after_deadline);
    else
      v_new := v_old;
    end if;
  else
    insert into public.responses (workspace_id, meeting_id, invitee_id, status, delay_minutes, reason, comment, after_deadline)
    values (v.workspace_id, v.meeting_id, v.invitee_id, p_status, v_delay, v_reason, v_comment, v_after)
    on conflict (invitee_id) do update
      set status = excluded.status, delay_minutes = excluded.delay_minutes, reason = excluded.reason,
        comment = excluded.comment, after_deadline = excluded.after_deadline, needs_reconfirmation = false,
        updated_at = pg_catalog.now()
    returning * into v_new;
    -- (history insert and refresh_calendar_job exactly as in M5)
  end if;
```

and add `'needs_reconfirmation', v_new.needs_reconfirmation` to the returned object.

`create or replace function public.token_invitee(…)`: the complete M5 body with `'needs_reconfirmation', r.needs_reconfirmation` added to the `answer` object.

`create or replace function private.meeting_results(p_meeting uuid)`: the complete M5 body with:
- `select m.id, m.workspace_id, m.response_mode, m.last_nudged_at, m.last_nudged_count into v_meeting …`
- the `inv` CTE becomes:

```sql
    with inv as materialized (
      select i.id, i.email_status, i.calendar_requested_at, r.status as answer,
        coalesce(r.needs_reconfirmation, false) as reconfirm,
        c.unsubscribed_at is null as reachable_contact,
        am.invitee_id is not null as marked
      from public.meeting_invitees i
      join public.contacts c on c.id = i.contact_id
      left join public.responses r on r.invitee_id = i.id
      left join public.attendance_marks am on am.invitee_id = i.id
      where i.meeting_id = p_meeting
    ), …
```
- `answers`:

```sql
      'answers', (select pg_catalog.jsonb_build_object(
        'attending', count(*) filter (where inv.answer = 'attending' and not inv.reconfirm),
        'late', count(*) filter (where inv.answer = 'late' and not inv.reconfirm),
        'absent', count(*) filter (where inv.answer = 'absent' and not inv.reconfirm),
        'not_attending', count(*) filter (where inv.answer = 'not_attending' and not inv.reconfirm),
        'to_reconfirm', count(*) filter (where inv.reconfirm),
        'no_reply', count(*) filter (where inv.answer is null and inv.email_status in ('sent', 'unknown')),
        'calendar_requested', count(*) filter (where inv.calendar_requested_at is not null),
        'remindable', count(*) filter (where inv.email_status in ('sent', 'unknown') and inv.reachable_contact
          and private.reminder_eligible('pending', inv.answer, inv.reconfirm)),
        'reachable', count(*) filter (where inv.email_status in ('sent', 'unknown') and inv.reachable_contact)) from inv),
      'checked_in', (select count(*) from inv where inv.marked),
      'nudge', pg_catalog.jsonb_build_object(
        'last_at', v_meeting.last_nudged_at,
        'last_count', v_meeting.last_nudged_count,
        'next_at', v_meeting.last_nudged_at + pg_catalog.make_interval(hours => private.app_limit('nudge_interval_hours'))),
```

`meeting_people`: `drop function public.meeting_people(uuid, text, text, uuid, integer); drop function private.meeting_people(uuid, text, text, uuid, integer);` then create both with `p_search text` added last (`default null` on the public wrapper), the M5 body plus:
- `p_filter` may also be `'to_reconfirm'`; the filter `case` becomes:

```sql
      and case p_filter
        when 'all' then true
        when 'no_reply' then r.id is null and i.email_status in ('sent', 'unknown')
        when 'not_delivered' then i.email_status in ('failed', 'skipped')
        when 'to_reconfirm' then coalesce(r.needs_reconfirmation, false)
        else r.status::text = p_filter and not r.needs_reconfirmation
      end
      and (p_search is null
           or private.fold(c.full_name) like private.like_contains(private.fold(p_search))
           or c.email like private.like_contains(pg_catalog.lower(p_search)))
```
- `left join public.attendance_marks am on am.invitee_id = i.id left join public.profiles mp on mp.user_id = am.marked_by` and in the row: `'needs_reconfirmation', r.needs_reconfirmation` inside `answer`, plus

```sql
      case when am.invitee_id is null then null else pg_catalog.jsonb_build_object(
        'actual', am.actual, 'marked_at', am.marked_at, 'marked_by_name', mp.display_name) end as mark
```
- re-grant: `revoke … from public, anon; grant … to authenticated` for both new signatures; `p_search` longer than 120 characters → `invalid_input`.

- [ ] **Step 3: Apply, types, run** — `supabase migration up --local </dev/null && bun run db:types`; `bun run test:db -- m6-edit-cancel m6-reads` → PASS; the full `bun run test:db` (M5 `results.db.test.ts` must still pass: its "attending" counts have no one to reconfirm); add the three functions to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`; advisors clean.

- [ ] **Step 4: Commit, PR, merge, hosted push** — `feat: edit, cancel and delete a sent meeting in the database; reconfirmation`. The app's `meeting_people` call still works (the new `p_search` defaults to null) and the extra JSON fields are ignored until Task 9 reads them.

---

### Task 7: DB — check-in writes, `effective_status`, History and Attendance reads

Labels: `area:db`. Branch `feat/<issue>-m6-check-in-db`.

**Files:**
- Create: `supabase/migrations/<ts>_m6_check_in.sql`
- Create: `src/server/db/m6-check-in.db.test.ts`
- Modify: `src/server/db/database.types.ts`, `src/server/db/function-security.db.test.ts` (+ `mark_attendance`, `mark_rest_as_declared`)

**Interfaces:**
- Consumes (Task 4): `attendance_marks`, `attendance_actual`; (M2) `workspace_roles.can_check_in`; (M5) the three History/Attendance reads.
- Produces (SQL):
  - `public.mark_attendance(p_meeting uuid, p_invitee uuid, p_actual public.attendance_actual default null) → jsonb {actual, marked_at, marked_by_name} | null` (null `p_actual` clears the mark).
  - `public.mark_rest_as_declared(p_meeting uuid) → integer` (how many were marked).
  - Errors for both: `not_found` (meeting not visible, or the invitee is not in this meeting), `forbidden` (no check-in right), `check_in_closed` (before the start, announcement, cancelled, draft).
  - `private.effective_status(p_actual public.attendance_actual, p_answer public.response_status) → text` (`'attending' | 'late' | 'absent' | null`).
  - `contact_history` / `attendance_summary` / `attendance_details` (same signatures): counts use `effective_status`; `contact_history` and `attendance_details` items add `mark: {actual, marked_at, marked_by_name} | null`.

- [ ] **Step 1: Failing DB tests** (`m6-check-in.db.test.ts`)

Setup: Owner + Admin + Viewer (no check-in) + Viewer with `can_check_in` (`addMember(…, "viewer", true)`); an attendance meeting that started 1 hour ago (`starts_at` in the past, `status: 'scheduled'`); invitees A (Going), B (Late 10), C (Absent), D (no answer), E (`email_status: 'failed'`).

1. **Who can check in:** the Owner, the Admin and the check-in Viewer can `mark_attendance(meeting, A, 'present')`; the plain Viewer → `forbidden`; a member of another workspace → `not_found`.
2. **When:** a meeting starting tomorrow → `check_in_closed`; an announcement → `check_in_closed`; cancelled → `check_in_closed`.
3. **Marks:** `mark_attendance(…, A, 'absent')` then `'present'` → one row, `actual = 'present'`, `marked_by` the last caller, the returned `marked_by_name` is that caller's display name; `p_actual: null` deletes it; an invitee of another meeting → `not_found`.
4. **Mark the rest:** with A already marked `absent`: `mark_rest_as_declared` → `3` (B → late, C → absent, D → absent); A stays `absent`; E (failed email) is not marked; a second call → `0`.
5. **History counts use the check-in:** for A's contact, `contact_history` counts `absent: 1, attending: 0` and the item has `mark.actual = 'absent'` and `answer.status = 'attending'` ("Said going · Was absent"); for D (no reply) marked `present` → `attending: 1, no_reply: 0`.
6. **Attendance:** `attendance_summary` row for A: `attending 0, absent 1`; `attendance_details` row for A carries `mark.actual = 'absent'` and `mark.marked_by_name`.
7. **Cancelled meetings never count:** a cancelled past meeting with marks is not in `contact_history`, `attendance_summary` or `attendance_details`.
8. **Plans:** with 2,000 contacts, 20 past meetings × 100 invitees with marks on half, `analyze`: `attendance_summary` and `attendance_details` (first page) use an index on `meeting_invitees` and finish under 500 ms (`performance.now()` around the RPC); `explainCall` shows `attendance_marks_pkey` (or a hash join on `attendance_marks` built once, not a per-row loop).

Run: `bun run test:db -- m6-check-in` → FAIL.

- [ ] **Step 2: Migration** (`<ts>_m6_check_in.sql`)

```sql
-- M6 check-in (spec §7.8) and "check-in wins" in History and Attendance (spec §7.7).

-- Owners, Admins, and Viewers with can_check_in (spec §3, §7.8).
create function private.can_check_in(p_workspace uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_roles r
    where r.workspace_id = p_workspace and r.user_id = auth.uid()
      and (r.role in ('owner', 'admin') or r.can_check_in)
  )
$$;

-- The meeting if the caller may check people in now; raises otherwise.
create function private.check_in_meeting(p_meeting uuid)
returns public.meetings
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.meetings;
begin
  select * into v from public.meetings m where m.id = p_meeting;
  if v.id is null or not private.is_member(v.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.can_check_in(v.workspace_id) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v.status <> 'scheduled' or v.response_mode = 'announcement' or v.starts_at > pg_catalog.now() then
    raise exception 'tn:check_in_closed' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- What counts in History and Attendance: the check-in where one exists, else the answer (RSVP
-- "not going" counts as absent). TS twin for labels: effectiveStatus (src/lib/responses/effective-status.ts).
create function private.effective_status(p_actual public.attendance_actual, p_answer public.response_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_actual
    when 'present' then 'attending'
    when 'late' then 'late'
    when 'absent' then 'absent'
    else case p_answer when 'not_attending' then 'absent' else p_answer::text end
  end
$$;

revoke execute on function private.can_check_in(uuid), private.check_in_meeting(uuid),
  private.effective_status(public.attendance_actual, public.response_status)
  from public, anon, authenticated;

create function private.mark_attendance(p_meeting uuid, p_invitee uuid, p_actual public.attendance_actual)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.meetings;
  v_mark public.attendance_marks;
begin
  v := private.check_in_meeting(p_meeting);
  if not exists (select 1 from public.meeting_invitees i where i.id = p_invitee and i.meeting_id = p_meeting) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_actual is null then
    delete from public.attendance_marks where invitee_id = p_invitee;
    return null;
  end if;
  insert into public.attendance_marks (invitee_id, workspace_id, meeting_id, actual, marked_by)
  values (p_invitee, v.workspace_id, p_meeting, p_actual, auth.uid())
  on conflict (invitee_id) do update
    set actual = excluded.actual, marked_by = excluded.marked_by, marked_at = pg_catalog.now()
  returning * into v_mark;
  return pg_catalog.jsonb_build_object(
    'actual', v_mark.actual, 'marked_at', v_mark.marked_at,
    'marked_by_name', (select p.display_name from public.profiles p where p.user_id = v_mark.marked_by)
  );
end;
$$;

-- "Mark the rest as they said" (spec §7.8): everyone whose invite went out and who has no mark
-- yet, from their answer; no reply counts as absent. TS twin of the mapping: declaredActual
-- (src/lib/responses/check-in.ts).
create function private.mark_rest_as_declared(p_meeting uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.meetings;
  v_count integer;
begin
  v := private.check_in_meeting(p_meeting);
  with inserted as (
    insert into public.attendance_marks (invitee_id, workspace_id, meeting_id, actual, marked_by)
    select i.id, i.workspace_id, i.meeting_id,
      case r.status when 'attending' then 'present' when 'late' then 'late' else 'absent' end::public.attendance_actual,
      auth.uid()
    from public.meeting_invitees i
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and i.email_status in ('sent', 'unknown')
    on conflict (invitee_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

revoke execute on function private.mark_attendance(uuid, uuid, public.attendance_actual),
  private.mark_rest_as_declared(uuid) from public, anon;
grant execute on function private.mark_attendance(uuid, uuid, public.attendance_actual),
  private.mark_rest_as_declared(uuid) to authenticated;

create function public.mark_attendance(p_meeting uuid, p_invitee uuid, p_actual public.attendance_actual default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.mark_attendance(p_meeting, p_invitee, p_actual) $$;
create function public.mark_rest_as_declared(p_meeting uuid)
returns integer language sql security invoker set search_path = ''
as $$ select private.mark_rest_as_declared(p_meeting) $$;
revoke execute on function public.mark_attendance(uuid, uuid, public.attendance_actual),
  public.mark_rest_as_declared(uuid) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, public.attendance_actual),
  public.mark_rest_as_declared(uuid) to authenticated;
```

Then `create or replace` the three reads with their complete M5 bodies and these changes:

`private.contact_history` — the `hist` CTE:

```sql
    with hist as materialized (
      select m.id as meeting_id, m.title, m.starts_at, m.timezone, m.response_mode, i.email_status,
        private.effective_status(am.actual, r.status) as counted,
        case when r.id is null then null else pg_catalog.jsonb_build_object(
          'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
          'after_deadline', r.after_deadline, 'updated_at', r.updated_at,
          'needs_reconfirmation', r.needs_reconfirmation) end as answer,
        case when am.invitee_id is null then null else pg_catalog.jsonb_build_object(
          'actual', am.actual, 'marked_at', am.marked_at, 'marked_by_name', mp.display_name) end as mark
      from public.meeting_invitees i
      join public.meetings m on m.id = i.meeting_id
      left join public.responses r on r.invitee_id = i.id
      left join public.attendance_marks am on am.invitee_id = i.id
      left join public.profiles mp on mp.user_id = am.marked_by
      where … (unchanged)
    ), …
```

counts become `count(*) filter (where hist.counted = 'attending')`, `… = 'late'`, `… = 'absent'`, and `no_reply` = `count(*) filter (where hist.counted is null and hist.email_status in ('sent', 'unknown'))`; each item adds `'mark', numbered.mark`.

`private.attendance_summary` — the `agg` CTE joins `left join public.attendance_marks am on am.invitee_id = i.id` and counts `private.effective_status(am.actual, r.status)` the same way (`no_reply`: counted is null and email sent/unknown).

`private.attendance_details` — the `page` CTE adds the two left joins and the `mark` object (same shape) and `'needs_reconfirmation'` inside `answer`.

- [ ] **Step 3: Apply, types, run** — `supabase migration up --local </dev/null && bun run db:types`; `bun run test:db -- m6-check-in` → PASS; the full `bun run test:db` (M5 results tests unchanged: no marks there); function-security list; advisors.

- [ ] **Step 4: Commit, PR, merge, hosted push** — `feat: check-in in the database; History and Attendance count it`.

---

### Task 8: Duplicate meeting (DB, API, hook, card menus)

Labels: `area:db`, `area:api`, `area:frontend`. Branch `feat/<issue>-duplicate-meeting`.

**Files:**
- Create: `supabase/migrations/<ts>_m6_duplicate.sql`, `src/server/db/m6-duplicate.db.test.ts`
- Create: `src/app/api/workspaces/[slug]/meetings/[id]/duplicate/route.ts`, `route.test.ts`
- Modify: `src/server/queries/meetings.ts` (+ `duplicateMeeting`), `src/hooks/use-meetings.ts` (+ `useDuplicateMeeting`), `src/hooks/use-meetings.test.tsx`
- Create: `src/app/w/[slug]/meetings/meeting-card-menu.tsx`, `meeting-card-menu.test.tsx`; delete `draft-menu.tsx` and `draft-menu.test.tsx` (their cases move into the new test)
- Modify: `src/app/w/[slug]/meetings/meetings-list.tsx` (a menu on every card for Owners and Admins), `messages/en.json` (`Meetings.cardActions`, `Meetings.duplicate`, `Meetings.duplicated`)
- Modify: `src/server/db/function-security.db.test.ts` (+ `duplicate_meeting`)

**Interfaces:**
- Consumes: `meetings_per_user_per_hour` via `private.hit_user_rate_limit('meeting_create')` (M4).
- Produces: `public.duplicate_meeting(p_meeting uuid) → uuid` (errors `not_found`, `forbidden`, `rate_limited`); `POST /api/workspaces/[slug]/meetings/[id]/duplicate` → `201 { id }` (`createMeetingResponseSchema`); `duplicateMeeting(client, meetingId): Promise<Result<string>>`; `useDuplicateMeeting(slug): UseMutationResult<{ id: string }, Error, string>` (the argument is the source meeting id; on success it invalidates `meetingsQueryKey(slug)`); `MeetingCardMenu({ slug, meeting }: { slug: string; meeting: MeetingSummary })`. Task 11's meeting-page menu reuses `useDuplicateMeeting`.

- [ ] **Step 1: Failing tests**

DB (`m6-duplicate.db.test.ts`): a sent meeting with a deadline, reminders 24/2, a list in its audience, one included and one excluded person, invitees and answers →
1. `duplicate_meeting` returns a new id; the new row is a `draft` with the same title, agenda, duration, timezone, place fields, answer settings and reminder settings, `starts_at`, `response_deadline`, `sent_at` null, a new `ics_uid`, `ics_sequence = 0`;
2. its `meeting_audience` has the same list and its `meeting_audience_people` the same include/exclude rows; it has no invitees, no responses, no jobs;
3. a Viewer → `forbidden`; another workspace → `not_found`; with `overrideLimit("meetings_per_user_per_hour", 0)` → `rate_limited`;
4. a cancelled meeting can be duplicated too.

Route (`route.test.ts`, mocking `loadMeetingContext` and `duplicateMeeting` like the meetings route test): `201 { id }`; a Viewer → `403 forbidden`; a cross-origin POST → `403 invalid_origin`; a database `tn:rate_limited` → `429`.

UI (`meeting-card-menu.test.tsx`): an Owner sees "…" with **Duplicate** on a sent card and **Duplicate** + **Delete draft** on a draft card; Duplicate calls the API and navigates to `/w/<slug>/meetings/<new id>/edit?step=details` with a toast "Copy created. Pick a date."; a Viewer sees no menu; Delete draft keeps the M4 confirm dialog.

Run: `bun run test:db -- m6-duplicate` and `bunx vitest run duplicate meeting-card-menu use-meetings` → FAIL.

- [ ] **Step 2: Migration**

```sql
-- M6 Duplicate (spec §7.9): a new draft with the same details, audience, answer and reminder
-- settings, and no date, time or deadline.
create function private.duplicate_meeting(p_meeting uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.meetings;
  v_id uuid;
begin
  select * into v from public.meetings m where m.id = p_meeting;
  if v.id is null or not private.is_member(v.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('meeting_create') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  insert into public.meetings (
    workspace_id, title, agenda_md, duration_minutes, timezone, location_mode, location_text, online_text,
    meeting_url, response_mode, delay_options, reason_required, comments_enabled, footer_note,
    reminder_pending_hours, reminder_going_hours, created_by
  )
  values (
    v.workspace_id, v.title, v.agenda_md, v.duration_minutes, v.timezone, v.location_mode, v.location_text,
    v.online_text, v.meeting_url, v.response_mode, v.delay_options, v.reason_required, v.comments_enabled,
    v.footer_note, v.reminder_pending_hours, v.reminder_going_hours, auth.uid()
  )
  returning id into v_id;
  insert into public.meeting_audience (workspace_id, meeting_id, list_id)
  select a.workspace_id, v_id, a.list_id from public.meeting_audience a where a.meeting_id = p_meeting;
  insert into public.meeting_audience_people (workspace_id, meeting_id, contact_id, mode)
  select p.workspace_id, v_id, p.contact_id, p.mode from public.meeting_audience_people p where p.meeting_id = p_meeting;
  return v_id;
end;
$$;
revoke execute on function private.duplicate_meeting(uuid) from public, anon;
grant execute on function private.duplicate_meeting(uuid) to authenticated;
create function public.duplicate_meeting(p_meeting uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.duplicate_meeting(p_meeting) $$;
revoke execute on function public.duplicate_meeting(uuid) from public, anon;
grant execute on function public.duplicate_meeting(uuid) to authenticated;
```

`meeting_audience_people` has no cap trigger: `set_meeting_audience`/`add_meeting_people` enforce the per-meeting cap, and a copy of a meeting that was within the cap stays within it.

- [ ] **Step 3: Query, route, hook**

```ts
/** `duplicate_meeting()`: the new draft's id. */
export async function duplicateMeeting(client: Client, meetingId: string): Promise<Result<string>> {
  const { data, error } = await client.rpc("duplicate_meeting", { p_meeting: meetingId });
  return { data: data ?? null, error };
}
```

`route.ts` (`POST`): `rejectCrossOrigin` → `loadMeetingContext(slug, id)` → `forbidViewer` → `duplicateMeeting` → `fromDatabaseError` on error → `NextResponse.json({ id }, { status: 201 })`.

`useDuplicateMeeting(slug)`:

```ts
/** Duplicate (spec §7.9): the new draft's id; the Meetings tabs refresh. */
export function useDuplicateMeeting(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) =>
      apiRequest(`${base(slug)}/${meetingId}/duplicate`, { method: "POST", body: {}, schema: createMeetingResponseSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meetingsQueryKey(slug) }),
  });
}
```

- [ ] **Step 4: `MeetingCardMenu`** — `draft-menu.tsx` generalized: the same trigger and `DropdownMenuContent align="end"` (with the padded menu classes), items **Duplicate** (always) and **Delete draft** (drafts only, with the existing `ConfirmDialog`). Duplicate needs no confirm (it creates a private draft; nothing is sent): on success `toast.success(t("duplicated"))` and `router.push(\`/w/${slug}/meetings/${id}/edit?step=details\`)`; on error a toast with `tErrors(code)`. `meetings-list.tsx` renders it on every card when `myRole !== "viewer"` (today only drafts get `DraftMenu`).

Copy: `Meetings.cardActions` "Actions for {title}", `Meetings.duplicate` "Duplicate", `Meetings.duplicated` "Copy created. Pick a date."

- [ ] **Step 5: Verify** — chained check + `bun run test:db`; screenshots of the Meetings list with the open card menu at 390 light, 320 dark, 1024 (menu padded, inside the viewport) and of the new draft's Details step (empty date and time).

- [ ] **Step 6: Commit, PR, merge, hosted push** — `feat: duplicate a meeting`.

---

### Task 9: API + hooks — edit (preview and save), cancel, delete, nudge, reminder fields, results and token schemas, error codes

Labels: `area:api`, `area:frontend`. Branch `feat/<issue>-m6-api`.

**Files:**
- Modify: `src/shared/api/errors.ts`, `src/shared/api/errors.test.ts`, `messages/en.json` (`ApiErrors`)
- Modify: `src/shared/api/meetings.ts` (+ reminder fields, `cancelledAt`, edit/cancel/nudge schemas), `src/shared/api/meetings.test.ts`
- Modify: `src/shared/api/meeting-settings.ts` (Meeting defaults + reminder fields), `src/shared/api/meeting-settings.test.ts`
- Modify: `src/shared/api/responses.ts` (`answerSchema.needsReconfirmation`, results counts, `to_reconfirm` filter, `markSchema`, `personRowSchema.mark`), `src/shared/api/responses.test.ts`
- Modify: `src/server/queries/meetings.ts` (`MEETING_COLUMNS`, `toMeeting`, `updateMeeting`, + `editSentMeeting`, `cancelMeeting`, `deleteCancelledMeeting`, `nudgeMeeting`, `toEditColumns`)
- Modify: `src/server/queries/results.ts` (`getMeetingResults`, `listMeetingPeople` with `search`, `dbAnswerSchema`), `src/server/queries/tokens.ts` (`needs_reconfirmation`)
- Modify: `src/app/api/workspaces/[slug]/meeting-defaults/route.ts` (+ reminder fields), `…/meetings/[id]/route.ts` (DELETE of a cancelled meeting), `…/meetings/[id]/people/route.ts` (`?search=`)
- Create: `…/meetings/[id]/changes/route.ts`, `…/meetings/[id]/cancel/route.ts`, `…/meetings/[id]/nudge/route.ts` and a `route.test.ts` next to each
- Create: `src/hooks/use-meeting-lifecycle.ts`, `use-meeting-lifecycle.test.tsx`
- Modify: `src/hooks/use-results.ts` (`useMeetingPeople(…, search)`), `src/test/fixtures/meetings.ts` (new fields)

**Interfaces:**
- Consumes (Tasks 4–7): `edit_sent_meeting`, `cancel_meeting`, `delete_cancelled_meeting`, `nudge_meeting`, the new `meeting_results`/`meeting_people`/`token_invitee` fields; (Task 2) `changeSetSchema`; (Task 4) `src/config/reminders.ts`.
- Produces (shared, camelCase):
  - `meetingSchema` + `reminderPendingHours: number | null`, `reminderGoingHours: number | null`, `cancelledAt: string | null`.
  - `reminderPendingSchema`, `reminderGoingSchema` (`z.number().int()` refined to the choices, `.nullable()`); `updateMeetingBodySchema` + `reminderPendingHours`, `reminderGoingHours`; `meetingDefaultsSchema` + the same two.
  - `editFieldsSchema` = `updateMeetingBodySchema`'s object without `responseMode` and `delayOptions` (partial, non-empty); `editMeetingBodySchema = z.object({ fields: editFieldsSchema, notify: z.boolean(), dryRun: z.boolean() })`; `editResultSchema = z.object({ changed: z.boolean(), changes: changeSetSchema, emails: z.number().int(), calendarOnly: z.number().int(), reconfirm: z.boolean() })`; types `EditFields`, `EditMeetingBody`, `EditResult`.
  - `cancelResultSchema = z.object({ emails: z.number().int() })`; `nudgeResultSchema = z.object({ reminded: z.number().int(), nextAt: z.string() })`.
  - `answerSchema.needsReconfirmation: boolean` (default false); `meetingResultsSchema.answers` + `toReconfirm`, `remindable`, `reachable`; `meetingResultsSchema` + `checkedIn: number`, `nudge: { lastAt: string | null; lastCount: number | null; nextAt: string | null }`; `peopleFilterSchema` + `"to_reconfirm"`; `markSchema = z.object({ actual: z.enum(["present", "late", "absent"]), markedAt: z.string(), markedByName: z.string().nullable() })`, type `Mark`; `personRowSchema.mark: Mark | null`.
- Produces (server): `toEditColumns(fields: EditFields): Record<EditableField, string | number | boolean | null>` (camelCase → the DB's snake_case keys, `title`/`agendaMd`/… → `title`/`agenda_md`/…); `editSentMeeting(client, meetingId, body: EditMeetingBody): Promise<Result<EditResult>>`; `cancelMeeting(client, meetingId): Promise<Result<{ emails: number }>>`; `deleteCancelledMeeting(client, meetingId): Promise<{ error: DbError | null }>`; `nudgeMeeting(client, meetingId): Promise<Result<{ reminded: number; nextAt: string }>>`; `listMeetingPeople(…, search: string | null)`.
- Produces (routes):
  - `POST …/meetings/[id]/changes` body `EditMeetingBody` → `200 EditResult` (Viewer 403; cross-origin 403).
  - `POST …/meetings/[id]/cancel` → `200 { emails }`, then `scheduleDispatch()`; `maxDuration = 60`.
  - `DELETE …/meetings/[id]`: a cancelled meeting goes through `deleteCancelledMeeting`, a draft through the M4 `deleteMeeting`; anything else → `409 meeting_not_draft`.
  - `POST …/meetings/[id]/nudge` → `200 { reminded, nextAt }`, then `scheduleDispatch()`; `maxDuration = 60`.
  - `GET …/people?search=` (≤ 120 characters, trimmed; empty → null).
- Produces (hooks, `src/hooks/use-meeting-lifecycle.ts`):
  - `editPreviewKey(slug, id, body)`; `useEditPreview(slug, id, fields: EditFields, notify: boolean, enabled: boolean)` — `useQuery` that POSTs with `dryRun: true` (a preview writes nothing; `staleTime: 0`).
  - `useSaveEdit(slug, id)` — `useMutation` POSTing `dryRun: false`; on success invalidates `meetingQueryKey`, `meetingResultsKey`, `meetingPeopleKey`, `meetingsQueryKey`.
  - `useCancelMeeting(slug, id)` — same invalidations.
  - `useNudgeMeeting(slug, id)` — invalidates `meetingResultsKey`.
  - Deleting reuses the M4 `useDeleteMeeting(slug)` (the server decides by status).

- [ ] **Step 1: Failing tests**

`errors.test.ts`: the seven new codes have the statuses listed in Global Constraints, and `messages/en.json` has an `ApiErrors` entry for every code (the existing "every code is translated" test covers it once the codes exist).

`meetings.test.ts`:

```ts
it("refuses the answer type and the delays in an edit", () => {
  expect(editMeetingBodySchema.safeParse({ fields: { responseMode: "rsvp" }, notify: false, dryRun: true }).success).toBe(false);
  expect(editMeetingBodySchema.safeParse({ fields: { delayOptions: [5] }, notify: false, dryRun: true }).success).toBe(false);
  expect(editMeetingBodySchema.safeParse({ fields: {}, notify: false, dryRun: true }).success).toBe(false);
});
it("accepts reminder choices and off, nothing else", () => {
  expect(updateMeetingBodySchema.safeParse({ reminderPendingHours: 24 }).success).toBe(true);
  expect(updateMeetingBodySchema.safeParse({ reminderPendingHours: null }).success).toBe(true);
  expect(updateMeetingBodySchema.safeParse({ reminderPendingHours: 3 }).success).toBe(false);
  expect(updateMeetingBodySchema.safeParse({ reminderGoingHours: 48 }).success).toBe(false);
});
```

A server test for `toEditColumns` (in `src/server/queries/meetings.test.ts`, create if absent): `{ agendaMd: "x", startsAt: null, reminderGoingHours: 2 }` → `{ agenda_md: "x", starts_at: null, reminder_going_hours: 2 }`, and every key it can produce is in `EDITABLE_FIELDS`.

Route tests (copy the meetings route test's mocking; mock `loadMeetingContext` with `okContext`/`viewerContext` and the query function):
- `changes/route.test.ts`: a dry run returns the RPC result mapped to camelCase and calls `editSentMeeting` with `{ fields, notify, dryRun: true }`; a Viewer → 403; a body with `responseMode` → 400 `invalid_input`; a DB `tn:deadline_after_start` → 400 with that code.
- `cancel/route.test.ts`: 200 `{ emails: 3 }`, `scheduleDispatch` called once; DB `tn:meeting_started` → 409; Viewer → 403; cross-origin → 403 `invalid_origin`.
- `nudge/route.test.ts`: 200 `{ reminded, nextAt }`, `scheduleDispatch` called; `tn:nudge_too_soon` → 409; `tn:sender_not_connected` → its M4 status.
- `[id]/route.test.ts` (DELETE, in the existing mutations test file): a cancelled meeting calls `deleteCancelledMeeting`; a draft calls `deleteMeeting`; a scheduled one → 409 `meeting_not_draft` without calling either.

`use-meeting-lifecycle.test.tsx`: `useEditPreview` POSTs `dryRun: true` and is disabled when `enabled` is false; `useSaveEdit` invalidates the four keys; `useCancelMeeting` and `useNudgeMeeting` invalidate their keys (spy on `invalidateQueries`, like `use-meetings.test.tsx`).

Run: `bunx vitest run errors meetings meeting-settings responses changes cancel nudge use-meeting-lifecycle` → FAIL.

- [ ] **Step 2: Shared schemas**

`src/shared/api/meetings.ts`:

```ts
import { REMINDER_GOING_CHOICES, REMINDER_PENDING_CHOICES } from "@/config/reminders";
import { changeSetSchema } from "./meeting-changes";

const oneOf = (choices: readonly number[]) =>
  z.number().int().refine((value) => choices.includes(value));
/** "People who haven't answered" reminder, hours before the deadline (null = off). */
export const reminderPendingSchema = oneOf(REMINDER_PENDING_CHOICES).nullable();
/** "Going and Late" reminder, hours before the start (null = off). */
export const reminderGoingSchema = oneOf(REMINDER_GOING_CHOICES).nullable();
```

Add `reminderPendingHours: z.number().int().nullable()`, `reminderGoingHours: z.number().int().nullable()`, `cancelledAt: z.string().nullable()` to `meetingSchema`; add the two reminder fields (with the schemas above) to the object inside `updateMeetingBodySchema` (move that object into a named `const meetingFieldsSchema = z.object({…})` so the edit schema can reuse it):

```ts
/** Fields of a sent meeting that can change (spec §4: not the answer type, not the delays). */
export const editFieldsSchema = meetingFieldsSchema
  .omit({ responseMode: true, delayOptions: true })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0);
/** Changed fields of a sent meeting. */
export type EditFields = z.infer<typeof editFieldsSchema>;
/** `POST …/changes`: preview (`dryRun`) or save. `notify`: "Email everyone about this change". */
export const editMeetingBodySchema = z.object({ fields: editFieldsSchema, notify: z.boolean(), dryRun: z.boolean() });
/** An edit request. */
export type EditMeetingBody = z.infer<typeof editMeetingBodySchema>;
/** What an edit changes and who it emails. */
export const editResultSchema = z.object({
  changed: z.boolean(),
  changes: changeSetSchema,
  emails: z.number().int(),
  calendarOnly: z.number().int(),
  reconfirm: z.boolean(),
});
/** An edit's preview or result. */
export type EditResult = z.infer<typeof editResultSchema>;
/** `POST …/cancel` response. */
export const cancelResultSchema = z.object({ emails: z.number().int() });
/** `POST …/nudge` response. */
export const nudgeResultSchema = z.object({ reminded: z.number().int(), nextAt: z.string() });
```

`.strict()` makes `responseMode`/`delayOptions` (and any unknown key) a 400 at the route, before the database's own check.

`src/shared/api/meeting-settings.ts`: add `reminderPendingHours: reminderPendingSchema` and `reminderGoingHours: reminderGoingSchema` to `meetingDefaultsSchema` (import them from `./meetings` only if that creates no cycle; otherwise define `oneOf` and the two schemas here and re-export them from `meetings.ts`).

`src/shared/api/responses.ts`:

```ts
/** A check-in mark (spec §7.8). */
export const markSchema = z.object({
  actual: z.enum(["present", "late", "absent"]),
  markedAt: z.string(),
  markedByName: z.string().nullable(),
});
/** A check-in mark. */
export type Mark = z.infer<typeof markSchema>;
```

`answerSchema` + `needsReconfirmation: z.boolean().default(false)`; `meetingResultsSchema.answers` + `toReconfirm`, `remindable`, `reachable` (`count`), and top level `checkedIn: count`, `nudge: z.object({ lastAt: z.string().nullable(), lastCount: z.number().int().nullable(), nextAt: z.string().nullable() })`; `peopleFilterSchema` + `"to_reconfirm"`; `personRowSchema` + `mark: markSchema.nullable()`.

- [ ] **Step 3: Queries**

`src/server/queries/meetings.ts`: `MEETING_COLUMNS` + `reminder_pending_hours, reminder_going_hours, cancelled_at`; `toMeeting` maps them; `updateMeeting` writes `reminder_pending_hours: patch.reminderPendingHours, reminder_going_hours: patch.reminderGoingHours`.

```ts
const EDIT_COLUMNS: Record<keyof EditFields, EditableField> = {
  title: "title", agendaMd: "agenda_md", startsAt: "starts_at", durationMinutes: "duration_minutes",
  timezone: "timezone", locationMode: "location_mode", locationText: "location_text", onlineText: "online_text",
  meetingUrl: "meeting_url", responseDeadline: "response_deadline", reasonRequired: "reason_required",
  commentsEnabled: "comments_enabled", footerNote: "footer_note", reminderPendingHours: "reminder_pending_hours",
  reminderGoingHours: "reminder_going_hours",
};

/** The edit's fields with the database's column names (`edit_sent_meeting` p_fields). */
export function toEditColumns(fields: EditFields): Partial<Record<EditableField, string | number | boolean | null>> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [EDIT_COLUMNS[key as keyof EditFields], value]),
  );
}

/** `edit_sent_meeting()`: preview or save an edit of a sent meeting (spec §7.5). */
export async function editSentMeeting(client: Client, meetingId: string, body: EditMeetingBody): Promise<Result<EditResult>> {
  const { data, error } = await client.rpc("edit_sent_meeting", {
    p_meeting: meetingId, p_fields: toEditColumns(body.fields), p_notify: body.notify, p_dry_run: body.dryRun,
  });
  if (error) {
    return { data: null, error };
  }
  const db = z.object({
    changed: z.boolean(), changes: changeSetSchema, emails: z.number().int(),
    calendar_only: z.number().int(), reconfirm: z.boolean(),
  }).parse(data);
  return {
    data: { changed: db.changed, changes: db.changes, emails: db.emails, calendarOnly: db.calendar_only, reconfirm: db.reconfirm },
    error: null,
  };
}
```

(`key as keyof EditFields`: `Object.entries` widens keys to `string`; the schema already guaranteed them. If lint rejects the cast, iterate over `Object.keys(EDIT_COLUMNS)` and read `fields[key]` instead.)

`cancelMeeting`, `deleteCancelledMeeting`, `nudgeMeeting`: thin `client.rpc` wrappers that parse `{ emails }`, nothing, `{ reminded, next_at }` → `{ reminded, nextAt }`.

`src/server/queries/results.ts`: `dbAnswerSchema` + `needs_reconfirmation: z.boolean().default(false)` → `needsReconfirmation`; `getMeetingResults` parses and maps `to_reconfirm`, `remindable`, `reachable`, `checked_in`, `nudge { last_at, last_count, next_at }`; `dbPersonSchema` + `mark: z.object({ actual: z.enum(["present", "late", "absent"]), marked_at: z.string(), marked_by_name: z.string().nullable() }).nullable()` mapped to `markSchema`'s shape; `listMeetingPeople(client, meetingId, filter, limit, after, search)` passes `p_search: sqlNullable(search)`. `src/server/queries/tokens.ts`: map `answer.needs_reconfirmation`.

- [ ] **Step 4: Routes** — each new route follows `send/route.ts` exactly (`rejectCrossOrigin` → `loadMeetingContext` → `forbidViewer` → query → `fromDatabaseError` / `NextResponse.json`); `changes` parses the body with `parseJsonBody(request, editMeetingBodySchema)`. `cancel` and `nudge` call `scheduleDispatch()` after a successful RPC and export `maxDuration = 60`. The `[id]` DELETE handler loads the meeting first (`getMeeting`) and branches on `status`. `people/route.ts` reads `search` (trim; > 120 characters → `invalid_input`; empty → null). `meeting-defaults/route.ts` maps `reminderPendingHours`/`reminderGoingHours` to `default_reminder_pending_hours`/`default_reminder_going_hours` in both GET and PATCH.

- [ ] **Step 5: Hooks** (`src/hooks/use-meeting-lifecycle.ts`)

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meetingQueryKey, meetingsQueryKey } from "@/hooks/use-meetings";
import { meetingPeopleKey, meetingResultsKey } from "@/hooks/use-results";
import { apiRequest } from "@/lib/api-client";
import {
  cancelResultSchema, type EditFields, editResultSchema, nudgeResultSchema,
} from "@/shared/api/meetings";

const base = (slug: string, id: string) => `/api/workspaces/${encodeURIComponent(slug)}/meetings/${id}`;

/** Key of an edit preview (the fields and the switch are part of it). */
export const editPreviewKey = (slug: string, id: string, fields: EditFields, notify: boolean) =>
  ["meeting-edit-preview", slug, id, fields, notify] as const;

/** What saving these changes would change and who it would email (writes nothing). */
export function useEditPreview(slug: string, id: string, fields: EditFields, notify: boolean, enabled: boolean) {
  return useQuery({
    queryKey: editPreviewKey(slug, id, fields, notify),
    queryFn: () => apiRequest(`${base(slug, id)}/changes`, {
      method: "POST", body: { fields, notify, dryRun: true }, schema: editResultSchema,
    }),
    enabled,
    staleTime: 0,
  });
}

function useRefreshMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [meetingQueryKey(slug, id), meetingResultsKey(slug, id), meetingPeopleKey(slug, id), meetingsQueryKey(slug)]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

/** Saves an edit of a sent meeting (spec §7.5). */
export function useSaveEdit(slug: string, id: string) {
  const refresh = useRefreshMeeting(slug, id);
  return useMutation({
    mutationFn: (input: { fields: EditFields; notify: boolean }) =>
      apiRequest(`${base(slug, id)}/changes`, { method: "POST", body: { ...input, dryRun: false }, schema: editResultSchema }),
    onSuccess: refresh,
  });
}

/** Cancels a sent meeting (spec §7.5). */
export function useCancelMeeting(slug: string, id: string) {
  const refresh = useRefreshMeeting(slug, id);
  return useMutation({
    mutationFn: () => apiRequest(`${base(slug, id)}/cancel`, { method: "POST", body: {}, schema: cancelResultSchema }),
    onSuccess: refresh,
  });
}

/** Reminds everyone who hasn't answered (spec §7.6 Nudge). */
export function useNudgeMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(`${base(slug, id)}/nudge`, { method: "POST", body: {}, schema: nudgeResultSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meetingResultsKey(slug, id) }),
  });
}
```

`useMeetingPeople(slug, id, filter, live, search = null)`: add `search` to the key and the params (only when not null).

- [ ] **Step 6: Verify** — `bunx vitest run …` → PASS; the chained check; `bun run test:db` (nothing changed in SQL, but the query wrappers are covered by the existing DB-backed route tests). No UI change yet, so no screenshots.

- [ ] **Step 7: Commit, PR, merge** — `feat: API for editing, cancelling, deleting and nudging a sent meeting`.

---

### Task 10: Wizard edit mode + Review changes; reminder rows in Answers and Meeting defaults

Labels: `area:frontend`. Branch `feat/<issue>-m6-edit-mode`.

**Files:**
- Modify: `src/app/w/[slug]/meetings/[id]/edit/wizard-steps.ts` (+ edit mode, `stepAfter`, `stepBefore`, `StepSaver`), `wizard-steps.test.ts`
- Modify: `src/app/w/[slug]/meetings/[id]/edit/wizard-shell.tsx` (mode from `?mode=edit`, the saver, the edit draft), `wizard-shell.test.tsx`
- Modify: `src/app/w/[slug]/meetings/[id]/edit/edit-meeting.tsx` (pass `mode`)
- Modify: `details-step.tsx`, `details-step.test.tsx`, `responses-step.tsx`, `responses-step.test.tsx`, `responses-form.ts`, `responses-form.test.ts`, `audience-step.tsx`, `review-step.tsx` (use `stepAfter`/`stepBefore` instead of hardcoded step names)
- Create: `src/app/w/[slug]/meetings/[id]/edit/use-edit-draft.ts`, `use-edit-draft.test.ts`
- Create: `src/app/w/[slug]/meetings/[id]/edit/changes-step.tsx`, `changes-step.test.tsx`
- Create: `src/components/forms/reminder-choice.tsx`, `reminder-choice.test.tsx`
- Modify: `src/lib/meetings/deadline.ts` (+ `editDeadlineProblem`), `deadline.test.ts`
- Modify: `src/app/w/[slug]/settings/meeting-defaults-section.tsx`, `meeting-defaults-section.test.tsx`
- Modify: `messages/en.json` (`Wizard.steps.changes`, `Wizard.next.responses`, `Wizard.next.changes`, `Wizard.responses.reminders*`, `Wizard.responses.locked`, `Wizard.changes.*`, `Settings.defaults.reminders*`)

**Interfaces:**
- Consumes (Task 9): `useEditPreview`, `useSaveEdit`, `EditFields`, `editFieldsSchema`, `reminderPendingSchema`, `reminderGoingSchema`; (Task 2) `changeLines`, `MEMBER_VISIBLE_FIELDS`, `SCHEDULE_FIELDS`, `PLACE_FIELDS`; (Task 4) `REMINDER_*`; (M4) `useUpdateMeeting`, `useWorkspaceSender`, `quotaLine`, `ConfirmDialog`, `SwitchRow`, `SegmentedControl` (+ Task 1's `compact`).
- Produces:
  - `type WizardMode = "draft" | "invite" | "edit"`; `stepsFor(status, mode): readonly WizardStep[]` (`edit` → `["details", "responses", "changes"]`); `WizardStep` gains `"changes"`; `stepAfter(steps, step): WizardStep | null`, `stepBefore(steps, step): WizardStep | null`.
  - `type StepSaver = { save(patch: UpdateMeetingBody, onSaved?: () => void): void; pending: boolean; failed: boolean }`; `WizardStepProps` gains `mode: WizardMode`, `saver: StepSaver`, `saved: Meeting` (the server's meeting; `meeting` is the view with unsaved edits applied) and `editDraft: EditDraft | null`.
  - `useEditDraft(meeting: Meeting): EditDraft` with `type EditDraft = { fields: EditFields | null; view: Meeting; save(patch: UpdateMeetingBody): void; clear(): void }` (`fields` is null while nothing differs from the saved meeting).
  - `editDeadlineProblem(deadline: string, startsAt: string | null, now: Date, saved: string | null): ResponseDeadlineProblem | null`.
  - `ReminderChoice({ id, label, hint, value, choices, onChange, disabled }: { id: string; label: string; hint: string; value: number | null; choices: readonly number[]; onChange(value: number | null): void; disabled?: boolean })`.
  - Edit mode URL: `/w/<slug>/meetings/<id>/edit?mode=edit&step=details` (Task 11 links to it).

- [ ] **Step 1: Failing tests**

`deadline.test.ts` (Review Focus 3):

```ts
describe("editDeadlineProblem", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  const start = "2026-10-09T17:00:00.000Z";
  const passed = "2026-10-09T12:00:00.000Z";
  it("keeps a deadline that already passed when it is not changed", () => {
    expect(editDeadlineProblem(passed, start, now, passed)).toBeNull();
    expect(editDeadlineProblem("2026-10-09T12:00:00+00:00", start, now, passed)).toBeNull();
  });
  it("still refuses a start moved to before that deadline", () => {
    expect(editDeadlineProblem(passed, "2026-10-09T11:00:00.000Z", now, passed)).toBe("afterStart");
  });
  it("applies the full rule to a changed deadline", () => {
    expect(editDeadlineProblem("2026-10-09T13:00:00.000Z", start, now, passed)).toBe("inPast");
    expect(editDeadlineProblem("2026-10-09T16:00:00.000Z", start, now, passed)).toBeNull();
  });
});
```

`wizard-steps.test.ts`: `stepsFor("scheduled", "edit")` → `["details", "responses", "changes"]`; `stepsFor("scheduled", "invite")` → `["audience", "review"]`; `stepsFor("draft", "draft")` → the four M4 steps; `stepAfter(WIZARD_STEPS, "responses")` → `"review"`; `stepAfter(EDIT_STEPS, "responses")` → `"changes"`; `stepBefore(EDIT_STEPS, "details")` → `null`.

`use-edit-draft.test.ts` (`renderHook`, `meetingFixture` with `status: "scheduled"`):
- `save({ title: "New" })` → `fields` `{ title: "New" }`, `view.title` "New", stored under `tn:edit:<id>` in `sessionStorage`;
- `save({ title: meetingFixture.title })` afterwards → `fields` null (back to the saved value);
- `save({ startsAt: "2026-10-09T17:00:00+00:00" })` when the fixture has `"2026-10-09T17:00:00.000Z"` → `fields` null (same instant);
- `save({ responseMode: "rsvp", delayOptions: [5], reasonRequired: false })` → `fields` `{ reasonRequired: false }` (locked fields dropped);
- a new hook instance reads the stored draft; `clear()` removes it;
- `sessionStorage.setItem` throwing → the draft still works in memory (wrap reads and writes in try/catch).

`details-step.test.tsx`: in edit mode, Next calls `saver.save` with the Details patch and then `goTo("responses")`, and never sends a PATCH (`routeFetch` has no PATCH route; the test fails on an unexpected request).

`responses-step.test.tsx`:
- edit mode: the answer-type radios and the delay chips are disabled, and "Fixed once sent. To change it, cancel and duplicate the meeting." is shown;
- edit mode with a saved deadline in the past and unchanged: Next works (no "Pick a time in the future.");
- the two reminder rows: picking "6 h" for "People who haven't answered" and "Off" for "Going and Late" puts `reminderPendingHours: 6, reminderGoingHours: null` in the saved patch; announcements hide both rows.

`changes-step.test.tsx` (mock `routeFetch` for `POST …/changes` returning a preview, then the save; `GET …/sender` like the review-step test):
- lists "Time: Fri 9 Oct, 18:00 → Sat 10 Oct, 18:00", "Emails 3 people", "Everyone will be asked to confirm again.", and the quota line;
- Save opens "Save and email 3 people?"; confirming POSTs `dryRun: false` with the fields, clears the draft, and navigates to the meeting page with the toast "Changes saved.";
- a text-only change shows the "Email everyone about this change" switch (off), and turning it on refetches the preview with `notify: true`;
- a preview with `emails: 0, calendarOnly: 0` shows "Nobody is emailed." and **Save changes** saves without a dialog;
- no sender: "Emails will wait until Gmail is reconnected.";
- nothing changed: "Nothing changed yet." with Back only;
- Discard changes asks "Discard your changes?" and then clears the draft and returns to the meeting page;
- an API error shows its plain message (`ApiErrors.meeting_started`).

`reminder-choice.test.tsx`: six options for the pending row ("Off", "1 h", "2 h", "6 h", "24 h", "48 h"); the pressed one matches `value`; choosing "Off" calls `onChange(null)`.

`meeting-defaults-section.test.tsx`: changing either reminder row PATCHes `reminderPendingHours`/`reminderGoingHours`; a Viewer sees them disabled.

Run: `bunx vitest run deadline wizard-steps use-edit-draft details-step responses-step changes-step reminder-choice meeting-defaults` → FAIL.

- [ ] **Step 2: `editDeadlineProblem`** (`src/lib/meetings/deadline.ts`)

```ts
const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

/**
 * The deadline rule while editing a sent meeting: a deadline that already passed may stay as it
 * is, but the start may never move to before it; a changed deadline follows the full rule.
 * DB twin: the deadline block in `private.edit_sent_meeting`.
 */
export function editDeadlineProblem(
  deadline: string,
  startsAt: string | null,
  now: Date,
  saved: string | null,
): ResponseDeadlineProblem | null {
  if (saved !== null && sameInstant(deadline, saved)) {
    return startsAt !== null && new Date(deadline).getTime() >= new Date(startsAt).getTime() ? "afterStart" : null;
  }
  return responseDeadlineProblem(deadline, startsAt, now);
}
```

`responses-form.ts`: `validateResponses(values, startsAt, now, savedDeadline: string | null = null)` uses `editDeadlineProblem(deadline, startsAt, now, savedDeadline)` (with `savedDeadline` null it is exactly `responseDeadlineProblem`, so draft behaviour is unchanged); `ResponsesValues` and `responsesPatch` gain `reminderPendingHours` and `reminderGoingHours` (announcements → both null).

- [ ] **Step 3: Steps, mode, saver** (`wizard-steps.ts`)

```ts
/** Editing a sent meeting (spec §7.5): Details, Answers, then Review changes. */
export const EDIT_STEPS = ["details", "responses", "changes"] as const;
/** Every step of every mode. */
export type WizardStep = (typeof WIZARD_STEPS)[number] | "changes";
/** Draft wizard, Invite more, or editing a sent meeting. */
export type WizardMode = "draft" | "invite" | "edit";

/** Steps of a mode (a sent meeting is never back in the draft steps). */
export function stepsFor(status: Meeting["status"], mode: WizardMode): readonly WizardStep[] {
  if (status === "draft") {
    return WIZARD_STEPS;
  }
  return mode === "edit" ? EDIT_STEPS : INVITE_MORE_STEPS;
}
/** The step after `step` in `steps`, or null at the end. */
export function stepAfter(steps: readonly WizardStep[], step: WizardStep): WizardStep | null {
  return steps[steps.indexOf(step) + 1] ?? null;
}
/** The step before `step`, or null at the start. */
export function stepBefore(steps: readonly WizardStep[], step: WizardStep): WizardStep | null {
  const index = steps.indexOf(step);
  return index > 0 ? steps[index - 1] : null;
}

/** How a step keeps its fields: PATCH for drafts, the session edit draft for sent meetings. */
export type StepSaver = {
  save: (patch: UpdateMeetingBody, onSaved?: () => void) => void;
  pending: boolean;
  failed: boolean;
};
```

`WizardStepProps` gains `mode`, `saver`, `saved` and `editDraft` (Interfaces). In `details-step.tsx` and `responses-step.tsx` replace `useUpdateMeeting` + `update.mutate(patch, { onSuccess })` with `saver.save(patch, () => goTo(next))`, `update.isPending` with `saver.pending` and `update.isError` with `saver.failed`; replace every hardcoded `goTo("audience")`/`goTo("review")`/`goTo("details")` in the four steps with `stepAfter`/`stepBefore` on `steps`, and the Next labels with `t(\`next.${after}\`)` (add `next.responses` "Next: Answers" and `next.changes` "Next: Review changes" to the existing `next.audience`/`next.review`). `ResponsesStep` passes `saved.responseDeadline` to `validateResponses` when `mode === "edit"`, and disables the answer-type control and the delay chips in edit mode with `t("responses.locked")` under them.

`wizard-shell.tsx`:

```tsx
const mode: WizardMode =
  meeting.status === "draft" ? "draft" : modeParam === "edit" ? "edit" : "invite";
const steps = stepsFor(meeting.status, mode);
const editDraft = useEditDraft(meeting);
const update = useUpdateMeeting(slug, meeting.id);
const saver: StepSaver =
  mode === "edit"
    ? { save: (patch, onSaved) => { editDraft.save(patch); onSaved?.(); }, pending: false, failed: false }
    : { save: (patch, onSaved) => update.mutate(patch, { onSuccess: () => onSaved?.() }), pending: update.isPending, failed: update.isError };
const goTo = (next: WizardStep) =>
  router.replace(`/w/${slug}/meetings/${meeting.id}/edit?${mode === "edit" ? "mode=edit&" : ""}step=${next}`, { scroll: true });
```

The existing redirect effect also sends the user to the meeting page when `mode === "edit"` and the meeting has started (`meeting.startsAt <= now`). Steps get `meeting={mode === "edit" ? editDraft.view : meeting}` and `saved={meeting}`. `edit-meeting.tsx` passes `modeParam={params.get("mode")}`. `STEP_COMPONENTS` gains `changes: ChangesStep`. The header in edit mode reads "Edit meeting · Step 2 of 3".

- [ ] **Step 4: `useEditDraft`** (`use-edit-draft.ts`)

```ts
"use client";

import { useState } from "react";
import { type EditFields, editFieldsSchema, type Meeting, type UpdateMeetingBody } from "@/shared/api/meetings";

const storageKey = (id: string) => `tn:edit:${id}`;
const INSTANT_FIELDS = new Set(["startsAt", "responseDeadline"]);

function differs(key: string, a: string | number | boolean | null | number[], b: typeof a): boolean {
  if (INSTANT_FIELDS.has(key) && typeof a === "string" && typeof b === "string") {
    return new Date(a).getTime() !== new Date(b).getTime();
  }
  return JSON.stringify(a) !== JSON.stringify(b);
}

function read(id: string): EditFields | null {
  try {
    const raw = sessionStorage.getItem(storageKey(id));
    const parsed = raw ? editFieldsSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(id: string, fields: EditFields | null): void {
  try {
    if (fields) {
      sessionStorage.setItem(storageKey(id), JSON.stringify(fields));
    } else {
      sessionStorage.removeItem(storageKey(id));
    }
  } catch {
    // Private mode or blocked storage: the draft lives in memory for this visit only.
  }
}

/** Unsaved edits of a sent meeting, kept per tab until Review changes saves them (spec §7.5). */
export type EditDraft = {
  fields: EditFields | null;
  view: Meeting;
  save: (patch: UpdateMeetingBody) => void;
  clear: () => void;
};

/** The edit draft of `meeting`: only fields that differ from the saved meeting are kept. */
export function useEditDraft(meeting: Meeting): EditDraft {
  const [fields, setFields] = useState<EditFields | null>(() => read(meeting.id));
  const save = (patch: UpdateMeetingBody) => {
    // The answer type and the delays are fixed once sent (spec §4); a Responses patch still carries them.
    const editable = Object.fromEntries(
      Object.entries(patch).filter(([key]) => key !== "responseMode" && key !== "delayOptions"),
    );
    const merged = { ...fields, ...editable };
    const kept = Object.fromEntries(
      Object.entries(merged).filter(([key, value]) => differs(key, value, meeting[key as keyof Meeting] as typeof value)),
    );
    const next = Object.keys(kept).length > 0 ? editFieldsSchema.parse(kept) : null;
    write(meeting.id, next);
    setFields(next);
  };
  const clear = () => {
    write(meeting.id, null);
    setFields(null);
  };
  return { fields, view: { ...meeting, ...fields }, save, clear };
}
```

(`meeting[key as keyof Meeting]` reads the saved value of a key that `editFieldsSchema.parse` accepts a moment later; the cast only narrows `Object.entries`' `string` keys.)

- [ ] **Step 5: `ReminderChoice`** — a `SegmentedControl` with `compact`, options "Off" plus `t("hours", { count })` per choice, value `String(value ?? "off")`, `onValueChange` → `onChange(v === "off" ? null : Number(v))`; the hint under it (`text-sm text-muted-ink`). In `ResponsesStep` (not for announcements), after the deadline rows:

```tsx
<ReminderChoice id="reminder-pending" label={t("responses.remindPending")} hint={t("responses.remindPendingHint")}
  value={values.reminderPendingHours} choices={REMINDER_PENDING_CHOICES}
  onChange={(value) => set("reminderPendingHours", value)} />
<ReminderChoice id="reminder-going" label={t("responses.remindGoing")} hint={t("responses.remindGoingHint")}
  value={values.reminderGoingHours} choices={REMINDER_GOING_CHOICES}
  onChange={(value) => set("reminderGoingHours", value)} />
```

The same two rows in `MeetingDefaultsSection`, saving each change at once (`save({ reminderPendingHours: value })`), disabled for Viewers.

- [ ] **Step 6: `ChangesStep`** (`changes-step.tsx`) — props `WizardStepProps`; `editDraft` is always set in edit mode.

```tsx
"use client";

/** Step 3 of editing a sent meeting (spec §7.5): what changed, who is emailed, then save. */
export function ChangesStep({ slug, meeting, saved, steps, goTo, editDraft }: WizardStepProps) {
  const t = useTranslations("Wizard.changes");
  const tFields = useTranslations("Email.changes");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const fields = editDraft?.fields ?? null;
  const [notify, setNotify] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const preview = useEditPreview(slug, saved.id, fields ?? {}, notify, fields !== null);
  const save = useSaveEdit(slug, saved.id);
  const sender = useWorkspaceSender(slug);
  // …render (below)
}
```

Render, top to bottom:
1. `fields === null` → `t("nothing")` "Nothing changed yet." and the footer with Back only.
2. While `preview.isPending` → `Skeleton`. On `preview.error` → its `ApiErrors` message (`role="alert"`) and Back.
3. A `Card` "What changes" listing `changeLines(preview.data.changes, meeting.timezone, text)` (with `text` built from `tFields` like the email's `changeText`) as "Time: Fri 9 Oct, 18:00 → Sat 10 Oct, 18:00" / "Agenda: updated", followed by the organizer-only settings that changed ("Ask for a reason: On → Off", "Allow a comment: Off → On", "Reminder, not answered: 24 h → 6 h", "Reminder, Going and Late: 2 h → Off") from a small local formatter over `reason_required`, `comments_enabled`, `reminder_pending_hours`, `reminder_going_hours`.
4. A `Card` "Who is told": `t("emails", { count: emails })` ("Emails 3 people" / "Nobody is emailed."), `t("calendarOnly", { count })` when `calendarOnly > 0` ("Updates 1 calendar copy"), `t("reconfirm")` when `reconfirm` ("Everyone will be asked to confirm again."), the quota line (`quotaLine({ toSend: emails + calendarOnly, … })`, the Review step's copy), and `t("senderWaiting")` "Emails will wait until Gmail is reconnected." when the sender is missing or broken.
5. The "Email everyone about this change" `SwitchRow`, shown only when the changes touch `MEMBER_VISIBLE_FIELDS` but none of `SCHEDULE_FIELDS`/`PLACE_FIELDS`.
6. A text button **Discard changes** → `ConfirmDialog` "Discard your changes?" / "Nothing has been saved or sent." → `editDraft.clear()` and `router.push` to the meeting page.
7. `WizardFooter`: Back → `goTo(stepBefore(steps, "changes"))`; Next label `emails > 0 ? t("saveAndEmail", { count: emails }) : t("save")`; Next → `emails + calendarOnly > 0 ? setConfirming(true) : commit()`.
8. `ConfirmDialog` title `t("confirmTitle", { count: emails })` ("Save and email 3 people?"), description `reconfirm ? t("confirmReconfirm") : t("confirmBody")` ("They get one email with the changes and are asked to confirm again." / "They get one email with the changes."), `confirmLabel` = the Next label, `pending={save.isPending}`, `onConfirm={commit}`.

```ts
const commit = () =>
  save.mutate({ fields: fields ?? {}, notify }, {
    onSuccess: () => {
      editDraft?.clear();
      toast.success(t("saved"));
      router.push(`/w/${slug}/meetings/${saved.id}`);
    },
    onError: () => setConfirming(false),
  });
```

Save errors show under the cards like the Review step's `send.error` (`tErrors(code)`).

- [ ] **Step 7: Copy** (`messages/en.json`, plain words, `humanizer` pass): `Wizard.steps.changes` "Review changes"; `Wizard.editTitle` "Edit meeting"; `Wizard.responses.locked` "Fixed once sent. To change it, cancel and duplicate the meeting."; `remindPending` "Remind people who haven't answered"; `remindPendingHint` "Before the deadline, or before the start if there is none."; `remindGoing` "Remind Going and Late"; `remindGoingHint` "Before the start."; `Wizard.changes`: `nothing`, `whatChanges`, `whoIsTold`, `emails` ("{count, plural, =0 {Nobody is emailed.} one {Emails # person} other {Emails # people}}"), `calendarOnly`, `reconfirm`, `senderWaiting`, `notify` "Email everyone about this change", `discard`, `discardTitle`, `discardBody`, `save` "Save changes", `saveAndEmail` "{count, plural, one {Save and email # person} other {Save and email # people}}", `confirmTitle`, `confirmBody`, `confirmReconfirm`, `saved` "Changes saved."; `Settings.defaults` gets the same two reminder labels and hints.

- [ ] **Step 8: Verify** — the `vitest` command → PASS; the chained check. Screenshots (`.superpowers/scripts/screens/m6-t10-edit.spec.ts`, built from `m5-t5-meetings.spec.ts`: seed a sent meeting, open `?mode=edit&step=details`, change the time, Next, Next): Details (edit header), Answers with the locked controls and the two reminder rows, Review changes with the lists, the open confirm dialog, and the "Nothing changed yet." state, each at 390 light, 320 dark and 1024; and Settings > Meeting defaults with the reminder rows. Look at them: the six-option reminder control on one line at 320 px, the dialog centered at 1024.

- [ ] **Step 9: Commit, PR, merge** — `feat: edit a sent meeting through the wizard; reminder settings`.

---

### Task 11: Meeting page — "…" menu, Cancel and Delete dialogs, Nudge, To reconfirm tile, Cancelled label

Labels: `area:frontend`. Branch `feat/<issue>-m6-meeting-page`.

**Files:**
- Create: `src/app/w/[slug]/meetings/[id]/meeting-menu.tsx`, `meeting-menu.test.tsx`
- Create: `src/app/w/[slug]/meetings/[id]/nudge-button.tsx`, `nudge-button.test.tsx`
- Modify: `src/app/w/[slug]/meetings/[id]/page.tsx`, `page.test.tsx`, `meeting-header.tsx`, `result-tiles.tsx`, `result-tiles.test.tsx`, `person-row.tsx`, `people-list.test.tsx`
- Modify: `src/app/w/[slug]/meetings/meetings-list.tsx` (Cancelled label on cards), `meetings-list.test.tsx`
- Modify: `messages/en.json` (`MeetingPage.menu.*`, `MeetingPage.cancel.*`, `MeetingPage.delete.*`, `MeetingPage.nudge.*`, `MeetingPage.results.to_reconfirm`, `MeetingPage.results.toReconfirmPill`, `MeetingPage.cancelledOn`, `Meetings.cancelled`)

**Interfaces:**
- Consumes (Task 9): `useCancelMeeting`, `useNudgeMeeting`, `useDeleteMeeting` (M4), `MeetingResults` (`answers.toReconfirm`, `remindable`, `reachable`, `nudge`), `Meeting.cancelledAt`, `PersonRow.answer.needsReconfirmation`; (Task 8) `useDuplicateMeeting`; (Task 10) the edit URL.
- Produces: `MeetingMenu({ slug, meeting, results }: { slug: string; meeting: Meeting; results: MeetingResults | undefined })`; `NudgeButton({ slug, meeting, results }: { slug: string; meeting: Meeting; results: MeetingResults })`; `ResultTiles` shows a fifth tile `to_reconfirm` when `answers.toReconfirm > 0`.

- [ ] **Step 1: Failing tests**

`meeting-menu.test.tsx` (`renderWithProviders`, `routeFetch`, `next/navigation` mocked like `review-step.test.tsx`):
- an Owner on a scheduled meeting that hasn't started sees **Edit**, **Duplicate**, **Cancel meeting**; Edit is a link to `/w/robotics-cd34/meetings/<id>/edit?mode=edit&step=details`;
- after the start: only **Duplicate**;
- a cancelled meeting: **Duplicate** and **Delete**;
- a Viewer: no "…" button at all;
- **Cancel meeting** opens "Cancel this meeting and email 28 people?" (28 = `results.answers.reachable`) with "Everyone invited gets a cancellation email, and it is removed from calendars. This can't be undone." and a danger **Cancel meeting** button; confirming POSTs `…/cancel` and shows the toast "Meeting cancelled. 28 cancellation emails are going out.";
- with `reachable: 0` the title reads "Cancel this meeting?" and the toast "Meeting cancelled.";
- **Delete** opens "Delete this meeting for good?" / "Its answers will be gone. This can't be undone."; confirming sends `DELETE` and navigates to `/w/robotics-cd34/meetings`; a `409 cancel_emails_pending` keeps the dialog open and shows "The cancellation emails are still going out. Try again in a few minutes.";
- **Duplicate** POSTs and navigates to the new draft (shared behaviour with Task 8).

`nudge-button.test.tsx`:
- before the start with `remindable: 6` and no nudge yet → **Remind 6 who haven't answered**; it opens "Email 6 people who haven't answered from club@gmail.com?" (sender email from `useWorkspaceSender`) / "They get a reminder with the answer buttons."; confirming POSTs `…/nudge` and shows "Reminded 6 people.";
- `nudge.nextAt` in the future → the button is replaced by "Reminded 6 at 14:20 · available again at 02:20" (times in the meeting's zone);
- `remindable: 0` → nothing rendered;
- announcement, started or cancelled → nothing rendered;
- no sender → the button is disabled and "Ask Daly to connect Gmail to send reminders." is shown (Review Focus 4).

`result-tiles.test.tsx`: with `toReconfirm: 2` a fifth tile "To reconfirm 2" filters `to_reconfirm`; with 0 it is not shown and the grid stays four columns.

`people-list.test.tsx`: a row whose answer has `needsReconfirmation` shows the answer pill followed by "To reconfirm".

`page.test.tsx`: a cancelled meeting shows "Cancelled on Fri 9 Oct" under the title, no Invite more and no Nudge; the menu is in the header next to Export.

`meetings-list.test.tsx`: a cancelled card shows a "Cancelled" label.

Run: `bunx vitest run meeting-menu nudge-button result-tiles people-list "meetings/\\[id\\]/page" meetings-list` (filter by substring if brackets do not match) → FAIL.

- [ ] **Step 2: `ConfirmDialog` gets a `cancelLabel`** — next to **Cancel meeting**, a dismiss button reading "Cancel" is ambiguous. Add `cancelLabel?: string` (default `t("cancel")`), with a test in `confirm-dialog.test.tsx`; the cancel dialog passes `t("cancel.keep")` "Keep meeting".

- [ ] **Step 3: `MeetingMenu`** (`meeting-menu.tsx`)

```tsx
"use client";

import { DotsThree } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCancelMeeting } from "@/hooks/use-meeting-lifecycle";
import { useDeleteMeeting, useDuplicateMeeting } from "@/hooks/use-meetings";
import { useWorkspace } from "@/hooks/use-workspace";
import { ApiClientError } from "@/lib/api-client";
import type { Meeting } from "@/shared/api/meetings";
import type { MeetingResults } from "@/shared/api/responses";

/** The meeting page's "…" (spec §7.5, §7.9): Edit, Duplicate, Cancel meeting, Delete. Owners and Admins. */
export function MeetingMenu({
  slug,
  meeting,
  results,
}: {
  slug: string;
  meeting: Meeting;
  results: MeetingResults | undefined;
}) {
  const t = useTranslations("MeetingPage");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const workspace = useWorkspace(slug);
  const cancel = useCancelMeeting(slug, meeting.id);
  const remove = useDeleteMeeting(slug);
  const duplicate = useDuplicateMeeting(slug);
  const [dialog, setDialog] = useState<"cancel" | "delete" | null>(null);
  if (!workspace.data || workspace.data.myRole === "viewer") {
    return null;
  }
  const started = meeting.startsAt !== null && new Date(meeting.startsAt) <= new Date();
  const open = meeting.status === "scheduled" && !started;
  const reachable = results?.answers.reachable ?? 0;
  const errorOf = (error: Error | null) =>
    error instanceof ApiClientError ? tErrors(error.code) : error ? tErrors("internal") : null;
  const copy = () =>
    duplicate.mutate(meeting.id, {
      onSuccess: ({ id }) => {
        toast.success(t("menu.duplicated"));
        router.push(`/w/${slug}/meetings/${id}/edit?step=details`);
      },
      onError: (error) => toast.error(errorOf(error) ?? tErrors("internal")),
    });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("menu.label")}
          className="inline-flex size-11 items-center justify-center rounded-control"
        >
          <DotsThree weight="bold" aria-hidden className="size-6" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {open ? (
            <DropdownMenuItem
              onSelect={() => router.push(`/w/${slug}/meetings/${meeting.id}/edit?mode=edit&step=details`)}
            >
              {t("menu.edit")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={copy}>{t("menu.duplicate")}</DropdownMenuItem>
          {open ? (
            <DropdownMenuItem onSelect={() => setDialog("cancel")}>{t("menu.cancel")}</DropdownMenuItem>
          ) : null}
          {meeting.status === "cancelled" ? (
            <DropdownMenuItem onSelect={() => setDialog("delete")}>{t("menu.delete")}</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(next) => setDialog(next ? "cancel" : null)}
        title={reachable > 0 ? t("cancel.title", { count: reachable }) : t("cancel.titleNobody")}
        description={t("cancel.body")}
        confirmLabel={t("cancel.confirm")}
        cancelLabel={t("cancel.keep")}
        tone="danger"
        pending={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(undefined, {
            onSuccess: ({ emails }) => {
              setDialog(null);
              toast.success(emails > 0 ? t("cancel.done", { count: emails }) : t("cancel.doneNobody"));
            },
          })
        }
      >
        {cancel.error ? <p role="alert" className="font-bold">{errorOf(cancel.error)}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(next) => setDialog(next ? "delete" : null)}
        title={t("delete.title")}
        description={t("delete.body")}
        confirmLabel={t("delete.confirm")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate(meeting.id, { onSuccess: () => router.push(`/w/${slug}/meetings`) })}
      >
        {remove.error ? <p role="alert" className="font-bold">{errorOf(remove.error)}</p> : null}
      </ConfirmDialog>
    </>
  );
}
```

`DropdownMenuItem` takes `onSelect` (as in the M4 `DraftMenu`), and `DropdownMenuContent` already carries the padded classes and `collisionPadding` 16. `copy`'s `onError` must pass a string: `toast.error(errorOf(error) ?? tErrors("internal"))`.

- [ ] **Step 4: `NudgeButton`** (`nudge-button.tsx`)

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useNudgeMeeting } from "@/hooks/use-meeting-lifecycle";
import { useWorkspaceSender } from "@/hooks/use-sender";
import { formatTime } from "@/lib/meetings/format";
import type { Meeting } from "@/shared/api/meetings";
import type { MeetingResults } from "@/shared/api/responses";

/** "Remind N who haven't answered" (spec §7.6 Nudge): once every 12 hours, after a confirm dialog. */
export function NudgeButton({ slug, meeting, results }: { slug: string; meeting: Meeting; results: MeetingResults }) {
  const t = useTranslations("MeetingPage.nudge");
  const sender = useWorkspaceSender(slug);
  const nudge = useNudgeMeeting(slug, meeting.id);
  const [confirming, setConfirming] = useState(false);
  const started = meeting.startsAt !== null && new Date(meeting.startsAt) <= new Date();
  if (meeting.status !== "scheduled" || started || meeting.responseMode === "announcement") {
    return null;
  }
  const { lastAt, lastCount, nextAt } = results.nudge;
  if (lastAt && nextAt && new Date(nextAt) > new Date()) {
    return (
      <p className="text-sm text-muted-ink">
        {t("done", {
          count: lastCount ?? 0,
          at: formatTime(lastAt, meeting.timezone),
          next: formatTime(nextAt, meeting.timezone),
        })}
      </p>
    );
  }
  const count = results.answers.remindable;
  if (count === 0) {
    return null;
  }
  const connection = sender.data?.sender ?? null;
  const usable = connection?.status === "active";
  return (
    <div className="flex flex-col gap-1">
      <Button className="justify-center" disabled={!usable} onClick={() => setConfirming(true)}>
        {t("action", { count })}
      </Button>
      {!usable && sender.data ? (
        <p className="text-sm font-bold">{t("askOwner", { owner: sender.data.ownerName })}</p>
      ) : null}
      {connection ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t("confirmTitle", { count, email: connection.email })}
          description={t("confirmBody")}
          confirmLabel={t("confirm")}
          pending={nudge.isPending}
          onConfirm={() =>
            nudge.mutate(undefined, {
              onSuccess: ({ reminded }) => {
                setConfirming(false);
                toast.success(t("sent", { count: reminded }));
              },
              onError: () => setConfirming(false),
            })
          }
        />
      ) : null}
    </div>
  );
}
```

`formatTime(iso, zone)`: add to `src/lib/meetings/format.ts` as `/** "14:20" in the meeting's zone. */` (`format(new TZDate(iso, timezone), "HH:mm")`), with a unit test, and use it for the time part of `formatDeadline` (DRY).

- [ ] **Step 5: Page, header, tiles, rows, cards**
- `page.tsx`: `actions={<div className="flex gap-2">{export}<MeetingMenu slug={slug} meeting={meeting.data} results={results.data} /></div>}`; under the tiles, for Owners/Admins: `<NudgeButton …/>` above Invite more; nothing of either for cancelled meetings.
- `meeting-header.tsx`: when `meeting.status === "cancelled"`, a pill "Cancelled on {date}" (`formatDeadline(meeting.cancelledAt, meeting.timezone)`'s date part; `bg-fill-danger/25` container tint in dark mode per the M5 lesson, text in `text-ink`).
- `result-tiles.tsx`: when `answers.toReconfirm > 0`, append `{ filter: "to_reconfirm", count: answers.toReconfirm, fill: "bg-fill-warning" }` (RSVP and attendance) and switch the grid to `md:grid-cols-5`/`md:grid-cols-4` by tile count (compute `md:grid-cols-${n}` from a fixed class map so Tailwind sees each class name).
- `person-row.tsx` `AnswerPill`: after the pill, `person.answer.needsReconfirmation` → `<span className="ml-1 text-xs font-bold">{t("toReconfirmPill")}</span>` ("To reconfirm").
- `meetings-list.tsx`: a cancelled card gets a "Cancelled" label where the status line goes (`meeting-status-line.tsx`), and no answer counts line.

- [ ] **Step 6: Copy** — `MeetingPage.menu` (`label` "Meeting actions", `edit` "Edit", `duplicate` "Duplicate", `cancel` "Cancel meeting", `delete` "Delete", `duplicated` "Copy created. Pick a date."); `MeetingPage.cancel` (`keep` "Keep meeting", `title` "{count, plural, one {Cancel this meeting and email # person?} other {Cancel this meeting and email # people?}}", `titleNobody` "Cancel this meeting?", `body` "Everyone invited gets a cancellation email, and it is removed from calendars. This can't be undone.", `confirm` "Cancel meeting", `done` "{count, plural, one {Meeting cancelled. # cancellation email is going out.} other {Meeting cancelled. # cancellation emails are going out.}}", `doneNobody` "Meeting cancelled."); `MeetingPage.delete` (`title` "Delete this meeting for good?", `body` "Its answers will be gone. This can't be undone.", `confirm` "Delete"); `MeetingPage.nudge` (`action` "{count, plural, one {Remind # who hasn't answered} other {Remind # who haven't answered}}", `confirmTitle` "{count, plural, one {Email # person who hasn't answered from {email}?} other {Email # people who haven't answered from {email}?}}", `confirmBody` "They get a reminder with the answer buttons.", `confirm` "Send reminders", `sent` "{count, plural, one {Reminded # person.} other {Reminded # people.}}", `done` "Reminded {count} at {at} · available again at {next}", `askOwner` "Ask {owner} to connect Gmail to send reminders."); `MeetingPage.results.to_reconfirm` "To reconfirm"; `MeetingPage.results.toReconfirmPill` "To reconfirm"; `MeetingPage.cancelledOn` "Cancelled on {date}"; `Meetings.cancelled` "Cancelled". Run the `humanizer` pass on these strings.

- [ ] **Step 7: Verify** — `vitest` → PASS; the chained check. Screenshots (`m6-t11-meeting-page.spec.ts`): the open menu (scheduled, started, cancelled), the Cancel dialog, the Delete dialog, the Nudge button, its confirm dialog and the "Reminded …" line, the To reconfirm tile with a filtered list, a cancelled meeting page, and the Meetings list with a cancelled card — 390 light, 320 dark, 1024. Check the five tiles at 320 px (two columns, no overflow) and the dialogs centered at 1024.

- [ ] **Step 8: Commit, PR, merge** — `feat: meeting page actions — edit, duplicate, cancel, delete, nudge; to reconfirm`.

---

### Task 12: Answer page — "The time changed", "Yes, still going"

Labels: `area:frontend`. Branch `feat/<issue>-m6-reconfirm-page`.

**Files:**
- Create: `src/app/r/[token]/reconfirm-banner.tsx`, `reconfirm-banner.test.tsx`
- Modify: `src/app/r/[token]/answer-view.tsx`, `answer-view.test.tsx`, `src/shared/api/tokens.ts` (the answer already carries `needsReconfirmation` from Task 9's `answerSchema`), `messages/en.json` (`AnswerPage.reconfirm*`)

**Interfaces:**
- Consumes (Task 6/9): `TokenInfo.answer.needsReconfirmation`; `useSubmitAnswer` (M5); `describeAnswer`, `useAnswerLabels` (M5); `formatMeetingWhen` (M4).
- Produces: `ReconfirmBanner({ info, pending, onConfirm, onChange }: { info: TokenInfo; pending: boolean; onConfirm(): void; onChange(): void })`; `lowerFirst(text: string): string` in `src/lib/responses/describe-answer.ts` ("Going" → "going" inside a sentence; Task 14 reuses it), with a unit test.

- [ ] **Step 1: Failing tests** (`answer-view.test.tsx`, the file's token mock):

```tsx
it("asks to confirm the same answer after a time change", async () => {
  mockToken({ ...tokenInfoFixture, answer: { ...goingAnswer, needsReconfirmation: true } });
  renderAnswerView();
  expect(await screen.findByText("The time changed to Sat 10 Oct, 18:00.")).toBeInTheDocument();
  expect(screen.getByText("You said: Going.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Yes, still going" }));
  expect(lastPutBody()).toEqual({ status: "attending", delayMinutes: null, reason: "", comment: "" });
  expect(await screen.findByText("Your answer: Going")).toBeInTheDocument();
});

it("keeps the delay and the reason when Late confirms again", async () => {
  mockToken({ ...tokenInfoFixture, answer: { ...lateAnswer, needsReconfirmation: true } });
  renderAnswerView();
  await userEvent.click(await screen.findByRole("button", { name: "Yes, still late by 10 min" }));
  expect(lastPutBody()).toEqual({ status: "late", delayMinutes: 10, reason: "Bus", comment: "" });
});

it("lets the member pick another answer instead", async () => {
  mockToken({ ...tokenInfoFixture, answer: { ...goingAnswer, needsReconfirmation: true } });
  renderAnswerView();
  await userEvent.click(await screen.findByRole("button", { name: "Change my answer" }));
  expect(screen.getByRole("radio", { name: /I can't come/ })).toBeInTheDocument();
});

it("shows no banner once the meeting has started", async () => {
  mockToken({ ...startedFixture, answer: { ...goingAnswer, needsReconfirmation: true } });
  renderAnswerView();
  expect(await screen.findByText("Answers are closed.")).toBeInTheDocument();
  expect(screen.queryByText(/The time changed/)).toBeNull();
});
```

(`goingAnswer`, `lateAnswer`, `startedFixture`, `lastPutBody` are small additions to the test file's fixtures; "Yes, still can't come" covers Absent through the same label builder.)

Run: `bunx vitest run answer-view reconfirm-banner` → FAIL.

- [ ] **Step 2: `ReconfirmBanner`** — a `Card` with `bg-fill-warning/25` (dark-mode tint rule): `t("reconfirmChanged", { when: \`${when.date}, ${when.start}\` })`, `t("reconfirmYouSaid", { answer: describeAnswer(labels, answer) })`, a primary **Yes, still {answer}** button (`t("reconfirmYes", { answer: lowerFirst(describeAnswer(…)) })`, `pending` disables it) and a text button **Change my answer**. `answer-view.tsx`: when `!closed && answer?.needsReconfirmation && !editing && !justSaved`, render the banner instead of the saved-answer summary; `onConfirm` calls `save({ status: answer.status, delayMinutes: answer.delayMinutes, reason: answer.reason, comment: answer.comment })` (the same body; the database clears the flag, Task 6); `onChange` calls `setEditing(true)`. The CONFIRMED stamp plays as after any save.

- [ ] **Step 3: Copy** — `AnswerPage.reconfirmChanged` "The time changed to {when}.", `reconfirmYouSaid` "You said: {answer}.", `reconfirmYes` "Yes, still {answer}", `reconfirmChange` "Change my answer".

- [ ] **Step 4: Verify** — `vitest` → PASS; the chained check. Screenshots (`m6-t12-reconfirm.spec.ts`: seed a sent meeting, answer Going through the token, then `edit_sent_meeting` a new time as the Owner via the service client): the banner and the state after "Yes, still going", at 390 light, 320 dark, 1024.

- [ ] **Step 5: Commit, PR, merge** — `feat: members confirm their answer again after a time change`.

---

### Task 13: Check-in — API, hooks, Results / Check-in switch

Labels: `area:api`, `area:frontend`. Branch `feat/<issue>-m6-check-in`.

**Files:**
- Create: `src/server/queries/check-in.ts`
- Create: `src/app/api/workspaces/[slug]/meetings/[id]/check-in/route.ts` (`PUT`), `…/check-in/rest/route.ts` (`POST`), a `route.test.ts` next to each
- Create: `src/hooks/use-check-in.ts`, `use-check-in.test.tsx`
- Create: `src/lib/responses/check-in.ts`, `check-in.test.ts`
- Create: `src/app/w/[slug]/meetings/[id]/check-in-list.tsx`, `check-in-row.tsx`, `check-in-list.test.tsx`
- Modify: `src/shared/api/responses.ts` (`markBodySchema`, `markResultSchema`, `markRestResultSchema`), `src/app/w/[slug]/meetings/[id]/page.tsx`, `messages/en.json` (`MeetingPage.checkIn.*`)

**Interfaces:**
- Consumes (Task 7): `mark_attendance`, `mark_rest_as_declared`; (Task 9) `markSchema`, `Mark`, `meeting_people` `mark` + `p_search`, `useMeetingPeople(…, search)`, `meetingResultsKey`, `meetingPeopleKey`, `MeetingResults.checkedIn`; (M2) `WorkspaceDetails.myRole`/`canCheckIn`.
- Produces:
  - `markBodySchema = z.object({ inviteeId: z.uuid(), actual: z.enum(["present", "late", "absent"]).nullable() })`, `markResultSchema = z.object({ mark: markSchema.nullable() })`, `markRestResultSchema = z.object({ marked: z.number().int() })`.
  - `PUT …/meetings/[id]/check-in` → `{ mark }`; `POST …/meetings/[id]/check-in/rest` → `{ marked }`. A Viewer **with** check-in passes the route; the database is the gate (403 `forbidden`, 409 `check_in_closed`).
  - `markAttendance(client, meetingId, inviteeId, actual)`, `markRestAsDeclared(client, meetingId)`.
  - `useMarkAttendance(slug, id)` (optimistic, one request at a time per person), `useMarkRest(slug, id)`.
  - `canCheckIn(workspace: WorkspaceDetails): boolean` (Owner, Admin, or Viewer with `canCheckIn`; DB twin `private.can_check_in`); `declaredActual(answer: AnswerStatus | null): Mark["actual"] | null` (Going → present, Late → late, Absent/Not going → absent, no reply → null for the hint; DB twin `mark_rest_as_declared`, which marks no reply as absent).

- [ ] **Step 1: Failing tests**

`check-in.test.ts` (lib): `declaredActual` for all four statuses and null; `canCheckIn` for owner, admin, viewer, viewer with `canCheckIn`.

Route tests: `PUT` with a Viewer **with** `canCheckIn` reaches `markAttendance`; a plain Viewer → 403 without calling it; bad body → 400; DB `tn:check_in_closed` → 409. `POST …/rest` → `{ marked: 3 }`; cross-origin → 403.

`use-check-in.test.tsx`:
- `useMarkAttendance` sets the person's `mark` in every cached `meeting-people` page at once (optimistic), rolls it back on an error, and invalidates `meetingResultsKey` on success;
- two quick calls for the same person send the second `PUT` only after the first resolves, and the final cached mark is the second one (rapid taps never end in the wrong state);
- calls for two different people run in parallel.

`check-in-list.test.tsx` (meeting started an hour ago, three people: Going, Late 10, no reply):
- each row shows Present / Late / Absent chips; the Going row's **Present** chip has the dashed hint and is not pressed;
- tapping **Absent** on the Going row presses it at once and PUTs `{ inviteeId, actual: "absent" }`; the row shows "Said going";
- tapping the pressed chip again clears the mark (`actual: null`);
- the count line reads "1 of 3 checked in" after one mark (from `results.checkedIn` / `results.emails.total`);
- **Mark the rest as they said** opens "Mark everyone not checked in yet?" / "People are marked from their answer. People who didn't answer are marked Absent." and POSTs `…/check-in/rest`;
- the search box filters by name (debounced 250 ms; the request carries `search=`);
- a failed PUT shows "Couldn't save. Try again." on that row and the chip goes back.

`page.test.tsx`: after the start, an Owner and a check-in Viewer see the **Results / Check-in** switch; a plain Viewer does not; before the start, an announcement, or a cancelled meeting → no switch.

Run: `bunx vitest run check-in use-check-in "meetings/\\[id\\]/page"` → FAIL.

- [ ] **Step 2: Lib, queries, routes**

```ts
// src/lib/responses/check-in.ts
import type { AnswerStatus, Mark } from "@/shared/api/responses";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Who may check people in (spec §7.8). DB twin: `private.can_check_in`. */
export function canCheckIn(workspace: WorkspaceDetails): boolean {
  return workspace.myRole !== "viewer" || workspace.canCheckIn;
}

const DECLARED: Record<AnswerStatus, Mark["actual"]> = {
  attending: "present", late: "late", absent: "absent", not_attending: "absent",
};

/**
 * The check-in an answer suggests (the dashed hint). No reply suggests nothing here; "Mark the
 * rest as they said" marks it Absent (DB twin: `private.mark_rest_as_declared`).
 */
export function declaredActual(answer: AnswerStatus | null): Mark["actual"] | null {
  return answer ? DECLARED[answer] : null;
}
```

`src/server/queries/check-in.ts`: `markAttendance` calls `client.rpc("mark_attendance", { p_meeting, p_invitee, p_actual: sqlNullable(actual) })` and maps `{ actual, marked_at, marked_by_name }` → `Mark` (or null); `markRestAsDeclared` returns the integer.

Routes follow `nudge/route.ts`, except the role gate: `if (!canCheckIn(context.workspace)) return apiError("forbidden");` instead of `forbidViewer`.

- [ ] **Step 3: Hooks** (`src/hooks/use-check-in.ts`)

```ts
"use client";

import { type InfiniteData, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { meetingPeopleKey, meetingResultsKey } from "@/hooks/use-results";
import { apiRequest } from "@/lib/api-client";
import type { Page } from "@/shared/api/pagination";
import { type Mark, markRestResultSchema, markResultSchema, type PersonRow } from "@/shared/api/responses";

type MarkInput = { inviteeId: string; actual: Mark["actual"] | null };
type PeoplePages = InfiniteData<Page<PersonRow>>;

/** Check one person in (spec §7.8): shown at once, sent one request at a time per person. */
export function useMarkAttendance(slug: string, id: string) {
  const queryClient = useQueryClient();
  const chains = useRef(new Map<string, Promise<void>>());
  const setMark = (inviteeId: string, mark: Mark | null) =>
    queryClient.setQueriesData<PeoplePages>({ queryKey: meetingPeopleKey(slug, id) }, (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((person) => (person.inviteeId === inviteeId ? { ...person, mark } : person)),
        })),
      });
  return useMutation({
    mutationFn: (input: MarkInput) => {
      const previous = chains.current.get(input.inviteeId) ?? Promise.resolve();
      const request = previous.then(() =>
        apiRequest(`/api/workspaces/${encodeURIComponent(slug)}/meetings/${id}/check-in`, {
          method: "PUT", body: input, schema: markResultSchema,
        }),
      );
      chains.current.set(input.inviteeId, request.then(() => undefined, () => undefined));
      return request;
    },
    onMutate: (input) => {
      const before = queryClient.getQueriesData<PeoplePages>({ queryKey: meetingPeopleKey(slug, id) });
      setMark(input.inviteeId, input.actual ? { actual: input.actual, markedAt: new Date().toISOString(), markedByName: null } : null);
      return { before };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.before ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: (result, input) => {
      setMark(input.inviteeId, result.mark);
      void queryClient.invalidateQueries({ queryKey: meetingResultsKey(slug, id) });
    },
  });
}

/** "Mark the rest as they said" (spec §7.8). */
export function useMarkRest(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`/api/workspaces/${encodeURIComponent(slug)}/meetings/${id}/check-in/rest`, {
        method: "POST", body: {}, schema: markRestResultSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: meetingPeopleKey(slug, id) });
      void queryClient.invalidateQueries({ queryKey: meetingResultsKey(slug, id) });
    },
  });
}
```

(`usePagedList` stores `useInfiniteQuery` data under `[...meetingPeopleKey(slug, id), filter, params, limit]`, one `Page<PersonRow>` per page, so `setQueriesData` with the `meetingPeopleKey` prefix reaches every filter and search. `_error` and `_input` come before the used `context`, which `@typescript-eslint/no-unused-vars`' default `args: "after-used"` allows.)

- [ ] **Step 4: UI**
- `check-in-row.tsx`: name (`PersonName`), a small line with the declared answer (`describeAnswer`, or "No reply") and, when a mark exists and differs from the hint, "Said going" style text; three `Chip`s in a `CHIP_ROW_CLASS` row (`role="group"` labelled "Check-in for {name}"), each ≥ 44 px, `pressed={person.mark?.actual === value}`, the hinted one (no mark yet) with `border-dashed`; `onPressedChange` → `mark.mutate({ inviteeId, actual: pressed ? null : value })`; a row-level error line on failure.
- `check-in-list.tsx`: a `Card` with the count line `t("count", { done: results.checkedIn, total: results.emails.total })`, the search `Input` (label "Search people", debounced 250 ms, `search` passed to `useMeetingPeople(slug, id, "all", true, search || null)`), the rows (`content-visibility:auto` with `contain-intrinsic-size`, like the people list), `ShowMore`, and **Mark the rest as they said** (`ConfirmDialog` per Step 1's copy; then `toast.success(t("restDone", { count: marked }))`).
- `page.tsx`: when `meeting.status === "scheduled" && started && meeting.responseMode !== "announcement" && canCheckIn(workspace)`, a `SegmentedControl` **Results / Check-in** above the tiles; Check-in shows `CheckInList` instead of the tiles and the people list. Remember the choice in `sessionStorage` per meeting (try/catch) so a reload stays on Check-in at the door.

The button has no count (owner decision 2026-10-09): the dialog explains what happens, the toast says how many were marked, and the count line above already reads "18 of 30 checked in".

- [ ] **Step 5: Copy** — `MeetingPage.checkIn`: `switchResults` "Results", `switchCheckIn` "Check-in", `count` "{done} of {total} checked in", `present` "Present", `late` "Late", `absent` "Absent", `group` "Check-in for {name}", `said` "Said {answer}", `noReply` "No reply", `search` "Search people", `rest` "Mark the rest as they said", `restTitle` "Mark everyone not checked in yet?", `restBody` "People are marked from their answer. People who didn't answer are marked Absent.", `restConfirm` "Mark the rest", `restDone` "{count, plural, one {Marked # person.} other {Marked # people.}}", `saveFailed` "Couldn't save. Try again."

- [ ] **Step 6: Verify** — `vitest` → PASS; the chained check. Screenshots (`m6-t13-check-in.spec.ts`: a started meeting with 60 invitees, mixed answers, some marks): the switch, the list with hints and marks, the search, the "Mark the rest" dialog, at 390 light, 320 dark, 1024. At 320 px the three chips fit next to each other under the name; nothing scrolls sideways.

- [ ] **Step 7: Commit, PR, merge** — `feat: check people in after the start`.

---

### Task 14: History, Attendance and exports show check-in

Labels: `area:frontend`, `area:api`. Branch `feat/<issue>-m6-declared-vs-actual`.

**Files:**
- Create: `src/lib/responses/effective-status.ts`, `effective-status.test.ts`
- Modify: `src/shared/api/responses.ts` (`historyItemSchema.mark`, `attendanceDetailRowSchema.mark`), `src/server/queries/results.ts` (map `mark` in `getContactHistory` and `listAttendanceDetails`)
- Modify: `src/app/w/[slug]/lists/contact-history.tsx` (the person sheet's history rows) and its test
- Modify: `src/lib/export/rows.ts`, `rows.test.ts`, `src/app/w/[slug]/meetings/[id]/use-export-answers.ts`, `src/app/w/[slug]/lists/use-export-attendance.ts`, `messages/en.json` (`Export.columns.checkedIn`, `Export.columns.checkedInBy`, `Export.actual.*`, `History.saidWas`)

**Interfaces:**
- Consumes (Task 7): the `mark` objects and the effective counts from `contact_history`, `attendance_summary`, `attendance_details`; (Task 9) `markSchema`, `PersonRow.mark`.
- Produces: `effectiveStatus(mark: Mark | null, answer: { status: AnswerStatus } | null): "attending" | "late" | "absent" | null` (DB twin `private.effective_status`); `describeCheckIn(labels, answer, mark): string` in `src/lib/responses/describe-answer.ts` ("Said going · Was absent", "Was present" for no reply, the plain answer when there is no mark or they agree); export columns **Checked in** and **Checked in by** after **Email** in meeting answers and Attendance details.

- [ ] **Step 1: Failing tests**
- `effective-status.test.ts`: mark wins (`absent` mark + `attending` answer → `absent`); no mark → answer (`not_attending` → `absent`); neither → null.
- `describe-answer.test.ts`: `describeCheckIn` for agree / disagree / no reply + present / no mark.
- History component test: a past meeting where the person said Going and was marked Absent shows "Said going · Was absent"; the period counts come from the server unchanged.
- `rows.test.ts`: `meetingAnswerRows` adds `"Absent"` and `"Amira Ben Ali"` at the end of a marked row and two empty cells for an unmarked one; `attendanceDetailRows` the same; the header arrays in `use-export-answers.ts` and `use-export-attendance.ts` gain the two column names (snapshot of the header row).
- Excel: with the `xlsx` skill, open a generated file in a scratch test and check the two new columns are text cells.

Run: `bunx vitest run effective-status describe-answer rows history use-export` → FAIL.

- [ ] **Step 2: Implement**

```ts
// src/lib/responses/effective-status.ts
import type { AnswerStatus, Mark } from "@/shared/api/responses";

const FROM_MARK = { present: "attending", late: "late", absent: "absent" } as const;

/** What counts for one person and meeting (spec §7.7): the check-in, else the answer. DB twin: `private.effective_status`. */
export function effectiveStatus(
  mark: Mark | null,
  answer: { status: AnswerStatus } | null,
): "attending" | "late" | "absent" | null {
  if (mark) {
    return FROM_MARK[mark.actual];
  }
  if (!answer) {
    return null;
  }
  return answer.status === "not_attending" ? "absent" : answer.status;
}
```

`describeCheckIn(labels, answer, mark)`: no mark → `describeAnswer(labels, answer)` (or "No reply"); a mark that matches `declaredActual(answer?.status ?? null)` → the plain answer; otherwise `t("History.saidWas", { said: lowerFirst(describeAnswer(…)) or "didn't answer", was: label(mark.actual) })` → "Said going · Was absent" / "Didn't answer · Was present".

Export rows: append `mark ? text.actual(mark.actual) : ""` and `mark?.markedByName ?? ""` to both row builders; `ExportText` gains `actual: (value: Mark["actual"]) => string`.

- [ ] **Step 3: Verify** — `vitest` → PASS; chained check; `bun run test:db` (the reads changed in Task 7 are exercised by the DB-backed query tests). Screenshots: the person sheet history with a "Said going · Was absent" row, and the Attendance view, at 390 light, 320 dark, 1024. Export one CSV and one Excel file from the meeting page and from Attendance, open both (Excel through the `xlsx` skill's reader), and check the two new columns.

- [ ] **Step 4: Commit, PR, merge** — `feat: History, Attendance and exports show who actually came`.

---

### Task 15: Rollout — e2e story, final review, production check, spec §14 evidence

Labels: `area:infra`, `area:frontend`. Branch `test/<issue>-m6-e2e` (the e2e PR), then a docs PR for §14.

**Files:**
- Create: `e2e/m6-lifecycle.spec.ts`
- Modify: `e2e/helpers/meetings.ts` (+ `dueTimers(meetingId)` to make a meeting's reminder timers due, `editMeetingThroughUi`)
- Modify: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§14 M6 evidence)

- [ ] **Step 1: The e2e story** (phone viewport, fake Gmail; `calendar_confirm_delay_seconds` is already 1 in e2e, so `update` jobs are due after 1 s too)
1. Owner workspace with two members A and B (`seedRoster`, `seedSender`); send a meeting for tomorrow 18:00 with reminders 24 h / 2 h (`sendMeetingThroughUi`, then set the reminder rows before Review).
2. A opens the email's "I'm going" link and confirms; `dispatchAndRead` → A's calendar email (`METHOD:REQUEST`, `SEQUENCE:0`).
3. Owner: meeting page → "…" → Edit → Details: time 19:00 → Next → Next → Review changes shows "Time: … 18:00 → … 19:00", "Emails 2 people", "Everyone will be asked to confirm again." → **Save and email 2 people** → confirm. `dispatchAndRead` → A gets one email "Changed: …" whose `.ics` is `METHOD:REQUEST` with `SEQUENCE:1` and `DTSTART` at 19:00 local; B gets "Changed: …" with no calendar part.
4. The meeting page shows the **To reconfirm 1** tile. A opens their link → "The time changed to …, 19:00." → **Yes, still going** → CONFIRMED; the tile disappears and Going shows 1.
5. `dueTimers(meeting)` makes the "not answered" timer due; `dispatchAndRead` → only B gets "Reminder: …" with the answer buttons.
6. Owner taps **Remind 1 who hasn't answered** → confirm → B gets a second reminder; the button turns into "Reminded 1 at …".
7. Owner: "…" → **Cancel meeting** → "Cancel this meeting and email 2 people?" → confirm → `dispatchAndRead` → A's cancellation carries `METHOD:CANCEL`, B's has no calendar part; the page shows "Cancelled on …"; "…" → **Delete** works once the emails are out.
8. A second meeting seeded as started an hour ago with A (Going) and B (no reply) (`seedPastMeetingWithAnswer`); a Viewer with check-in signs in → Check-in → marks A Absent → **Mark the rest as they said** → B Absent; the Viewer exports the meeting's CSV and it has "Checked in" = "Absent" for both and "Checked in by" = the Viewer's name; A's person sheet shows "Said going · Was absent".
9. Owner duplicates the started meeting from its "…" → lands on the new draft's Details with an empty date.

Run `bun run test:e2e` (all 70+ tests, not only the new one). Stop any running `next start` first.

- [ ] **Step 2: Final review** — `superpowers:requesting-code-review` with a **fresh** reviewer (`model: "opus"`) over the whole M6 diff (`git diff <M6 start>..main`), then `superpowers:receiving-code-review`. Fix Critical and Important findings in follow-up PRs; collect Minor ones in one "M6 minors" issue under epic #8 (or the next epic). Record every decision as a `Ruling:`.

- [ ] **Step 3: Production check (owner present)** — ask with AskUserQuestion before any production send. From localhost against preview, then on production, in the Owner's **test** workspace (never the club's), send a meeting to the Owner's four S2 inboxes only; in Gmail, Outlook.com and the university inbox tap Yes once on the first calendar email; then:
1. move the meeting by an hour → each calendar event moves (no duplicate), each inbox gets one "Changed:" email;
2. answer from two inboxes, leave two unanswered, make the "not answered" timer due (`dueTimers` via the service client on the right project) → only the two unanswered inboxes get the reminder;
3. cancel → the events disappear;
4. on a started test meeting, check people in and export Excel (Checked in columns).
Record what each inbox did (counts and client names only; no addresses) for §14. Check Sentry (`mcp__plugin_sentry_sentry__search_issues`, project `tapnshow`, last 24 h) and `supabase db advisors --linked` on both projects.

- [ ] **Step 4: Close M6** — spec §14 M6 row "Done <date>: …" with the evidence (e2e count, DB and unit counts, the production check, Sentry, advisors, review outcome); a comment on epic #8 with every `Ruling:`; close the task issues, #213 and epic #8; close the milestone `M6 Lifecycle & reminders`; update the memory `m5-done-open-items` (rename to what is still open after M6) and add a one-line pointer in `MEMORY.md`.

- [ ] **Step 5: Commit, PR, merge** — `test: M6 e2e story` and `docs: M6 done (spec §14 evidence)`.

---

## Self-review notes (plan author)

- **Spec coverage:** §4 Edits after sending → Tasks 6, 9, 10; Cancel and delete → Tasks 6, 9, 11; Reminders → Tasks 4, 5, 2, 3, 10, 11; Check-in → Tasks 7, 13, 14; Meeting wizard (reminders in Answers) → Task 10; §6 columns and tables → Task 4; Access pattern (M6) → Tasks 5–8; §7.3 time changed / cancelled → Task 12 (cancelled copy already exists from M5); §7.5 → Tasks 6, 9–11; §7.6 → Tasks 4, 5, 2, 3, 10, 11; §7.7 → Task 14; §7.8 → Tasks 7, 13; §7.9 → Task 8; §8 update/cancel/reminder → Tasks 5, 3; §12 M6 tests → spread through every task plus Task 15; §14 → Task 15; #213 → Task 1.
- **Order risk found while writing:** the TypeScript dispatcher's claim schema rejects unknown job kinds, so Tasks 2 and 3 go before the migrations that create them (see Execution Order).
- **Decided in the plan review (owner, 2026-10-09):** the Meetings cards keep counting people's last answer while they are still to reconfirm (only the meeting page splits them out); the "Mark the rest as they said" button has no count; the check-in search ignores accents (`unaccent`, Task 6); a reminder that already went out is scheduled again when the meeting moves to a time whose reminder is still ahead (Task 5 `sync_reminder_timers`, Task 6 test 1).
- **After the plan review:** mockups and side-by-side choices for the M6 screens (owner's milestone routine) before Task 10 starts; any change they bring is written back into Tasks 10–14 first.
