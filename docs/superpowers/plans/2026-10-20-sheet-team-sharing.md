# Sharing the Google Sheet with the team: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TapNShow shares a workspace's Google Sheet, view only, with the workspace's team and keeps access in step with the team (join → access, leave → no access, within about a minute), and removes the access it gave before it lets go of its Google access.

**Architecture:** The database holds the wanted state (the team, one SQL function), what TapNShow did (`sheet_shares`), and what is still to undo (`sheet_share_cleanups`); statement triggers mark work due, so no route has to remember anything. The existing Sheet worker lane gets two steps after the redraw: reconcile a sheet's shares against Drive (`permissions.list` first, so nobody is emailed twice), and finish cleanups (remove, then release and revoke). A pure planner decides every per-person action; a database flag keeps the feature dark until Google approves the verification.

**Tech Stack:** Postgres (Supabase, plpgsql, RLS, statement triggers), Next.js API routes, TanStack Query, Zod, next-intl, Vitest, Playwright, plain `fetch` to Drive v3 (no `googleapis`).

**Spec:** `docs/superpowers/specs/2026-10-20-sheet-team-sharing-design.md` (approved 2026-10-20; spike results in its §4).

## Global Constraints

- Team only (`workspace_roles`: owner, admin, viewer); never contacts or invited people (design §2).
- Role `reader`; Google's notification email on (`sendNotificationEmail` default true); never a second `permissions.create` for an address that already has access (the spike: Google returns the same permission id but emails the person again).
- Only permissions TapNShow created are ever deleted; hand shares are never touched (design §2).
- No new Google scope: `DRIVE_FILE_SCOPE` only (`src/config/sheets.ts`).
- A per-person Google refusal never pauses the sheet; only file-level failures use the existing pause rules (design §5).
- Off until switched on: `private.app_flags` row `sheet_team_sharing` (false) is the one switch for the database, the worker and the UI.
- Limits in `private.app_limits` (`sheet_team_shares_max` = 500); client and worker tuning in `src/config/sheets.ts`; no hardcoded values elsewhere.
- Every user-facing string in `messages/en.json`; no technical words for users; no emojis; styled controls only; ≥ 44 px targets.
- Logs carry counts and ids only, never addresses; Google error bodies are scrubbed of addresses before logging or storing.
- SQL only in `supabase/migrations/*` and `src/server/queries/*`; RLS on every new table; `SECURITY DEFINER` only in `private`, `public` invoker wrappers with `search_path = ''`; before changing a function, copy its newest definition (`grep -ln "function private.<name>" supabase/migrations/* | sort | tail -1`).
- After each migration: `supabase db reset --local`, `bun run db:types`, `bun run test:db`, `supabase db advisors --local` with no new warning (ask the Owner for a window first: shared local stack and port 3000).
- TDD: watch each test fail for the right reason; a test that passes at once gets a mutation check.
- Before each PR: `bunx prettier --write <touched> && bun run format:check && bun run lint && bun run typecheck && bun run test -- --run`; Tasks 5–6 add `TZ=UTC bun run test:e2e` and `bun scripts/check-build-log.ts .e2e-build.log`.
- Screens: 390 light, 320 dark, 1024, labelled with who sees them, "Looks right?" before merge.
- No new API route: the Owner and member views extend the existing `GET /api/workspaces/[slug]/sheet` and the members page, both already rate limited in `ROUTES` (`src/server/http/route-registry.ts`); lists stay keyset-paginated; Drive's `permissions.list` is followed page by page.
- Migrations are created with `supabase migration new <name>` (the `<timestamp>` below is what it writes).
- One PR per task, titled with the task's commit message; bodies say "Part of #413" (Task 7: "Closes #413"); commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A share that Google made but the database never recorded** (run timed out, lease lost, crash): the next run finds the person in `permissions.list` with the row still `sharing` and adopts the permission; no second create, no second email. Pinned in Task 3 (planner) and Task 4 (worker).
2. **The team changes while a run is working on that sheet:** the run read the team at claim time; a trigger bumps `shares_version`, so the run's release keeps the sheet due and the next run sees the new team. Pinned in Task 2 (DB).
3. **The Owner removes a team member's access by hand in Drive:** TapNShow never shares again on its own; the person counts as "can't open" (`removed_in_drive`) until the Owner shares by hand or the person leaves. Pinned in Task 3.
4. **Google refuses one person, or rate limits:** a refusal marks only that person (retried at most once a day); a rate limit or 5xx retries the sheet's share step later with backoff; the sheet keeps updating. Pinned in Tasks 3 and 4.
5. **Turning off, replacing, deleting the workspace, or the sheet account's person deleting their account while Google is down:** the cleanup keeps its own sealed token copy, retries until `give_up_at` (24 h), then revokes anyway, erases the copy and emails the Owner the count of people who may still have access. Pinned in Tasks 2 and 4.

---

### Task 1: The switch, share state, the wanted team and change marks (database)

**Files:**
- Create: `supabase/migrations/<timestamp>_sheet_team_sharing.sql`
- Create: `src/test/db/sheet-shares.ts` (helpers)
- Test: `src/server/queries/sheet-shares.db.test.ts`
- Modify: `docs/superpowers/specs/2026-10-20-sheet-team-sharing-design.md` (§5: the state rules of Task 3), `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§6 tables, §7.17 one paragraph pointing to the design)

**Interfaces:**
- Produces (SQL):
  - `private.app_flags (name text primary key, enabled boolean not null)`, RLS on, no policies; row `('sheet_team_sharing', false)`; `private.app_flag(p_name text) returns boolean` (stable, `search_path = ''`, false for an unknown name).
  - `private.app_limits` row `('sheet_team_shares_max', 500)`.
  - enum `public.sheet_share_state`: `'pending', 'sharing', 'shared', 'external', 'refused'`; enum `public.sheet_share_reason`: `'refused', 'too_many', 'removed_in_drive'`.
  - `public.sheet_shares (id uuid pk default gen_random_uuid(), workspace_id uuid not null references public.sheet_syncs (workspace_id) on delete cascade, user_id uuid references auth.users (id) on delete set null, email text not null check (email = lower(email) and char_length(email) between 3 and 320), state public.sheet_share_state not null default 'pending', permission_id text check (permission_id is null or permission_id ~ '^[A-Za-z0-9_-]{1,200}$'), reason public.sheet_share_reason, next_try_at timestamptz, updated_at timestamptz not null default now(), unique (workspace_id, email))`; index `(workspace_id, state)`. RLS: SELECT for the workspace's Owner (all rows) and for the row's own user; no writes for `authenticated`.
  - `public.sheet_syncs` gains `shares_due_at timestamptz`, `shares_version bigint not null default 0`, `shares_run_id uuid`, `shares_locked_until timestamptz`.
  - `private.sheet_share_targets(p_workspace uuid) returns table (user_id uuid, email text, position integer)`: every `workspace_roles` row of the workspace by `lower(auth.users.email)`, minus `lower(sheet_syncs.google_email)`, ordered owner first, then `workspace_roles.created_at`, then `user_id` (`position` 1..n). The one rule for who gets access.
  - `private.sheet_shares_mark(p_workspaces uuid[]) returns void`: `shares_due_at = coalesce(shares_due_at, now())`, `shares_version = shares_version + 1` for those workspaces that have a sheet.
  - Statement triggers: `sheet_team_changed` after insert/update/delete on `public.workspace_roles` (transition tables, `exists (select 1 from public.sheet_syncs)` early return, like `private.sheet_memberships_changed`); `sheet_file_changed` after insert or update of `spreadsheet_id, google_email, status` on `public.sheet_syncs`.
  - `private.sheet_shares_due(p_sheet public.sheet_syncs) returns boolean`: flag on, `status = 'active'`, `spreadsheet_id is not null`, `shares_due_at <= now()`, shares lease free.
  - `private.workers_due()` (copy the newest, add `or exists (... sheet_syncs where private.sheet_shares_due(s))`).
  - The migration ends with `select private.sheet_shares_mark(array(select workspace_id from public.sheet_syncs))` so existing sheets are shared when the flag turns on (design §7).
- Produces (TS test helpers, `src/test/db/sheet-shares.ts`): `setSheetTeamSharing(enabled: boolean): () => void` (returns the restore, like `overrideLimit`; tests that need sharing switch it on in `beforeEach` and restore in `afterEach`), `sharesOf(workspaceId: string): Promise<Array<{ email: string; state: string; permissionId: string | null; reason: string | null }>>`, `sharesDueOf(workspaceId: string): Promise<{ dueAt: string | null; version: number }>`.

- [ ] **Step 1: Write the failing DB tests** (`sheet-shares.db.test.ts`, using `createTestUser`, `createWorkspaceAs`, `addMember`, `seedSheet`, `seedConnection`):
  - `"wants every team member except the sheet's own Google account"`: Owner (connects with an address equal to the Owner's), Admin, Viewer → targets = Admin, Viewer, positions 1..2; Owner excluded because `google_email` equals the Owner's email in another case (`Owner@…` vs `owner@…`).
  - `"marks a sheet's shares due when someone joins, changes role or leaves"`: each of `addMember`, `change_role`, `remove_member` bumps `shares_version` by 1 and sets `shares_due_at`; a workspace without a sheet is untouched.
  - `"marks shares due when the sheet gets its file or resumes"`: `sheet_save_file` and a paused → active update each bump the version.
  - `"is due only while the switch is on, the sheet is active and has a file"`: flag off → `sheet_shares_due` false and `workers_due()` false (with nothing else due); flag on → true; paused → false.
  - `"lets the Owner read every share row and a member only their own"` (RLS) and `"lets nobody write share rows"` (insert/update/delete as Owner refused).
  - `"marks every existing sheet due when the feature arrives"`: after reset, a sheet seeded before the mark has `shares_due_at` set (seed, then call the migration's final statement through `serviceRpc`-free SQL helper `queryLocalSql`).
- [ ] **Step 2: Run** `bun run test:db -- sheet-shares` → FAIL (relation `public.sheet_shares` does not exist).
- [ ] **Step 3: Write the migration** with the objects above; revoke every new `private` function from `public, anon, authenticated` (none is called by `authenticated`).
- [ ] **Step 4: Reset and regenerate:** `supabase db reset --local && bun run db:types`.
- [ ] **Step 5: Run** `bun run test:db -- sheet-shares` → PASS; mutation check: drop the `google_email` exclusion → the first test fails.
- [ ] **Step 6: Docs:** design §5 gets the state rules of Task 3's table; spec §6 lists the two tables, §7.17 links the design (the spike results are already in design §4).
- [ ] **Step 7: Full DB suite and advisors:** `bun run test:db` green; `supabase db advisors --local` → no new warning.
- [ ] **Step 8: Commit** `feat(db): who the Google Sheet is shared with, and when (#413)`.

### Task 2: Worker RPCs, cleanups, and removal before release (database)

**Files:**
- Create: `supabase/migrations/<timestamp>_sheet_share_worker.sql`
- Modify: `src/test/db/sheet-shares.ts`
- Test: `src/server/queries/sheet-shares.db.test.ts`, `src/server/db/function-security.db.test.ts` (only if a new `private` function needs `authenticated`; none planned)

**Interfaces:**
- Consumes: Task 1's tables, `private.sheet_share_targets`, `private.app_flag`, `private.app_limit`.
- Produces (SQL; `public` wrappers are `security invoker`, granted to `service_role` only, like `public.sheet_claim`):
  - `public.sheet_share_cleanups (id uuid pk, workspace_id uuid, workspace_name text not null, owner_user_id uuid references auth.users on delete set null, spreadsheet_id text not null, google_email text not null, connection_id uuid references public.google_connections on delete set null, google_sub text not null, token_user_id uuid not null, refresh_token_encrypted text not null, permission_ids text[] not null, emails text[] not null, revoke_after boolean not null, attempts integer not null default 0, retry_at timestamptz not null default now(), give_up_at timestamptz not null, run_id uuid, locked_until timestamptz, created_at timestamptz not null default now())`; RLS on, no policies. `give_up_at = now() + make_interval(hours => private.app_limit('sheet_share_cleanup_max_hours'))` (new limit, 24).
  - `private.sheet_shares_retire(p_workspace uuid, p_revoke boolean) returns void`: when the sheet has a file, a connection and any row in `shared` or `sharing`, inserts one cleanup with the connection's sealed token, `google_sub`, `user_id` (as `token_user_id`), the `shared` permission ids, and the `sharing` emails (to look up by list); then sets those rows back to `pending` with no permission. Called by a `before delete` row trigger on `public.sheet_syncs` (`p_revoke => false`; turn off, replace, workspace deletion) and by `private.delete_account` (`p_revoke => true`).
  - `private.connection_in_use` (copy the newest): also true while a cleanup references the connection, so `release_connection` keeps it until the cleanup finishes.
  - `private.delete_account` (copy the newest): before nulling `sheet_syncs.connection_id` for the person's connections, call `private.sheet_shares_retire(s.workspace_id, true)` for each such sheet; the connections a cleanup holds are left out of what the route revokes (the cleanup revokes them).
  - `private.workers_due()`: also `or exists (cleanup with retry_at <= now() and lease free)`.
  - `public.sheet_share_claim(p_run uuid, p_limit integer, p_lease_seconds integer) returns jsonb`: leases due sheets (`private.sheet_shares_due`), returns per sheet `{workspace_id, spreadsheet_id, version, cap, connection: {id, user_id, google_sub, refresh_token_encrypted, granted_scopes} | null, targets: [{user_id, email, position}], shares: [{email, state, permission_id, reason, next_try_at}]}`; `cap = private.app_limit('sheet_team_shares_max')`.
  - `public.sheet_share_intend(p_workspace uuid, p_run uuid, p_email text, p_user uuid) returns boolean`: upsert the row as `sharing` (the intent written before `permissions.create`); false when the lease is gone.
  - `public.sheet_share_save(p_workspace uuid, p_run uuid, p_email text, p_user uuid, p_state public.sheet_share_state, p_permission_id text, p_reason public.sheet_share_reason, p_next_try_at timestamptz) returns boolean`.
  - `public.sheet_share_forget(p_workspace uuid, p_run uuid, p_emails text[]) returns boolean`.
  - `public.sheet_share_release(p_workspace uuid, p_run uuid, p_version bigint, p_next_due timestamptz) returns void`: clears the lease; sets `shares_due_at = p_next_due` only when `shares_version = p_version` (a newer mark keeps it due now).
  - `public.sheet_share_retry(p_workspace uuid, p_run uuid, p_error text) returns void`: clears the lease, `shares_due_at = now() + backoff` (same backoff shape as `private.sheet_retry`; copy it).
  - `public.sheet_share_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason) returns jsonb`: pauses the sheet while the shares lease is held; shares one body with `private.sheet_pause` through a new `private.sheet_pause_apply(p_workspace uuid, p_reason public.sheet_pause_reason) returns jsonb` (both callers check their own lease, then call it).
  - `public.sheet_share_cleanup_claim(p_run uuid, p_limit integer, p_lease_seconds integer) returns jsonb` (rows with token fields), `public.sheet_share_cleanup_retry(p_id uuid, p_run uuid, p_error text) returns void`, `public.sheet_share_cleanup_finish(p_id uuid, p_run uuid, p_left integer) returns jsonb`: deletes the row (the token copy goes with it); when `revoke_after` or the held connection is no longer in use, releases it through `private.release_connection(connection_id, token_user_id)` and returns `{released, alert}` where `alert = {email, workspace_name, spreadsheet_id, account_email (the cleanup's google_email), left}` when `p_left > 0` and the owner still has an account.
- Produces (TS helpers): `seedShare(workspaceId, row)`, `cleanupsOf(workspaceId)`.

- [ ] **Step 1: Write the failing DB tests:**
  - `"keeps the team's shares to remove when the sheet is turned off, and holds the Google account until they are"`: shares `shared` ×2 → `turn_off_sheet` → one cleanup with both ids, `released` is null, the connection row still exists.
  - `"keeps the old file's shares to remove when the Owner creates a new sheet"`: `start_sheet(replace => true)` → cleanup for the old file; the new sheet has no rows and is due.
  - `"keeps the shares to remove when the workspace is deleted"`: `delete_workspace` → cleanup survives (no FK to the workspace), connection held.
  - `"keeps the shares to remove when the person whose Google account holds the sheet deletes their account"`: Admin connected the sheet, Owner keeps the workspace, Admin `delete_account` → cleanup with `revoke_after` true; the Admin's connection is not in the route's revoke list; after the auth user is removed, the cleanup still has its token copy.
  - `"finishes a cleanup: forgets the token, releases and returns what to revoke"` and `"returns the alert when people may still have access"` (`p_left = 2`).
  - `"keeps a sheet due when the team changed during the run"`: claim (version v) → `addMember` → release with v and `p_next_due => null` → still due.
  - `"writes only while holding the lease"`: intend/save/forget/release with another run id → false/no change.
  - `"gives the shares of a sheet to one run at a time"`: two claims → the second gets nothing.
  - `"claims nothing while the switch is off"`.
- [ ] **Step 2: Run** → FAIL (functions missing).
- [ ] **Step 3: Write the migration** (copy the newest `connection_in_use`, `delete_account`, `workers_due`, `sheet_pause` first).
- [ ] **Step 4: Reset, regenerate types, run** → PASS; mutation checks: remove the version guard in `sheet_share_release` → the "team changed during the run" test fails; remove the cleanup clause in `connection_in_use` → the turn-off test fails.
- [ ] **Step 5: Full DB suite and advisors** clean.
- [ ] **Step 6: Commit** `feat(db): the share worker's calls, and removing access before letting go (#413)`.

### Task 3: The share planner (pure)

**Files:**
- Create: `src/lib/sheets/share-plan.ts`
- Test: `src/lib/sheets/share-plan.test.ts`
- Modify: `src/config/sheets.ts`

**Interfaces:**
- Produces:
  - `src/config/sheets.ts`: `SHEET_SHARE_REFUSED_RETRY_MS = 24 * 60 * 60 * 1000`, `SHEET_SHARES_PER_RUN = 25`, `SHEET_SHARE_CLAIM_BATCH = 5`, `DRIVE_PERMISSIONS_PAGE_SIZE = 100`, `SHEET_SHARE_CLEANUP_BATCH = 5`; twin note: `sheet_team_shares_max` stays in SQL only (the claim returns it).
  - `type ShareTarget = { userId: string; email: string; position: number }`
  - `type ShareRow = { email: string; state: "pending" | "sharing" | "shared" | "external" | "refused"; permissionId: string | null; reason: "refused" | "too_many" | "removed_in_drive" | null; nextTryAt: string | null }`
  - `type DrivePermission = { id: string; email: string }` (only `type: "user"` permissions, emails lower-cased)
  - `type SharePlan = { create: ShareTarget[]; adopt: Array<{ target: ShareTarget; permissionId: string }>; external: ShareTarget[]; removedInDrive: ShareTarget[]; tooMany: ShareTarget[]; remove: Array<{ email: string; permissionId: string }>; forget: string[]; nextDue: string | null }`
  - `planShareChanges(input: { targets: ShareTarget[]; shares: ShareRow[]; permissions: DrivePermission[]; cap: number; now: number; createBudget: number }): SharePlan`

The decision table (per address in targets ∪ rows; "present" = in `permissions` by email):

| Wanted? | Row | Present | Action |
|---|---|---|---|
| yes | `shared` (same id) / `external` | yes | nothing |
| yes | `sharing`, `refused`, or `shared` (other id) | yes | adopt (ours: TapNShow tried this address) |
| yes | none / `pending` | yes | external (shared by hand before TapNShow) |
| yes | `shared` / `external` | no | removedInDrive (never re-shared automatically) |
| yes | `refused` with reason `removed_in_drive` | no | nothing |
| yes | `refused`, `next_try_at <= now` | no | create |
| yes | `refused`, later | no | nothing (contributes to `nextDue`) |
| yes | none / `pending` / `sharing` | no | create (within cap and budget) |
| no | `shared` / `sharing` | yes | remove (only ids TapNShow holds; for `sharing`, the listed id) |
| no | any | no | forget |
| no | `external` / `refused` / `pending` | yes | forget (not ours: never removed) |

Creates are allowed while `shared + external + sharing + creates < cap` (people beyond: `tooMany`) and at most `createBudget` per call (the rest: `nextDue = now`). `nextDue` is the earliest `next_try_at` of waiting refusals, `now` when anything was deferred, else null.

- [ ] **Step 1: Write the failing tests**, one per table row plus: `"never creates for an address Google already lists"` (all present rows), `"stops at the cap and marks the rest too many"` (cap 2, 3 targets), `"defers creates past the run's budget"` (budget 1, 3 creates → 1 create, `nextDue` = now), `"compares addresses without case"`, `"leaves a hand share of someone who left alone"`.
- [ ] **Step 2: Run** `bun run test -- --run src/lib/sheets/share-plan.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `planShareChanges`** (one pass over a `Map` keyed by lower-cased email; no Google or database access).
- [ ] **Step 4: Run** → PASS; mutation check: swap "adopt" for "create" on the `sharing` + present row → that test fails.
- [ ] **Step 5: Commit** `feat(sheets): decide each person's share from the team, the records and Drive (#413)`.

### Task 4: Drive permissions client and the share steps of the Sheet worker

**Files:**
- Create: `src/server/google/drive-permissions.ts`, `src/server/queries/sheet-shares.ts`, `src/server/sheets/run-sheet-shares.ts`
- Test: `src/server/google/drive-permissions.test.ts`, `src/server/sheets/run-sheet-shares.test.ts`, `src/server/queries/sheet-shares.db.test.ts` (store parse test, like the admin queries' real-database parse test)
- Modify: `src/server/sheets/sheets-deps.ts`, `src/server/workers/schedule-workers.ts` (+ test), `src/server/email/owner-alert.ts`, `src/emails/owner-alert-email.tsx` (+ test), `messages/en.json` (`Email.sheetAccessLeft`), `src/lib/observability/scrub.ts` only if Google's error text reaches a log (it must not: log codes only)

**Interfaces:**
- Consumes: Task 2 RPCs; Task 3 `planShareChanges`; existing `GoogleResult`, `GoogleFailure`, `FetchLike`, `classifyGoogleResponse`, `googleTokenDeps`, `revokeReleased`, `sendOwnerAlert`, `sheetUrl`.
- Produces:
  - `type ShareFailure = { kind: "refused" } | GoogleFailure` and `classifyShareResponse(status: number, body: string): ShareFailure` — `400 invalidSharingRequest`, `403` with `forbidden`/"ACL change not allowed" for that address, and `400 invalid`/`badRequest` on the email field → `refused`; `403 sharingRateLimitExceeded` → `retry`; otherwise `classifyGoogleResponse`.
  - `type DrivePermissionsClient = { list(token: string, fileId: string): Promise<GoogleResult<DrivePermission[]>>; create(token: string, fileId: string, email: string): Promise<GoogleResult<string> | { kind: "refused" }>; remove(token: string, fileId: string, permissionId: string): Promise<GoogleResult<null>> }` — `list` follows `nextPageToken` with `pageSize=DRIVE_PERMISSIONS_PAGE_SIZE` and `fields=nextPageToken,permissions(id,type,emailAddress)`, keeps `type === "user"`; `create` posts `{type: "user", role: "reader", emailAddress}`; `remove` maps 404 to `ok` (already gone, the spike).
  - `createDrivePermissionsClient(input: { driveBaseUrl: string; timeoutMs: number; fetchImpl?: FetchLike }): DrivePermissionsClient` (reuses the private `call` shape of `sheets-client.ts`; extract it to `src/server/google/google-call.ts` and use it from both, no copy).
  - `type ShareStore` and `createShareStore(admin): ShareStore` wrapping every Task 2 RPC with Zod parsing (same `check` pattern as `createSheetStore`).
  - `runSheetShares(deps: SheetSharesDeps, options: SheetSharesOptions): Promise<{ sheets: number; created: number; adopted: number; removed: number; refused: number; retried: number }>` and `runShareCleanups(deps, options): Promise<{ cleanups: number; removed: number; finished: number; gaveUp: number }>`; `SheetSharesDeps = { store: ShareStore; drive: DrivePermissionsClient; refresh; openToken; revoke: (released: ReleasedConnection[]) => Promise<void>; alertAccessLeft: (alert) => Promise<void>; now: () => number; newRunId: () => string }`.
  - `OwnerAlertInput` gains `{ kind: "sheetAccessLeft"; left: number; workspaceName: string; sheetUrl: string; accountEmail: string }`; email words: subject "People may still have access to {workspace}'s Google Sheet", body "TapNShow couldn't remove {left, plural, one {1 person} other {# people}} from the Google Sheet in {account}'s Drive. Open it, choose Share, and remove anyone who shouldn't see it." with the button "Open the Google Sheet".
  - Lane order in `scheduleWorkers` "sheets": `runSheetSync`, then `runSheetShares`, then `runShareCleanups`, each with what is left of `SHEET_BUDGET_MS` (one `startedAt` passed down); `WORKER_OPTIONS.sheets` gains the Task 3 config values.

`runSheetShares` per claimed sheet: refresh the token (`invalid_grant` → `sheet_share_pause("access_lost")`); `list` (failure → the existing pause rules for `access_lost`/`not_found`, else `sheet_share_retry`); `planShareChanges`; then in order: `forget`, `remove` (each `remove` 2xx/404 → forget the row), `adopt`/`external`/`removedInDrive`/`tooMany` (save), and for each `create`: `sheet_share_intend` → `drive.create` → save `shared` with the id, `refused` with `next_try_at = now + SHEET_SHARE_REFUSED_RETRY_MS`, or on `retry` stop the sheet's creates and `sheet_share_retry`; finally `sheet_share_release(version, plan.nextDue)`. Every Google call checks the run's budget first (as `runSheetSync`'s `google` helper); out of budget → release with `nextDue = now`.

`runShareCleanups` per cleanup: open the token copy, refresh (`invalid_grant` → finish with `left = permission_ids + emails` count), `list` (404 file → finish with 0), delete each held id and each listed permission for the `emails`, then `sheet_share_cleanup_finish(left)`, `revoke(released)`, and `alertAccessLeft` when an alert comes back; a retryable failure → `sheet_share_cleanup_retry`, and after `give_up_at` → finish with what is left.

- [ ] **Step 1: Write the failing client tests** (`drive-permissions.test.ts`, fake `fetchImpl`): follows two pages; keeps only user permissions with lower-cased emails; create sends role reader and returns the id; `invalidSharingRequest` → `refused`; `sharingRateLimitExceeded` → `retry`; remove maps 404 to ok; a network error → `retry`; never throws.
- [ ] **Step 2: Write the failing worker tests** (`run-sheet-shares.test.ts`, fakes for store and Drive): `"shares with a new Viewer, writing the intent first"` (call order intend → create → save); `"adopts a share a crashed run made instead of sharing again"`; `"removes the share of someone who left, then forgets them"`; `"marks one refusal without pausing the sheet"`; `"backs off the sheet's shares on a rate limit"`; `"pauses the sheet when Google access is lost"`; `"stops calling Google when the budget is spent and leaves the sheet due"`; `"never logs an address"` (spy on the logger: no `@` in any call); cleanup: `"removes the old file's shares, then releases and revokes"`, `"treats a deleted file as nothing left to remove"`, `"gives up after give_up_at, revokes anyway and emails the Owner the count"`.
- [ ] **Step 3: Write the failing store parse test** (`sheet-shares.db.test.ts`): claim and cleanup claim parse against the real database.
- [ ] **Step 4: Run** → FAIL (modules missing).
- [ ] **Step 5: Implement** `google-call.ts` (extracted), `drive-permissions.ts`, `sheet-shares.ts` (store), `run-sheet-shares.ts`, the alert kind and email, the deps and the lane order.
- [ ] **Step 6: Run** the three files and `src/server/sheets/run-sheets.test.ts`, `src/server/google/sheets-client.test.ts`, `src/server/workers/schedule-workers.test.ts`, `src/emails/owner-alert-email.test.tsx` → PASS. Mutation check: drop the intent write → the call-order test fails.
- [ ] **Step 7: Commit** `feat(sheets): share the Google Sheet with the team and take it back (#413)`.

### Task 5: What people see (API, Settings, People)

**Files:**
- Modify: migration (new `<timestamp>_sheet_share_views.sql`: copy the newest `private.workspace_sheet` and `private.members_page`)
- Modify: `src/shared/api/sheets.ts`, `src/shared/api/members.ts`, `src/server/queries/sheets.ts`, `src/server/queries/members.ts`
- Create: `src/app/(app)/w/[slug]/settings/sheet-team-access.tsx`, `src/app/(app)/w/[slug]/settings/sheet-my-access.tsx` (+ tests)
- Modify: `src/app/(app)/w/[slug]/settings/sheets-section.tsx` (+ test), `src/app/(app)/w/[slug]/settings/people-section.tsx` (+ test), `messages/en.json`
- Test: `src/server/queries/sheet-shares.db.test.ts` (views), the component tests, screenshots spec `.superpowers/scripts/screens/sheet-sharing.spec.ts` (git-ignored)

**Interfaces:**
- Produces:
  - `workspace_sheet()` adds `sharing`: null when the flag is off; else `{team_count, total, can_view, cant_open, in_progress, mine}` where `team_count` = Admins + Viewers, `total` = targets, `can_view` = `shared + external`, `cant_open` = `refused` + `too_many`, `in_progress` = `pending + sharing` + targets with no row, and `mine` (members only, null for the Owner) ∈ `"shared" | "sharing" | "refused" | "sheet_account"` with `my_email`.
  - `sheetStatusSchema.sharing: z.object({ teamCount, total, canView, cantOpen, inProgress: z.number().int().nonnegative(), mine: z.enum(["shared","sharing","refused","sheet_account"]).nullable(), myEmail: z.string().nullable() }).nullable()`, and `export type SheetSharing = NonNullable<SheetStatus["sharing"]>`.
  - `members_page` items add `sheet_access` for the Owner only (`"can_view" | "cant_open" | "pending" | null`, null when the flag is off, no sheet, or the caller isn't the Owner), read with one left join on `sheet_shares` by email for the page's rows (no per-row query; the page stays keyset-paginated, ≤ 100 rows).
  - `memberSchema.sheetAccess: z.enum(["can_view","cant_open","pending"]).nullable()`.
  - `SheetTeamAccess({ sharing, onShowPeople }: { sharing: SheetSharing; onShowPeople: () => void })` (Owner block, option A) and `SheetMyAccess({ sharing, ownerName }: { sharing: SheetSharing; ownerName: string })` (member line).
  - Words (`Settings.sheets.team.*`, `Settings.people.cantOpenSheet`), from the design §3: `shared` "Shared", `sharing` "Sharing…", `summary` "Your team can view it · {canView} of {total} people", `cantOpen` "Google couldn't share it with {count, plural, one {1 person} other {# people}}, usually because the address isn't a Google account. You can share it with them by hand from Google Sheets.", `markedInPeople` "They're marked in People.", `follows` "People who join or leave the team get or lose access within a minute.", `alone` "Only you so far. People who join the team get access.", `mineShared` "You can view it with {email}.", `mineSharing` "Sharing it with you…", `mineRefused` "Google couldn't share it with {email}. Ask {owner}, the Owner, to share it with your Google address.", `mineAccount` "It's in your Google Drive.", `connectTeam` "Your team ({count} people) can view it: Google emails each of them a link.", `connectTeamNone` "People who join your team will be able to view it.", `turnOffTeam` "The sheet stops updating and your team loses access to it. It stays in {account}'s Drive.", `recreateTeam` "The old sheet stops updating. Your team moves to the new one and loses access to the old one.", `cantOpenSheet` "Can't open the sheet".
  - The tag colours: green `success` when `cantOpen = 0 and inProgress = 0`, `info` with "Sharing…" while `inProgress > 0`, `warning` when `cantOpen > 0`.
  - `"They're marked in People."` scrolls to and opens the People section (`SettingsSection` id `people`).
- [ ] **Step 1: Write the failing DB tests:** `"shows the Owner the team's counts and a member their own line"`, `"hides sharing while the switch is off"`, `"tags only the Owner's view of People, one page at a time"` (page of 2 with a cursor still carries the tag on page 2).
- [ ] **Step 2: Write the failing component tests:** Owner block in each colour; the count sentence for 1 and 5 (no names rendered); the People link opens the section; the member lines for the four `mine` values; the People tag only for `cant_open` and only when present; dialogs show the team lines only when `sharing` is not null; no sharing UI at all when `sharing` is null (flag off).
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** the migration, schemas, queries, components and words.
- [ ] **Step 5: Run** → PASS; reset + `db:types` + full DB suite + advisors clean.
- [ ] **Step 6: Screens:** with the flag on locally, capture Owner (all good / some can't open / sharing), Viewer (each line), People tag, and the three dialogs at 390 light, 320 dark and 1024; look at each; send to the Owner with who sees each; "Looks right?".
- [ ] **Step 7: Commit** `feat(settings): show who can open the Google Sheet (#413)`.

### Task 6: The fake Google and the end-to-end story

**Files:**
- Modify: `e2e/helpers/fake-google.ts` (permissions per file: `GET/POST /drive/v3/files/:id/permissions`, `DELETE /drive/v3/files/:id/permissions/:pid`; create on an existing address returns the same id and counts a second "email"; `/__sheets` exposes permissions and email counts; a test hook to refuse one address with `invalidSharingRequest`), `e2e/global-setup.ts` (switch on for the run, off in teardown)
- Create: `e2e/sheet-sharing.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- [ ] **Step 1: Write the failing story** `"the team gets the Google Sheet and loses it when they leave"`: Owner with a Viewer and an Admin connects the sheet → within the worker run the fake shows two reader permissions and one email each → the Viewer's Settings says "You can view it with …" → the Owner removes the Viewer → the permission is gone and no second email was counted → the Owner turns the sheet off → no TapNShow permissions remain on the file.
- [ ] **Step 2: Write the failing story** `"one address Google refuses doesn't stop the sheet"`: the fake refuses the Admin → the Owner sees "Google couldn't share it with 1 person" and the People tag; the sheet still updates.
- [ ] **Step 3: Run** `TZ=UTC bun run test:e2e -- sheet-sharing` → FAIL.
- [ ] **Step 4: Implement** the fake's endpoints and the setup switch.
- [ ] **Step 5: Run** the whole e2e and `bun scripts/check-build-log.ts .e2e-build.log` → PASS, no build warnings.
- [ ] **Step 6: Commit** `test(e2e): sharing the Google Sheet with the team (#413)`.

### Task 7: Release (only after Google approves the verification; Owner's go-ahead)

**Files:**
- Create: `supabase/migrations/<timestamp>_sheet_team_sharing_on.sql` (`update private.app_flags set enabled = true where name = 'sheet_team_sharing'`)
- Modify: `src/content/legal/privacy.ts` (§4: "With your permission when the sheet is turned on, TapNShow also shares it, view only, with the workspace's team, and takes that access away when someone leaves the team or the sheet is turned off."; §5 "People in your groups": the team can view the Google Sheet; `updated` date), `src/content/legal/content.test.ts` (pin the new sentence), `docs/runbooks/google-verification.md` (nothing changes in scopes; note the new use of `drive.file`)
- [ ] **Step 1: Safeguard** (design §7): `bun .superpowers/scripts/prod-sheet-teams.ts`; if any sheet that isn't the platform owner's has other people on its team, stop and bring the one-time prompt back to the Owner.
- [ ] **Step 2: Write the failing legal pin**, run → FAIL; update the policy; run → PASS.
- [ ] **Step 3: Full checks**, PR, merge; hosted push (`.superpowers/scripts/hosted-push.sh`) after the Owner approves this production write.
- [ ] **Step 4: Production check with the Owner's test workspace:** a test Admin gets Google's email and can open the sheet; removing them takes the access away within a minute; Sentry clean; `prod-sheets.ts` shows no error.
- [ ] **Step 5: Commit** `feat(sheets): share the Google Sheet with the team, switched on (#413)`; close #413 with a comment.
