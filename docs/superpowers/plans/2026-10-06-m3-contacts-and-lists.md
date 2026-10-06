# TapNShow M3 (Contacts & Lists) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Owner or Admin imports the club roster from a `.csv`/`.xlsx` file or a paste, sorts people into lists taken from the sheet's Team column, edits them on a phone, and re-importing the same file reports 0 new; Viewers see the roster read-only.

**Architecture:** Postgres holds `contacts`, `lists` and `list_contacts` behind RLS (members read, Owner/Admin write). Multi-row work runs in `SECURITY INVOKER` functions (`roster`, `import_contacts`, `set_contact_lists`, `bulk_contacts`) so RLS still applies; insert triggers enforce the per-workspace caps under an advisory lock. The browser parses files and pastes, maps columns, and sends clean rows to `POST …/contacts/import`, whose dry run is the preview and whose commit applies the same logic in one transaction. The roster page is a client component on TanStack Query: virtualized cards and a bottom-sheet editor on phones, an inline-editable TanStack Table grid from `md` up. The M2 `SECURITY DEFINER` functions move into `private` behind `public` `SECURITY INVOKER` wrappers (lint 0029, #87).

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript 5, bun 1.3.11, `@supabase/supabase-js` 2.117.2 + `@supabase/ssr` 0.12.7, Supabase CLI 2.119.0 (local ports 44320–44329), Postgres 17, `zod` 4.6, `@tanstack/react-query` 5.104, `radix-ui` 1.6 (Checkbox, Switch, ToggleGroup are in the umbrella package already installed), **new:** `papaparse` 5.7 + `@types/papaparse`, `read-excel-file` 9.3 (import path `read-excel-file/universal`), `@tanstack/react-table` 9.2 (`useTable`, `tableFeatures`, `rowSortingFeature`), `@tanstack/react-virtual` 3.14 (`useWindowVirtualizer`), `fflate` 0.8 (dev only: builds `.xlsx` test fixtures), Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md` — read §3 (roles), §4 "Member list editing", §6 "People & lists" + access pattern, §7.13 (last sentence), §7.14 (roster and import UI), §10 "Roster API" + "Libraries", §11 (`SECURITY DEFINER` wrapper pattern, visibility, rate limiting), §12 (M3 tests) and §14 (M3 row) before starting. Design approved 2026-10-06 (PR #92). Epic #5; #87 items folded in.

## Global Constraints

- Everything from the M0+M1 and M2 plans' Global Constraints still applies (free only; bun; no Server Actions; no emojis; no `any`/`unknown` — the ESLint rule bans the `unknown` keyword, including `as unknown as`; no `console.*`; JSDoc on every export; no hardcoded values; SQL only in `supabase/migrations/*` and `src/server/queries/*`; every UI string through next-intl; Soft Neobrutalism; Expressive motion with a reduced-motion fallback; WCAG 2.2 AA; one branch + PR per task with the repo template, squash merge, commit trailer from the session's attribution reminder).
- **Imports at the top of the file only** (`.agents/01-core-rules.md` rule 7). Code splitting for the import dialog uses `next/dynamic` at module scope (Next 16 guide `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`), never an `import()` inside a function.
- **No native form controls** (owner rule): no browser-styled `<input type="checkbox|radio|file">`, `<select>` or `<textarea>`. Use `src/components/ui/*` (Task 6 adds Checkbox, Switch, SegmentedControl, Textarea, FileDropZone). A hidden `<input type="file">` behind our styled button is allowed.
- Supabase: every new `public` table gets `enable row level security`, `revoke all … from anon, authenticated`, then explicit column `GRANT`s to `authenticated` and `grant all … to service_role` (new tables are not exposed by default; enforced on existing projects 2026-10-30). Policies are `to authenticated` and use `private.is_member(workspace_id[, roles])`; UPDATE policies have `using` and `with check`.
- **Function security from M3 (spec §11):** no `SECURITY DEFINER` function may live in `public`. New functions are `SECURITY INVOKER` with `set search_path = ''` and fully qualified names. A definer helper lives in `private`, is granted to `authenticated` only when an invoker function must call it, and checks `auth.uid()` itself. Run `supabase db advisors --local` after every migration (and `--linked` on preview during rollout); expected: no WARN or ERROR.
- Supabase's Data API returns at most **1,000 rows** per request (`max_rows = 1000` in `supabase/config.toml`, same default on hosted projects). Any read that can exceed it (the roster: up to 2,000 contacts) is a function returning one `jsonb` value, never a table select.
- Database errors meant for users: `raise exception 'tn:<code>' using errcode = 'P0001'`. New codes: `contact_email_taken`, `contacts_limit_reached`, `lists_limit_reached`, `list_name_taken`, `import_too_many_rows` (plus existing `forbidden`, `not_found`, `invalid_input`, `rate_limited`). Never put user data in exception messages.
- **Limits live in `private.app_limits` only:** `contacts_per_workspace_max` 2000, `lists_per_workspace_max` 50, `import_rows_max` 2000, `imports_per_user_per_hour` 30, `import_previews_per_user_per_hour` 120. The client learns the first three from `GET …/contacts` (`limits`). Client-only constants (5 MB file cap, Undo delay) live in `src/config/roster.ts`. Field length rules (name ≤ 120, list name ≤ 60) mirror the database checks in Zod, as M2 did for workspace names.
- Every mutating route: `rejectCrossOrigin` → `loadWorkspaceContext` → `forbidViewer` (Task 4) → `parseJsonBody` with a shared Zod schema from `src/shared/api/roster.ts` → query module → `fromDatabaseError`.
- The import file never leaves the device: only `{ row, fullName, email, lists[] }` objects are sent. Parsed cell text is never logged.
- UI verification: Playwright screenshots at 390 px (light) and 320 px (dark) for every new screen, and no horizontal page scroll at 320 px.
- Local stack: `supabase start` (API 44321, DB 44322, Studio 44323, Mailpit 44324/44325). Always run the CLI with `</dev/null`. Stop any `next dev` before `bun run test:e2e` (find it with `ss -ltnp`, kill by PID; never `pkill -f`). Regenerate types with `bun run db:types` after each migration.

## Review Focus

1. **Rosters larger than the Data API's 1,000-row cap** — a workspace with 1,100 contacts must show 1,100 on the roster, not 1,000. Pinned in Task 2 (`roster()` DB test with 1,100 contacts).
2. **A French-locale Excel CSV** — saved as Windows-1252 with `;` separators, so "Inès" arrives as byte `0xE8`; the import must show "Inès", not "In�s" or "InÃ¨s". Pinned in Task 5 (`decodeText` + `parseCsv` tests with cp1252 bytes).
3. **Separate first-name and last-name columns** ("Prénom" / "Nom") — mapping both to Full name must produce "Prénom Nom" in column order instead of forcing the organizer to merge columns in the sheet first. Pinned in Task 5 (`buildImportRows` test) and Task 10 (match step test).
4. **Messy cells and case-only differences** — non-breaking spaces, zero-width characters, `" Ines@Example.COM "`, numeric `.xlsx` cells, and a list cell "dev" when the list is "Dev" must all normalize so that re-importing the same people reports 0 new and creates no "dev" list. Pinned in Task 5 (`cleanCell` tests) and Task 3 (re-import DB test).
5. **Long names and emails on a 320 px phone** — `"Mohamed Ali Ben Abdallah El Kefi"` / `"mohamedali.benabdallah.elkefi@etudiant-issatso.u-sousse.tn"` must wrap or truncate inside cards, the sheet and the preview without horizontal page scroll. Pinned in Task 7 and Task 10 (e2e `expectNoHorizontalScroll` on the small-phone project).

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge this plan (docs PR); create the agent-task issues (Tracking) | — |
| 1 | Task 1 — DB: `private` definer bodies behind `public` invoker wrappers (lint 0029, #87) | 0 |
| 2 | Task 2 — DB: roster schema, RLS, caps, `roster`, `set_contact_lists`, `bulk_contacts` | 1 |
| 3 | Task 3 — DB: `import_contacts` (dry run + commit) | 2 |
| 4 | Task 4 — API: error codes, shared schemas, queries, routes, hooks | 3 |
| 5 | Task 5 — Import parsing library (CSV/XLSX/paste, cleaning, column guessing, row building) | 4 |
| 6 | Task 6 — UI primitives: Checkbox, Switch, SegmentedControl, Textarea, FileDropZone | 0 |
| 7 | Task 7 — Roster page: read view (search, list chips, virtualized cards, empty state, Viewer, Home link) | 4, 6 |
| 8 | Task 8 — Roster editing: ContactSheet, ListPicker, Add person, Manage lists, Undo deletes | 7 |
| 9 | Task 9 — Select mode, bulk actions and the `md+` grid | 8 |
| 10 | Task 10 — Import dialog (Source → Match columns → Preview) | 5, 6, 8 |
| 11 | Task 11 — #87 leftovers: Settings skeleton, Google "G" in WebKit/Firefox, preview `VERCEL_URL` | 0 |
| 12 | Task 12 — Rollout: e2e story, hosted migrations + advisors, real roster import, final review | 1–11 |

Tasks 1, 6 and 11 are independent of each other; Tasks 2 → 3 → 4 are a chain; Task 5 needs only Task 4's `src/config/roster.ts` and `ImportRowInput`.

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–12 with the agent-task template, labels `type:task` + the area labels named in each task, milestone `M3 Contacts & lists`, and add each as a sub-issue of epic #5:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/5/sub_issues -F sub_issue_id="$id"
```
- [ ] Tick "Plan written for M3" in epic #5's body.
- [ ] #87: comment that its items are now Tasks 1 and 11 of this plan, except "rate-limit cleanup", which moves to the M4 epic #6 (edit #87's scope list; add the item to #6's body). Close #87 when Task 11 merges.
- [ ] Ledger: `.superpowers/sdd/2026-10-06-m3-contacts-and-lists/progress.md` (git-ignored) with one line per task and every `Ruling:`.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `supabase/migrations/*_m3_definer_wrappers.sql` | Moves the 14 M2 `SECURITY DEFINER` functions to `private`; `public` invoker wrappers with identical signatures | 1 |
| `src/test/db/sql.ts` | + `queryLocalSql` (JSON rows from the local DB, test setup only) | 1 |
| `src/server/db/function-security.db.test.ts` | No definer function in `public`; nothing in `private` executable by `anon` | 1 |
| `supabase/migrations/*_m3_roster.sql` | `is_valid_email`, limits, `contacts`, `lists`, `list_contacts`, RLS, caps, `hit_user_rate_limit`, `roster`, `set_contact_lists`, `bulk_contacts` | 2 |
| `src/test/db/roster.ts` | `seedContacts`, `seedList` helpers (service role) | 2 |
| `src/server/db/roster.db.test.ts` | RLS matrix, caps, `roster` > 1,000 rows, lists functions | 2 |
| `supabase/migrations/*_m3_import_contacts.sql` | `import_contacts` | 3 |
| `src/server/db/import-contacts.db.test.ts` | Dry run vs commit, merges, re-import, limits, email parity with Zod | 3 |
| `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors`) | New error codes | 4 |
| `src/shared/api/roster.ts` | Zod contracts for every roster route | 4 |
| `src/server/http/errors.ts` | `fromDatabaseError(error, overrides?)` | 4 |
| `src/server/http/forbid-viewer.ts` | `forbidViewer` (Viewers get 403 on roster writes) | 4 |
| `src/server/queries/roster.ts` | All roster supabase-js calls | 4 |
| `src/app/api/workspaces/[slug]/contacts/**`, `…/lists/**` | Roster routes | 4 |
| `src/hooks/use-roster.ts` | Roster query + mutations with optimistic cache updates | 4 |
| `src/lib/roster/roster-cache.ts` | Pure cache updaters used by the hooks | 4 |
| `src/config/roster.ts` | `IMPORT_FILE_MAX_BYTES`, `UNDO_DELETE_MS`, `LIST_CELL_SEPARATORS` | 4 |
| `src/lib/import/*` | `cleanCell`, `decodeText`, `parseCsv`, `parsePaste`, `parseXlsx`, `guessColumns`, `splitListCell`, `buildImportRows` | 5 |
| `src/test/fixtures/xlsx.ts` | `makeXlsx` (fflate) for tests | 5 |
| `src/components/ui/{checkbox,switch,segmented-control,textarea,file-drop-zone}.tsx` | Styled primitives | 6 |
| `src/app/design/design-showcase.tsx` | Shows the new primitives | 6 |
| `src/hooks/use-media-query.ts`, `src/test/match-media.ts` | `useMediaQuery`; tests can emulate a wide viewport | 7 |
| `src/lib/roster/filter-contacts.ts` | Accent-insensitive search + list filter | 7 |
| `src/app/w/[slug]/lists/*` | Roster page, toolbar, list chips, cards, empty state | 7 |
| `src/components/forms/list-picker.tsx` | Pick/create lists (sheet, grid, import, bulk) | 8 |
| `src/app/w/[slug]/lists/{contact-sheet,add-contact-dialog,manage-lists-dialog,use-deferred-delete}.tsx` | Editing | 8 |
| `src/app/w/[slug]/lists/{selection-bar,roster-grid}.tsx` | Select mode, bulk actions, grid | 9 |
| `src/app/w/[slug]/lists/import/*` | Import dialog and its three steps | 10 |
| `src/app/w/[slug]/settings/page.tsx` | Members skeleton (Danger zone no longer pops in) | 11 |
| `e2e/roster.spec.ts`, `e2e/fixtures/roster.csv`, `e2e/helpers/layout.ts` | Roster e2e and the no-horizontal-scroll helper | 7, 10, 12 |

---

### Task 1: DB — `private` definer bodies behind `public` invoker wrappers (lint 0029, #87)

**Labels:** `area:db`

**Files:**
- Create: `supabase/migrations/<timestamp>_m3_definer_wrappers.sql` (`supabase migration new m3_definer_wrappers </dev/null`), `src/server/db/function-security.db.test.ts`
- Modify: `src/test/db/sql.ts` (+ `queryLocalSql`), `src/server/db/database.types.ts` (regenerated; expected unchanged)

**Interfaces:**
- Consumes: the M2 functions as they exist today (signatures below).
- Produces:
  - The same 14 RPC names and signatures in `public`, now `language sql security invoker` one-liners calling `private.<same name>`. No TypeScript call site changes.
  - `queryLocalSql<T>(sql: string, schema: z.ZodType<T>): T` in `src/test/db/sql.ts` — runs SQL as `postgres` through the CLI and parses the JSON rows.
  - Rule for later tasks: `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef` is 0, enforced by a test.

Why this is safe: `private` is not in the Data API's exposed schemas (`[api] schemas = ["public", "graphql_public"]`), so `private.*` can only be reached through the wrappers. `auth.uid()` reads the request's JWT claims, so it returns the same caller inside the definer body. Grants travel with a function when its schema changes.

- [ ] **Step 1: Test helper** — append to `src/test/db/sql.ts`:
```ts
import type { z } from "zod";

/**
 * Runs SQL as the local `postgres` superuser and parses the rows (test assertions only).
 * `--agent no` keeps the CLI output a plain JSON array on every machine.
 */
export function queryLocalSql<T>(sql: string, schema: z.ZodType<T>): T {
  const output = execFileSync(
    "supabase",
    ["db", "query", "--local", "--output-format", "json", "--agent", "no", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return schema.parse(JSON.parse(output));
}
```
(Move the `import type { z }` line to the top of the file next to the existing `execFileSync` import.)

- [ ] **Step 2: Failing test** — `src/server/db/function-security.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryLocalSql } from "@/test/db/sql";

const names = z.array(z.object({ name: z.string() }));

/**
 * The private functions signed-in users may reach (through RLS policies or public wrappers).
 * Adding one is a security decision: extend this list in the same PR, sorted.
 */
const PRIVATE_FUNCTIONS_FOR_AUTHENTICATED = [
  "accept_invite",
  "change_role",
  "consume_invite_email",
  "create_invite",
  "create_workspace",
  "delete_workspace",
  "invite_preview",
  "is_member",
  "leave_workspace",
  "list_members",
  "remove_member",
  "renew_invite",
  "revoke_invite",
  "role_of",
  "transfer_ownership",
];

describe("function security (spec §11)", () => {
  it("keeps every SECURITY DEFINER function out of the exposed public schema", () => {
    const rows = queryLocalSql(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef order by 1`,
      names,
    );
    expect(rows).toEqual([]);
  });

  it("lets authenticated execute only the allow-listed private functions", () => {
    const rows = queryLocalSql(
      `select distinct p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`,
      names,
    );
    expect(rows.map((row) => row.name)).toEqual(PRIVATE_FUNCTIONS_FOR_AUTHENTICATED);
  });

  it("exposes the M2 RPCs as invoker wrappers with unchanged names", () => {
    const rows = queryLocalSql(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not p.prosecdef and p.proname = any (array[
         'create_workspace','list_members','check_ip_rate_limit','change_role','remove_member',
         'leave_workspace','transfer_ownership','delete_workspace','create_invite','renew_invite',
         'revoke_invite','consume_invite_email','invite_preview','accept_invite'])
       order by 1`,
      names,
    );
    expect(rows).toHaveLength(14);
  });
});
```

- [ ] **Step 3: Run it to verify it fails** — `bun run test:db -- src/server/db/function-security.db.test.ts`. Expected: the first test FAILS listing the 14 M2 function names; the second FAILS (the moved bodies are not in `private` yet, and helpers such as `mask_email` are executable through PUBLIC); the third FAILS with length 0.

- [ ] **Step 4: Migration** — `supabase migration new m3_definer_wrappers </dev/null`, then write:
```sql
-- M3 (#87, spec §11): SECURITY DEFINER bodies move to the non-exposed private schema; the Data
-- API sees only SECURITY INVOKER wrappers with the same signatures. Effective security is
-- unchanged (each body still checks auth.uid() and the caller's role); advisor lint 0029
-- (authenticated_security_definer_function_executable) stops firing.

alter function public.create_workspace(text, text, text) set schema private;
alter function public.list_members(uuid) set schema private;
alter function public.check_ip_rate_limit(text, text) set schema private;
alter function public.change_role(uuid, uuid, public.workspace_role, boolean) set schema private;
alter function public.remove_member(uuid, uuid) set schema private;
alter function public.leave_workspace(uuid) set schema private;
alter function public.transfer_ownership(uuid, uuid, text) set schema private;
alter function public.delete_workspace(uuid, text) set schema private;
alter function public.create_invite(uuid, text, public.workspace_role, text) set schema private;
alter function public.renew_invite(uuid, text) set schema private;
alter function public.revoke_invite(uuid) set schema private;
alter function public.consume_invite_email(uuid) set schema private;
alter function public.invite_preview(text) set schema private;
alter function public.accept_invite(text) set schema private;

create function public.create_workspace(p_name text, p_slug text, p_timezone text)
returns public.workspaces language sql security invoker set search_path = ''
as $$ select * from private.create_workspace(p_name, p_slug, p_timezone) $$;

create function public.list_members(p_workspace uuid)
returns table (
  user_id uuid,
  role public.workspace_role,
  can_check_in boolean,
  display_name text,
  avatar_url text,
  email text,
  joined_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.list_members(p_workspace) $$;

create function public.check_ip_rate_limit(p_action text, p_ip text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.check_ip_rate_limit(p_action, p_ip) $$;

create function public.change_role(p_workspace uuid, p_user uuid, p_role public.workspace_role, p_can_check_in boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.change_role(p_workspace, p_user, p_role, p_can_check_in) $$;

create function public.remove_member(p_workspace uuid, p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_member(p_workspace, p_user) $$;

create function public.leave_workspace(p_workspace uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.leave_workspace(p_workspace) $$;

create function public.transfer_ownership(p_workspace uuid, p_new_owner uuid, p_confirm_name text)
returns void language sql security invoker set search_path = ''
as $$ select private.transfer_ownership(p_workspace, p_new_owner, p_confirm_name) $$;

create function public.delete_workspace(p_workspace uuid, p_confirm_name text)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_workspace(p_workspace, p_confirm_name) $$;

create function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role, p_token_hash text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_invite(p_workspace, p_email, p_role, p_token_hash) $$;

create function public.renew_invite(p_invite uuid, p_token_hash text)
returns void language sql security invoker set search_path = ''
as $$ select private.renew_invite(p_invite, p_token_hash) $$;

create function public.revoke_invite(p_invite uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.revoke_invite(p_invite) $$;

create function public.consume_invite_email(p_workspace uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select private.consume_invite_email(p_workspace) $$;

create function public.invite_preview(p_token_hash text)
returns table (status text, workspace_name text, workspace_slug text, role public.workspace_role, masked_email text)
language sql stable security invoker set search_path = ''
as $$ select * from private.invite_preview(p_token_hash) $$;

create function public.accept_invite(p_token_hash text)
returns text language sql security invoker set search_path = ''
as $$ select private.accept_invite(p_token_hash) $$;

-- Supabase's default privileges grant new public functions to anon; take that back.
revoke execute on function
  public.create_workspace(text, text, text),
  public.list_members(uuid),
  public.check_ip_rate_limit(text, text),
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text),
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
from public, anon;
revoke execute on function public.check_ip_rate_limit(text, text) from authenticated;
grant execute on function
  public.create_workspace(text, text, text),
  public.list_members(uuid),
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text),
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
to authenticated;
grant execute on function public.check_ip_rate_limit(text, text) to service_role;

-- Functions created in private after M2's first migration kept PostgreSQL's default EXECUTE for
-- PUBLIC. Trigger functions need no EXECUTE at fire time; everything signed-in users reach is
-- granted explicitly (is_member, role_of and the bodies above), so close the default.
revoke execute on all functions in schema private from public, anon;
```

- [ ] **Step 5: Apply and verify** — `supabase db reset </dev/null` (re-applies all migrations), then:
  - `bun run test:db` → all suites PASS, including the M2 suites unchanged (they call the same RPC names) and the new file.
  - `bun run db:types && git diff --stat src/server/db/database.types.ts` → no change expected. If the generator now lists `Returns` differently for a wrapper, keep the regenerated file and run `bun run typecheck`; it must pass without touching call sites.
  - `supabase db advisors --local </dev/null` → no `authenticated_security_definer_function_executable` entries and no new WARN/ERROR.
  - **Stop condition:** if lint 0029 still reports the `private.*` functions, stop and report to the owner with the advisor output (the spec assumed the lint covers exposed schemas only).

- [ ] **Step 6: Commit** — `fix: move M2 security definer functions behind invoker wrappers (#87)`. PR body lists the 14 functions and the advisor output before/after.


- [ ] **Step 7: Hosted rollout (right after the PR merges)** — Vercel deploys `main` to production on every merge, and later tasks call these database objects, so apply the migration to both hosted projects now. The database passwords live in `~/.config/tapnshow/supabase-db-passwords.env` (list the variable names with `cut -d= -f1` on that file; never print values). For each project, preview first:
```bash
supabase link --project-ref wayabcidwnhgaazgsuns </dev/null   # preview; the CLI asks for that project's DB password
supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
supabase link --project-ref dysqhjvwabqahpctytnw </dev/null   # production; the repo stays linked to prod afterwards
supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
```
Pass the password through the `SUPABASE_DB_PASSWORD` environment variable from that file (the CLI reads it) instead of typing it. Expected: the new migration listed as applied on both projects; the hosted advisors no longer report lint 0029 for the 14 functions (compare with the M2 output); no new WARN/ERROR. Record the advisor output in the ledger.
---

### Task 2: DB — roster schema, RLS, caps, `roster`, `set_contact_lists`, `bulk_contacts`

**Labels:** `area:db`

**Files:**
- Create: `supabase/migrations/<timestamp>_m3_roster.sql`, `src/test/db/roster.ts`, `src/server/db/roster.db.test.ts`
- Modify: `src/server/db/function-security.db.test.ts` (allow-list), `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: `private.is_member(uuid, workspace_role[])`, `private.app_limit(text)`, `private.hit_rate_limit(text, integer, interval)`, `private.set_updated_at()`, test helpers `createTestUser`, `createWorkspaceAs`, `addMember`, `expectAppError`, `adminClient`, `anonClient`.
- Produces:
  - Tables `public.contacts` (`id`, `workspace_id`, `email`, `full_name`, `user_id`, `unsubscribed_at`, `is_adhoc`, `created_at`, `updated_at`), `public.lists` (`id`, `workspace_id`, `name`, `created_at`, `updated_at`), `public.list_contacts` (`workspace_id`, `list_id`, `contact_id`, `created_at`). `list_contacts.workspace_id` plus composite foreign keys make a cross-workspace link impossible.
  - Column grants to `authenticated`: contacts insert (`workspace_id`, `email`, `full_name`), update (`email`, `full_name`), delete; lists insert (`workspace_id`, `name`), update (`name`), delete; list_contacts insert (`workspace_id`, `list_id`, `contact_id`), delete; select on all three.
  - `private.is_valid_email(p_email text) returns boolean` — immutable; same rule as `emailSchema` (Zod 4.6's email regex on the lower-cased address, ≤ 254 chars). Granted to `authenticated` (used by a check constraint).
  - `private.hit_user_rate_limit(p_action text) returns boolean` — definer; `p_action` ∈ `import` | `import_preview`; key `<action>:user:<auth.uid()>`; limits `imports_per_user_per_hour` / `import_previews_per_user_per_hour` over 1 hour. Granted to `authenticated`.
  - `private.app_limit(text)` granted to `authenticated` (numbers only; invoker functions and cap triggers read them).
  - Cap triggers: `tn:contacts_limit_reached` (> `contacts_per_workspace_max` non-ad-hoc contacts), `tn:lists_limit_reached` (> `lists_per_workspace_max`).
  - `public.roster(p_workspace uuid) returns jsonb` (invoker, members): `{ contacts: [{ id, email, full_name, list_ids: uuid[] }], lists: [{ id, name, contact_count }], limits: { contacts_max, lists_max, import_rows_max } }`; contacts sorted by `lower(full_name), email`, lists by `lower(name)`; ad-hoc contacts excluded.
  - `public.set_contact_lists(p_contact uuid, p_list_ids uuid[]) returns void` (invoker, Owner/Admin): the contact's lists become exactly `p_list_ids`. `tn:not_found` for an unknown contact or a list of another workspace.
  - `public.bulk_contacts(p_workspace uuid, p_action text, p_contact_ids uuid[], p_list_id uuid default null) returns integer` (invoker, Owner/Admin): `delete` | `add_to_list` | `remove_from_list`; returns affected rows; ids from other workspaces are ignored.
  - Duplicate email on a contact update → Postgres `23505` (the route maps it to `contact_email_taken`); duplicate list name (case-insensitive) → `23505` (`list_name_taken`).
  - Test helpers `seedContacts(workspaceId, count, prefix?) => Promise<string[]>` and `seedList(workspaceId, name) => Promise<string>` in `src/test/db/roster.ts`.

- [ ] **Step 1: Test helpers** — `src/test/db/roster.ts`:
```ts
import { adminClient } from "./clients";

const CHUNK = 500;

/**
 * Inserts `count` contacts named "<prefix> 1…n" with addresses `<prefix>-<n>@example.test` (service
 * role, bypasses RLS; the cap trigger still runs). Returns their ids in insertion order.
 */
export async function seedContacts(
  workspaceId: string,
  count: number,
  prefix = "member",
): Promise<string[]> {
  const ids: string[] = [];
  for (let start = 0; start < count; start += CHUNK) {
    const rows = Array.from(
      { length: Math.min(CHUNK, count - start) },
      (_, offset) => {
        const n = start + offset + 1;
        return {
          workspace_id: workspaceId,
          email: `${prefix}-${n}@example.test`,
          full_name: `${prefix} ${n}`,
        };
      },
    );
    const { data, error } = await adminClient()
      .from("contacts")
      .insert(rows)
      .select("id");
    if (error) {
      throw error;
    }
    ids.push(...data.map((row) => row.id));
  }
  return ids;
}

/** Creates a list (service role) and returns its id. */
export async function seedList(workspaceId: string, name: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("lists")
    .insert({ workspace_id: workspaceId, name })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}
```

- [ ] **Step 2: Failing tests** — `src/server/db/roster.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  anonClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedContacts, seedList } from "@/test/db/roster";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

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
  workspace = await createWorkspaceAs(owner, "Roster Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("contacts and lists RLS", () => {
  it("lets Owner/Admin write, Viewers read, and hides everything from others", async () => {
    const created = await admin.client
      .from("contacts")
      .insert({ workspace_id: workspace.id, email: "amira@example.test", full_name: "Amira" })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    const id = created.data?.id ?? "";

    const asViewer = await viewer.client.from("contacts").select("id, email").eq("workspace_id", workspace.id);
    expect(asViewer.data).toEqual([{ id, email: "amira@example.test" }]);
    const viewerInsert = await viewer.client
      .from("contacts")
      .insert({ workspace_id: workspace.id, email: "v@example.test", full_name: "V" });
    expect(viewerInsert.error?.code).toBe("42501");
    const viewerUpdate = await viewer.client.from("contacts").update({ full_name: "X" }).eq("id", id).select("id");
    expect(viewerUpdate.data).toEqual([]);

    expect((await outsider.client.from("contacts").select("id").eq("workspace_id", workspace.id)).data).toEqual([]);
    expect((await anonClient().from("contacts").select("id")).error?.code).toBe("42501");

    const renamed = await owner.client.from("contacts").update({ full_name: "Amira B." }).eq("id", id).select("full_name");
    expect(renamed.data).toEqual([{ full_name: "Amira B." }]);
  });

  it("stores emails normalized and rejects malformed ones", async () => {
    const bad = await admin.client
      .from("contacts")
      .insert({ workspace_id: workspace.id, email: "Not An Email", full_name: "Bad" });
    expect(bad.error?.code).toBe("23514");
    const upper = await admin.client
      .from("contacts")
      .insert({ workspace_id: workspace.id, email: "Amira@Example.test", full_name: "Amira" });
    expect(upper.error?.code).toBe("23514");
  });

  it("refuses a second contact with the same email and a list name differing only in case", async () => {
    await seedContacts(workspace.id, 1, "dup");
    const again = await admin.client
      .from("contacts")
      .insert({ workspace_id: workspace.id, email: "dup-1@example.test", full_name: "Again" });
    expect(again.error?.code).toBe("23505");
    await seedList(workspace.id, "Dev");
    const dev = await admin.client.from("lists").insert({ workspace_id: workspace.id, name: "dev" });
    expect(dev.error?.code).toBe("23505");
  });

  it("cannot link a contact to a list of another workspace", async () => {
    const other = await createWorkspaceAs(admin, "Other Club");
    const [contact] = await seedContacts(workspace.id, 1, "x");
    const foreignList = await seedList(other.id, "Foreign");
    const linked = await admin.client
      .from("list_contacts")
      .insert({ workspace_id: workspace.id, list_id: foreignList, contact_id: contact });
    expect(linked.error?.code).toBe("23503");
  });

  it("removes memberships when a list or a contact is deleted, never the people", async () => {
    const [a, b] = await seedContacts(workspace.id, 2, "keep");
    const list = await seedList(workspace.id, "Design");
    await admin.client.from("list_contacts").insert([
      { workspace_id: workspace.id, list_id: list, contact_id: a },
      { workspace_id: workspace.id, list_id: list, contact_id: b },
    ]);
    await admin.client.from("contacts").delete().eq("id", a);
    await admin.client.from("lists").delete().eq("id", list);
    const left = await adminClient().from("contacts").select("id").eq("workspace_id", workspace.id);
    expect(left.data).toEqual([{ id: b }]);
    const links = await adminClient().from("list_contacts").select("contact_id").eq("workspace_id", workspace.id);
    expect(links.data).toEqual([]);
  });
});

describe("caps", () => {
  it("allows 50 lists and refuses the 51st", async () => {
    for (let n = 1; n <= 50; n += 1) {
      await seedList(workspace.id, `List ${n}`);
    }
    await expectAppError(
      admin.client.from("lists").insert({ workspace_id: workspace.id, name: "One too many" }),
      "lists_limit_reached",
    );
  });

  it("allows 2,000 contacts and refuses the 2,001st, also under two concurrent inserts", async () => {
    await seedContacts(workspace.id, 1996, "fill");
    const insertTwo = (prefix: string) =>
      admin.client.from("contacts").insert([
        { workspace_id: workspace.id, email: `${prefix}-a@example.test`, full_name: "A" },
        { workspace_id: workspace.id, email: `${prefix}-b@example.test`, full_name: "B" },
        { workspace_id: workspace.id, email: `${prefix}-c@example.test`, full_name: "C" },
      ]);
    const [first, second] = await Promise.all([insertTwo("p"), insertTwo("q")]);
    const messages = [first.error?.message, second.error?.message];
    expect(messages.filter((message) => message === "tn:contacts_limit_reached")).toHaveLength(1);
    const { count } = await adminClient()
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id);
    expect(count).toBe(1999);
  });
});

describe("roster()", () => {
  it("returns every contact even past the Data API's 1,000-row cap (Review Focus 1)", async () => {
    await seedContacts(workspace.id, 1100, "big");
    const { data, error } = await viewer.client.rpc("roster", { p_workspace: workspace.id });
    expect(error).toBeNull();
    const roster = z.object({ contacts: z.array(z.object({ id: z.uuid() })) }).parse(data);
    expect(roster.contacts).toHaveLength(1100);
  });

  it("returns contacts with list ids, lists with counts, and the limits", async () => {
    const [ines] = await seedContacts(workspace.id, 1, "ines");
    const dev = await seedList(workspace.id, "dev team");
    await seedList(workspace.id, "Alumni");
    await adminClient().from("list_contacts").insert({ workspace_id: workspace.id, list_id: dev, contact_id: ines });
    const { data } = await admin.client.rpc("roster", { p_workspace: workspace.id });
    expect(data).toEqual({
      contacts: [{ id: ines, email: "ines-1@example.test", full_name: "ines 1", list_ids: [dev] }],
      lists: [
        { id: expect.any(String), name: "Alumni", contact_count: 0 },
        { id: dev, name: "dev team", contact_count: 1 },
      ],
      limits: { contacts_max: 2000, lists_max: 50, import_rows_max: 2000 },
    });
  });

  it("refuses non-members", async () => {
    await expectAppError(outsider.client.rpc("roster", { p_workspace: workspace.id }), "forbidden");
  });
});

describe("set_contact_lists()", () => {
  it("replaces a contact's lists atomically and checks the workspace", async () => {
    const [contact] = await seedContacts(workspace.id, 1, "sara");
    const dev = await seedList(workspace.id, "Dev");
    const events = await seedList(workspace.id, "Events");
    await admin.client.rpc("set_contact_lists", { p_contact: contact, p_list_ids: [dev, events] });
    await admin.client.rpc("set_contact_lists", { p_contact: contact, p_list_ids: [events] });
    const links = await adminClient().from("list_contacts").select("list_id").eq("contact_id", contact);
    expect(links.data).toEqual([{ list_id: events }]);

    const other = await createWorkspaceAs(owner, "Elsewhere");
    const foreign = await seedList(other.id, "Foreign");
    await expectAppError(
      admin.client.rpc("set_contact_lists", { p_contact: contact, p_list_ids: [foreign] }),
      "not_found",
    );
    await expectAppError(
      viewer.client.rpc("set_contact_lists", { p_contact: contact, p_list_ids: [] }),
      "forbidden",
    );
  });
});

describe("bulk_contacts()", () => {
  it("adds to, removes from a list, and deletes, ignoring other workspaces' ids", async () => {
    const ids = await seedContacts(workspace.id, 3, "bulk");
    const list = await seedList(workspace.id, "Media");
    const other = await createWorkspaceAs(owner, "Other");
    const [foreign] = await seedContacts(other.id, 1, "foreign");

    const added = await admin.client.rpc("bulk_contacts", {
      p_workspace: workspace.id, p_action: "add_to_list", p_contact_ids: [...ids, foreign], p_list_id: list,
    });
    expect(added.data).toBe(3);
    const removed = await admin.client.rpc("bulk_contacts", {
      p_workspace: workspace.id, p_action: "remove_from_list", p_contact_ids: [ids[0]], p_list_id: list,
    });
    expect(removed.data).toBe(1);
    const deleted = await admin.client.rpc("bulk_contacts", {
      p_workspace: workspace.id, p_action: "delete", p_contact_ids: [ids[1], foreign],
    });
    expect(deleted.data).toBe(1);
    expect((await adminClient().from("contacts").select("id").eq("id", foreign)).data).toHaveLength(1);
    await expectAppError(
      viewer.client.rpc("bulk_contacts", { p_workspace: workspace.id, p_action: "delete", p_contact_ids: ids }),
      "forbidden",
    );
    await expectAppError(
      admin.client.rpc("bulk_contacts", { p_workspace: workspace.id, p_action: "explode", p_contact_ids: ids }),
      "invalid_input",
    );
  });
});
```

- [ ] **Step 3: Run to verify failure** — `bun run test:db -- src/server/db/roster.db.test.ts`. Expected: FAIL (`relation "public.contacts" does not exist` / unknown RPC). Typecheck errors on `from("contacts")` are expected until Step 6 regenerates types.

- [ ] **Step 4: Migration** — `supabase migration new m3_roster </dev/null`:
```sql
-- M3 roster (spec §6 People & lists, §11): contacts, lists, memberships, caps, roster reads.

insert into private.app_limits (name, value) values
  ('contacts_per_workspace_max', 2000),
  ('lists_per_workspace_max', 50),
  ('import_rows_max', 2000),
  ('imports_per_user_per_hour', 30),
  ('import_previews_per_user_per_hour', 120);

-- Same rule as the app's emailSchema (Zod 4.6 `z.email()` on the lower-cased address).
create function private.is_valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
    and char_length(p_email) <= 254
    and p_email ~ '^([A-Za-z0-9_''+-]+\.)*[A-Za-z0-9_''+-]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$';
$$;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and private.is_valid_email(email)),
  full_name text not null check (full_name = btrim(full_name) and char_length(full_name) between 1 and 120),
  user_id uuid references auth.users (id) on delete set null,
  unsubscribed_at timestamptz,
  is_adhoc boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email),
  unique (id, workspace_id)
);
create index contacts_user_id_idx on public.contacts (user_id);
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function private.set_updated_at();

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create unique index lists_workspace_name_key on public.lists (workspace_id, lower(name));
create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function private.set_updated_at();

-- workspace_id + composite keys: a membership can only join a list and a contact of the same workspace.
create table public.list_contacts (
  workspace_id uuid not null,
  list_id uuid not null,
  contact_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (list_id, contact_id),
  foreign key (list_id, workspace_id) references public.lists (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index list_contacts_list_ws_idx on public.list_contacts (list_id, workspace_id);
create index list_contacts_contact_ws_idx on public.list_contacts (contact_id, workspace_id);

-- Caps (spec §6): checked after each insert statement, under a per-workspace advisory lock, so two
-- concurrent imports cannot both pass. Read Committed gives each query here a fresh snapshot, so
-- the second transaction to take the lock counts the first one's committed rows.
create function private.enforce_roster_caps()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_count integer;
begin
  for v_workspace in select distinct n.workspace_id from new_rows n loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('roster:' || tg_table_name || ':' || v_workspace::text));
    if tg_table_name = 'contacts' then
      select count(*) into v_count from public.contacts c where c.workspace_id = v_workspace and not c.is_adhoc;
      if v_count > private.app_limit('contacts_per_workspace_max') then
        raise exception 'tn:contacts_limit_reached' using errcode = 'P0001';
      end if;
    else
      select count(*) into v_count from public.lists l where l.workspace_id = v_workspace;
      if v_count > private.app_limit('lists_per_workspace_max') then
        raise exception 'tn:lists_limit_reached' using errcode = 'P0001';
      end if;
    end if;
  end loop;
  return null;
end;
$$;
create trigger contacts_enforce_cap
  after insert on public.contacts
  referencing new table as new_rows
  for each statement execute function private.enforce_roster_caps();
create trigger lists_enforce_cap
  after insert on public.lists
  referencing new table as new_rows
  for each statement execute function private.enforce_roster_caps();

create function private.hit_user_rate_limit(p_action text)
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
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.app_limit(text),
  private.is_valid_email(text),
  private.hit_user_rate_limit(text)
to authenticated;

-- Grants + RLS (new tables are not exposed by default).
alter table public.contacts enable row level security;
alter table public.lists enable row level security;
alter table public.list_contacts enable row level security;
revoke all on table public.contacts, public.lists, public.list_contacts from anon, authenticated;
grant select on table public.contacts, public.lists, public.list_contacts to authenticated;
grant insert (workspace_id, email, full_name), update (email, full_name), delete on table public.contacts to authenticated;
grant insert (workspace_id, name), update (name), delete on table public.lists to authenticated;
grant insert (workspace_id, list_id, contact_id), delete on table public.list_contacts to authenticated;
grant all on table public.contacts, public.lists, public.list_contacts to service_role;

create policy contacts_select_members on public.contacts
  for select to authenticated using (private.is_member(workspace_id));
create policy contacts_insert_managers on public.contacts
  for insert to authenticated with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy contacts_update_managers on public.contacts
  for update to authenticated
  using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy contacts_delete_managers on public.contacts
  for delete to authenticated using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy lists_select_members on public.lists
  for select to authenticated using (private.is_member(workspace_id));
create policy lists_insert_managers on public.lists
  for insert to authenticated with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy lists_update_managers on public.lists
  for update to authenticated
  using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy lists_delete_managers on public.lists
  for delete to authenticated using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy list_contacts_select_members on public.list_contacts
  for select to authenticated using (private.is_member(workspace_id));
create policy list_contacts_insert_managers on public.list_contacts
  for insert to authenticated with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy list_contacts_delete_managers on public.list_contacts
  for delete to authenticated using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- The whole roster as one value: a table select would stop at the Data API's 1,000-row cap.
create function public.roster(p_workspace uuid)
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
  return pg_catalog.jsonb_build_object(
    'contacts', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', c.id,
          'email', c.email,
          'full_name', c.full_name,
          'list_ids', coalesce((
            select pg_catalog.jsonb_agg(lc.list_id order by lc.list_id)
            from public.list_contacts lc where lc.contact_id = c.id
          ), '[]'::jsonb)
        )
        order by lower(c.full_name), c.email
      )
      from public.contacts c
      where c.workspace_id = p_workspace and not c.is_adhoc
    ), '[]'::jsonb),
    'lists', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', l.id,
          'name', l.name,
          'contact_count', (
            select count(*) from public.list_contacts lc
            join public.contacts c on c.id = lc.contact_id
            where lc.list_id = l.id and not c.is_adhoc
          )
        )
        order by lower(l.name)
      )
      from public.lists l
      where l.workspace_id = p_workspace
    ), '[]'::jsonb),
    'limits', pg_catalog.jsonb_build_object(
      'contacts_max', private.app_limit('contacts_per_workspace_max'),
      'lists_max', private.app_limit('lists_per_workspace_max'),
      'import_rows_max', private.app_limit('import_rows_max')
    )
  );
end;
$$;

create function public.set_contact_lists(p_contact uuid, p_list_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select c.workspace_id into v_workspace from public.contacts c where c.id = p_contact;
  if v_workspace is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(coalesce(p_list_ids, '{}')) as x(id)
    where not exists (select 1 from public.lists l where l.id = x.id and l.workspace_id = v_workspace)
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  delete from public.list_contacts lc
  where lc.contact_id = p_contact and lc.list_id <> all (coalesce(p_list_ids, '{}'));
  insert into public.list_contacts (workspace_id, list_id, contact_id)
  select v_workspace, x.id, p_contact from pg_catalog.unnest(coalesce(p_list_ids, '{}')) as x(id)
  on conflict do nothing;
end;
$$;

create function public.bulk_contacts(p_workspace uuid, p_action text, p_contact_ids uuid[], p_list_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_action in ('add_to_list', 'remove_from_list') and not exists (
    select 1 from public.lists l where l.id = p_list_id and l.workspace_id = p_workspace
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  case p_action
    when 'delete' then
      delete from public.contacts c where c.workspace_id = p_workspace and c.id = any (p_contact_ids);
    when 'add_to_list' then
      insert into public.list_contacts (workspace_id, list_id, contact_id)
      select p_workspace, p_list_id, c.id from public.contacts c
      where c.workspace_id = p_workspace and c.id = any (p_contact_ids)
      on conflict do nothing;
    when 'remove_from_list' then
      delete from public.list_contacts lc
      where lc.workspace_id = p_workspace and lc.list_id = p_list_id and lc.contact_id = any (p_contact_ids);
    else
      raise exception 'tn:invalid_input' using errcode = 'P0001';
  end case;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  public.roster(uuid),
  public.set_contact_lists(uuid, uuid[]),
  public.bulk_contacts(uuid, text, uuid[], uuid)
from public, anon;
grant execute on function
  public.roster(uuid),
  public.set_contact_lists(uuid, uuid[]),
  public.bulk_contacts(uuid, text, uuid[], uuid)
to authenticated;
```

- [ ] **Step 5: Allow-list** — in `src/server/db/function-security.db.test.ts`, add `"app_limit"`, `"hit_user_rate_limit"` and `"is_valid_email"` to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (keep it sorted).

- [ ] **Step 6: Apply, regenerate, verify** (verified on the local stack while planning: trigger functions fire without an `EXECUTE` grant, `on conflict (workspace_id, lower(name))` resolves the expression index, and the email regex agrees with Zod on `o'brien@…`, `a..b@…` and one-letter TLDs) — `supabase migration up --local </dev/null && bun run db:types`, then:
  - `bun run test:db` → all PASS (M2 suites too).
  - `bun run typecheck` → PASS.
  - `supabase db advisors --local </dev/null` → no WARN/ERROR (INFO about unused indexes on new tables is fine).

- [ ] **Step 7: Commit** — `feat: roster tables, RLS, caps and roster reads (M3)`.


- [ ] **Step 8: Hosted rollout (right after the PR merges)** — Vercel deploys `main` to production on every merge, and later tasks call these database objects, so apply the migration to both hosted projects now. The database passwords live in `~/.config/tapnshow/supabase-db-passwords.env` (list the variable names with `cut -d= -f1` on that file; never print values). For each project, preview first:
```bash
supabase link --project-ref wayabcidwnhgaazgsuns </dev/null   # preview; the CLI asks for that project's DB password
supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
supabase link --project-ref dysqhjvwabqahpctytnw </dev/null   # production; the repo stays linked to prod afterwards
supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
```
Pass the password through the `SUPABASE_DB_PASSWORD` environment variable from that file (the CLI reads it) instead of typing it. Expected: the new migration listed as applied on both projects; no new WARN/ERROR. Record the advisor output in the ledger.
---

### Task 3: DB — `import_contacts` (dry run + commit)

**Labels:** `area:db`

**Files:**
- Create: `supabase/migrations/<timestamp>_m3_import_contacts.sql`, `src/server/db/import-contacts.db.test.ts`
- Modify: `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: Task 2 tables, `private.is_valid_email`, `private.hit_user_rate_limit`, `private.app_limit`, `seedContacts`, `seedList`.
- Produces: `public.import_contacts(p_workspace uuid, p_rows jsonb, p_dry_run boolean, p_also_add_to_list uuid default null) returns jsonb` (invoker; Owner/Admin).
  - Input: `p_rows` is an array of `{ "row": int, "full_name": string|null, "email": string|null, "lists": string[] }`. `row` is the file row number shown to the user (falls back to the 1-based array position).
  - Output:
    ```json
    {
      "summary": { "new": 0, "updated": 0, "unchanged": 0, "invalid": 0, "merged": 0 },
      "new_lists": ["Events"],
      "limit_exceeded": null,
      "rows": [{ "row": 2, "email": "…", "full_name": "…", "outcome": "new|updated|unchanged|invalid",
                 "reason": null, "added_lists": ["Dev"], "previous_name": null, "merged_rows": [6] }]
    }
    ```
    `reason` ∈ `email_missing | email_invalid | name_missing | name_too_long | list_name_too_long`. `limit_exceeded` ∈ `null | "contacts" | "lists"`. One result per merged person (at its first row) plus one per invalid row, in input order.
  - Errors: `tn:forbidden`, `tn:invalid_input` (not an array), `tn:import_too_many_rows` (> `import_rows_max`), `tn:not_found` (unknown `p_also_add_to_list`), `tn:rate_limited`, and on commit `tn:contacts_limit_reached` / `tn:lists_limit_reached`.
  - Rules (spec §6): emails trimmed + lower-cased; names whitespace-collapsed; rows with the same email merge (lists united, last non-empty name wins); an empty name keeps an existing contact's name, and a new email without a name is `name_missing`; list names match existing lists ignoring case and unknown ones are created (first spelling wins); nothing is ever removed; a dry run writes no contacts or lists and counts against `import_previews_per_user_per_hour`; a commit counts against `imports_per_user_per_hour`.

Prototyped on the local stack while planning (rolled back): Task 2's migration plus this function gave the expected dry run, an identical commit, and a re-import of 0 new / 2 unchanged; with 2,000 rows the dry run took ~0.8 s, the commit ~2 s, and `roster()` returned ~400 KB.

- [ ] **Step 1: Failing tests** — `src/server/db/import-contacts.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { emailSchema } from "@/shared/api/common";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedContacts, seedList } from "@/test/db/roster";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const resultSchema = z.object({
  summary: z.object({
    new: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    invalid: z.number(),
    merged: z.number(),
  }),
  new_lists: z.array(z.string()),
  limit_exceeded: z.enum(["contacts", "lists"]).nullable(),
  rows: z.array(
    z.object({
      row: z.number(),
      email: z.string(),
      full_name: z.string().nullable(),
      outcome: z.enum(["new", "updated", "unchanged", "invalid"]),
      reason: z.string().nullable(),
      added_lists: z.array(z.string()),
      previous_name: z.string().nullable(),
      merged_rows: z.array(z.number()),
    }),
  ),
});
type ImportResult = z.infer<typeof resultSchema>;
type Row = { row?: number; full_name?: string | null; email?: string | null; lists?: string[] };

let owner: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Import Club");
  await addMember(workspace.id, viewer.id, "viewer");
});

async function run(rows: Row[], dryRun: boolean, alsoAddToList?: string, user = owner): Promise<ImportResult> {
  const { data, error } = await user.client.rpc("import_contacts", {
    p_workspace: workspace.id,
    p_rows: rows,
    p_dry_run: dryRun,
    p_also_add_to_list: alsoAddToList,
  });
  if (error) {
    throw new Error(error.message);
  }
  return resultSchema.parse(data);
}

async function counts(): Promise<{ contacts: number; lists: number; links: number }> {
  const admin = adminClient();
  const head = { count: "exact" as const, head: true };
  const [contacts, lists, links] = await Promise.all([
    admin.from("contacts").select("id", head).eq("workspace_id", workspace.id),
    admin.from("lists").select("id", head).eq("workspace_id", workspace.id),
    admin.from("list_contacts").select("list_id", head).eq("workspace_id", workspace.id),
  ]);
  return { contacts: contacts.count ?? -1, lists: lists.count ?? -1, links: links.count ?? -1 };
}

async function rosterOf(): Promise<Array<{ email: string; full_name: string; lists: string[] }>> {
  const { data } = await adminClient()
    .from("contacts")
    .select("email, full_name, list_contacts(lists(name))")
    .eq("workspace_id", workspace.id)
    .order("email");
  return (data ?? []).map((contact) => ({
    email: contact.email,
    full_name: contact.full_name,
    lists: contact.list_contacts.map((link) => link.lists?.name ?? "").sort(),
  }));
}

const ROSTER: Row[] = [
  { row: 2, full_name: "Inès  Ben Salah", email: " Ines@Example.com ", lists: ["Dev", "Events"] },
  { row: 3, full_name: "Youssef", email: "y@example.com", lists: ["design"] },
  { row: 4, full_name: "", email: "nobody@example.com", lists: [] },
  { row: 5, full_name: "Bad", email: "mehdi.g@gmail", lists: [] },
  { row: 6, full_name: "Inès B.", email: "ines@example.com", lists: ["dev", "Media"] },
  { row: 7, full_name: "Sarra", email: "", lists: [] },
];

async function seedYoussef(): Promise<void> {
  const design = await seedList(workspace.id, "Design");
  const { data } = await adminClient()
    .from("contacts")
    .insert({ workspace_id: workspace.id, email: "y@example.com", full_name: "Youssef T." })
    .select("id")
    .single();
  await adminClient()
    .from("list_contacts")
    .insert({ workspace_id: workspace.id, list_id: design, contact_id: data?.id ?? "" });
}

describe("import_contacts dry run", () => {
  it("classifies, merges and resolves lists without writing anything", async () => {
    await seedYoussef();
    const before = await counts();
    const result = await run(ROSTER, true);
    expect(await counts()).toEqual(before);
    expect(result.summary).toEqual({ new: 1, updated: 1, unchanged: 0, invalid: 3, merged: 1 });
    expect(result.new_lists).toEqual(["Dev", "Events", "Media"]);
    expect(result.limit_exceeded).toBeNull();
    expect(result.rows).toEqual([
      { row: 2, email: "ines@example.com", full_name: "Inès B.", outcome: "new", reason: null,
        added_lists: ["Dev", "Events", "Media"], previous_name: null, merged_rows: [6] },
      { row: 3, email: "y@example.com", full_name: "Youssef", outcome: "updated", reason: null,
        added_lists: [], previous_name: "Youssef T.", merged_rows: [] },
      { row: 4, email: "nobody@example.com", full_name: null, outcome: "invalid", reason: "name_missing",
        added_lists: [], previous_name: null, merged_rows: [] },
      { row: 5, email: "mehdi.g@gmail", full_name: "Bad", outcome: "invalid", reason: "email_invalid",
        added_lists: [], previous_name: null, merged_rows: [] },
      { row: 7, email: "", full_name: "Sarra", outcome: "invalid", reason: "email_missing",
        added_lists: [], previous_name: null, merged_rows: [] },
    ]);
  });

  it("agrees with emailSchema on which addresses are valid", async () => {
    const samples = [
      "o'brien@example.com", "first.last+tag@sub.example.tn", "a..b@example.com", ".a@example.com",
      "ines@example.c", "ines@example", "ines@-example.com", "ines@exa_mple.com", "inès@example.com",
      "a@b.co", "UPPER@EXAMPLE.COM",
    ];
    const result = await run(samples.map((email, i) => ({ row: i + 1, full_name: "X", email })), true);
    for (const [i, email] of samples.entries()) {
      const outcome = result.rows.find((row) => row.row === i + 1)?.outcome;
      expect({ email, valid: outcome !== "invalid" }).toEqual({ email, valid: emailSchema.safeParse(email).success });
    }
  });

  it("reports names and list names that are too long", async () => {
    const result = await run([
      { row: 1, full_name: "x".repeat(121), email: "long@example.com" },
      { row: 2, full_name: "Ok", email: "ok@example.com", lists: ["y".repeat(61)] },
    ], true);
    expect(result.rows.map((row) => row.reason)).toEqual(["name_too_long", "list_name_too_long"]);
  });

  it("flags a contact cap that the import would exceed", async () => {
    await seedContacts(workspace.id, 1999, "fill");
    const result = await run([
      { row: 1, full_name: "A", email: "a@example.com" },
      { row: 2, full_name: "B", email: "b@example.com" },
    ], true);
    expect(result.limit_exceeded).toBe("contacts");
    await expectAppError(
      owner.client.rpc("import_contacts", {
        p_workspace: workspace.id,
        p_rows: [{ row: 1, full_name: "A", email: "a@example.com" }, { row: 2, full_name: "B", email: "b@example.com" }],
        p_dry_run: false,
      }),
      "contacts_limit_reached",
    );
  });

  it("flags a list cap that the import would exceed", async () => {
    for (let n = 1; n <= 49; n += 1) {
      await seedList(workspace.id, `List ${n}`);
    }
    const result = await run([{ row: 1, full_name: "A", email: "a@example.com", lists: ["New 1", "New 2"] }], true);
    expect(result.limit_exceeded).toBe("lists");
  });
});

describe("import_contacts commit", () => {
  it("applies exactly what the dry run showed", async () => {
    await seedYoussef();
    const preview = await run(ROSTER, true);
    const committed = await run(ROSTER, false);
    expect(committed).toEqual(preview);
    expect(await rosterOf()).toEqual([
      { email: "ines@example.com", full_name: "Inès B.", lists: ["Dev", "Events", "Media"] },
      { email: "y@example.com", full_name: "Youssef", lists: ["Design"] },
    ]);
  });

  it("re-importing the same rows reports 0 new and creates nothing (Review Focus 4)", async () => {
    await run(ROSTER, false);
    const before = await counts();
    const again = await run(
      ROSTER.map((row) => ({ ...row, email: row.email?.toUpperCase(), lists: row.lists?.map((name) => name.toLowerCase()) })),
      false,
    );
    expect(again.summary.new).toBe(0);
    expect(again.new_lists).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it("updates names and adds lists, never removes a list", async () => {
    await seedYoussef();
    await run([{ row: 1, full_name: "Youssef Trabelsi", email: "y@example.com", lists: ["Media"] }], false);
    expect(await rosterOf()).toEqual([
      { email: "y@example.com", full_name: "Youssef Trabelsi", lists: ["Design", "Media"] },
    ]);
  });

  it("keeps the stored name when the file's name is empty", async () => {
    await seedYoussef();
    const result = await run([{ row: 1, full_name: "  ", email: "y@example.com", lists: ["Design"] }], false);
    expect(result.rows[0]).toMatchObject({ outcome: "unchanged", full_name: "Youssef T." });
  });

  it("adds everyone to the chosen list and refuses a list of another workspace", async () => {
    const alumni = await seedList(workspace.id, "Alumni");
    await run([
      { row: 1, full_name: "A", email: "a@example.com", lists: ["alumni"] },
      { row: 2, full_name: "B", email: "b@example.com" },
    ], false, alumni);
    expect((await rosterOf()).map((contact) => contact.lists)).toEqual([["Alumni"], ["Alumni"]]);
    const other = await createWorkspaceAs(owner, "Other Club");
    const foreign = await seedList(other.id, "Foreign");
    await expectAppError(
      owner.client.rpc("import_contacts", { p_workspace: workspace.id, p_rows: [], p_dry_run: true, p_also_add_to_list: foreign }),
      "not_found",
    );
  });
});

describe("import_contacts guards", () => {
  it("refuses Viewers and non-members", async () => {
    const outsider = await createTestUser();
    for (const user of [viewer, outsider]) {
      await expectAppError(
        user.client.rpc("import_contacts", { p_workspace: workspace.id, p_rows: [], p_dry_run: true }),
        "forbidden",
      );
    }
  });

  it("refuses more rows than import_rows_max", async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => ({ row: i + 1, full_name: "X", email: `x${i}@example.com` }));
    await expectAppError(
      owner.client.rpc("import_contacts", { p_workspace: workspace.id, p_rows: rows, p_dry_run: true }),
      "import_too_many_rows",
    );
  });

  it("limits commits to 30 per hour, separately from previews", async () => {
    for (let n = 0; n < 30; n += 1) {
      await run([{ row: 1, full_name: "Same", email: "same@example.com" }], false);
    }
    await expectAppError(
      owner.client.rpc("import_contacts", { p_workspace: workspace.id, p_rows: [], p_dry_run: false }),
      "rate_limited",
    );
    await expect(run([], true)).resolves.toMatchObject({ summary: { new: 0 } });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test:db -- src/server/db/import-contacts.db.test.ts`. Expected: FAIL (`Could not find the function public.import_contacts`).

- [ ] **Step 3: Migration** — `supabase migration new m3_import_contacts </dev/null`:
```sql
-- M3 import (spec §6 `import_contacts`, §7.14): one function computes the preview (dry run) and
-- applies the same plan (commit), so the two cannot drift.

create function public.import_contacts(
  p_workspace uuid,
  p_rows jsonb,
  p_dry_run boolean,
  p_also_add_to_list uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_rows jsonb;
  v_new_lists text[];
  v_also_name text;
  v_contacts_after integer;
  v_lists_after integer;
  v_limit_exceeded text;
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) > private.app_limit('import_rows_max') then
    raise exception 'tn:import_too_many_rows' using errcode = 'P0001';
  end if;
  if p_also_add_to_list is not null then
    select l.name into v_also_name from public.lists l
    where l.id = p_also_add_to_list and l.workspace_id = p_workspace;
    if v_also_name is null then
      raise exception 'tn:not_found' using errcode = 'P0001';
    end if;
  end if;
  if not private.hit_user_rate_limit(case when p_dry_run then 'import_preview' else 'import' end) then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;

  with input as (
    -- One row per element: normalized email, whitespace-collapsed name, raw list cells.
    select
      r.ord::integer as idx,
      coalesce(
        case when pg_catalog.jsonb_typeof(r.value -> 'row') = 'number' then (r.value ->> 'row')::numeric::integer end,
        r.ord::integer
      ) as row_no,
      lower(btrim(coalesce(r.value ->> 'email', ''))) as email,
      nullif(btrim(regexp_replace(coalesce(r.value ->> 'full_name', ''), '[[:space:]]+', ' ', 'g')), '') as full_name,
      case when pg_catalog.jsonb_typeof(r.value -> 'lists') = 'array' then r.value -> 'lists' else '[]'::jsonb end as lists_json
    from pg_catalog.jsonb_array_elements(p_rows) with ordinality as r(value, ord)
  ),
  input_lists as (
    select i.idx, l.ord::integer as ord, btrim(regexp_replace(l.value, '[[:space:]]+', ' ', 'g')) as name
    from input i
    cross join lateral pg_catalog.jsonb_array_elements_text(i.lists_json) with ordinality as l(value, ord)
  ),
  checked as (
    select i.idx, i.row_no, i.email, i.full_name,
      case
        when i.email = '' then 'email_missing'
        when not private.is_valid_email(i.email) then 'email_invalid'
        when char_length(i.full_name) > 120 then 'name_too_long'
        when exists (select 1 from input_lists il where il.idx = i.idx and char_length(il.name) > 60) then 'list_name_too_long'
      end as reason
    from input i
  ),
  grouped as (
    -- Rows sharing an email merge: the last non-empty name wins.
    select ch.email,
      (array_agg(ch.full_name order by ch.idx desc) filter (where ch.full_name is not null))[1] as file_name,
      array_agg(ch.row_no order by ch.idx) as row_nos,
      min(ch.idx) as first_idx
    from checked ch
    where ch.reason is null
    group by ch.email
  ),
  people as (
    select g.email, g.file_name, g.row_nos, g.first_idx,
      c.id as existing_id, c.full_name as existing_name,
      coalesce(g.file_name, c.full_name) as full_name
    from grouped g
    left join public.contacts c on c.workspace_id = p_workspace and c.email = g.email
  ),
  group_lists as (
    -- Each email's list names, case-insensitively de-duplicated (first spelling wins), resolved
    -- to an existing list when one matches ignoring case.
    select distinct on (ch.email, lower(il.name))
      ch.email, il.name, ch.idx, il.ord, l.id as list_id
    from checked ch
    join people g on g.email = ch.email and g.full_name is not null
    join input_lists il on il.idx = ch.idx and il.name <> ''
    left join public.lists l on l.workspace_id = p_workspace and lower(l.name) = lower(il.name)
    where ch.reason is null
    order by ch.email, lower(il.name), ch.idx, il.ord
  ),
  new_lists as (
    select distinct on (lower(gl.name)) gl.name, gl.idx, gl.ord
    from group_lists gl
    where gl.list_id is null
    order by lower(gl.name), gl.idx, gl.ord
  ),
  added as (
    -- Lists each person would gain: every list for a new contact, missing memberships otherwise.
    select gl.email, gl.name
    from group_lists gl
    join people g on g.email = gl.email
    where g.existing_id is null
      or gl.list_id is null
      or not exists (select 1 from public.list_contacts lc where lc.list_id = gl.list_id and lc.contact_id = g.existing_id)
    union all
    select g.email, v_also_name
    from people g
    where v_also_name is not null
      and g.full_name is not null
      and not exists (select 1 from group_lists gl where gl.email = g.email and lower(gl.name) = lower(v_also_name))
      and (
        g.existing_id is null
        or not exists (select 1 from public.list_contacts lc where lc.list_id = p_also_add_to_list and lc.contact_id = g.existing_id)
      )
  ),
  final_groups as (
    select g.email, g.full_name, g.existing_name, g.file_name, g.row_nos, g.first_idx,
      coalesce((select array_agg(a.name order by lower(a.name)) from added a where a.email = g.email), '{}') as added_lists,
      coalesce((select array_agg(gl.name order by gl.idx, gl.ord) from group_lists gl where gl.email = g.email), '{}') as lists,
      case
        when g.existing_id is null then 'new'
        when (g.file_name is not null and g.file_name <> g.existing_name)
          or exists (select 1 from added a where a.email = g.email) then 'updated'
        else 'unchanged'
      end as outcome
    from people g
    where g.full_name is not null
  ),
  row_results as (
    select ch.idx, pg_catalog.jsonb_build_object(
      'row', ch.row_no, 'email', ch.email, 'full_name', ch.full_name, 'outcome', 'invalid',
      'reason', ch.reason, 'added_lists', '[]'::jsonb, 'previous_name', null, 'merged_rows', '[]'::jsonb
    ) as result
    from checked ch
    where ch.reason is not null
    union all
    select ch.idx, pg_catalog.jsonb_build_object(
      'row', ch.row_no, 'email', ch.email, 'full_name', null, 'outcome', 'invalid',
      'reason', 'name_missing', 'added_lists', '[]'::jsonb, 'previous_name', null, 'merged_rows', '[]'::jsonb
    )
    from checked ch
    join people g on g.email = ch.email and g.full_name is null
    where ch.reason is null
    union all
    select fg.first_idx, pg_catalog.jsonb_build_object(
      'row', fg.row_nos[1], 'email', fg.email, 'full_name', fg.full_name, 'outcome', fg.outcome,
      'reason', null,
      'added_lists', pg_catalog.to_jsonb(fg.added_lists),
      'previous_name', case when fg.outcome = 'updated' and fg.file_name is not null and fg.file_name <> fg.existing_name then fg.existing_name end,
      'merged_rows', pg_catalog.to_jsonb(fg.row_nos[2:])
    )
    from final_groups fg
  )
  select
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'email', fg.email, 'full_name', fg.full_name, 'lists', pg_catalog.to_jsonb(fg.lists), 'outcome', fg.outcome
      ))
      from final_groups fg
    ), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(rr.result order by rr.idx) from row_results rr), '[]'::jsonb),
    coalesce((select array_agg(nl.name order by nl.idx, nl.ord) from new_lists nl), '{}')
  into v_groups, v_rows, v_new_lists;

  -- Caps as they would stand after this import (the insert triggers stay the final word).
  select count(*) + (
    select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'new'
  ) into v_contacts_after
  from public.contacts c where c.workspace_id = p_workspace and not c.is_adhoc;
  select count(*) + coalesce(array_length(v_new_lists, 1), 0) into v_lists_after
  from public.lists l where l.workspace_id = p_workspace;
  v_limit_exceeded := case
    when v_contacts_after > private.app_limit('contacts_per_workspace_max') then 'contacts'
    when v_lists_after > private.app_limit('lists_per_workspace_max') then 'lists'
  end;

  if not p_dry_run then
    if v_limit_exceeded = 'contacts' then
      raise exception 'tn:contacts_limit_reached' using errcode = 'P0001';
    elsif v_limit_exceeded = 'lists' then
      raise exception 'tn:lists_limit_reached' using errcode = 'P0001';
    end if;

    insert into public.lists (workspace_id, name)
    select p_workspace, n.name from pg_catalog.unnest(v_new_lists) as n(name)
    on conflict (workspace_id, lower(name)) do nothing;

    insert into public.contacts (workspace_id, email, full_name)
    select p_workspace, g.email, g.full_name
    from pg_catalog.jsonb_to_recordset(v_groups) as g(email text, full_name text, lists text[], outcome text)
    where g.outcome <> 'unchanged'
    on conflict (workspace_id, email) do update
      set full_name = excluded.full_name
      where public.contacts.full_name is distinct from excluded.full_name;

    insert into public.list_contacts (workspace_id, list_id, contact_id)
    select p_workspace, l.id, c.id
    from pg_catalog.jsonb_to_recordset(v_groups) as g(email text, full_name text, lists text[], outcome text)
    join public.contacts c on c.workspace_id = p_workspace and c.email = g.email
    cross join lateral pg_catalog.unnest(g.lists) as n(name)
    join public.lists l on l.workspace_id = p_workspace and lower(l.name) = lower(n.name)
    on conflict do nothing;

    if p_also_add_to_list is not null then
      insert into public.list_contacts (workspace_id, list_id, contact_id)
      select p_workspace, p_also_add_to_list, c.id
      from pg_catalog.jsonb_to_recordset(v_groups) as g(email text)
      join public.contacts c on c.workspace_id = p_workspace and c.email = g.email
      on conflict do nothing;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'summary', pg_catalog.jsonb_build_object(
      'new', (select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'new'),
      'updated', (select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'updated'),
      'unchanged', (select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'unchanged'),
      'invalid', (select count(*) from pg_catalog.jsonb_array_elements(v_rows) r where r ->> 'outcome' = 'invalid'),
      'merged', (select coalesce(sum(pg_catalog.jsonb_array_length(r -> 'merged_rows')), 0) from pg_catalog.jsonb_array_elements(v_rows) r)
    ),
    'new_lists', pg_catalog.to_jsonb(v_new_lists),
    'limit_exceeded', v_limit_exceeded,
    'rows', v_rows
  );
end;
$$;

revoke execute on function public.import_contacts(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_contacts(uuid, jsonb, boolean, uuid) to authenticated;
```

- [ ] **Step 4: Apply and verify** — `supabase migration up --local </dev/null && bun run db:types`, then `bun run test:db` (all PASS), `bun run typecheck` (PASS), `supabase db advisors --local </dev/null` (no WARN/ERROR).

- [ ] **Step 5: Commit** — `feat: import_contacts with dry-run preview and merge on re-import`.


- [ ] **Step 6: Hosted rollout (right after the PR merges)** — Vercel deploys `main` to production on every merge, and later tasks call these database objects, so apply the migration to both hosted projects now. The database passwords live in `~/.config/tapnshow/supabase-db-passwords.env` (list the variable names with `cut -d= -f1` on that file; never print values). For each project, preview first:
```bash
supabase link --project-ref wayabcidwnhgaazgsuns </dev/null   # preview; the CLI asks for that project's DB password
supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
supabase link --project-ref dysqhjvwabqahpctytnw </dev/null   # production; the repo stays linked to prod afterwards
supabase db push </dev/null && supabase migration list --linked </dev/null && supabase db advisors --linked </dev/null
```
Pass the password through the `SUPABASE_DB_PASSWORD` environment variable from that file (the CLI reads it) instead of typing it. Expected: the new migration listed as applied on both projects; no new WARN/ERROR. Record the advisor output in the ledger.
---

### Task 4: API — error codes, shared schemas, queries, routes, hooks

**Labels:** `area:api`

**Files:**
- Create: `src/config/roster.ts`, `src/shared/api/roster.ts`, `src/shared/api/roster.test.ts`, `src/server/queries/roster.ts`, `src/lib/roster/roster-cache.ts`, `src/lib/roster/roster-cache.test.ts`, `src/hooks/use-roster.ts`, `src/test/fixtures/roster.ts`
- Create routes + tests: `src/app/api/workspaces/[slug]/contacts/route.ts` (GET), `…/contacts/import/route.ts` (POST), `…/contacts/[id]/route.ts` (PATCH, DELETE), `…/contacts/bulk/route.ts` (POST), `…/lists/route.ts` (POST), `…/lists/[id]/route.ts` (PATCH, DELETE), each with a `route.test.ts` next to it
- Create: `src/server/http/forbid-viewer.ts` + `forbid-viewer.test.ts`
- Modify: `src/shared/api/errors.ts`, `messages/en.json` (`ApiErrors`), `src/server/http/errors.ts` + test, `src/test/workspace-context-mock.ts`

**Interfaces:**
- Consumes: Task 2/3 RPCs and tables; `loadWorkspaceContext`, `rejectCrossOrigin`, `parseJsonBody`, `apiError`, `ok`, `apiRequest`, `okSchema`, `emailSchema`.
- Produces (client and later tasks rely on these exact names):
  - `src/config/roster.ts`: `IMPORT_FILE_MAX_BYTES = 5 * 1024 * 1024`, `IMPORT_CELL_MAX_CHARS = 500`, `IMPORT_LISTS_PER_ROW_MAX = 50`, `UNDO_DELETE_MS = 5000`, `LIST_CELL_SEPARATORS = /[,;|]/`.
  - `src/shared/api/roster.ts`: `contactNameSchema`, `listNameSchema`, `contactSchema` / `Contact`, `listSummarySchema` / `ListSummary`, `rosterLimitsSchema`, `rosterSchema` / `Roster`, `importRowInputSchema` / `ImportRowInput`, `importBodySchema` / `ImportBody`, `IMPORT_REASONS`, `importReasonSchema` / `ImportReason`, `importOutcomeSchema` / `ImportOutcome`, `importRowResultSchema` / `ImportRowResult`, `importResultSchema` / `ImportResult`, `updateContactBodySchema` / `UpdateContactBody`, `bulkContactsBodySchema` / `BulkContactsBody`, `bulkResultSchema`, `listBodySchema`, `listCreatedSchema` / `ListCreated`.
  - `fromDatabaseError(error, overrides?: Readonly<Record<string, ApiErrorCode>>)` — overrides map a Postgres SQLSTATE (e.g. `"23505"`) to a specific code before the generic mapping.
  - `forbidViewer(workspace: WorkspaceDetails): NextResponse | null` in `src/server/http/forbid-viewer.ts` (its own module so route tests can mock `workspace-context` whole, as M2's do).
  - `src/server/queries/roster.ts`: `getRoster`, `importContacts`, `updateContact`, `setContactLists`, `deleteContact`, `bulkContacts`, `createList`, `renameList`, `deleteList` (signatures in Step 6).
  - `src/lib/roster/roster-cache.ts`: `patchContact`, `removeContacts`, `addList`, `withListCounts`.
  - `src/hooks/use-roster.ts`: `rosterQueryKey(slug)`, `rosterPath(slug)`, `useRoster`, `useUpdateContact`, `useDeleteContact`, `useBulkContacts`, `useCreateList`, `useRenameList`, `useDeleteList`, `useImportContacts`.
  - Error codes `contact_email_taken` (409), `contacts_limit_reached` (409), `lists_limit_reached` (409), `list_name_taken` (409), `import_too_many_rows` (400).

- [ ] **Step 1: Config** — `src/config/roster.ts`:
```ts
/** Largest file the import dialog accepts; parsed on the device, never uploaded (spec §7.14). */
export const IMPORT_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Longest cell text sent to the import route. Above every database rule (name 120, email 254,
 * list 60), so the dry run still reports "too long" instead of the request being refused.
 */
export const IMPORT_CELL_MAX_CHARS = 500;

/** Most list names one row may carry. */
export const IMPORT_LISTS_PER_ROW_MAX = 50;

/** How long a deleted person can be restored with Undo before the delete is sent (spec §7.14). */
export const UNDO_DELETE_MS = 5000;

/** Separators inside one Lists cell: "Dev, Events" or "Dev; Events" or "Dev | Events" (spec §4). */
export const LIST_CELL_SEPARATORS = /[,;|]/;
```

- [ ] **Step 2: Failing schema tests** — `src/shared/api/roster.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  bulkContactsBodySchema,
  contactNameSchema,
  importBodySchema,
  listNameSchema,
  updateContactBodySchema,
} from "./roster";

describe("roster schemas", () => {
  it("trims names and enforces the database lengths", () => {
    expect(contactNameSchema.parse("  Inès  ")).toBe("Inès");
    expect(contactNameSchema.safeParse("x".repeat(121)).success).toBe(false);
    expect(listNameSchema.safeParse("y".repeat(61)).success).toBe(false);
    expect(listNameSchema.safeParse("   ").success).toBe(false);
  });

  it("needs at least one field to update and normalizes the email", () => {
    expect(updateContactBodySchema.safeParse({}).success).toBe(false);
    expect(updateContactBodySchema.parse({ email: " Ines@Example.COM " })).toEqual({ email: "ines@example.com" });
  });

  it("accepts raw import cells and caps their size", () => {
    const row = { row: 2, fullName: "  messy  ", email: "not an email", lists: ["Dev"] };
    expect(importBodySchema.parse({ rows: [row], dryRun: true })).toEqual({ rows: [row], dryRun: true });
    expect(importBodySchema.safeParse({ rows: [{ ...row, email: "x".repeat(501) }], dryRun: true }).success).toBe(false);
    expect(importBodySchema.safeParse({ rows: [{ ...row, row: 0 }], dryRun: true }).success).toBe(false);
  });

  it("requires a list for list actions", () => {
    const ids = [crypto.randomUUID()];
    expect(bulkContactsBodySchema.safeParse({ action: "delete", contactIds: ids }).success).toBe(true);
    expect(bulkContactsBodySchema.safeParse({ action: "addToList", contactIds: ids }).success).toBe(false);
    expect(bulkContactsBodySchema.safeParse({ action: "delete", contactIds: [] }).success).toBe(false);
  });
});
```
Run `bun run test src/shared/api/roster.test.ts` → FAIL (module not found).

- [ ] **Step 3: Schemas** — `src/shared/api/roster.ts`:
```ts
import { z } from "zod";
import {
  IMPORT_CELL_MAX_CHARS,
  IMPORT_LISTS_PER_ROW_MAX,
} from "@/config/roster";
import { emailSchema } from "./common";

/** A person's full name (matches the database check: trimmed, 1–120 characters). */
export const contactNameSchema = z.string().trim().min(1).max(120);

/** A list name (matches the database check: trimmed, 1–60 characters). */
export const listNameSchema = z.string().trim().min(1).max(60);

/** One person of the roster. */
export const contactSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  listIds: z.array(z.uuid()),
});
/** One person of the roster. */
export type Contact = z.infer<typeof contactSchema>;

/** A list with how many roster people are in it. */
export const listSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactCount: z.number().int().nonnegative(),
});
/** A list with its member count. */
export type ListSummary = z.infer<typeof listSummarySchema>;

/** Caps the UI needs (values come from the database's app_limits). */
export const rosterLimitsSchema = z.object({
  contactsMax: z.number().int().positive(),
  listsMax: z.number().int().positive(),
  importRowsMax: z.number().int().positive(),
});

/** `GET /api/workspaces/[slug]/contacts` response: the whole roster. */
export const rosterSchema = z.object({
  contacts: z.array(contactSchema),
  lists: z.array(listSummarySchema),
  limits: rosterLimitsSchema,
});
/** The whole roster of a workspace. */
export type Roster = z.infer<typeof rosterSchema>;

const importCell = z.string().max(IMPORT_CELL_MAX_CHARS);

/** One row sent to the import route: raw cell text; the database validates and reports. */
export const importRowInputSchema = z.object({
  row: z.number().int().positive(),
  fullName: importCell.nullable(),
  email: importCell.nullable(),
  lists: z.array(importCell).max(IMPORT_LISTS_PER_ROW_MAX),
});
/** One row sent to the import route. */
export type ImportRowInput = z.infer<typeof importRowInputSchema>;

/** `POST …/contacts/import` body. The row count is checked by the database (`import_rows_max`). */
export const importBodySchema = z.object({
  rows: z.array(importRowInputSchema),
  dryRun: z.boolean(),
  alsoAddToListId: z.uuid().optional(),
});
/** `POST …/contacts/import` body. */
export type ImportBody = z.infer<typeof importBodySchema>;

/** Why a row is skipped. */
export const IMPORT_REASONS = [
  "email_missing",
  "email_invalid",
  "name_missing",
  "name_too_long",
  "list_name_too_long",
] as const;
/** Why a row is skipped. */
export const importReasonSchema = z.enum(IMPORT_REASONS);
/** Why a row is skipped. */
export type ImportReason = z.infer<typeof importReasonSchema>;

/** What the import does with a row. */
export const importOutcomeSchema = z.enum(["new", "updated", "unchanged", "invalid"]);
/** What the import does with a row. */
export type ImportOutcome = z.infer<typeof importOutcomeSchema>;

/** One row of the preview (a merged person appears once, at its first row). */
export const importRowResultSchema = z.object({
  row: z.number().int(),
  email: z.string(),
  fullName: z.string().nullable(),
  outcome: importOutcomeSchema,
  reason: importReasonSchema.nullable(),
  addedLists: z.array(z.string()),
  previousName: z.string().nullable(),
  mergedRows: z.array(z.number().int()),
});
/** One row of the preview. */
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

/** `POST …/contacts/import` response (dry run = preview; commit = what was applied). */
export const importResultSchema = z.object({
  summary: z.object({
    new: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    invalid: z.number().int(),
    merged: z.number().int(),
  }),
  newLists: z.array(z.string()),
  limitExceeded: z.enum(["contacts", "lists"]).nullable(),
  rows: z.array(importRowResultSchema),
});
/** Import preview or result. */
export type ImportResult = z.infer<typeof importResultSchema>;

/** `PATCH …/contacts/[id]` body: one or more fields; `listIds` replaces the person's lists. */
export const updateContactBodySchema = z
  .object({
    fullName: contactNameSchema.optional(),
    email: emailSchema.optional(),
    listIds: z.array(z.uuid()).optional(),
  })
  .refine(
    (body) =>
      body.fullName !== undefined ||
      body.email !== undefined ||
      body.listIds !== undefined,
  );
/** `PATCH …/contacts/[id]` body. */
export type UpdateContactBody = z.infer<typeof updateContactBodySchema>;

const contactIds = z.array(z.uuid()).min(1);

/** `POST …/contacts/bulk` body (Select mode). */
export const bulkContactsBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), contactIds }),
  z.object({ action: z.literal("addToList"), contactIds, listId: z.uuid() }),
  z.object({ action: z.literal("removeFromList"), contactIds, listId: z.uuid() }),
]);
/** `POST …/contacts/bulk` body. */
export type BulkContactsBody = z.infer<typeof bulkContactsBodySchema>;

/** `POST …/contacts/bulk` response. */
export const bulkResultSchema = z.object({ affected: z.number().int() });

/** `POST …/lists` and `PATCH …/lists/[id]` body. */
export const listBodySchema = z.object({ name: listNameSchema });

/** `POST …/lists` response. */
export const listCreatedSchema = z.object({ id: z.uuid(), name: z.string() });
/** A list just created. */
export type ListCreated = z.infer<typeof listCreatedSchema>;
```
Run the test → PASS.

- [ ] **Step 4: Error codes** — in `src/shared/api/errors.ts` append to `API_ERROR_CODES` (before `] as const`): `"contact_email_taken"`, `"contacts_limit_reached"`, `"lists_limit_reached"`, `"list_name_taken"`, `"import_too_many_rows"`; and to `API_ERROR_STATUS`: `contact_email_taken: 409`, `contacts_limit_reached: 409`, `lists_limit_reached: 409`, `list_name_taken: 409`, `import_too_many_rows: 400`. In `messages/en.json` → `ApiErrors` add:
```json
"contact_email_taken": "Someone in your roster already uses this email.",
"contacts_limit_reached": "Your roster is full. Remove people before adding more.",
"lists_limit_reached": "You have the maximum number of lists. Delete one first.",
"list_name_taken": "A list with this name already exists.",
"import_too_many_rows": "This file has too many rows. Split it and import each part."
```
`bun run test src/shared/api/errors.test.ts` → PASS (every code translated).

- [ ] **Step 5: `fromDatabaseError` overrides + `forbidViewer`** — failing tests first. Append to `src/server/http/errors.test.ts`:
```ts
describe("fromDatabaseError overrides", () => {
  it("maps a Postgres code to a specific API code when the route knows the meaning", async () => {
    const response = fromDatabaseError(
      { code: "23505", message: "duplicate key" },
      { "23505": "contact_email_taken" },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "contact_email_taken" } });
  });

  it("still prefers tn:<code> from our functions", async () => {
    const response = fromDatabaseError(
      { code: "P0001", message: "tn:contacts_limit_reached" },
      { P0001: "conflict" },
    );
    expect(await response.json()).toEqual({ error: { code: "contacts_limit_reached" } });
  });
});
```
Create `src/server/http/forbid-viewer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { forbidViewer } from "./forbid-viewer";

describe("forbidViewer", () => {
  it("returns 403 for Viewers and null for Owner/Admin", async () => {
    const base = { id: "w1", slug: "s", name: "N", timezone: "Africa/Tunis", canCheckIn: false };
    const viewer = forbidViewer({ ...base, myRole: "viewer" });
    expect(viewer?.status).toBe(403);
    expect(await viewer?.json()).toEqual({ error: { code: "forbidden" } });
    expect(forbidViewer({ ...base, myRole: "admin" })).toBeNull();
    expect(forbidViewer({ ...base, myRole: "owner" })).toBeNull();
  });
});
```
Run both → FAIL. Then in `src/server/http/errors.ts` replace `fromDatabaseError` with:
```ts
/**
 * Converts a Supabase/PostgREST error into an API error. `tn:<code>` messages come from our
 * database functions; `overrides` let a route name what a Postgres code means for it (e.g. a
 * unique violation on contacts is `contact_email_taken`); anything unexpected is logged and
 * returned as `internal`.
 */
export function fromDatabaseError(
  error: { code?: string; message: string },
  overrides: Readonly<Record<string, ApiErrorCode>> = {},
): NextResponse {
  const appCode = /^tn:([a-z_]+)$/.exec(error.message)?.[1];
  if (appCode && isApiErrorCode(appCode)) {
    return apiError(appCode);
  }
  const mapped = error.code
    ? (overrides[error.code] ?? POSTGRES_CODES[error.code])
    : undefined;
  if (mapped) {
    return apiError(mapped);
  }
  logger.error({ err: error }, "unexpected database error");
  return apiError("internal");
}
```
and create `src/server/http/forbid-viewer.ts`:
```ts
import "server-only";
import type { NextResponse } from "next/server";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { apiError } from "./errors";

/** 403 for Viewers on roster writes (RLS refuses them too; this answers early and clearly). */
export function forbidViewer(workspace: WorkspaceDetails): NextResponse | null {
  return workspace.myRole === "viewer" ? apiError("forbidden") : null;
}
```
Run both tests → PASS.

- [ ] **Step 6: Query module** — `src/server/queries/roster.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  importReasonSchema,
  type ImportResult,
  type ImportRowInput,
  type Roster,
} from "@/shared/api/roster";

type Client = SupabaseClient<Database>;

/** Error shape every mutation returns (PostgREST error subset). */
export type DbError = { code?: string; message: string };

const dbRosterSchema = z
  .object({
    contacts: z.array(
      z.object({
        id: z.uuid(),
        email: z.string(),
        full_name: z.string(),
        list_ids: z.array(z.uuid()),
      }),
    ),
    lists: z.array(
      z.object({ id: z.uuid(), name: z.string(), contact_count: z.number().int() }),
    ),
    limits: z.object({
      contacts_max: z.number().int(),
      lists_max: z.number().int(),
      import_rows_max: z.number().int(),
    }),
  })
  .transform(
    (db): Roster => ({
      contacts: db.contacts.map((c) => ({
        id: c.id,
        email: c.email,
        fullName: c.full_name,
        listIds: c.list_ids,
      })),
      lists: db.lists.map((l) => ({ id: l.id, name: l.name, contactCount: l.contact_count })),
      limits: {
        contactsMax: db.limits.contacts_max,
        listsMax: db.limits.lists_max,
        importRowsMax: db.limits.import_rows_max,
      },
    }),
  );

const dbImportResultSchema = z
  .object({
    summary: z.object({
      new: z.number().int(),
      updated: z.number().int(),
      unchanged: z.number().int(),
      invalid: z.number().int(),
      merged: z.number().int(),
    }),
    new_lists: z.array(z.string()),
    limit_exceeded: z.enum(["contacts", "lists"]).nullable(),
    rows: z.array(
      z.object({
        row: z.number().int(),
        email: z.string(),
        full_name: z.string().nullable(),
        outcome: z.enum(["new", "updated", "unchanged", "invalid"]),
        reason: importReasonSchema.nullable(),
        added_lists: z.array(z.string()),
        previous_name: z.string().nullable(),
        merged_rows: z.array(z.number().int()),
      }),
    ),
  })
  .transform(
    (db): ImportResult => ({
      summary: db.summary,
      newLists: db.new_lists,
      limitExceeded: db.limit_exceeded,
      rows: db.rows.map((r) => ({
        row: r.row,
        email: r.email,
        fullName: r.full_name,
        outcome: r.outcome,
        reason: r.reason,
        addedLists: r.added_lists,
        previousName: r.previous_name,
        mergedRows: r.merged_rows,
      })),
    }),
  );

/**
 * The whole roster through `roster()` (one jsonb value, so the 1,000-row Data API cap never applies).
 * @throws Error with the database message
 */
export async function getRoster(client: Client, workspaceId: string): Promise<Roster> {
  const { data, error } = await client.rpc("roster", { p_workspace: workspaceId });
  if (error) {
    throw new Error(error.message);
  }
  return dbRosterSchema.parse(data);
}

/** `import_contacts` (dry run = preview; commit = apply). */
export async function importContacts(
  client: Client,
  input: {
    workspaceId: string;
    rows: ImportRowInput[];
    dryRun: boolean;
    alsoAddToListId?: string;
  },
): Promise<{ data: ImportResult; error: null } | { data: null; error: DbError }> {
  const { data, error } = await client.rpc("import_contacts", {
    p_workspace: input.workspaceId,
    p_rows: input.rows.map((row) => ({
      row: row.row,
      full_name: row.fullName,
      email: row.email,
      lists: row.lists,
    })),
    p_dry_run: input.dryRun,
    p_also_add_to_list: input.alsoAddToListId,
  });
  return error
    ? { data: null, error }
    : { data: dbImportResultSchema.parse(data), error: null };
}

/** Renames a person or changes their email (RLS: Owner/Admin). Empty `data` means not found. */
export function updateContact(
  client: Client,
  input: { workspaceId: string; contactId: string; fullName?: string; email?: string },
) {
  return client
    .from("contacts")
    .update({ full_name: input.fullName, email: input.email })
    .eq("id", input.contactId)
    .eq("workspace_id", input.workspaceId)
    .select("id");
}

/** `set_contact_lists`: the person's lists become exactly `listIds`. */
export function setContactLists(client: Client, contactId: string, listIds: string[]) {
  return client.rpc("set_contact_lists", { p_contact: contactId, p_list_ids: listIds });
}

/** Deletes one person (memberships go with them). Empty `data` means not found. */
export function deleteContact(client: Client, workspaceId: string, contactId: string) {
  return client
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .select("id");
}

const BULK_ACTIONS = {
  delete: "delete",
  addToList: "add_to_list",
  removeFromList: "remove_from_list",
} as const;

/** `bulk_contacts`: Select-mode actions; returns the number of affected rows. */
export function bulkContacts(
  client: Client,
  input: {
    workspaceId: string;
    action: keyof typeof BULK_ACTIONS;
    contactIds: string[];
    listId?: string;
  },
) {
  return client.rpc("bulk_contacts", {
    p_workspace: input.workspaceId,
    p_action: BULK_ACTIONS[input.action],
    p_contact_ids: input.contactIds,
    p_list_id: input.listId,
  });
}

/** Creates a list (case-insensitive unique name; cap trigger). */
export function createList(client: Client, workspaceId: string, name: string) {
  return client
    .from("lists")
    .insert({ workspace_id: workspaceId, name })
    .select("id, name")
    .single();
}

/** Renames a list. Empty `data` means not found. */
export function renameList(client: Client, workspaceId: string, listId: string, name: string) {
  return client
    .from("lists")
    .update({ name })
    .eq("id", listId)
    .eq("workspace_id", workspaceId)
    .select("id");
}

/** Deletes a list (people stay). Empty `data` means not found. */
export function deleteList(client: Client, workspaceId: string, listId: string) {
  return client
    .from("lists")
    .delete()
    .eq("id", listId)
    .eq("workspace_id", workspaceId)
    .select("id");
}
```
`updateContact` passes `undefined` for an unchanged field; supabase-js drops `undefined` keys from the JSON body, so only the sent field changes.

- [ ] **Step 7: Test helpers** — `src/test/fixtures/roster.ts`:
```ts
import type { ImportResult, Roster } from "@/shared/api/roster";

/** Stable ids for UI and cache tests. */
export const IDS = {
  ines: "00000000-0000-4000-8000-000000000001",
  youssef: "00000000-0000-4000-8000-000000000002",
  sarra: "00000000-0000-4000-8000-000000000003",
  dev: "00000000-0000-4000-8000-0000000000d1",
  design: "00000000-0000-4000-8000-0000000000d2",
} as const;

/** A small roster: two lists, three people. */
export const rosterFixture: Roster = {
  contacts: [
    { id: IDS.ines, email: "ines@example.com", fullName: "Inès Ben Salah", listIds: [IDS.dev] },
    { id: IDS.sarra, email: "sarra@example.com", fullName: "Sarra Khelifi", listIds: [IDS.dev, IDS.design] },
    { id: IDS.youssef, email: "y@example.com", fullName: "Youssef Trabelsi", listIds: [] },
  ],
  lists: [
    { id: IDS.design, name: "Design", contactCount: 1 },
    { id: IDS.dev, name: "Dev", contactCount: 2 },
  ],
  limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
};

/** A preview with one row of each kind. */
export const importPreviewFixture: ImportResult = {
  summary: { new: 1, updated: 1, unchanged: 1, invalid: 1, merged: 1 },
  newLists: ["Events"],
  limitExceeded: null,
  rows: [
    { row: 2, email: "amira@example.com", fullName: "Amira", outcome: "new", reason: null, addedLists: ["Events"], previousName: null, mergedRows: [9] },
    { row: 3, email: "y@example.com", fullName: "Youssef T.", outcome: "updated", reason: null, addedLists: [], previousName: "Youssef Trabelsi", mergedRows: [] },
    { row: 4, email: "ines@example.com", fullName: "Inès Ben Salah", outcome: "unchanged", reason: null, addedLists: [], previousName: null, mergedRows: [] },
    { row: 5, email: "mehdi.g@gmail", fullName: "Mehdi", outcome: "invalid", reason: "email_invalid", addedLists: [], previousName: null, mergedRows: [] },
  ],
};
```
Append to `src/test/workspace-context-mock.ts`:
```ts
/** Same as `okContext` but the caller is a Viewer. */
export const viewerContext = {
  ...okContext,
  workspace: { ...okContext.workspace, myRole: "viewer" as const },
};
```

- [ ] **Step 8: Failing route tests** — one file per route. `src/app/api/workspaces/[slug]/contacts/route.test.ts`:
```ts
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { rosterFixture } from "@/test/fixtures/roster";
import { viewerContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => viewerContext,
}));
vi.mock("@/server/queries/roster", () => ({ getRoster: async () => rosterFixture }));

describe("GET /api/workspaces/[slug]/contacts", () => {
  it("returns the roster to any member, Viewers included", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/workspaces/club-ab12/contacts"),
      { params: Promise.resolve({ slug: "club-ab12" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rosterFixture);
  });
});
```
`…/contacts/import/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPreviewFixture } from "@/test/fixtures/roster";
import { jsonRequest, okContext, viewerContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  context: { current: null as object | null },
  importContacts: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => mocks.context.current,
}));
vi.mock("@/server/queries/roster", () => ({ importContacts: mocks.importContacts }));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const body = { rows: [{ row: 2, fullName: "Amira", email: "amira@example.com", lists: ["Events"] }], dryRun: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.current = okContext;
  mocks.importContacts.mockResolvedValue({ data: importPreviewFixture, error: null });
});

describe("POST /api/workspaces/[slug]/contacts/import", () => {
  it("returns the dry-run preview", async () => {
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", body), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(importPreviewFixture);
    expect(mocks.importContacts).toHaveBeenCalledWith({}, { workspaceId: "w1", ...body });
  });

  it("refuses Viewers before touching the database", async () => {
    mocks.context.current = viewerContext;
    const { POST } = await import("./route");
    expect((await POST(jsonRequest("POST", body), ctx)).status).toBe(403);
    expect(mocks.importContacts).not.toHaveBeenCalled();
  });

  it("refuses cross-origin requests and malformed bodies", async () => {
    const { POST } = await import("./route");
    const foreign = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify(body),
    });
    expect((await POST(foreign, ctx)).status).toBe(403);
    expect((await POST(jsonRequest("POST", { rows: "nope", dryRun: true }), ctx)).status).toBe(400);
  });

  it("maps database refusals", async () => {
    mocks.importContacts.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "tn:import_too_many_rows" } });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", body), ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "import_too_many_rows" } });
  });
});
```
`…/contacts/[id]/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

type Result = { data: Array<{ id: string }> | null; error: { code?: string; message: string } | null };
const found: Result = { data: [{ id: IDS.ines }], error: null };
const mocks = vi.hoisted(() => ({
  updateContact: vi.fn(),
  setContactLists: vi.fn(),
  deleteContact: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12", id: IDS.ines }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateContact.mockResolvedValue(found);
  mocks.setContactLists.mockResolvedValue({ error: null });
  mocks.deleteContact.mockResolvedValue(found);
});

describe("/api/workspaces/[slug]/contacts/[id]", () => {
  it("PATCH renames without touching lists", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(jsonRequest("PATCH", { fullName: " Inès B. " }), ctx)).status).toBe(200);
    expect(mocks.updateContact).toHaveBeenCalledWith({}, { workspaceId: "w1", contactId: IDS.ines, fullName: "Inès B.", email: undefined });
    expect(mocks.setContactLists).not.toHaveBeenCalled();
  });

  it("PATCH with listIds only replaces the lists", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(jsonRequest("PATCH", { listIds: [IDS.dev] }), ctx)).status).toBe(200);
    expect(mocks.updateContact).not.toHaveBeenCalled();
    expect(mocks.setContactLists).toHaveBeenCalledWith({}, IDS.ines, [IDS.dev]);
  });

  it("PATCH reports a taken email and an unknown person", async () => {
    mocks.updateContact.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } });
    const { PATCH } = await import("./route");
    const taken = await PATCH(jsonRequest("PATCH", { email: "sarra@example.com" }), ctx);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: { code: "contact_email_taken" } });
    mocks.updateContact.mockResolvedValueOnce({ data: [], error: null });
    expect((await PATCH(jsonRequest("PATCH", { fullName: "X" }), ctx)).status).toBe(404);
  });

  it("DELETE removes the person or answers 404", async () => {
    const { DELETE } = await import("./route");
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    mocks.deleteContact.mockResolvedValueOnce({ data: [], error: null });
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(404);
  });
});
```
`…/contacts/bulk/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ bulkContacts: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bulkContacts.mockResolvedValue({ data: 2, error: null });
});

describe("POST /api/workspaces/[slug]/contacts/bulk", () => {
  it("adds people to a list and reports how many changed", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest("POST", { action: "addToList", contactIds: [IDS.ines, IDS.sarra], listId: IDS.dev }),
      ctx,
    );
    expect(await response.json()).toEqual({ affected: 2 });
    expect(mocks.bulkContacts).toHaveBeenCalledWith({}, {
      workspaceId: "w1", action: "addToList", contactIds: [IDS.ines, IDS.sarra], listId: IDS.dev,
    });
  });

  it("maps an unknown list", async () => {
    mocks.bulkContacts.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "tn:not_found" } });
    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest("POST", { action: "removeFromList", contactIds: [IDS.ines], listId: IDS.dev }),
      ctx,
    );
    expect(response.status).toBe(404);
  });
});
```
`…/lists/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ createList: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces/[slug]/lists", () => {
  it("creates a list with a trimmed name", async () => {
    mocks.createList.mockResolvedValueOnce({ data: { id: IDS.dev, name: "Dev" }, error: null });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", { name: "  Dev " }), ctx);
    expect(await response.json()).toEqual({ id: IDS.dev, name: "Dev" });
    expect(mocks.createList).toHaveBeenCalledWith({}, "w1", "Dev");
  });

  it("names the duplicate and the cap", async () => {
    mocks.createList.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate" } });
    const { POST } = await import("./route");
    expect(await (await POST(jsonRequest("POST", { name: "dev" }), ctx)).json()).toEqual({ error: { code: "list_name_taken" } });
    mocks.createList.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "tn:lists_limit_reached" } });
    expect(await (await POST(jsonRequest("POST", { name: "New" }), ctx)).json()).toEqual({ error: { code: "lists_limit_reached" } });
  });
});
```
`…/lists/[id]/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ renameList: vi.fn(), deleteList: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12", id: IDS.dev }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renameList.mockResolvedValue({ data: [{ id: IDS.dev }], error: null });
  mocks.deleteList.mockResolvedValue({ data: [{ id: IDS.dev }], error: null });
});

describe("/api/workspaces/[slug]/lists/[id]", () => {
  it("PATCH renames, DELETE removes, both 404 for unknown lists", async () => {
    const { PATCH, DELETE } = await import("./route");
    expect((await PATCH(jsonRequest("PATCH", { name: "Developers" }), ctx)).status).toBe(200);
    expect(mocks.renameList).toHaveBeenCalledWith({}, "w1", IDS.dev, "Developers");
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    mocks.renameList.mockResolvedValueOnce({ data: [], error: null });
    expect((await PATCH(jsonRequest("PATCH", { name: "X" }), ctx)).status).toBe(404);
    mocks.deleteList.mockResolvedValueOnce({ data: [], error: null });
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(404);
  });

  it("PATCH names a duplicate", async () => {
    mocks.renameList.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate" } });
    const { PATCH } = await import("./route");
    expect(await (await PATCH(jsonRequest("PATCH", { name: "design" }), ctx)).json()).toEqual({ error: { code: "list_name_taken" } });
  });
});
```
Run `bun run test src/app/api/workspaces` → the new files FAIL (routes missing).

- [ ] **Step 9: Routes** — `src/app/api/workspaces/[slug]/contacts/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { getRoster } from "@/server/queries/roster";

/** The whole roster (any member; Viewers read only). */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/workspaces/[slug]/contacts">,
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  return NextResponse.json(await getRoster(context.supabase, context.workspace.id));
}
```
`…/contacts/import/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { importContacts } from "@/server/queries/roster";
import { importBodySchema } from "@/shared/api/roster";

/** Import preview (`dryRun: true`) or commit; also used by "+ Add" with one row (spec §6). */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/contacts/import">,
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
  const body = await parseJsonBody(request, importBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await importContacts(context.supabase, {
    workspaceId: context.workspace.id,
    ...body.data,
  });
  return result.error ? fromDatabaseError(result.error) : NextResponse.json(result.data);
}
```
`…/contacts/[id]/route.ts`:
```ts
import type { NextRequest, NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deleteContact, setContactLists, updateContact } from "@/server/queries/roster";
import { updateContactBodySchema } from "@/shared/api/roster";

type Ctx = RouteContext<"/api/workspaces/[slug]/contacts/[id]">;

const UNIQUE_EMAIL = { "23505": "contact_email_taken" } as const;

/** Edits one person: name and/or email, and/or replaces their lists (sheet autosave). */
export async function PATCH(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const body = await parseJsonBody(request, updateContactBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { fullName, email, listIds } = body.data;
  if (fullName !== undefined || email !== undefined) {
    const updated = await updateContact(context.supabase, {
      workspaceId: context.workspace.id,
      contactId: id,
      fullName,
      email,
    });
    if (updated.error) {
      return fromDatabaseError(updated.error, UNIQUE_EMAIL);
    }
    if (!updated.data?.length) {
      return apiError("not_found");
    }
  }
  if (listIds !== undefined) {
    const { error } = await setContactLists(context.supabase, id, listIds);
    if (error) {
      return fromDatabaseError(error);
    }
  }
  return ok();
}

/** Deletes one person (sent after the Undo window closes). */
export async function DELETE(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const { data, error } = await deleteContact(context.supabase, context.workspace.id, id);
  if (error) {
    return fromDatabaseError(error);
  }
  return data?.length ? ok() : apiError("not_found");
}
```
`…/contacts/bulk/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { bulkContacts } from "@/server/queries/roster";
import { bulkContactsBodySchema } from "@/shared/api/roster";

/** Select-mode actions: delete, add to a list, remove from a list. */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/contacts/bulk">,
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
  const body = await parseJsonBody(request, bulkContactsBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await bulkContacts(context.supabase, {
    workspaceId: context.workspace.id,
    action: body.data.action,
    contactIds: body.data.contactIds,
    listId: body.data.action === "delete" ? undefined : body.data.listId,
  });
  return error ? fromDatabaseError(error) : NextResponse.json({ affected: data ?? 0 });
}
```
`…/lists/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { createList } from "@/server/queries/roster";
import { listBodySchema } from "@/shared/api/roster";

/** Creates a list (name unique ignoring case; at most `lists_per_workspace_max`). */
export async function POST(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/lists">,
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
  const body = await parseJsonBody(request, listBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await createList(context.supabase, context.workspace.id, body.data.name);
  return error
    ? fromDatabaseError(error, { "23505": "list_name_taken" })
    : NextResponse.json(data);
}
```
`…/lists/[id]/route.ts`:
```ts
import type { NextRequest, NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deleteList, renameList } from "@/server/queries/roster";
import { listBodySchema } from "@/shared/api/roster";

type Ctx = RouteContext<"/api/workspaces/[slug]/lists/[id]">;

/** Renames a list. */
export async function PATCH(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const body = await parseJsonBody(request, listBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data, error } = await renameList(context.supabase, context.workspace.id, id, body.data.name);
  if (error) {
    return fromDatabaseError(error, { "23505": "list_name_taken" });
  }
  return data?.length ? ok() : apiError("not_found");
}

/** Deletes a list; its people stay in the roster. */
export async function DELETE(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const { data, error } = await deleteList(context.supabase, context.workspace.id, id);
  if (error) {
    return fromDatabaseError(error);
  }
  return data?.length ? ok() : apiError("not_found");
}
```
Run `bun run test src/app/api/workspaces src/server/http` → PASS. `bun run typecheck` → PASS (it runs `next typegen` first, which creates the `RouteContext` types for the new paths).

- [ ] **Step 10: Cache updaters (test first)** — `src/lib/roster/roster-cache.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { addList, patchContact, removeContacts } from "./roster-cache";

describe("roster cache updaters", () => {
  it("patches one person and recounts lists when their lists change", () => {
    const next = patchContact(rosterFixture, IDS.youssef, { fullName: "Youssef T.", listIds: [IDS.design] });
    expect(next.contacts.find((c) => c.id === IDS.youssef)).toMatchObject({ fullName: "Youssef T.", listIds: [IDS.design] });
    expect(next.lists).toEqual([
      { id: IDS.design, name: "Design", contactCount: 2 },
      { id: IDS.dev, name: "Dev", contactCount: 2 },
    ]);
    expect(rosterFixture.contacts.find((c) => c.id === IDS.youssef)?.fullName).toBe("Youssef Trabelsi");
  });

  it("re-sorts by name after a rename", () => {
    const next = patchContact(rosterFixture, IDS.youssef, { fullName: "Aaron" });
    expect(next.contacts[0].id).toBe(IDS.youssef);
  });

  it("removes people and recounts", () => {
    const next = removeContacts(rosterFixture, [IDS.sarra]);
    expect(next.contacts.map((c) => c.id)).toEqual([IDS.ines, IDS.youssef]);
    expect(next.lists.map((l) => l.contactCount)).toEqual([0, 1]);
  });

  it("adds a list in name order with no people", () => {
    const next = addList(rosterFixture, { id: "00000000-0000-4000-8000-0000000000d3", name: "alumni" });
    expect(next.lists.map((l) => l.name)).toEqual(["alumni", "Design", "Dev"]);
  });
});
```
Run → FAIL. Then `src/lib/roster/roster-cache.ts`:
```ts
import type { Contact, ListCreated, Roster } from "@/shared/api/roster";

const byName = (a: Contact, b: Contact): number =>
  a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }) ||
  a.email.localeCompare(b.email);

/** Recomputes every list's `contactCount` from the people's `listIds`. */
export function withListCounts(roster: Roster): Roster {
  const counts = new Map<string, number>();
  for (const contact of roster.contacts) {
    for (const listId of contact.listIds) {
      counts.set(listId, (counts.get(listId) ?? 0) + 1);
    }
  }
  return {
    ...roster,
    lists: roster.lists.map((list) => ({ ...list, contactCount: counts.get(list.id) ?? 0 })),
  };
}

/** Optimistic edit of one person (name, email and/or lists), keeping name order and counts. */
export function patchContact(
  roster: Roster,
  contactId: string,
  patch: Partial<Pick<Contact, "fullName" | "email" | "listIds">>,
): Roster {
  const contacts = roster.contacts
    .map((contact) => (contact.id === contactId ? { ...contact, ...patch } : contact))
    .sort(byName);
  return withListCounts({ ...roster, contacts });
}

/** Optimistic removal of people (Undo delete, bulk delete). */
export function removeContacts(roster: Roster, contactIds: readonly string[]): Roster {
  const removed = new Set(contactIds);
  return withListCounts({
    ...roster,
    contacts: roster.contacts.filter((contact) => !removed.has(contact.id)),
  });
}

/** Adds a just-created list (no people yet) in name order. */
export function addList(roster: Roster, list: ListCreated): Roster {
  const lists = [...roster.lists, { ...list, contactCount: 0 }].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return { ...roster, lists };
}
```
Run → PASS.

- [ ] **Step 11: Hooks** — `src/hooks/use-roster.ts`:
```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { addList, patchContact } from "@/lib/roster/roster-cache";
import { okSchema } from "@/shared/api/common";
import {
  bulkResultSchema,
  importResultSchema,
  listCreatedSchema,
  rosterSchema,
  type BulkContactsBody,
  type ImportBody,
  type Roster,
  type UpdateContactBody,
} from "@/shared/api/roster";

/** Query key of a workspace's roster. */
export const rosterQueryKey = (slug: string) => ["roster", slug] as const;

/** Base path of the roster API for `/w/[slug]`. */
export const rosterPath = (slug: string): string =>
  `/api/workspaces/${encodeURIComponent(slug)}`;

/** The whole roster (`GET …/contacts`). */
export function useRoster(slug: string) {
  return useQuery({
    queryKey: rosterQueryKey(slug),
    queryFn: () => apiRequest(`${rosterPath(slug)}/contacts`, { schema: rosterSchema }),
  });
}

/**
 * Edits one person with an optimistic cache update; rolls back on failure and refetches after.
 * The caller shows the error (e.g. `contact_email_taken` next to the field).
 */
export function useUpdateContact(slug: string) {
  const queryClient = useQueryClient();
  const key = rosterQueryKey(slug);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateContactBody }) =>
      apiRequest(`${rosterPath(slug)}/contacts/${id}`, { method: "PATCH", body: patch, schema: okSchema }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Roster>(key);
      if (previous) {
        queryClient.setQueryData<Roster>(key, patchContact(previous, id, patch));
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Roster>(key, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Deletes one person (the page hides them first and calls this when Undo expires). */
export function useDeleteContact(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`${rosterPath(slug)}/contacts/${id}`, { method: "DELETE", schema: okSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Select-mode actions. */
export function useBulkContacts(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkContactsBody) =>
      apiRequest(`${rosterPath(slug)}/contacts/bulk`, { method: "POST", body, schema: bulkResultSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Creates a list; it appears in the cache at once so a picker can select it. */
export function useCreateList(slug: string) {
  const queryClient = useQueryClient();
  const key = rosterQueryKey(slug);
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest(`${rosterPath(slug)}/lists`, { method: "POST", body: { name }, schema: listCreatedSchema }),
    onSuccess: (list) => {
      const previous = queryClient.getQueryData<Roster>(key);
      if (previous) {
        queryClient.setQueryData<Roster>(key, addList(previous, list));
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Renames a list. */
export function useRenameList(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest(`${rosterPath(slug)}/lists/${id}`, { method: "PATCH", body: { name }, schema: okSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Deletes a list (people stay). */
export function useDeleteList(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`${rosterPath(slug)}/lists/${id}`, { method: "DELETE", schema: okSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Import preview or commit; a commit refreshes the roster. */
export function useImportContacts(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportBody) =>
      apiRequest(`${rosterPath(slug)}/contacts/import`, { method: "POST", body, schema: importResultSchema }),
    onSuccess: async (_result, body) => {
      if (!body.dryRun) {
        await queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) });
      }
    },
  });
}
```
The hooks are exercised through the component tests of Tasks 7–10 (they mock `fetch` with `routeFetch`), as M2's hooks are.

- [ ] **Step 12: Verify and commit** — `bun run lint && bun run typecheck && bun run test` → PASS; `bun run test:db` → PASS. Commit: `feat: roster API routes, contracts and hooks`.

---

### Task 5: Import parsing library (CSV / XLSX / paste, cleaning, column guessing, rows)

**Labels:** `area:frontend`

**Files:**
- Create: `src/lib/import/types.ts`, `clean-cell.ts`, `decode-text.ts`, `parse-delimited.ts`, `parse-xlsx.ts`, `read-import-file.ts`, `guess-columns.ts`, `build-import-rows.ts` — each with a `*.test.ts` next to it (`types.ts` excepted) — and `src/test/fixtures/xlsx.ts`
- Modify: `package.json` / `bun.lock` (`bun add papaparse read-excel-file` and `bun add -d @types/papaparse fflate`)

**Interfaces:**
- Consumes: `IMPORT_FILE_MAX_BYTES`, `IMPORT_CELL_MAX_CHARS`, `IMPORT_LISTS_PER_ROW_MAX`, `LIST_CELL_SEPARATORS` (Task 4 `src/config/roster.ts`), `ImportRowInput` (Task 4), `emailSchema`.
- Produces:
  - `types.ts`: `SheetGrid = string[][]`; `ColumnTarget = "fullName" | "email" | "lists" | "ignore"`; `ColumnMapping = { hasHeader: boolean; targets: ColumnTarget[] }`; `ImportSheet = { name: string; grid: SheetGrid }`.
  - `cleanCell(value: string | number | boolean | object | null | undefined): string` — NFC, invisible characters removed, whitespace (incl. non-breaking) collapsed, trimmed; dates as `yyyy-MM-dd` (date-fns).
  - `decodeText(bytes: ArrayBuffer): string` — UTF-8 (BOM dropped), Windows-1252 when not valid UTF-8.
  - `parseDelimited(text: string, delimiter?: string): SheetGrid` (PapaParse; auto-detects `,` `;` tab `|` when no delimiter) and `parsePaste(text: string): SheetGrid` (tab when the text has tabs). Blank lines are kept so row numbers match the file.
  - `parseXlsx(bytes: ArrayBuffer): Promise<ImportSheet[]>` (`read-excel-file/universal`, every sheet).
  - `readImportFile(file: File): Promise<ImportSheet[]>` — throws `ImportFileError` with `reason` ∈ `too_large | xls | unsupported | unreadable | empty`; returns only sheets with content.
  - `guessColumns(grid: SheetGrid): ColumnMapping` — header synonyms (English + French, accent-insensitive), exactly one email column (header first, else data with ≥ 50 % email-looking values), header row detected (a first row containing an email is data).
  - `mappingProblem(mapping: ColumnMapping): "no_email" | "several_emails" | null`.
  - `splitListCell(cell: string): string[]` and `buildImportRows(grid: SheetGrid, mapping: ColumnMapping): ImportRowInput[]` — row numbers are 1-based file rows; blank rows skipped; several Full name columns joined with a space in column order; several Lists columns merged; cells clamped to `IMPORT_CELL_MAX_CHARS`.
  - `makeXlsx(sheets: Array<{ name: string; rows: Array<Array<string | number | null>> }>): ArrayBuffer` test fixture.

Prototyped while planning with the real libraries (bun): the cp1252 / BOM / paste / no-header / multi-sheet / empty-sheet cases below produced exactly the expected grids and rows; a non-zip `.xlsx` makes read-excel-file throw `InvalidInputError` (mapped to `unreadable`).

- [ ] **Step 1: Dependencies** — `bun add papaparse read-excel-file && bun add -d @types/papaparse fflate`. Check the installed versions match the Tech Stack line (papaparse 5.7.x, read-excel-file 9.3.x, fflate 0.8.x).

- [ ] **Step 2: Fixture builder** — `src/test/fixtures/xlsx.ts`:
```ts
import { strToU8, zipSync } from "fflate";

type Cell = string | number | null;

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const columnName = (index: number): string => String.fromCharCode(65 + index);

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (cell === null) {
            return "";
          }
          return typeof cell === "number"
            ? `<c r="${ref}"><v>${cell}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Builds a minimal `.xlsx` (inline strings, numbers, empty cells) for parser tests, so no binary
 * fixture is committed. Columns A–Z only.
 */
export function makeXlsx(sheets: Array<{ name: string; rows: Cell[][] }>): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`,
    ),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet.rows));
  });
  const zipped = zipSync(files);
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  return copy.buffer;
}

/** Bytes of `text` in Windows-1252 (Latin-1 range only), as French-locale Excel saves CSV. */
export function cp1252Bytes(text: string): ArrayBuffer {
  return Uint8Array.from(text, (char) => char.charCodeAt(0)).buffer;
}
```

- [ ] **Step 3: Failing tests** — one file per module.

`src/lib/import/clean-cell.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cleanCell } from "./clean-cell";

describe("cleanCell (Review Focus 4)", () => {
  it("removes invisible characters and collapses every kind of space", () => {
    expect(cleanCell(" Ines​  Ben Salah \t")).toBe("Ines Ben Salah");
    expect(cleanCell("﻿Email")).toBe("Email");
  });

  it("composes accents so 'Inès' typed two ways compares equal", () => {
    expect(cleanCell("Inès")).toBe("Inès");
  });

  it("turns spreadsheet values into text", () => {
    expect(cleanCell(2)).toBe("2");
    expect(cleanCell(true)).toBe("true");
    expect(cleanCell(new Date(2026, 9, 6))).toBe("2026-10-06");
    expect(cleanCell(null)).toBe("");
    expect(cleanCell(undefined)).toBe("");
  });
});
```
`src/lib/import/decode-text.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cp1252Bytes } from "@/test/fixtures/xlsx";
import { decodeText } from "./decode-text";

describe("decodeText", () => {
  it("reads UTF-8 and drops the byte-order mark", () => {
    expect(decodeText(new TextEncoder().encode("﻿Inès").buffer)).toBe("Inès");
  });

  it("falls back to Windows-1252 for French-locale Excel CSV (Review Focus 2)", () => {
    expect(decodeText(cp1252Bytes("Inès;Équipe"))).toBe("Inès;Équipe");
  });
});
```
`src/lib/import/parse-delimited.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cp1252Bytes } from "@/test/fixtures/xlsx";
import { decodeText } from "./decode-text";
import { parseDelimited, parsePaste } from "./parse-delimited";

describe("parseDelimited", () => {
  it("detects ';' in a French Excel CSV and keeps blank lines for row numbers", () => {
    const text = decodeText(cp1252Bytes("Nom;E-mail;Équipe\r\nInès Ben Salah;ines@example.com;Dev, Events\r\n\r\nYoussef;y@example.com;Design\r\n"));
    expect(parseDelimited(text)).toEqual([
      ["Nom", "E-mail", "Équipe"],
      ["Inès Ben Salah", "ines@example.com", "Dev, Events"],
      [""],
      ["Youssef", "y@example.com", "Design"],
      [""],
    ]);
  });

  it("keeps quoted commas and cleans cells", () => {
    expect(parseDelimited('Full name,Email\n"Ben Salah, Inès", INES@Example.com \n')[1]).toEqual([
      "Ben Salah, Inès",
      "INES@Example.com",
    ]);
  });
});

describe("parsePaste", () => {
  it("splits Google Sheets / Excel pastes on tabs", () => {
    expect(parsePaste("Prénom\tNom\tEmail\nInès\tBen Salah\tines@example.com")).toEqual([
      ["Prénom", "Nom", "Email"],
      ["Inès", "Ben Salah", "ines@example.com"],
    ]);
  });

  it("treats a pasted column of addresses as one column", () => {
    expect(parsePaste("a@example.com\nb@example.com")).toEqual([["a@example.com"], ["b@example.com"]]);
  });
});
```
`src/lib/import/parse-xlsx.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { makeXlsx } from "@/test/fixtures/xlsx";
import { parseXlsx } from "./parse-xlsx";

describe("parseXlsx", () => {
  it("reads every sheet with text cells, numbers as text and empty rows kept", async () => {
    const workbook = makeXlsx([
      { name: "Members 2026", rows: [["Nom complet", "E-mail", "Équipe", "Year"], ["Inès Ben Salah", " Ines@Example.com ", "Dev, Events", 2], [null, null, null, null], ["Youssef", "y@example.com", "Design", 3]] },
      { name: "Old", rows: [["x"]] },
    ]);
    expect(await parseXlsx(workbook)).toEqual([
      {
        name: "Members 2026",
        grid: [
          ["Nom complet", "E-mail", "Équipe", "Year"],
          ["Inès Ben Salah", "Ines@Example.com", "Dev, Events", "2"],
          ["", "", "", ""],
          ["Youssef", "y@example.com", "Design", "3"],
        ],
      },
      { name: "Old", grid: [["x"]] },
    ]);
  });
});
```
`src/lib/import/read-import-file.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { IMPORT_FILE_MAX_BYTES } from "@/config/roster";
import { makeXlsx } from "@/test/fixtures/xlsx";
import { ImportFileError, readImportFile } from "./read-import-file";

const reason = async (file: File): Promise<string> =>
  readImportFile(file).then(
    () => "ok",
    (error: Error) => (error instanceof ImportFileError ? error.reason : error.message),
  );

describe("readImportFile", () => {
  it("reads CSV, TSV and XLSX files and skips empty sheets", async () => {
    expect(await readImportFile(new File(["Email\na@example.com\n"], "roster.CSV"))).toEqual([
      { name: "roster.CSV", grid: [["Email"], ["a@example.com"], [""]] },
    ]);
    const xlsx = makeXlsx([{ name: "Empty", rows: [] }, { name: "Team", rows: [["Email"], ["a@example.com"]] }]);
    expect(await readImportFile(new File([xlsx], "roster.xlsx"))).toEqual([
      { name: "Team", grid: [["Email"], ["a@example.com"]] },
    ]);
  });

  it("explains files it cannot read", async () => {
    expect(await reason(new File([new Uint8Array(IMPORT_FILE_MAX_BYTES + 1)], "big.csv"))).toBe("too_large");
    expect(await reason(new File(["x"], "old.xls"))).toBe("xls");
    expect(await reason(new File(["x"], "notes.pdf"))).toBe("unsupported");
    expect(await reason(new File(["not a zip"], "broken.xlsx"))).toBe("unreadable");
    expect(await reason(new File(["\n\n \u00a0\n"], "blank.csv"))).toBe("empty");
  });
});
```
`src/lib/import/guess-columns.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { guessColumns, mappingProblem } from "./guess-columns";
import { parseDelimited, parsePaste } from "./parse-delimited";

describe("guessColumns", () => {
  it("matches English and French headers, accents and case ignored", () => {
    expect(guessColumns(parseDelimited("Nom complet;E-mail;Équipe;Year\nA;a@example.com;Dev;2"))).toEqual({
      hasHeader: true,
      targets: ["fullName", "email", "lists", "ignore"],
    });
    expect(guessColumns(parseDelimited("Full Name,Email Address,Team\nA,a@example.com,Dev")).targets).toEqual(["fullName", "email", "lists"]);
  });

  it("maps separate first and last name columns both to Full name (Review Focus 3)", () => {
    expect(guessColumns(parsePaste("Prénom\tNom\tEmail\tÉquipe\nInès\tBen Salah\tines@example.com\tDev")).targets).toEqual([
      "fullName", "fullName", "email", "lists",
    ]);
  });

  it("recognizes an email column by a header containing 'mail'", () => {
    expect(guessColumns(parseDelimited("Nom complet,Adresse e-mail (ISSAT),Year\nA,a@example.com,2")).targets).toEqual([
      "fullName", "email", "ignore",
    ]);
  });

  it("detects a file without a header row from its data", () => {
    expect(guessColumns(parsePaste("ines@example.com\tInès\nsara@example.com\tSarra"))).toEqual({
      hasHeader: false,
      targets: ["email", "fullName"],
    });
  });

  it("finds the email column by data when no header names it, and keeps only one", () => {
    expect(guessColumns(parseDelimited("Who,Contact,Backup\nA,a@example.com,b@example.com\nB,c@example.com,")).targets).toEqual([
      "ignore", "email", "ignore",
    ]);
    expect(guessColumns(parseDelimited("Email,Mail\na@example.com,x\nb@example.com,y")).targets).toEqual(["email", "ignore"]);
  });
});

describe("mappingProblem", () => {
  it("needs exactly one email column", () => {
    expect(mappingProblem({ hasHeader: true, targets: ["fullName", "lists"] })).toBe("no_email");
    expect(mappingProblem({ hasHeader: true, targets: ["email", "email"] })).toBe("several_emails");
    expect(mappingProblem({ hasHeader: true, targets: ["fullName", "email"] })).toBeNull();
  });
});
```
`src/lib/import/build-import-rows.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { IMPORT_CELL_MAX_CHARS } from "@/config/roster";
import { buildImportRows, splitListCell } from "./build-import-rows";
import { parsePaste } from "./parse-delimited";

describe("splitListCell", () => {
  it("splits on , ; and | and drops empty parts", () => {
    expect(splitListCell("Dev, Events;Media | ;")).toEqual(["Dev", "Events", "Media"]);
  });
});

describe("buildImportRows", () => {
  it("joins first and last name in column order and keeps file row numbers (Review Focus 3)", () => {
    const grid = parsePaste("Prénom\tNom\tEmail\tÉquipe\n\nInès\tBen Salah\tines@example.com\tDev|Media\nYoussef\t\ty@example.com\t");
    expect(buildImportRows(grid, { hasHeader: true, targets: ["fullName", "fullName", "email", "lists"] })).toEqual([
      { row: 3, fullName: "Inès Ben Salah", email: "ines@example.com", lists: ["Dev", "Media"] },
      { row: 4, fullName: "Youssef", email: "y@example.com", lists: [] },
    ]);
  });

  it("keeps the first row as data without a header, sends empty cells as null", () => {
    const grid = parsePaste("ines@example.com\t\nsara@example.com\tSarra");
    expect(buildImportRows(grid, { hasHeader: false, targets: ["email", "fullName"] })).toEqual([
      { row: 1, fullName: null, email: "ines@example.com", lists: [] },
      { row: 2, fullName: "Sarra", email: "sara@example.com", lists: [] },
    ]);
  });

  it("merges several Lists columns and clamps oversized cells", () => {
    const long = "x".repeat(IMPORT_CELL_MAX_CHARS + 10);
    const grid = [["Name", "Email", "Team", "Cell"], [long, "a@example.com", "Dev", "Media"]];
    const [row] = buildImportRows(grid, { hasHeader: true, targets: ["fullName", "email", "lists", "lists"] });
    expect(row.fullName).toHaveLength(IMPORT_CELL_MAX_CHARS);
    expect(row.lists).toEqual(["Dev", "Media"]);
  });
});
```
Run `bun run test src/lib/import` → FAIL (modules missing).

- [ ] **Step 4: Implementation**

`src/lib/import/types.ts`:
```ts
/** Cells of one sheet as text, row by row, header row included and blank rows kept. */
export type SheetGrid = string[][];

/** What a source column becomes in the roster. */
export type ColumnTarget = "fullName" | "email" | "lists" | "ignore";

/** The "Match columns" step's answer. */
export type ColumnMapping = { hasHeader: boolean; targets: ColumnTarget[] };

/** One sheet of a workbook (a CSV file is one sheet named after the file). */
export type ImportSheet = { name: string; grid: SheetGrid };
```
`src/lib/import/clean-cell.ts`:
```ts
import { format } from "date-fns";

/** Zero-width and BOM characters that spreadsheets and copy-paste leave inside cells. */
const INVISIBLE = /[​-‍⁠﻿]/g;

/** ISO day, so a date cell is readable and stable. */
const DATE_FORMAT = "yyyy-MM-dd";

/**
 * Text of one spreadsheet cell, normalized for comparison: NFC accents, invisible characters
 * removed, any run of whitespace (non-breaking included) collapsed to one space, trimmed.
 * `object` covers the `Date` cells read-excel-file returns.
 */
export function cleanCell(value: string | number | boolean | object | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = value instanceof Date ? format(value, DATE_FORMAT) : String(value);
  return text.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}
```
`src/lib/import/decode-text.ts`:
```ts
/**
 * File bytes as text: UTF-8 when valid (a leading BOM is dropped by TextDecoder), otherwise
 * Windows-1252 — what Excel's "CSV" export uses on French and other Western Windows setups.
 */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
```
`src/lib/import/parse-delimited.ts`:
```ts
import Papa from "papaparse";
import { cleanCell } from "./clean-cell";
import type { SheetGrid } from "./types";

const TAB = "\t";

/**
 * Parses CSV/TSV text. Without `delimiter`, PapaParse picks the most consistent of `,` `;` tab `|`.
 * Blank lines stay in the grid so row numbers match the file.
 */
export function parseDelimited(text: string, delimiter = ""): SheetGrid {
  const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  return result.data.map((row) => row.map((cell) => cleanCell(cell)));
}

/** Text pasted from Google Sheets or Excel (tab-separated; a single column has no tabs). */
export function parsePaste(text: string): SheetGrid {
  return parseDelimited(text, text.includes(TAB) ? TAB : "");
}
```
`src/lib/import/parse-xlsx.ts`:
```ts
import readXlsxFile from "read-excel-file/universal";
import { cleanCell } from "./clean-cell";
import type { ImportSheet } from "./types";

/** Every sheet of an `.xlsx` file as text grids (the `universal` build needs no Web Worker). */
export async function parseXlsx(bytes: ArrayBuffer): Promise<ImportSheet[]> {
  const sheets = await readXlsxFile(bytes);
  return sheets.map((sheet) => ({
    name: sheet.sheet,
    grid: sheet.data.map((row) => row.map((cell) => cleanCell(cell))),
  }));
}
```
`src/lib/import/read-import-file.ts`:
```ts
import { IMPORT_FILE_MAX_BYTES } from "@/config/roster";
import { decodeText } from "./decode-text";
import { parseDelimited } from "./parse-delimited";
import { parseXlsx } from "./parse-xlsx";
import type { ImportSheet } from "./types";

/** Why a chosen file cannot be imported (each has a message in `ListsImport.fileErrors`). */
export type ImportFileErrorReason = "too_large" | "xls" | "unsupported" | "unreadable" | "empty";

/** A file the import cannot read, with a reason the dialog explains. */
export class ImportFileError extends Error {
  constructor(readonly reason: ImportFileErrorReason) {
    super(reason);
    this.name = "ImportFileError";
  }
}

const DELIMITED_EXTENSIONS: readonly string[] = ["csv", "tsv", "txt"];

const hasContent = (sheet: ImportSheet): boolean =>
  sheet.grid.some((row) => row.some((cell) => cell !== ""));

/**
 * Reads a chosen file on the device (never uploaded): CSV/TSV/TXT or XLSX.
 * @throws ImportFileError when the file is too big, an old `.xls`, another type, broken, or empty
 */
export async function readImportFile(file: File): Promise<ImportSheet[]> {
  if (file.size > IMPORT_FILE_MAX_BYTES) {
    throw new ImportFileError("too_large");
  }
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (extension === "xls") {
    throw new ImportFileError("xls");
  }
  if (extension !== "xlsx" && !DELIMITED_EXTENSIONS.includes(extension)) {
    throw new ImportFileError("unsupported");
  }
  const bytes = await file.arrayBuffer();
  let sheets: ImportSheet[];
  if (extension === "xlsx") {
    try {
      sheets = await parseXlsx(bytes);
    } catch {
      throw new ImportFileError("unreadable");
    }
  } else {
    sheets = [{ name: file.name, grid: parseDelimited(decodeText(bytes)) }];
  }
  const withContent = sheets.filter(hasContent);
  if (withContent.length === 0) {
    throw new ImportFileError("empty");
  }
  return withContent;
}
```
`src/lib/import/guess-columns.ts`:
```ts
import { emailSchema } from "@/shared/api/common";
import type { ColumnMapping, ColumnTarget, SheetGrid } from "./types";

/** Rows looked at when guessing from data. */
const SAMPLE_ROWS = 20;

/** Share of sampled cells that must look like emails for a header-less column to be "Email". */
const EMAIL_SHARE_MIN = 0.5;

/** Accent-free, lower-case, punctuation as spaces: "Équipe" → "equipe", "E-mail" → "e mail". */
const normalizeHeader = (header: string): string =>
  header
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Header names (normalized) per target, English and French (spec §7.14). */
const HEADER_SYNONYMS: Record<Exclude<ColumnTarget, "ignore">, readonly string[]> = {
  email: ["email", "e mail", "mail", "courriel", "adresse email", "adresse e mail", "adresse mail", "email address", "e mail address"],
  fullName: [
    "full name", "name", "nom complet", "nom et prenom", "prenom et nom", "nom prenom", "prenom nom",
    "first name", "last name", "firstname", "lastname", "given name", "family name", "surname", "prenom", "nom",
  ],
  lists: [
    "team", "teams", "equipe", "equipes", "list", "lists", "liste", "listes", "department", "departement",
    "pole", "cellule", "group", "groups", "groupe", "groupes", "committee", "comite",
  ],
};

const MATCH_ORDER = ["email", "fullName", "lists"] as const;

const looksLikeEmail = (cell: string): boolean => emailSchema.safeParse(cell).success;
const isBlank = (row: string[]): boolean => row.every((cell) => cell === "");

function targetForHeader(header: string): ColumnTarget {
  const key = normalizeHeader(header);
  const exact = MATCH_ORDER.find((target) => HEADER_SYNONYMS[target].includes(key));
  if (exact) {
    return exact;
  }
  return key.split(" ").includes("mail") || key.includes("email") ? "email" : "ignore";
}

/**
 * First guess for "Match columns": header synonyms, then data. Exactly one column becomes Email
 * (the best-looking one); several may become Full name (joined) or Lists (merged). A first row
 * that contains an email address is data, not a header.
 */
export function guessColumns(grid: SheetGrid): ColumnMapping {
  const start = grid.findIndex((row) => !isBlank(row));
  if (start === -1) {
    return { hasHeader: false, targets: [] };
  }
  const columns = Array.from({ length: Math.max(...grid.map((row) => row.length)) }, (_, i) => i);
  const header = grid[start];
  const hasHeader = !header.some(looksLikeEmail);
  const sample = grid
    .slice(hasHeader ? start + 1 : start)
    .filter((row) => !isBlank(row))
    .slice(0, SAMPLE_ROWS);
  const emailShare = (column: number): number =>
    sample.length === 0 ? 0 : sample.filter((row) => looksLikeEmail(row[column] ?? "")).length / sample.length;

  const targets: ColumnTarget[] = columns.map((column) =>
    hasHeader ? targetForHeader(header[column] ?? "") : "ignore",
  );
  const named = columns.filter((column) => targets[column] === "email");
  const candidates = named.length > 0 ? named : columns.filter((column) => emailShare(column) >= EMAIL_SHARE_MIN);
  const emailColumn = [...candidates].sort((a, b) => emailShare(b) - emailShare(a))[0];
  const withOneEmail = targets.map((target, column): ColumnTarget => {
    if (column === emailColumn) {
      return "email";
    }
    return target === "email" ? "ignore" : target;
  });
  if (!hasHeader) {
    const nameColumn = columns.find(
      (column) => column !== emailColumn && sample.some((row) => (row[column] ?? "") !== ""),
    );
    if (nameColumn !== undefined) {
      withOneEmail[nameColumn] = "fullName";
    }
  }
  return { hasHeader, targets: withOneEmail };
}

/** Why "Preview" is disabled: the import needs exactly one Email column. */
export function mappingProblem(mapping: ColumnMapping): "no_email" | "several_emails" | null {
  const emails = mapping.targets.filter((target) => target === "email").length;
  if (emails === 0) {
    return "no_email";
  }
  return emails > 1 ? "several_emails" : null;
}
```
`src/lib/import/build-import-rows.ts`:
```ts
import {
  IMPORT_CELL_MAX_CHARS,
  IMPORT_LISTS_PER_ROW_MAX,
  LIST_CELL_SEPARATORS,
} from "@/config/roster";
import type { ImportRowInput } from "@/shared/api/roster";
import type { ColumnMapping, ColumnTarget, SheetGrid } from "./types";

/** "Dev, Events" → ["Dev", "Events"] (also `;` and `|`, spec §4). */
export function splitListCell(cell: string): string[] {
  return cell
    .split(LIST_CELL_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

const clamp = (text: string): string => text.slice(0, IMPORT_CELL_MAX_CHARS);

/**
 * Rows for the import route. `row` is the 1-based row of the file, so the preview can say
 * "Row 41". Blank rows and the header are skipped; several Full name columns are joined in
 * column order ("Prénom" + "Nom"); several Lists columns are merged.
 */
export function buildImportRows(grid: SheetGrid, mapping: ColumnMapping): ImportRowInput[] {
  const headerIndex = mapping.hasHeader ? grid.findIndex((row) => row.some((cell) => cell !== "")) : -1;
  const cellsFor = (row: string[], target: ColumnTarget): string[] =>
    mapping.targets.flatMap((columnTarget, column) => {
      const cell = row[column] ?? "";
      return columnTarget === target && cell !== "" ? [cell] : [];
    });
  return grid.flatMap((row, index): ImportRowInput[] => {
    if (index <= headerIndex || row.every((cell) => cell === "")) {
      return [];
    }
    const fullName = cellsFor(row, "fullName").join(" ");
    const email = cellsFor(row, "email")[0] ?? "";
    return [
      {
        row: index + 1,
        fullName: fullName === "" ? null : clamp(fullName),
        email: email === "" ? null : clamp(email),
        lists: cellsFor(row, "lists").flatMap(splitListCell).map(clamp).slice(0, IMPORT_LISTS_PER_ROW_MAX),
      },
    ];
  });
}
```
Run `bun run test src/lib/import` → PASS.

- [ ] **Step 5: Verify and commit** — `bun run lint && bun run typecheck && bun run test` → PASS. Commit: `feat: import parsing for CSV, XLSX and pasted sheets`.

---

### Task 6: UI primitives — Checkbox, Switch, SegmentedControl, Textarea, FileDropZone

**Labels:** `area:frontend`, `area:design`

**Files:**
- Create: `src/components/ui/checkbox.tsx`, `switch.tsx`, `segmented-control.tsx`, `textarea.tsx`, `file-drop-zone.tsx`, each with a `*.test.tsx`
- Modify: `src/app/design/design-showcase.tsx` (a "Controls" card), `messages/en.json` (`Design` keys), `src/app/design/design-showcase.test.tsx` (the card renders)

**Interfaces:**
- Consumes: Radix primitives from the `radix-ui` umbrella package (`Checkbox`, `Switch`, `ToggleGroup`), tokens (`border-outline`, `shadow-brutal-sm`, `bg-fill-primary`, `rounded-control`, `--tn-border-width`), Phosphor icons.
- Produces:
  - `Checkbox(props: ComponentProps<typeof CheckboxPrimitive.Root>)` — 24 px box inside a 44 px hit area; checked = primary fill + bold check; `aria-label` or a wrapping `<label>` names it.
  - `Switch(props: ComponentProps<typeof SwitchPrimitive.Root>)` — 44×28 px track, thumb slides (no motion for reduced motion).
  - `SegmentedControl({ value, onValueChange, options, label, className })` where `options: ReadonlyArray<{ value: string; label: string }>` — single choice, never empty (clicking the active segment keeps it); Radix renders `role="radiogroup"` with `role="radio"` items.
  - `Textarea({ id, label, hint?, error?, ...textareaProps })` — same wiring as `Input` (label, hint, error, `aria-invalid`).
  - `FileDropZone({ id, title, hint, accept, onFile, disabled? })` — a styled drop area and button; the `<input type="file">` is visually hidden (`sr-only`) and labelled by the title; dropping or choosing a file calls `onFile(file)` with the first file.

- [ ] **Step 1: Failing tests**

`src/components/ui/checkbox.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("is a styled, labelled checkbox (no native input) that toggles", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Checkbox aria-label="Select Inès" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Select Inès" });
    expect(box.tagName).toBe("BUTTON");
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box).toBeChecked();
    expect(document.querySelector('input[type="checkbox"]:not([aria-hidden="true"])')).toBeNull();
  });
});
```
`src/components/ui/switch.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Switch } from "./switch";

describe("Switch", () => {
  it("is a labelled switch that reports its state", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <label>
        <Switch defaultChecked onCheckedChange={onCheckedChange} />
        First row is headers
      </label>,
    );
    const toggle = screen.getByRole("switch", { name: "First row is headers" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
```
`src/components/ui/segmented-control.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { SegmentedControl } from "./segmented-control";

function Harness() {
  const [value, setValue] = useState("file");
  return (
    <>
      <SegmentedControl
        label="Source"
        value={value}
        onValueChange={setValue}
        options={[{ value: "file", label: "File" }, { value: "paste", label: "Paste" }]}
      />
      <output>{value}</output>
    </>
  );
}

describe("SegmentedControl", () => {
  it("switches between options and never ends up empty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Source" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Paste" }));
    expect(screen.getByRole("status")).toHaveTextContent("paste");
    await user.click(screen.getByRole("radio", { name: "Paste" }));
    expect(screen.getByRole("status")).toHaveTextContent("paste");
    expect(screen.getByRole("radio", { name: "Paste" })).toHaveAttribute("aria-checked", "true");
  });
});
```
`src/components/ui/textarea.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("wires label, hint and error like Input", () => {
    renderWithProviders(<Textarea id="paste" label="Paste rows" hint="From Google Sheets" error="Nothing to import" />);
    const field = screen.getByLabelText("Paste rows");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("From Google Sheets Nothing to import");
    expect(field.className).toContain("shadow-brutal-sm");
  });
});
```
`src/components/ui/file-drop-zone.test.tsx`:
```tsx
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { FileDropZone } from "./file-drop-zone";

describe("FileDropZone", () => {
  it("hands over a chosen file and a dropped file", async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <FileDropZone id="roster-file" title="Choose a .csv or .xlsx" hint="Up to 5 MB" accept=".csv,.xlsx" onFile={onFile} />,
    );
    const input = screen.getByLabelText("Choose a .csv or .xlsx");
    expect(input).toHaveAttribute("type", "file");
    expect(input.className).toContain("sr-only");
    const chosen = new File(["Email\n"], "roster.csv", { type: "text/csv" });
    await user.upload(input, chosen);
    expect(onFile).toHaveBeenLastCalledWith(chosen);

    const dropped = new File(["x"], "team.xlsx");
    fireEvent.drop(screen.getByTestId("roster-file-zone"), { dataTransfer: { files: [dropped] } });
    expect(onFile).toHaveBeenLastCalledWith(dropped);
  });
});
```
Run `bun run test src/components/ui` → the five files FAIL.

- [ ] **Step 2: Components**

`src/components/ui/checkbox.tsx`:
```tsx
"use client";

import { Check } from "@phosphor-icons/react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Neobrutalist checkbox: 24 px outlined box with the small hard shadow inside a 44 px tap area;
 * checked = primary fill and a bold check that pops in (none for reduced motion).
 */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group relative inline-flex size-6 shrink-0 items-center justify-center rounded-[8px] border-[length:var(--tn-border-width)] border-outline bg-surface text-on-fill shadow-brutal-sm transition-[transform,box-shadow,background-color] duration-300 ease-spring before:absolute before:-inset-2.5 before:content-[''] active:translate-y-0.5 active:shadow-none data-[state=checked]:bg-fill-primary motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="data-[state=checked]:animate-in data-[state=checked]:zoom-in-50 motion-reduce:animate-none">
        <Check weight="bold" className="size-4" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
```
`src/components/ui/switch.tsx`:
```tsx
"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Outlined pill switch; the thumb springs across when on (instant for reduced motion). */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-7 w-11 shrink-0 items-center rounded-full border-[length:var(--tn-border-width)] border-outline bg-fill-neutral p-0.5 shadow-brutal-sm transition-colors data-[state=checked]:bg-fill-primary motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full border-[length:var(--tn-border-width)] border-outline bg-surface transition-transform duration-300 ease-spring data-[state=checked]:translate-x-4 motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  );
}
```
`src/components/ui/segmented-control.tsx`:
```tsx
"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * One choice among a few, as joined outlined segments (Radix ToggleGroup, arrow-key navigation).
 * Clicking the active segment keeps it selected, so there is always a value.
 */
export function SegmentedControl({
  label,
  value,
  onValueChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) {
          onValueChange(next);
        }
      }}
      className={cn(
        "grid auto-cols-fr grid-flow-col overflow-hidden rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface shadow-brutal-sm",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className="min-h-11 px-3 text-sm font-bold text-ink transition-colors not-last:border-r-[length:var(--tn-border-width)] not-last:border-outline data-[state=on]:bg-ink data-[state=on]:text-surface motion-reduce:transition-none"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
```
Radix ToggleGroup with `type="single"` renders `role="radiogroup"` with `role="radio"` items and `aria-checked` (checked in `node_modules/@radix-ui/react-toggle-group/dist/index.mjs` while planning), which the test relies on.

`src/components/ui/textarea.tsx`:
```tsx
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

/** Labelled multi-line field with the same outline, shadow, hint and error wiring as `Input`. */
export function Textarea({ id, label, hint, error, className, ...props }: TextareaProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-32 resize-y rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 py-2 font-mono text-sm text-ink shadow-brutal-sm placeholder:text-muted-ink aria-invalid:bg-fill-danger aria-invalid:text-on-fill",
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted-ink">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-bold text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```
`src/components/ui/file-drop-zone.tsx`:
```tsx
"use client";

import { UploadSimple } from "@phosphor-icons/react";
import { useState, type DragEvent } from "react";
import { cn } from "@/lib/utils";
import { Sticker } from "./sticker";

/**
 * Drop area + file chooser. The native file input stays in the DOM for keyboard and screen-reader
 * users but is visually hidden; the whole card is its label, so tapping anywhere opens the picker.
 */
export function FileDropZone({
  id,
  title,
  hint,
  accept,
  onFile,
  disabled = false,
}: {
  id: string;
  title: string;
  hint: string;
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) {
      onFile(file);
    }
  };
  return (
    <label
      htmlFor={id}
      data-testid={`${id}-zone`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-card border-[length:var(--tn-border-width)] border-dashed border-outline bg-surface px-4 py-6 text-center shadow-brutal-sm transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 motion-reduce:transition-none",
        dragging && "bg-fill-info",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Sticker tone="info">
        <UploadSimple weight="bold" />
      </Sticker>
      <span className="font-bold">{title}</span>
      <span className="text-sm text-muted-ink">{hint}</span>
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
          }
          event.target.value = "";
        }}
      />
    </label>
  );
}
```
Run `bun run test src/components/ui` → PASS.

- [ ] **Step 3: Showcase** — add `Design` messages: `"controls": "Controls"`, `"checkboxLabel": "Include alumni"`, `"switchLabel": "First row is headers"`, `"sourceLabel": "Source"`, `"sourceFile": "File"`, `"sourcePaste": "Paste"`, `"pasteLabel": "Paste rows"`, `"pasteHint": "Copied from Google Sheets or Excel"`, `"dropTitle": "Choose a .csv or .xlsx"`, `"dropHint": "Up to 5 MB. Stays on your device."`. In `design-showcase.tsx`, after the Inputs card, add a `StaggerItem` with a `Card as="section" aria-label={t("controls")}` containing: a `<label className="flex min-h-11 items-center gap-3">` with `<Checkbox />` and `t("checkboxLabel")`; a label with `<Switch defaultChecked />` and `t("switchLabel")`; a `SegmentedControl` bound to local `useState("file")` with the two source options; a `Textarea id="demo-paste"`; and a `FileDropZone id="demo-file" accept=".csv,.xlsx" onFile={() => undefined}`. Extend `design-showcase.test.tsx` with `expect(screen.getByRole("region", { name: "Controls" })).toBeInTheDocument()`.

- [ ] **Step 4: Visual check** — `bun run dev`, open `/design` with Playwright at 390 px (light) and 320 px (dark); screenshot the Controls card; check focus rings with Tab, the switch and checkbox states, and no horizontal scroll. Stop the dev server (find it with `ss -ltnp`, kill by PID).

- [ ] **Step 5: Verify and commit** — `bun run lint && bun run typecheck && bun run test` → PASS. Commit: `feat: styled checkbox, switch, segmented control, textarea and file drop zone`.

---

### Task 7: Roster page — read view (search, list chips, virtualized cards, empty state, Viewer, Home link)

**Labels:** `area:frontend`

**Files:**
- Create: `src/hooks/use-media-query.ts` + test, `src/lib/roster/filter-contacts.ts` + test, `src/app/w/[slug]/lists/roster-view.tsx` + test, `list-chips.tsx`, `list-tag.tsx`, `contact-card.tsx`, `roster-cards.tsx`, `roster-empty.tsx`, `roster-skeleton.tsx`, `page.test.tsx`; `e2e/helpers/layout.ts`, `e2e/roster.spec.ts`
- Modify: `src/app/w/[slug]/lists/page.tsx` (replaces `ComingSoon`), `src/components/shell/coming-soon.tsx` (`area` is only `"meetings"` now), `src/components/ui/input.tsx` + test (`hideLabel`), `src/test/match-media.ts` + `vitest.setup.ts` (`setWideViewport`), `src/config/roster.ts` (`ROSTER_GRID_MEDIA`, `ROSTER_CARD_ESTIMATE_PX`), `src/app/w/[slug]/home-checklist.tsx` + test (Import members links here), `e2e/helpers/seed.ts` (`seedRoster`), `messages/en.json` (`Lists`, `WorkspaceHome.importMembersAction`; remove `ComingSoon.listsTitle`/`listsBody`)
- Add dependency: `bun add @tanstack/react-virtual`

**Interfaces:**
- Consumes: `useRoster`, `rosterQueryKey`, `Roster`, `Contact`, `ListSummary` (Task 4); `useWorkspace`; `Chip`, `Card`, `Sticker`, `Skeleton`, `Input`, `Button`.
- Produces:
  - `useMediaQuery(query: string): boolean` (false on the server and first client render).
  - `setWideViewport(value: boolean)` in `src/test/match-media.ts` — makes `(min-width: …)` queries match in jsdom; reset after each test.
  - `normalizeForSearch(text: string): string` and `filterContacts(contacts: Contact[], filter: { query: string; listId: string | null }): Contact[]`.
  - `RosterView({ workspace, roster })` — the page body; later tasks add editing state to it.
  - `ListChips({ lists, total, selectedListId, onSelect, trailing? })`, `ListTag({ list })`, `ContactCard({ contact, lists, onOpen })`, `RosterCards({ contacts, lists, onOpen })`, `RosterEmpty({ canEdit, actions? })` where `actions` is a `ReactNode` slot filled by Tasks 8 and 10.
  - `Input` gains `hideLabel?: boolean` (label kept for assistive tech, visually hidden).
  - e2e: `expectNoHorizontalScroll(page)`; `seedRoster(slug, people: Array<{ fullName: string; email: string; lists?: string[] }>)`.

- [ ] **Step 1: Config + test helpers** — append to `src/config/roster.ts`:
```ts
/** From this width the roster shows the editable grid instead of cards (Tailwind `md`). */
export const ROSTER_GRID_MEDIA = "(min-width: 768px)";

/** First guess of a card's height before it is measured (virtualized list). */
export const ROSTER_CARD_ESTIMATE_PX = 104;
```
In `src/test/match-media.ts` add a `wideViewport` flag next to `reducedMotion`:
```ts
let wideViewport = false;

/**
 * Emulates a wide screen for `(min-width: …)` media queries in tests.
 * @param value - true to make min-width queries match
 */
export function setWideViewport(value: boolean): void {
  wideViewport = value;
}
```
and make the installed `matches` read `query.includes("prefers-reduced-motion") ? reducedMotion : query.includes("min-width") ? wideViewport : false`. In `vitest.setup.ts`'s `afterEach`, call `setWideViewport(false)` next to `setReducedMotion(false)`.

- [ ] **Step 2: Failing unit tests**

`src/lib/roster/filter-contacts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { filterContacts, normalizeForSearch } from "./filter-contacts";

const names = (query: string, listId: string | null = null): string[] =>
  filterContacts(rosterFixture.contacts, { query, listId }).map((c) => c.fullName);

describe("filterContacts", () => {
  it("ignores accents and case, and searches names and emails", () => {
    expect(normalizeForSearch("  Inès BEN ")).toBe("ines ben");
    expect(names("ines")).toEqual(["Inès Ben Salah"]);
    expect(names("Y@EXAMPLE")).toEqual(["Youssef Trabelsi"]);
    expect(names("")).toHaveLength(3);
  });

  it("filters by list, alone and with a query", () => {
    expect(names("", IDS.dev)).toEqual(["Inès Ben Salah", "Sarra Khelifi"]);
    expect(names("sarra", IDS.dev)).toEqual(["Sarra Khelifi"]);
    expect(names("", IDS.design)).toEqual(["Sarra Khelifi"]);
  });
});
```
`src/hooks/use-media-query.test.ts`:
```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setWideViewport } from "@/test/match-media";
import { useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  it("follows the media query", () => {
    expect(renderHook(() => useMediaQuery("(min-width: 768px)")).result.current).toBe(false);
    setWideViewport(true);
    expect(renderHook(() => useMediaQuery("(min-width: 768px)")).result.current).toBe(true);
  });
});
```
`src/app/w/[slug]/lists/roster-view.test.tsx`:
```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { okContext } from "@/test/workspace-context-mock";
import { RosterView } from "./roster-view";

const owner = okContext.workspace;
const viewer = { ...owner, myRole: "viewer" as const };

describe("RosterView", () => {
  it("lists people as cards with their lists and a count", () => {
    renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />);
    expect(screen.getByRole("heading", { name: "Lists" })).toBeInTheDocument();
    expect(screen.getByText("3 people")).toBeInTheDocument();
    const ines = screen.getByRole("listitem", { name: /Inès Ben Salah/ });
    expect(within(ines).getByText("ines@example.com")).toBeInTheDocument();
    expect(within(ines).getByText("Dev")).toBeInTheDocument();
  });

  it("searches without accents and filters by a list chip", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />);
    await user.type(screen.getByRole("searchbox", { name: "Search people" }), "ines");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Search people" }));
    await user.click(screen.getByRole("button", { name: "Design 1" }));
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      expect.stringContaining("Sarra Khelifi"),
    ]);
    await user.click(screen.getByRole("button", { name: "All 3" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says when nobody matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />);
    await user.type(screen.getByRole("searchbox", { name: "Search people" }), "zzz");
    expect(screen.getByText("Nobody matches your search.")).toBeInTheDocument();
  });

  it("shows the empty roster differently to organizers and Viewers", () => {
    const empty = { ...rosterFixture, contacts: [], lists: [] };
    const { unmount } = renderWithProviders(<RosterView workspace={owner} roster={empty} />);
    expect(screen.getByRole("heading", { name: "Import your roster" })).toBeInTheDocument();
    unmount();
    renderWithProviders(<RosterView workspace={viewer} roster={empty} />);
    expect(screen.getByRole("heading", { name: "No one here yet" })).toBeInTheDocument();
  });
});
```
`src/app/w/[slug]/lists/page.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { okContext } from "@/test/workspace-context-mock";
import ListsPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "club-ab12" }) }));

beforeEach(() => {
  routeFetch({
    "GET /api/workspaces/club-ab12": json(okContext.workspace),
    "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
  });
});

describe("/w/[slug]/lists", () => {
  it("loads the roster", async () => {
    renderWithProviders(<ListsPage />);
    expect(await screen.findByText("3 people")).toBeInTheDocument();
  });
});
```
Check `src/test/render.tsx` provides a fresh `QueryClient` per render (it does for the M2 page tests); if `next/navigation` is already mocked globally for page tests, reuse that instead of the local `vi.mock`.

Run `bun run test src/lib/roster src/hooks src/app/w` → new tests FAIL.

- [ ] **Step 3: Small building blocks**

`src/hooks/use-media-query.ts`:
```ts
"use client";

import { useSyncExternalStore } from "react";

/** Whether `query` matches; false during server rendering and hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
```
`src/lib/roster/filter-contacts.ts`:
```ts
import type { Contact } from "@/shared/api/roster";

/** Lower-case, accent-free, trimmed: "Inès " → "ines", so typing without accents still finds people. */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** People matching the search (name or email) and the selected list chip. */
export function filterContacts(
  contacts: Contact[],
  filter: { query: string; listId: string | null },
): Contact[] {
  const query = normalizeForSearch(filter.query);
  return contacts.filter(
    (contact) =>
      (filter.listId === null || contact.listIds.includes(filter.listId)) &&
      (query === "" ||
        normalizeForSearch(contact.fullName).includes(query) ||
        contact.email.includes(query)),
  );
}
```
`src/components/ui/input.tsx` — add `hideLabel?: boolean` to `InputProps`, destructure it, and give the `<label>` `className={cn("text-sm font-bold text-ink", hideLabel && "sr-only")}`. Add to `input.test.tsx`:
```tsx
it("can hide its label visually while keeping the accessible name", () => {
  renderWithProviders(<Input id="q" label="Search people" hideLabel type="search" />);
  expect(screen.getByRole("searchbox", { name: "Search people" })).toBeInTheDocument();
  expect(screen.getByText("Search people")).toHaveClass("sr-only");
});
```
(add `renderWithProviders`/`screen` imports if the file lacks them).

`src/app/w/[slug]/lists/list-tag.tsx`:
```tsx
import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";
import type { ListSummary } from "@/shared/api/roster";

const TONES: readonly FillTone[] = ["primary", "success", "warning", "info"];
const FILL: Record<FillTone, string> = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
};

/** Same pastel for a list everywhere (stable from its id). */
export function listTone(listId: string): FillTone {
  const sum = [...listId].reduce((total, char) => total + char.charCodeAt(0), 0);
  return TONES[sum % TONES.length];
}

/** Small read-only pill naming a list on a card or row. */
export function ListTag({ list, className }: { list: Pick<ListSummary, "id" | "name">; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
        FILL[listTone(list.id)],
        className,
      )}
    >
      {list.name}
    </span>
  );
}
```
`src/app/w/[slug]/lists/list-chips.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Chip } from "@/components/ui/chip";
import type { ListSummary } from "@/shared/api/roster";

/** "All N" plus one chip per list (with its count); one is always selected. Scrolls sideways. */
export function ListChips({
  lists,
  total,
  selectedListId,
  onSelect,
  trailing,
}: {
  lists: ListSummary[];
  total: number;
  selectedListId: string | null;
  onSelect: (listId: string | null) => void;
  trailing?: ReactNode;
}) {
  const t = useTranslations("Lists");
  return (
    <div role="group" aria-label={t("listChipsLabel")} className="flex gap-2 overflow-x-auto pt-1 pb-2">
      <Chip pressed={selectedListId === null} onPressedChange={() => onSelect(null)} className="shrink-0">
        {t("allChip", { count: total })}
      </Chip>
      {lists.map((list) => (
        <Chip
          key={list.id}
          pressed={selectedListId === list.id}
          onPressedChange={(pressed) => onSelect(pressed ? list.id : null)}
          className="shrink-0"
        >
          {list.name} {list.contactCount}
        </Chip>
      ))}
      {trailing}
    </div>
  );
}
```
`src/app/w/[slug]/lists/contact-card.tsx`:
```tsx
"use client";

import { CaretRight } from "@phosphor-icons/react";
import type { Contact, ListSummary } from "@/shared/api/roster";
import { ListTag } from "./list-tag";

/**
 * One person on a phone: name, email, list pills; the whole card opens the editor sheet. Long
 * names wrap and long emails break anywhere, so a 320 px screen never scrolls sideways.
 */
export function ContactCard({
  contact,
  lists,
  onOpen,
}: {
  contact: Contact;
  lists: ListSummary[];
  onOpen: (contact: Contact) => void;
}) {
  const own = lists.filter((list) => contact.listIds.includes(list.id));
  return (
    <button
      type="button"
      onClick={() => onOpen(contact)}
      className="flex w-full min-w-0 items-center gap-3 rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-3 text-left shadow-brutal-sm transition-transform duration-300 ease-spring active:translate-y-0.5 active:shadow-none motion-reduce:transition-none"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-bold break-words">{contact.fullName}</span>
        <span className="text-sm break-all text-muted-ink">{contact.email}</span>
        {own.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {own.map((list) => (
              <ListTag key={list.id} list={list} />
            ))}
          </span>
        ) : null}
      </span>
      <CaretRight weight="bold" aria-hidden className="shrink-0 text-muted-ink" />
    </button>
  );
}
```
`src/app/w/[slug]/lists/roster-cards.tsx`:
```tsx
"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useState } from "react";
import { ROSTER_CARD_ESTIMATE_PX } from "@/config/roster";
import type { Contact, ListSummary } from "@/shared/api/roster";
import { ContactCard } from "./contact-card";

const OVERSCAN = 6;

/**
 * Phone roster: only the cards near the viewport are in the DOM (up to 2,000 people). The list's
 * element is kept in state (callback ref) so its page offset can be read during render.
 */
export function RosterCards({
  contacts,
  lists,
  onOpen,
}: {
  contacts: Contact[];
  lists: ListSummary[];
  onOpen: (contact: Contact) => void;
}) {
  const [listElement, setListElement] = useState<HTMLUListElement | null>(null);
  const scrollMargin = listElement?.offsetTop ?? 0;
  const virtualizer = useWindowVirtualizer({
    count: contacts.length,
    estimateSize: () => ROSTER_CARD_ESTIMATE_PX,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => contacts[index].id,
  });
  return (
    <ul ref={setListElement} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const contact = contacts[item.index];
        return (
          <li
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            aria-label={`${contact.fullName}, ${contact.email}`}
            aria-setsize={contacts.length}
            aria-posinset={item.index + 1}
            className="absolute top-0 left-0 w-full pb-3"
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <ContactCard contact={contact} lists={lists} onOpen={onOpen} />
          </li>
        );
      })}
    </ul>
  );
}
```
In jsdom the virtualizer reads `window.innerHeight` (768) after its mount effect, which RTL's `render` flushes, so small test rosters render every card. If a test sees no `listitem`, pass `initialRect: { width: 0, height: ROSTER_CARD_ESTIMATE_PX * OVERSCAN }` (still SSR-safe) and record a `Ruling:`. `useWindowVirtualizer` returns functions the React Compiler cannot memoize; ESLint reports a `react-hooks/incompatible-library` **warning** (CI fails only on errors). Do not wrap its results in `useMemo`.

`src/app/w/[slug]/lists/roster-empty.tsx`:
```tsx
"use client";

import { UsersThree } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";

/** Empty roster: organizers get the import/paste/add actions (slot), Viewers a short note. */
export function RosterEmpty({ canEdit, actions }: { canEdit: boolean; actions?: ReactNode }) {
  const t = useTranslations("Lists");
  return (
    <Card as="section" className="flex flex-col items-start gap-3">
      <Sticker tone="primary">
        <UsersThree weight="bold" />
      </Sticker>
      <h2 className="font-display text-2xl">{canEdit ? t("emptyTitle") : t("emptyViewerTitle")}</h2>
      <p className="text-muted-ink">{canEdit ? t("emptyBody") : t("emptyViewerBody")}</p>
      {canEdit && actions ? <div className="flex w-full flex-col gap-3 sm:flex-row">{actions}</div> : null}
    </Card>
  );
}
```
`src/app/w/[slug]/lists/roster-skeleton.tsx`:
```tsx
import { Skeleton } from "@/components/ui/skeleton";

const PLACEHOLDER_CARDS = 5;

/** Style-B loading state of the roster page. */
export function RosterSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-2/3" />
      {Array.from({ length: PLACEHOLDER_CARDS }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: View + page**

`src/app/w/[slug]/lists/roster-view.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { filterContacts } from "@/lib/roster/filter-contacts";
import type { Contact, Roster } from "@/shared/api/roster";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { ListChips } from "./list-chips";
import { RosterCards } from "./roster-cards";
import { RosterEmpty } from "./roster-empty";

/** The roster page body (spec §7.14). Editing arrives in Tasks 8–10. */
export function RosterView({ workspace, roster }: { workspace: WorkspaceDetails; roster: Roster }) {
  const t = useTranslations("Lists");
  const [query, setQuery] = useState("");
  const [listId, setListId] = useState<string | null>(null);
  const canEdit = workspace.myRole !== "viewer";
  const visible = filterContacts(roster.contacts, { query, listId });
  const openContact: (contact: Contact) => void = () => undefined;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-sm text-muted-ink">{t("count", { count: roster.contacts.length })}</p>
        </div>
      </div>
      {roster.contacts.length === 0 && roster.lists.length === 0 ? (
        <RosterEmpty canEdit={canEdit} />
      ) : (
        <>
          <Input
            id="roster-search"
            type="search"
            label={t("searchLabel")}
            hideLabel
            placeholder={t("searchPlaceholder", { count: roster.contacts.length })}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ListChips
            lists={roster.lists}
            total={roster.contacts.length}
            selectedListId={listId}
            onSelect={setListId}
          />
          {visible.length === 0 ? (
            <p className="py-6 text-center text-muted-ink">{t("noMatches")}</p>
          ) : (
            <RosterCards contacts={visible} lists={roster.lists} onOpen={openContact} />
          )}
        </>
      )}
    </section>
  );
}
```
`openContact` is a no-op until Task 8 opens the sheet; Task 8 replaces it.

`src/app/w/[slug]/lists/page.tsx`:
```tsx
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRoster } from "@/hooks/use-roster";
import { useWorkspace } from "@/hooks/use-workspace";
import { RosterSkeleton } from "./roster-skeleton";
import { RosterView } from "./roster-view";

/** `/w/[slug]/lists` (spec §7.14): the roster and its lists. */
export default function ListsPage() {
  const t = useTranslations("Lists");
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  const roster = useRoster(slug);
  if (roster.isError) {
    return (
      <Card as="section" className="flex flex-col items-start gap-3">
        <p>{t("loadError")}</p>
        <Button tone="primary" onClick={() => void roster.refetch()}>
          {t("retry")}
        </Button>
      </Card>
    );
  }
  if (!workspace.data || !roster.data) {
    return <RosterSkeleton />;
  }
  return <RosterView workspace={workspace.data} roster={roster.data} />;
}
```
`src/components/shell/coming-soon.tsx`: change the prop type to `area: "meetings"` and delete `ComingSoon.listsTitle` / `listsBody` from `messages/en.json`.

Messages — add a `Lists` namespace (check `messages/en.json` has none first):
```json
"Lists": {
  "title": "Lists",
  "count": "{count, plural, =0 {No one yet} one {# person} other {# people}}",
  "searchLabel": "Search people",
  "searchPlaceholder": "Search {count, plural, one {# person} other {# people}}",
  "listChipsLabel": "Filter by list",
  "allChip": "All {count}",
  "noMatches": "Nobody matches your search.",
  "loadError": "We couldn't load your roster.",
  "retry": "Try again",
  "emptyTitle": "Import your roster",
  "emptyBody": "Bring your members in from a spreadsheet, paste them from Google Sheets, or add them one by one.",
  "emptyViewerTitle": "No one here yet",
  "emptyViewerBody": "The organizers haven't added anyone to the roster yet."
}
```
Run the Step 2 tests → PASS.

- [ ] **Step 5: Home checklist** — in `home-checklist.tsx` give each step an optional `href` builder and action label; "Import your members" becomes available:
```tsx
const STEPS: ReadonlyArray<{
  key: "inviteCommittee" | "importMembers" | "connectGmail" | "connectSheets";
  icon: Icon;
  href?: (slug: string) => string;
  actionKey?: "inviteCommitteeAction" | "importMembersAction";
}> = [
  { key: "inviteCommittee", icon: UserPlus, href: (slug) => `/w/${slug}/settings#people`, actionKey: "inviteCommitteeAction" },
  { key: "importMembers", icon: UploadSimple, href: (slug) => `/w/${slug}/lists`, actionKey: "importMembersAction" },
  { key: "connectGmail", icon: EnvelopeSimple },
  { key: "connectSheets", icon: Table },
];
```
and render `href && actionKey ? <Button asChild tone="primary"><Link href={href(workspace.slug)}>{t(actionKey)}</Link></Button> : <span …>{t("soon")}</span>` (sticker tone `primary` when `href` is set). Add `"importMembersAction": "Import"` to `WorkspaceHome`. Extend `home-checklist.test.tsx`:
```tsx
it("links the import step to the roster", () => {
  renderWithProviders(<HomeChecklist workspace={okContext.workspace} />);
  expect(screen.getByRole("link", { name: "Import" })).toHaveAttribute("href", "/w/club-ab12/lists");
});
```
(reuse the file's existing imports; add `okContext` from `@/test/workspace-context-mock` if missing).

- [ ] **Step 6: e2e** — `e2e/helpers/layout.ts`:
```ts
import { expect, type Page } from "@playwright/test";

/** Review Focus 5: the page never scrolls sideways (320 px phones included). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
```
Append to `e2e/helpers/seed.ts`:
```ts
/** Puts people and their lists straight into a workspace's roster (service role; test setup only). */
export async function seedRoster(
  slug: string,
  people: Array<{ fullName: string; email: string; lists?: string[] }>,
): Promise<void> {
  const client = admin();
  const workspace = await client.from("workspaces").select("id").eq("slug", slug).single();
  if (workspace.error) {
    throw workspace.error;
  }
  const workspaceId = workspace.data.id;
  const names = [...new Set(people.flatMap((person) => person.lists ?? []))];
  const lists = names.length
    ? await client.from("lists").insert(names.map((name) => ({ workspace_id: workspaceId, name }))).select("id, name")
    : { data: [], error: null };
  const contacts = await client
    .from("contacts")
    .insert(people.map((person) => ({ workspace_id: workspaceId, email: person.email, full_name: person.fullName })))
    .select("id, email");
  if (lists.error || contacts.error) {
    throw lists.error ?? contacts.error;
  }
  const listId = new Map(lists.data.map((list) => [list.name, list.id]));
  const contactId = new Map(contacts.data.map((contact) => [contact.email, contact.id]));
  const links = people.flatMap((person) =>
    (person.lists ?? []).map((name) => ({
      workspace_id: workspaceId,
      list_id: listId.get(name) ?? "",
      contact_id: contactId.get(person.email) ?? "",
    })),
  );
  if (links.length) {
    const linked = await client.from("list_contacts").insert(links);
    if (linked.error) {
      throw linked.error;
    }
  }
}
```
`e2e/roster.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { seedRoster } from "./helpers/seed";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

const LONG_NAME = "Mohamed Ali Ben Abdallah El Kefi";
const LONG_EMAIL = "mohamedali.benabdallah.elkefi@etudiant-issatso.u-sousse.tn";

async function createWorkspace(page: Page, name: string): Promise<string> {
  await signInWithCode(page, uniqueEmail("e2e-roster"), { startPath: "/login", name: "Roster Owner" });
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+-[a-z0-9]{4}$/);
  return new URL(page.url()).pathname.split("/")[2];
}

test("the roster lists, searches and filters people without sideways scrolling", async ({ page }) => {
  const slug = await createWorkspace(page, "Roster Club");
  await seedRoster(slug, [
    { fullName: "Inès Ben Salah", email: "ines@example.test", lists: ["Dev", "Events"] },
    { fullName: "Youssef Trabelsi", email: "youssef@example.test", lists: ["Design"] },
    { fullName: LONG_NAME, email: LONG_EMAIL, lists: ["Dev"] },
  ]);
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Lists" }).click();
  await expect(page.getByText("3 people")).toBeVisible();
  await expect(page.getByText(LONG_EMAIL)).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("searchbox", { name: "Search people" }).fill("ines");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search people" }).fill("");
  await page.getByRole("button", { name: "Design 1" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("listitem")).toContainText("Youssef Trabelsi");
});

test("a large roster renders only the visible cards", async ({ page }) => {
  const slug = await createWorkspace(page, "Big Club");
  await seedRoster(
    slug,
    Array.from({ length: 300 }, (_, i) => ({ fullName: `Member ${String(i).padStart(3, "0")}`, email: `m${i}@example.test` })),
  );
  await page.goto(`/w/${slug}/lists`);
  await expect(page.getByText("300 people")).toBeVisible();
  expect(await page.getByRole("listitem").count()).toBeLessThan(60);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByText("Member 299")).toBeVisible();
});
```
Stop any `next dev`, then `bun run test:e2e -- e2e/roster.spec.ts` → PASS on `phone` and `small-phone`.

- [ ] **Step 7: Visual check** — Playwright screenshots of `/w/<slug>/lists` with the seeded roster: 390 px light, 320 px dark, and the empty state for an Owner and a Viewer. Check the list-chip row scrolls sideways inside itself while the page does not.

- [ ] **Step 8: Verify and commit** — `bun run lint && bun run typecheck && bun run test` → PASS (the `incompatible-library` warning is expected). Commit: `feat: roster page with search, list filters and virtualized cards`.

---

### Task 8: Roster editing — ListPicker, ContactSheet, Add person, Manage lists, Undo deletes

**Labels:** `area:frontend`

**Files:**
- Create: `src/components/forms/list-picker.tsx` + test; `src/app/w/[slug]/lists/describe-edit-error.ts` + test, `contact-sheet.tsx` + test, `add-contact-dialog.tsx` + test, `manage-lists-dialog.tsx` + test, `use-deferred-delete.ts`
- Modify: `src/test/render.tsx` (`{ toaster: true }` option), `src/app/w/[slug]/lists/roster-view.tsx` + test (open sheet, "+ Add", "Manage" chip, pending deletes, empty-state actions), `messages/en.json` (`Lists` keys below), `e2e/roster.spec.ts`

**Interfaces:**
- Consumes: Task 4 hooks (`useUpdateContact`, `useDeleteContact`, `useCreateList`, `useRenameList`, `useDeleteList`, `useImportContacts`, `rosterQueryKey`), `removeContacts`, `contactNameSchema`, `emailSchema`, `listNameSchema`, `UNDO_DELETE_MS`, `ApiClientError`; UI: `Dialog*`, `Popover*`, `Command*`, `Input`, `Button`, `Chip`, `ListTag` (Task 7).
- Produces:
  - `ListPicker({ lists, selectedIds, onChange, onCreate?, mode?, triggerLabel, triggerClassName?, disabled? })` — `mode: "multiple"` (default; toggles, stays open) or `"single"` (selects one and closes); `onCreate(name) => Promise<{ id: string }>` adds a "Create list "<name>"" option when the typed name matches no list (case-insensitive).
  - `ContactSheet({ slug, contact, roster, canEdit, onClose, onDelete })`.
  - `AddContactDialog({ slug, roster, open, onOpenChange })`.
  - `ManageListsDialog({ slug, lists, open, onOpenChange })`.
  - `useDeferredDelete(slug): { pendingIds: ReadonlySet<string>; scheduleDelete: (contact: Contact) => void }`.
  - `describeEditError(error: Error, email: string | undefined, roster: Roster): { code: ApiErrorCode; takenBy: string | null }` — `takenBy` names the person who already has `email` when the API said `contact_email_taken`.
  - `RosterView` now owns `openContactId`, the "+ Add" and "Manage" entry points, and hides `pendingIds`.

- [ ] **Step 1: Messages** — add to `Lists`:
```json
"add": "Add",
"addTitle": "Add a person",
"addSubmit": "Add person",
"added": "{name} added.",
"alreadyThere": "{name} is already in your roster.",
"updatedExisting": "{name} was already in your roster. Updated.",
"nameLabel": "Full name",
"emailLabel": "Email",
"listsLabel": "Lists",
"noListsYet": "Not in any list yet.",
"addToList": "Add to a list",
"searchLists": "Search or create a list",
"noLists": "No list matches. Type a name to create one.",
"createList": "Create list \"{name}\"",
"removeFromList": "Remove from {list}",
"editTitle": "Edit person",
"viewTitle": "Person",
"readOnly": "Only Owners and Admins can edit the roster.",
"saving": "Saving…",
"saved": "Saved",
"emailTaken": "Already in your roster: {name}",
"invalidName": "Enter a name (up to 120 characters).",
"invalidEmail": "Enter a valid email address.",
"delete": "Delete",
"deleted": "{name} deleted.",
"undo": "Undo",
"manage": "Manage",
"manageTitle": "Manage lists",
"manageEmpty": "No lists yet.",
"newListLabel": "New list",
"createListAction": "Create",
"renameLabel": "Name of the list {name}",
"deleteList": "Delete {name}",
"confirmDeleteList": "Delete {name}? Its people stay in the roster.",
"confirmDeleteAction": "Delete list",
"cancel": "Cancel"
```

- [ ] **Step 2: Failing tests** — toasts are asserted on screen and `renderWithProviders` (`src/test/render.tsx`) does not mount sonner's `Toaster`, so add an option there: `renderWithProviders(ui, { toaster: true })` renders `<Toaster />` (from `@/components/ui/sonner`) next to `ui`. Use it in the AddContactDialog and RosterView tests below.

`src/components/forms/list-picker.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ListPicker } from "./list-picker";

describe("ListPicker", () => {
  it("toggles lists in multiple mode", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker lists={rosterFixture.lists} selectedIds={[IDS.dev]} onChange={onChange} triggerLabel="Add to a list" />,
    );
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.click(screen.getByRole("option", { name: "Design" }));
    expect(onChange).toHaveBeenLastCalledWith([IDS.dev, IDS.design]);
    await user.click(screen.getByRole("option", { name: "Dev" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("creates a list from the search text, ignoring case for existing names", async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn(async () => ({ id: "00000000-0000-4000-8000-0000000000d9" }));
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker lists={rosterFixture.lists} selectedIds={[]} onChange={onChange} onCreate={onCreate} triggerLabel="Add to a list" />,
    );
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.type(screen.getByPlaceholderText("Search or create a list"), "dev");
    expect(screen.queryByRole("option", { name: /Create list/ })).toBeNull();
    await user.clear(screen.getByPlaceholderText("Search or create a list"));
    await user.type(screen.getByPlaceholderText("Search or create a list"), "  Media ");
    await user.click(screen.getByRole("option", { name: 'Create list "Media"' }));
    expect(onCreate).toHaveBeenCalledWith("Media");
    expect(onChange).toHaveBeenLastCalledWith(["00000000-0000-4000-8000-0000000000d9"]);
  });

  it("selects one list and closes in single mode", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker mode="single" lists={rosterFixture.lists} selectedIds={[]} onChange={onChange} triggerLabel="Choose a list" />,
    );
    await user.click(screen.getByRole("button", { name: "Choose a list" }));
    await user.click(screen.getByRole("option", { name: "Design" }));
    expect(onChange).toHaveBeenCalledWith([IDS.design]);
    expect(screen.queryByRole("option", { name: "Design" })).toBeNull();
  });
});
```
`src/app/w/[slug]/lists/contact-sheet.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ContactSheet } from "./contact-sheet";

const youssef = rosterFixture.contacts[2];
const base = `/api/workspaces/club-ab12`;

function renderSheet(canEdit = true) {
  const onDelete = vi.fn();
  renderWithProviders(
    <ContactSheet slug="club-ab12" contact={youssef} roster={rosterFixture} canEdit={canEdit} onClose={vi.fn()} onDelete={onDelete} />,
  );
  return { onDelete };
}

describe("ContactSheet", () => {
  it("saves a changed name when the field loses focus", async () => {
    const fetchMock = routeFetch({
      [`PATCH ${base}/contacts/${IDS.youssef}`]: json({ ok: true }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderSheet();
    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Youssef T.");
    await user.tab();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith(IDS.youssef) && init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ fullName: "Youssef T." });
  });

  it("names the person who already has an email", async () => {
    routeFetch({
      [`PATCH ${base}/contacts/${IDS.youssef}`]: json({ error: { code: "contact_email_taken" } }, 409),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderSheet();
    const email = screen.getByLabelText("Email");
    await user.clear(email);
    await user.type(email, "SARRA@example.com");
    await user.tab();
    expect(await screen.findByText("Already in your roster: Sarra Khelifi")).toBeInTheDocument();
  });

  it("refuses an invalid email without calling the API", async () => {
    const fetchMock = routeFetch({});
    const user = userEvent.setup();
    renderSheet();
    const email = screen.getByLabelText("Email");
    await user.clear(email);
    await user.type(email, "not-an-email");
    await user.tab();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds and removes lists, and deletes through the parent", async () => {
    const fetchMock = routeFetch({
      [`PATCH ${base}/contacts/${IDS.youssef}`]: json({ ok: true }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    const { onDelete } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.click(screen.getByRole("option", { name: "Dev" }));
    const bodies = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies()).toContainEqual({ listIds: [IDS.dev] });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(youssef);
  });

  it("is read-only for Viewers", () => {
    renderSheet(false);
    expect(screen.getByRole("heading", { name: "Person" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("Only Owners and Admins can edit the roster.")).toBeInTheDocument();
  });
});
```
`src/app/w/[slug]/lists/add-contact-dialog.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { AddContactDialog } from "./add-contact-dialog";

const result = (outcome: "new" | "updated") => ({
  summary: { new: outcome === "new" ? 1 : 0, updated: outcome === "updated" ? 1 : 0, unchanged: 0, invalid: 0, merged: 0 },
  newLists: [],
  limitExceeded: null,
  rows: [{ row: 1, email: "amira@example.com", fullName: "Amira", outcome, reason: null, addedLists: [], previousName: null, mergedRows: [] }],
});

describe("AddContactDialog", () => {
  it("adds one person through the import route with their lists", async () => {
    const fetchMock = routeFetch({
      "POST /api/workspaces/club-ab12/contacts/import": json(result("new")),
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<AddContactDialog slug="club-ab12" roster={rosterFixture} open onOpenChange={onOpenChange} />, { toaster: true });
    await user.type(screen.getByLabelText("Full name"), "Amira");
    await user.type(screen.getByLabelText("Email"), "Amira@Example.com");
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.click(screen.getByRole("option", { name: "Dev" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Add person" }));
    expect(await screen.findByText("Amira added.")).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      rows: [{ row: 1, fullName: "Amira", email: "amira@example.com", lists: ["Dev"] }],
      dryRun: false,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when the email was already in the roster", async () => {
    routeFetch({
      "POST /api/workspaces/club-ab12/contacts/import": json(result("updated")),
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(<AddContactDialog slug="club-ab12" roster={rosterFixture} open onOpenChange={vi.fn()} />, { toaster: true });
    await user.type(screen.getByLabelText("Full name"), "Amira");
    await user.type(screen.getByLabelText("Email"), "amira@example.com");
    await user.click(screen.getByRole("button", { name: "Add person" }));
    expect(await screen.findByText("Amira was already in your roster. Updated.")).toBeInTheDocument();
  });
});
```
`src/app/w/[slug]/lists/manage-lists-dialog.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ManageListsDialog } from "./manage-lists-dialog";

const base = "/api/workspaces/club-ab12";

describe("ManageListsDialog", () => {
  it("creates, renames on blur and deletes after confirming", async () => {
    const fetchMock = routeFetch({
      [`POST ${base}/lists`]: json({ id: "00000000-0000-4000-8000-0000000000d9", name: "Media" }),
      [`PATCH ${base}/lists/${IDS.dev}`]: json({ ok: true }),
      [`DELETE ${base}/lists/${IDS.design}`]: json({ ok: true }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(<ManageListsDialog slug="club-ab12" lists={rosterFixture.lists} open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("New list"), "Media");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const dev = screen.getByLabelText("Name of the list Dev");
    await user.clear(dev);
    await user.type(dev, "Developers");
    await user.tab();

    await user.click(screen.getByRole("button", { name: "Delete Design" }));
    expect(screen.getByText("Delete Design? Its people stay in the roster.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete list" }));

    const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`);
    expect(calls).toEqual(expect.arrayContaining([
      `POST ${base}/lists`,
      `PATCH ${base}/lists/${IDS.dev}`,
      `DELETE ${base}/lists/${IDS.design}`,
    ]));
  });
});
```
Extend `roster-view.test.tsx`:
```tsx
it("deletes with Undo: hidden at once, restored by Undo, sent only after the delay", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = routeFetch({
    [`DELETE /api/workspaces/club-ab12/contacts/${IDS.ines}`]: json({ ok: true }),
    "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
  });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />, { toaster: true });

  await user.click(screen.getByRole("button", { name: /Inès Ben Salah/ }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.queryByRole("listitem", { name: /Inès/ })).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  expect(screen.getByRole("listitem", { name: /Inès/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Inès Ben Salah/ }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  vi.useRealTimers();
});

it("lets organizers add people and manage lists, not Viewers", () => {
  const { unmount } = renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />);
  expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  unmount();
  renderWithProviders(<RosterView workspace={viewer} roster={rosterFixture} />);
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
});
```
(add imports: `vi` from vitest, `json`/`routeFetch` from `@/test/fetch`, `IDS` from the fixture, `UNDO_DELETE_MS` from `@/config/roster`).

Run `bun run test src/components/forms/list-picker.test.tsx src/app/w` → new tests FAIL.

- [ ] **Step 3: ListPicker** — `src/components/forms/list-picker.tsx`:
```tsx
"use client";

import { Check, Plus } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { listNameSchema, type ListSummary } from "@/shared/api/roster";

/**
 * Searchable list chooser (cmdk in a popover). "multiple" toggles memberships and stays open;
 * "single" picks one list and closes. With `onCreate`, a name that matches no list (ignoring
 * case) can be created and is selected right away.
 */
export function ListPicker({
  lists,
  selectedIds,
  onChange,
  onCreate,
  mode = "multiple",
  triggerLabel,
  triggerClassName,
  disabled = false,
}: {
  lists: ListSummary[];
  selectedIds: string[];
  onChange: (listIds: string[]) => void;
  onCreate?: (name: string) => Promise<{ id: string }>;
  mode?: "multiple" | "single";
  triggerLabel: string;
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Lists");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const typed = listNameSchema.safeParse(search);
  const canCreate =
    onCreate !== undefined &&
    typed.success &&
    !lists.some((list) => list.name.toLowerCase() === typed.data.toLowerCase());

  const choose = (listId: string) => {
    if (mode === "single") {
      onChange([listId]);
      setOpen(false);
      return;
    }
    onChange(
      selectedIds.includes(listId)
        ? selectedIds.filter((id) => id !== listId)
        : [...selectedIds, listId],
    );
  };

  const create = async () => {
    if (!onCreate || !typed.success) {
      return;
    }
    const created = await onCreate(typed.data);
    setSearch("");
    choose(created.id);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-dashed border-outline px-3 text-sm font-bold text-ink disabled:opacity-50",
            triggerClassName,
          )}
        >
          <Plus weight="bold" aria-hidden />
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={t("searchLists")} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{t("noLists")}</CommandEmpty>
            {lists.map((list) => (
              <CommandItem key={list.id} value={list.name} onSelect={() => choose(list.id)} className="justify-between">
                <span className="truncate">{list.name}</span>
                {selectedIds.includes(list.id) ? <Check weight="bold" aria-hidden /> : null}
              </CommandItem>
            ))}
            {canCreate ? (
              <CommandItem forceMount value={`create:${typed.data}`} onSelect={() => void create()}>
                {t("createList", { name: typed.data })}
              </CommandItem>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```
`CommandItem`'s accessible name is its text, so the test's `option` names match. The check icon is `aria-hidden`; cmdk sets `aria-selected` for the keyboard highlight only, so selection is conveyed by the list of chips next to the trigger (sheet, dialog) rather than by the option.

- [ ] **Step 4: Deferred delete** — `src/app/w/[slug]/lists/use-deferred-delete.ts`:
```ts
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { UNDO_DELETE_MS } from "@/config/roster";
import { useDeleteContact } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import type { Contact } from "@/shared/api/roster";

/**
 * Delete with Undo (spec §7.14): the person disappears at once, the DELETE is sent only when the
 * Undo toast expires, and Undo cancels it. Closing the tab first means nothing is deleted. The
 * timer is not cleared on unmount, so moving to another page still completes the delete.
 */
export function useDeferredDelete(slug: string): {
  pendingIds: ReadonlySet<string>;
  scheduleDelete: (contact: Contact) => void;
} {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const remove = useDeleteContact(slug);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const forget = (id: string) =>
    setPendingIds((current) => new Set([...current].filter((pending) => pending !== id)));

  const scheduleDelete = (contact: Contact) => {
    setPendingIds((current) => new Set(current).add(contact.id));
    const timer = setTimeout(() => {
      remove.mutate(contact.id, {
        onSettled: () => forget(contact.id),
        onError: (error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal")),
      });
    }, UNDO_DELETE_MS);
    toast(t("deleted", { name: contact.fullName }), {
      duration: UNDO_DELETE_MS,
      action: {
        label: t("undo"),
        onClick: () => {
          clearTimeout(timer);
          forget(contact.id);
        },
      },
    });
  };

  return { pendingIds, scheduleDelete };
}
```

- [ ] **Step 5: Edit error helper + ContactSheet** — `src/app/w/[slug]/lists/describe-edit-error.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api-client";
import { rosterFixture } from "@/test/fixtures/roster";
import { describeEditError } from "./describe-edit-error";

describe("describeEditError", () => {
  it("names who already uses the email", () => {
    expect(describeEditError(new ApiClientError("contact_email_taken", 409), "sarra@example.com", rosterFixture)).toEqual({
      code: "contact_email_taken",
      takenBy: "Sarra Khelifi",
    });
  });

  it("falls back to the error code", () => {
    expect(describeEditError(new ApiClientError("forbidden", 403), undefined, rosterFixture)).toEqual({ code: "forbidden", takenBy: null });
    expect(describeEditError(new Error("offline"), undefined, rosterFixture)).toEqual({ code: "internal", takenBy: null });
  });
});
```
`src/app/w/[slug]/lists/describe-edit-error.ts`:
```ts
import { ApiClientError } from "@/lib/api-client";
import type { ApiErrorCode } from "@/shared/api/errors";
import type { Roster } from "@/shared/api/roster";

/**
 * What went wrong with a person edit. For `contact_email_taken`, `takenBy` is the name of the
 * roster person who already uses that email, so the UI can say "Already in your roster: Sarra".
 */
export function describeEditError(
  error: Error,
  email: string | undefined,
  roster: Roster,
): { code: ApiErrorCode; takenBy: string | null } {
  const code = error instanceof ApiClientError ? error.code : "internal";
  const takenBy =
    code === "contact_email_taken"
      ? (roster.contacts.find((contact) => contact.email === email)?.fullName ?? null)
      : null;
  return { code, takenBy };
}
```
Then `src/app/w/[slug]/lists/contact-sheet.tsx`:
```tsx
"use client";

import { Trash, X } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateList, useUpdateContact } from "@/hooks/use-roster";
import { emailSchema } from "@/shared/api/common";
import { contactNameSchema, type Contact, type Roster, type UpdateContactBody } from "@/shared/api/roster";
import { describeEditError } from "./describe-edit-error";
import { ListTag } from "./list-tag";

type Field = "fullName" | "email";
type SaveState = "idle" | "saving" | "saved";

/**
 * Bottom-sheet editor for one person (spec §7.14). Each field saves when it loses focus if it
 * changed and is valid; lists save on every change. Viewers get the same sheet read-only.
 */
export function ContactSheet({
  slug,
  contact,
  roster,
  canEdit,
  onClose,
  onDelete,
}: {
  slug: string;
  contact: Contact;
  roster: Roster;
  canEdit: boolean;
  onClose: () => void;
  onDelete: (contact: Contact) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const update = useUpdateContact(slug);
  const createList = useCreateList(slug);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const current = roster.contacts.find((c) => c.id === contact.id) ?? contact;
  const own = roster.lists.filter((list) => current.listIds.includes(list.id));

  const save = (patch: UpdateContactBody, field?: Field) => {
    setSaveState("saving");
    update.mutate(
      { id: contact.id, patch },
      {
        onSuccess: () => setSaveState("saved"),
        onError: (error) => {
          setSaveState("idle");
          const { code, takenBy } = describeEditError(error, patch.email, roster);
          const message = takenBy ? t("emailTaken", { name: takenBy }) : tErrors(code);
          if (field) {
            setErrors((previous) => ({ ...previous, [field]: message }));
          }
        },
      },
    );
  };

  const onBlur = (field: Field, raw: string) => {
    const parsed = (field === "email" ? emailSchema : contactNameSchema).safeParse(raw);
    if (!parsed.success) {
      setErrors((previous) => ({ ...previous, [field]: field === "email" ? t("invalidEmail") : t("invalidName") }));
      return;
    }
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    if (parsed.data !== current[field]) {
      save({ [field]: parsed.data }, field);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{canEdit ? t("editTitle") : t("viewTitle")}</DialogTitle>
          <DialogDescription className="break-all">{current.email}</DialogDescription>
        </DialogHeader>
        {canEdit ? (
          <div className="flex flex-col gap-4">
            <Input
              id="sheet-name"
              label={t("nameLabel")}
              defaultValue={current.fullName}
              error={errors.fullName}
              onBlur={(event) => onBlur("fullName", event.target.value)}
            />
            <Input
              id="sheet-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              label={t("emailLabel")}
              defaultValue={current.email}
              error={errors.email}
              onBlur={(event) => onBlur("email", event.target.value)}
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold">{t("listsLabel")}</span>
              <div className="flex flex-wrap items-center gap-2">
                {own.map((list) => (
                  <span key={list.id} className="inline-flex items-center gap-1">
                    <ListTag list={list} />
                    <button
                      type="button"
                      aria-label={t("removeFromList", { list: list.name })}
                      onClick={() => save({ listIds: current.listIds.filter((id) => id !== list.id) })}
                      className="inline-flex size-11 items-center justify-center rounded-full"
                    >
                      <X weight="bold" aria-hidden />
                    </button>
                  </span>
                ))}
                <ListPicker
                  lists={roster.lists}
                  selectedIds={current.listIds}
                  onChange={(listIds) => save({ listIds })}
                  onCreate={(name) => createList.mutateAsync(name)}
                  triggerLabel={t("addToList")}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Button tone="danger" onClick={() => onDelete(current)}>
                <Trash weight="bold" aria-hidden />
                {t("delete")}
              </Button>
              <p aria-live="polite" className="text-sm text-muted-ink">
                {saveState === "saving" ? t("saving") : saveState === "saved" ? t("saved") : ""}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="font-bold">{t("nameLabel")}</dt>
              <dd className="break-words">{current.fullName}</dd>
              <dt className="font-bold">{t("listsLabel")}</dt>
              <dd className="flex flex-wrap gap-1">
                {own.length ? own.map((list) => <ListTag key={list.id} list={list} />) : t("noListsYet")}
              </dd>
            </dl>
            <p className="text-sm text-muted-ink">{t("readOnly")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: AddContactDialog** — `src/app/w/[slug]/lists/add-contact-dialog.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateList, useImportContacts } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import { emailSchema } from "@/shared/api/common";
import { contactNameSchema, type Roster } from "@/shared/api/roster";
import { ListTag } from "./list-tag";

const schema = z.object({ fullName: contactNameSchema, email: emailSchema });
type Values = z.input<typeof schema>;

/**
 * "+ Add": one person through the import route (spec §6), so an email already in the roster
 * merges (name updated, lists added) instead of failing.
 */
export function AddContactDialog({
  slug,
  roster,
  open,
  onOpenChange,
}: {
  slug: string;
  roster: Roster;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const importContacts = useImportContacts(slug);
  const createList = useCreateList(slug);
  const [listIds, setListIds] = useState<string[]>([]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { fullName: "", email: "" } });

  const submit = form.handleSubmit((values) => {
    const parsed = schema.parse(values);
    const names = roster.lists.filter((list) => listIds.includes(list.id)).map((list) => list.name);
    importContacts.mutate(
      { rows: [{ row: 1, fullName: parsed.fullName, email: parsed.email, lists: names }], dryRun: false },
      {
        onSuccess: (result) => {
          const outcome = result.rows[0]?.outcome;
          const name = result.rows[0]?.fullName ?? parsed.fullName;
          if (outcome === "invalid") {
            form.setError("email", { message: t("invalidEmail") });
            return;
          }
          toast(
            outcome === "new" ? t("added", { name }) : outcome === "updated" ? t("updatedExisting", { name }) : t("alreadyThere", { name }),
          );
          form.reset();
          setListIds([]);
          onOpenChange(false);
        },
        onError: (error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal")),
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Input
            id="add-name"
            label={t("nameLabel")}
            error={form.formState.errors.fullName ? t("invalidName") : undefined}
            {...form.register("fullName")}
          />
          <Input
            id="add-email"
            type="email"
            inputMode="email"
            label={t("emailLabel")}
            error={form.formState.errors.email ? t("invalidEmail") : undefined}
            {...form.register("email")}
          />
          <div className="flex flex-wrap items-center gap-2">
            {roster.lists
              .filter((list) => listIds.includes(list.id))
              .map((list) => (
                <ListTag key={list.id} list={list} />
              ))}
            <ListPicker
              lists={roster.lists}
              selectedIds={listIds}
              onChange={setListIds}
              onCreate={(name) => createList.mutateAsync(name)}
              triggerLabel={t("addToList")}
            />
          </div>
          <DialogFooter>
            <Button type="submit" tone="primary" disabled={importContacts.isPending}>
              {t("addSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: ManageListsDialog** — `src/app/w/[slug]/lists/manage-lists-dialog.tsx`:
```tsx
"use client";

import { Trash } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateList, useDeleteList, useRenameList } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import { listNameSchema, type ListSummary } from "@/shared/api/roster";

/** Create, rename (on blur) and delete lists. Deleting a list never deletes its people. */
export function ManageListsDialog({
  slug,
  lists,
  open,
  onOpenChange,
}: {
  slug: string;
  lists: ListSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const create = useCreateList(slug);
  const rename = useRenameList(slug);
  const remove = useDeleteList(slug);
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState<ListSummary | null>(null);
  const showError = (error: Error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal"));

  const submitNew = () => {
    const parsed = listNameSchema.safeParse(newName);
    if (parsed.success) {
      create.mutate(parsed.data, { onSuccess: () => setNewName(""), onError: showError });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manageTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitNew();
          }}
        >
          <div className="flex-1">
            <Input id="new-list" label={t("newListLabel")} value={newName} onChange={(event) => setNewName(event.target.value)} />
          </div>
          <Button type="submit" tone="primary" disabled={create.isPending}>
            {t("createListAction")}
          </Button>
        </form>
        {lists.length === 0 ? <p className="text-muted-ink">{t("manageEmpty")}</p> : null}
        <ul className="flex flex-col gap-3">
          {lists.map((list) => (
            <li key={list.id} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  id={`list-${list.id}`}
                  label={t("renameLabel", { name: list.name })}
                  hideLabel
                  defaultValue={list.name}
                  onBlur={(event) => {
                    const parsed = listNameSchema.safeParse(event.target.value);
                    if (parsed.success && parsed.data !== list.name) {
                      rename.mutate({ id: list.id, name: parsed.data }, { onError: showError });
                    }
                  }}
                />
              </div>
              <span className="pb-3 text-sm text-muted-ink">{list.contactCount}</span>
              <Button tone="danger" aria-label={t("deleteList", { name: list.name })} onClick={() => setConfirming(list)}>
                <Trash weight="bold" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        {confirming ? (
          <div role="alert" className="flex flex-col gap-3 rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-danger p-3 text-on-fill">
            <p className="font-bold">{t("confirmDeleteList", { name: confirming.name })}</p>
            <div className="flex gap-2">
              <Button
                tone="danger"
                onClick={() => remove.mutate(confirming.id, { onSuccess: () => setConfirming(null), onError: showError })}
              >
                {t("confirmDeleteAction")}
              </Button>
              <Button onClick={() => setConfirming(null)}>{t("cancel")}</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Wire into RosterView** — in `roster-view.tsx`:
  - state: `openContactId: string | null`, `adding: boolean`, `managing: boolean`; `const { pendingIds, scheduleDelete } = useDeferredDelete(workspace.slug);`
  - `const people = roster.contacts.filter((c) => !pendingIds.has(c.id));` — use `people` (not `roster.contacts`) for the count, `filterContacts` and the chips' `total`; pass `{ ...roster, contacts: people }` to children that count.
  - replace the no-op with `const openContact = (contact: Contact) => setOpenContactId(contact.id);`
  - header: when `canEdit`, `<Button tone="primary" onClick={() => setAdding(true)}><Plus weight="bold" aria-hidden />{t("add")}</Button>`
  - `ListChips trailing={canEdit ? <Chip pressed={false} onPressedChange={() => setManaging(true)} className="shrink-0">{t("manage")}</Chip> : undefined}`
  - `RosterEmpty actions={<Button tone="primary" onClick={() => setAdding(true)}>{t("add")}</Button>}` (Task 10 adds Import and Paste in front of it)
  - render, after the list:
```tsx
{openContact ? (
  <ContactSheet
    key={openContact.id}
    slug={workspace.slug}
    contact={openContact}
    roster={roster}
    canEdit={canEdit}
    onClose={() => setOpenContactId(null)}
    onDelete={(contact) => {
      setOpenContactId(null);
      scheduleDelete(contact);
    }}
  />
) : null}
{canEdit ? (
  <>
    <AddContactDialog slug={workspace.slug} roster={roster} open={adding} onOpenChange={setAdding} />
    <ManageListsDialog slug={workspace.slug} lists={roster.lists} open={managing} onOpenChange={setManaging} />
  </>
) : null}
```
  where `const openContact = people.find((c) => c.id === openContactId)` (rename the handler to `openContactSheet` to avoid the clash).
  Run all Step 2 tests → PASS.

- [ ] **Step 9: e2e** — append to `e2e/roster.spec.ts`:
```ts
test("an organizer edits a person, adds one, and deletes with Undo", async ({ page }) => {
  const slug = await createWorkspace(page, "Edit Club");
  await seedRoster(slug, [{ fullName: "Youssef Trabelsi", email: "youssef@example.test", lists: ["Design"] }]);
  await page.goto(`/w/${slug}/lists`);

  await page.getByRole("button", { name: /Youssef Trabelsi/ }).click();
  await page.getByLabel("Full name").fill("Youssef T.");
  await page.getByLabel("Full name").blur();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByText("Youssef T.")).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Full name").fill("Amira Haddad");
  await page.getByLabel("Email").fill("amira@example.test");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText("Amira Haddad added.")).toBeVisible();
  await expect(page.getByText("2 people")).toBeVisible();

  await page.getByRole("button", { name: /Amira Haddad/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("1 person")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("2 people")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
```
Run `bun run test:e2e -- e2e/roster.spec.ts` → PASS.

- [ ] **Step 10: Visual check** — screenshots of the sheet (editor and Viewer), Add dialog, Manage lists (with the delete confirmation) at 390 px light and 320 px dark; the sheet must not exceed the viewport and the email must wrap.

- [ ] **Step 11: Verify and commit** — `bun run lint && bun run typecheck && bun run test` → PASS. Commit: `feat: edit people in a sheet, add one, manage lists, delete with undo`.

---

### Task 9: Select mode, bulk actions and the `md+` grid

**Labels:** `area:frontend`

**Files:**
- Create: `src/app/w/[slug]/lists/selection-bar.tsx` + test, `editable-cell.tsx` + test, `roster-grid.tsx` + test
- Modify: `src/app/w/[slug]/lists/contact-card.tsx` (select mode), `roster-cards.tsx` (pass selection), `roster-view.tsx` + test (selection state, Select toggle, grid from `md`), `messages/en.json` (`Lists` keys below), `e2e/roster.spec.ts`
- Add dependency: `bun add @tanstack/react-table`

**Interfaces:**
- Consumes: `useBulkContacts`, `useUpdateContact`, `useCreateList` (Task 4), `ListPicker`, `ListTag`, `Checkbox` (Task 6), `useMediaQuery`, `ROSTER_GRID_MEDIA`, `ROSTER_CARD_ESTIMATE_PX` (Task 7), TanStack Table v9 (`useTable`, `tableFeatures`, `createColumnHelper`, `rowSortingFeature`, `createSortedRowModel`, `sortFn_text`), `useWindowVirtualizer`.
- Produces:
  - `SelectionBar({ slug, roster, selectedIds, onClear })` — sticky above the bottom bar: "N selected", Add to list (single-mode picker, can create), Remove from list (only lists the selection is in), Delete N (confirm dialog), Clear.
  - `EditableCell({ value, label, onCommit, validate, rowIndex, columnIndex })` — shows text; Enter or click edits; Enter/blur commits when `validate(value)` returns `null`; Escape cancels; arrow keys move focus between cells (`data-cell="<row>:<col>"`).
  - `RosterGrid({ slug, contacts, roster, selectedIds, onToggle, onToggleAll })` — virtualized `<table>` with sortable Full name / Email headers.
  - `ContactCard` gains `selection?: { selected: boolean; onToggle: () => void }`; with it the card is a checkbox row instead of a sheet opener.

- [ ] **Step 1: Messages** — add to `Lists`:
```json
"select": "Select",
"doneSelecting": "Done",
"selectedCount": "{count} selected",
"clearSelection": "Clear",
"selectPerson": "Select {name}",
"selectAll": "Select everyone shown",
"bulkAdd": "Add to list",
"bulkRemove": "Remove from list",
"bulkDelete": "Delete {count}",
"bulkDeleteTitle": "Delete {count, plural, one {# person} other {# people}}?",
"bulkDeleteBody": "They are removed from every list. This can't be undone.",
"bulkAdded": "{count, plural, one {# person} other {# people}} added to {list}.",
"bulkRemoved": "{count, plural, one {# person} other {# people}} removed from {list}.",
"bulkDeleted": "{count, plural, one {# person} other {# people}} deleted.",
"columnName": "Full name",
"columnEmail": "Email",
"columnLists": "Lists",
"sortBy": "Sort by {column}",
"editCell": "{column} of {name}"
```

- [ ] **Step 2: Failing tests**

`src/app/w/[slug]/lists/editable-cell.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { EditableCell } from "./editable-cell";

const notEmpty = (value: string) => (value.trim() ? null : "Required");

function renderCells(onCommit = vi.fn()) {
  renderWithProviders(
    <table>
      <tbody>
        <tr>
          <td><EditableCell value="Inès" label="Full name of Inès" onCommit={onCommit} validate={notEmpty} rowIndex={0} columnIndex={1} /></td>
          <td><EditableCell value="ines@example.com" label="Email of Inès" onCommit={vi.fn()} validate={notEmpty} rowIndex={0} columnIndex={2} /></td>
        </tr>
        <tr>
          <td><EditableCell value="Sarra" label="Full name of Sarra" onCommit={vi.fn()} validate={notEmpty} rowIndex={1} columnIndex={1} /></td>
          <td />
        </tr>
      </tbody>
    </table>,
  );
  return onCommit;
}

describe("EditableCell", () => {
  it("edits with Enter, commits on Enter, cancels with Escape", async () => {
    const user = userEvent.setup();
    const onCommit = renderCells();
    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    const field = screen.getByRole("textbox", { name: "Full name of Inès" });
    await user.clear(field);
    await user.type(field, "Inès B.{Enter}");
    expect(onCommit).toHaveBeenCalledWith("Inès B.");

    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    await user.type(screen.getByRole("textbox", { name: "Full name of Inès" }), "xx{Escape}");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not commit invalid or unchanged values", async () => {
    const user = userEvent.setup();
    const onCommit = renderCells();
    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    await user.clear(screen.getByRole("textbox", { name: "Full name of Inès" }));
    await user.tab();
    expect(screen.getByText("Required")).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Full name of Inès" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("moves between cells with the arrow keys", async () => {
    const user = userEvent.setup();
    renderCells();
    screen.getByRole("button", { name: "Full name of Inès" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Email of Inès" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowDown}");
    expect(screen.getByRole("button", { name: "Full name of Sarra" })).toHaveFocus();
  });
});
```
`src/app/w/[slug]/lists/selection-bar.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { SelectionBar } from "./selection-bar";

const base = "/api/workspaces/club-ab12";

describe("SelectionBar", () => {
  it("adds the selection to a list and clears it", async () => {
    const fetchMock = routeFetch({
      [`POST ${base}/contacts/bulk`]: json({ affected: 2 }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const onClear = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <SelectionBar slug="club-ab12" roster={rosterFixture} selectedIds={new Set([IDS.ines, IDS.youssef])} onClear={onClear} />,
      { toaster: true },
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("option", { name: "Design" }));
    expect(await screen.findByText("2 people added to Design.")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      action: "addToList",
      contactIds: [IDS.ines, IDS.youssef],
      listId: IDS.design,
    });
    expect(onClear).toHaveBeenCalled();
  });

  it("offers only the selection's lists for removal, and confirms deletes", async () => {
    const fetchMock = routeFetch({
      [`POST ${base}/contacts/bulk`]: json({ affected: 1 }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <SelectionBar slug="club-ab12" roster={rosterFixture} selectedIds={new Set([IDS.ines])} onClear={vi.fn()} />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Remove from list" }));
    expect(screen.getByRole("option", { name: "Dev" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Design" })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Delete 1" }));
    expect(screen.getByRole("heading", { name: "Delete 1 person?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("1 person deleted.")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ action: "delete", contactIds: [IDS.ines] });
  });
});
```
`src/app/w/[slug]/lists/roster-grid.test.tsx`:
```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { RosterGrid } from "./roster-grid";

function renderGrid(selectedIds = new Set<string>(), onToggle = vi.fn()) {
  renderWithProviders(
    <RosterGrid
      slug="club-ab12"
      contacts={rosterFixture.contacts}
      roster={rosterFixture}
      selectedIds={selectedIds}
      onToggle={onToggle}
      onToggleAll={vi.fn()}
    />,
  );
  return onToggle;
}

describe("RosterGrid", () => {
  it("is a table of people with their lists", () => {
    renderGrid();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Full name", "Email", "Lists"]),
    );
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("edits a name in place and saves it", async () => {
    const fetchMock = routeFetch({
      [`PATCH /api/workspaces/club-ab12/contacts/${IDS.ines}`]: json({ ok: true }),
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const user = userEvent.setup();
    renderGrid();
    await user.click(screen.getByRole("button", { name: "Full name of Inès Ben Salah" }));
    const field = screen.getByRole("textbox", { name: "Full name of Inès Ben Salah" });
    await user.clear(field);
    await user.type(field, "Inès B.{Enter}");
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ fullName: "Inès B." });
  });

  it("sorts by name and selects rows", async () => {
    const user = userEvent.setup();
    const onToggle = renderGrid();
    await user.click(screen.getByRole("button", { name: "Sort by Full name" }));
    await user.click(screen.getByRole("button", { name: "Sort by Full name" }));
    const firstRow = () => screen.getAllByRole("row")[1];
    expect(within(firstRow()).getByRole("button", { name: /^Full name of/ })).toHaveTextContent("Youssef Trabelsi");
    await user.click(screen.getByRole("checkbox", { name: "Select Sarra Khelifi" }));
    expect(onToggle).toHaveBeenCalledWith(IDS.sarra);
  });
});
```
Extend `roster-view.test.tsx`:
```tsx
it("selects cards on phones and shows the bar", async () => {
  const user = userEvent.setup();
  renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />);
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Inès Ben Salah" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Sarra Khelifi" }));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText("2 selected")).toBeNull();
});

it("shows the grid from md up", () => {
  setWideViewport(true);
  renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />);
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
});

it("never shows selection or the grid's edit buttons to Viewers", () => {
  setWideViewport(true);
  renderWithProviders(<RosterView workspace={viewer} roster={rosterFixture} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Full name of/ })).toBeNull();
});
```
(import `setWideViewport` from `@/test/match-media`.) Run → FAIL.

- [ ] **Step 3: EditableCell** — `src/app/w/[slug]/lists/editable-cell.tsx`:
```tsx
"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Focuses the cell at row/column offset from `from` (cells carry `data-cell="row:col"`). */
function focusNeighbour(from: HTMLElement, rowIndex: number, columnIndex: number, key: string): boolean {
  const move = MOVES[key];
  if (!move) {
    return false;
  }
  const target = from
    .closest("table")
    ?.querySelector<HTMLElement>(`[data-cell="${rowIndex + move[0]}:${columnIndex + move[1]}"]`);
  target?.focus();
  return Boolean(target);
}

/**
 * Spreadsheet-like cell: a button showing the value; Enter or a click turns it into a field.
 * Enter or leaving commits (only when changed and `validate` returns null), Escape restores.
 * Arrow keys move between cells while not editing.
 */
export function EditableCell({
  value,
  label,
  onCommit,
  validate,
  rowIndex,
  columnIndex,
  inputType = "text",
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  validate: (value: string) => string | null;
  rowIndex: number;
  columnIndex: number;
  inputType?: "text" | "email";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (commit: boolean) => {
    if (draft === null) {
      return;
    }
    if (commit && draft.trim() !== value) {
      const problem = validate(draft);
      if (problem) {
        setError(problem);
        return;
      }
      onCommit(draft.trim());
    }
    setDraft(null);
    setError(null);
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      setError(null);
    }
  };

  if (draft !== null) {
    return (
      <div className="flex flex-col gap-1">
        <input
          autoFocus
          type={inputType}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onFieldKey}
          onBlur={() => finish(true)}
          className="min-h-11 w-full rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-2 text-sm text-ink aria-invalid:bg-fill-danger aria-invalid:text-on-fill"
        />
        {error ? <span className="text-xs font-bold">{error}</span> : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      data-cell={`${rowIndex}:${columnIndex}`}
      onClick={() => setDraft(value)}
      onKeyDown={(event) => {
        if (focusNeighbour(event.currentTarget, rowIndex, columnIndex, event.key)) {
          event.preventDefault();
        }
      }}
      className={cn(
        "min-h-11 w-full truncate rounded-control px-2 text-left text-sm hover:bg-fill-neutral/40 focus-visible:outline-3",
      )}
    >
      {value}
    </button>
  );
}
```
The edit field is a bare `<input>` styled with the same tokens as `Input` (a labelled `Input` with a visible label would not fit a cell); this is allowed by the Global Constraints ("plain `<input>` only inside our styled components").

- [ ] **Step 4: SelectionBar** — `src/app/w/[slug]/lists/selection-bar.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBulkContacts, useCreateList } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import type { Roster } from "@/shared/api/roster";

/** Sticky actions for the selected people (Select mode on phones, checkbox column on wider screens). */
export function SelectionBar({
  slug,
  roster,
  selectedIds,
  onClear,
}: {
  slug: string;
  roster: Roster;
  selectedIds: ReadonlySet<string>;
  onClear: () => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const bulk = useBulkContacts(slug);
  const createList = useCreateList(slug);
  const [confirming, setConfirming] = useState(false);
  const contactIds = [...selectedIds];
  const count = contactIds.length;
  const selectedLists = roster.lists.filter((list) =>
    roster.contacts.some((contact) => selectedIds.has(contact.id) && contact.listIds.includes(list.id)),
  );
  const nameOf = (listId: string) => roster.lists.find((list) => list.id === listId)?.name ?? "";
  const onError = (error: Error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal"));

  const toList = (action: "addToList" | "removeFromList", listId: string) =>
    bulk.mutate(
      { action, contactIds, listId },
      {
        onSuccess: ({ affected }) => {
          toast(t(action === "addToList" ? "bulkAdded" : "bulkRemoved", { count: affected, list: nameOf(listId) }));
          onClear();
        },
        onError,
      },
    );

  return (
    <div
      role="region"
      aria-label={t("selectedCount", { count })}
      className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-3 shadow-brutal-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 motion-reduce:animate-none"
      data-state="open"
    >
      <span className="font-bold">{t("selectedCount", { count })}</span>
      <ListPicker
        mode="single"
        lists={roster.lists}
        selectedIds={[]}
        onChange={([listId]) => toList("addToList", listId)}
        onCreate={(name) => createList.mutateAsync(name)}
        triggerLabel={t("bulkAdd")}
        disabled={bulk.isPending}
      />
      <ListPicker
        mode="single"
        lists={selectedLists}
        selectedIds={[]}
        onChange={([listId]) => toList("removeFromList", listId)}
        triggerLabel={t("bulkRemove")}
        disabled={bulk.isPending || selectedLists.length === 0}
      />
      <Button tone="danger" onClick={() => setConfirming(true)} disabled={bulk.isPending}>
        {t("bulkDelete", { count })}
      </Button>
      <Button onClick={onClear}>{t("clearSelection")}</Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bulkDeleteTitle", { count })}</DialogTitle>
            <DialogDescription>{t("bulkDeleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirming(false)}>{t("cancel")}</Button>
            <Button
              tone="danger"
              onClick={() =>
                bulk.mutate(
                  { action: "delete", contactIds },
                  {
                    onSuccess: ({ affected }) => {
                      toast(t("bulkDeleted", { count: affected }));
                      setConfirming(false);
                      onClear();
                    },
                    onError,
                  },
                )
              }
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Card select mode** — in `contact-card.tsx` add `selection?: { selected: boolean; onToggle: () => void }`. When present, render instead of the button:
```tsx
<label className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-3 shadow-brutal-sm has-[[data-state=checked]]:bg-fill-primary has-[[data-state=checked]]:text-on-fill">
  <Checkbox
    checked={selection.selected}
    onCheckedChange={selection.onToggle}
    aria-label={t("selectPerson", { name: contact.fullName })}
  />
  {/* same name / email / list pills block as the button variant */}
</label>
```
Extract the name/email/pills block into a local `CardBody` component so both variants share it. `RosterCards` takes an optional `selection?: { selectedIds: ReadonlySet<string>; onToggle: (id: string) => void }` and passes `{ selected, onToggle }` per card.

- [ ] **Step 6: RosterGrid** — `src/app/w/[slug]/lists/roster-grid.tsx`:
```tsx
"use client";

import { CaretUpDown } from "@phosphor-icons/react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ListPicker } from "@/components/forms/list-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { ROSTER_CARD_ESTIMATE_PX } from "@/config/roster";
import { useCreateList, useUpdateContact } from "@/hooks/use-roster";
import { emailSchema } from "@/shared/api/common";
import { contactNameSchema, type Contact, type Roster } from "@/shared/api/roster";
import { EditableCell } from "./editable-cell";
import { ListTag } from "./list-tag";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text },
});
const helper = createColumnHelper<typeof features, Contact>();
const OVERSCAN = 10;
const GRID_ROW_ESTIMATE_PX = ROSTER_CARD_ESTIMATE_PX / 2;

/**
 * Wide-screen roster (spec §7.14): a virtualized table with inline-editable name and email,
 * list pills with the picker, sortable headers, and a checkbox column feeding the selection bar.
 */
export function RosterGrid({
  slug,
  contacts,
  roster,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  slug: string;
  contacts: Contact[];
  roster: Roster;
  selectedIds: ReadonlySet<string>;
  onToggle: (contactId: string) => void;
  onToggleAll: (contactIds: string[]) => void;
}) {
  const t = useTranslations("Lists");
  const update = useUpdateContact(slug);
  const createList = useCreateList(slug);
  const [columns] = useState(() => [
    helper.accessor("fullName", { header: () => t("columnName"), sortFn: "text" }),
    helper.accessor("email", { header: () => t("columnEmail"), sortFn: "text" }),
  ]);
  const table = useTable({ features, columns, data: contacts, getRowId: (row) => row.id });
  const rows = table.getRowModel().rows;
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const scrollMargin = body?.offsetTop ?? 0;
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => GRID_ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => rows[index].id,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length ? items[0].start - scrollMargin : 0;
  const paddingBottom = items.length ? virtualizer.getTotalSize() - (items[items.length - 1].end - scrollMargin) : 0;
  const allShown = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const nameError = (value: string) => (contactNameSchema.safeParse(value).success ? null : t("invalidName"));
  const emailError = (value: string) => (emailSchema.safeParse(value).success ? null : t("invalidEmail"));

  return (
    <div className="overflow-x-auto rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface shadow-brutal">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col />
          <col />
          <col className="w-[34%]" />
        </colgroup>
        <thead className="bg-fill-primary text-on-fill">
          <tr>
            <th className="p-2">
              <Checkbox
                checked={allShown}
                onCheckedChange={() => onToggleAll(contacts.map((c) => c.id))}
                aria-label={t("selectAll")}
              />
            </th>
            {table.getHeaderGroups()[0].headers.map((header) => (
              <th key={header.id} className="p-2 text-left font-bold">
                <button
                  type="button"
                  aria-label={t("sortBy", { column: header.column.id === "fullName" ? t("columnName") : t("columnEmail") })}
                  onClick={header.column.getToggleSortingHandler()}
                  className="inline-flex min-h-11 items-center gap-1"
                >
                  <table.FlexRender header={header} />
                  <CaretUpDown weight="bold" aria-hidden />
                </button>
              </th>
            ))}
            <th className="p-2 text-left font-bold">{t("columnLists")}</th>
          </tr>
        </thead>
        <tbody ref={setBody}>
          {paddingTop > 0 ? (
            <tr aria-hidden>
              <td colSpan={4} style={{ height: paddingTop }} />
            </tr>
          ) : null}
          {items.map((item) => {
            const contact = rows[item.index].original;
            const own = roster.lists.filter((list) => contact.listIds.includes(list.id));
            const save = (patch: { fullName?: string; email?: string; listIds?: string[] }) =>
              update.mutate({ id: contact.id, patch });
            return (
              <tr
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="border-t-[length:var(--tn-border-width)] border-outline align-top"
              >
                <td className="p-2">
                  <Checkbox
                    checked={selectedIds.has(contact.id)}
                    onCheckedChange={() => onToggle(contact.id)}
                    aria-label={t("selectPerson", { name: contact.fullName })}
                  />
                </td>
                <td className="p-1">
                  <EditableCell
                    value={contact.fullName}
                    label={t("editCell", { column: t("columnName"), name: contact.fullName })}
                    validate={nameError}
                    onCommit={(fullName) => save({ fullName })}
                    rowIndex={item.index}
                    columnIndex={1}
                  />
                </td>
                <td className="p-1">
                  <EditableCell
                    value={contact.email}
                    label={t("editCell", { column: t("columnEmail"), name: contact.fullName })}
                    validate={emailError}
                    onCommit={(email) => save({ email: emailSchema.parse(email) })}
                    rowIndex={item.index}
                    columnIndex={2}
                    inputType="email"
                  />
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {own.map((list) => (
                      <ListTag key={list.id} list={list} />
                    ))}
                    <ListPicker
                      lists={roster.lists}
                      selectedIds={contact.listIds}
                      onChange={(listIds) => save({ listIds })}
                      onCreate={(name) => createList.mutateAsync(name)}
                      triggerLabel={t("addToList")}
                      triggerClassName="min-h-9 px-2 text-xs"
                    />
                  </div>
                </td>
              </tr>
            );
          })}
          {paddingBottom > 0 ? (
            <tr aria-hidden>
              <td colSpan={4} style={{ height: paddingBottom }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
```
`columns` is created once (`useState` initializer) because v9 requires stable column definitions; `t` only feeds header renderers, which read the current locale at render time. A failed edit rolls back through `useUpdateContact`; show why with a toast by replacing the `save` helper in the row with:
```tsx
const save = (patch: { fullName?: string; email?: string; listIds?: string[] }) =>
  update.mutate(
    { id: contact.id, patch },
    {
      onError: (error) => {
        const { code, takenBy } = describeEditError(error, patch.email, roster);
        toast.error(takenBy ? t("emailTaken", { name: takenBy }) : tErrors(code));
      },
    },
  );
```
(imports: `toast` from `sonner`, `describeEditError` from `./describe-edit-error`, and `const tErrors = useTranslations("ApiErrors");` next to `t`).

Checked against `@tanstack/table-core` 9.2.6 while planning: the column option is `sortFn` and `column.getToggleSortingHandler()` exists (`features/row-sorting/rowSortingFeature.types.d.ts`). Text columns sort ascending on the first click, descending on the second (the test clicks twice).

- [ ] **Step 7: RosterView** — add `selecting: boolean` and `selectedIds: ReadonlySet<string>` state; `const wide = useMediaQuery(ROSTER_GRID_MEDIA);`
  - `toggle(id)` adds/removes; `toggleAll(ids)` selects all of `ids` unless all are selected (then removes them); `clear()` empties and sets `selecting` false.
  - phones (`!wide`): when `canEdit`, a header button `t(selecting ? "doneSelecting" : "select")` toggles `selecting` (clearing the selection when leaving); `RosterCards` gets `selection` only while `selecting`.
  - wide: `canEdit ? <RosterGrid … /> : <RosterCards … />` (Viewers keep the read-only cards on every width).
  - `selectedIds.size > 0 && canEdit ? <SelectionBar slug={workspace.slug} roster={roster} selectedIds={selectedIds} onClear={clear} /> : null`.
  - Selected ids that disappear from the roster (deleted) are dropped: compute `const liveSelection = new Set([...selectedIds].filter((id) => people.some((c) => c.id === id)))` and use it everywhere.
  Run all Step 2 tests → PASS.

- [ ] **Step 8: e2e** — append to `e2e/roster.spec.ts`:
```ts
test("bulk actions on phones", async ({ page }) => {
  const slug = await createWorkspace(page, "Bulk Club");
  await seedRoster(slug, [
    { fullName: "Inès Ben Salah", email: "ines@example.test" },
    { fullName: "Sarra Khelifi", email: "sarra@example.test" },
    { fullName: "Youssef Trabelsi", email: "youssef@example.test" },
  ]);
  await page.goto(`/w/${slug}/lists`);
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByRole("checkbox", { name: "Select Inès Ben Salah" }).click();
  await page.getByRole("checkbox", { name: "Select Sarra Khelifi" }).click();
  await page.getByRole("button", { name: "Add to list" }).click();
  await page.getByPlaceholder("Search or create a list").fill("Alumni");
  await page.getByRole("option", { name: 'Create list "Alumni"' }).click();
  await expect(page.getByText("2 people added to Alumni.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Alumni 2" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test.describe("wide screens", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("the grid edits a name in place", async ({ page }) => {
    const slug = await createWorkspace(page, "Grid Club");
    await seedRoster(slug, [{ fullName: "Youssef Trabelsi", email: "youssef@example.test" }]);
    await page.goto(`/w/${slug}/lists`);
    await page.getByRole("button", { name: "Full name of Youssef Trabelsi" }).click();
    await page.getByRole("textbox", { name: "Full name of Youssef Trabelsi" }).fill("Youssef T.");
    await page.keyboard.press("Enter");
    await page.reload();
    await expect(page.getByRole("button", { name: "Full name of Youssef T." })).toBeVisible();
  });
});
```
Run `bun run test:e2e -- e2e/roster.spec.ts` → PASS.

- [ ] **Step 9: Visual check** — screenshots: Select mode with the bar (390 light, 320 dark; the bar must sit above the bottom bar and wrap its buttons at 320 px), the grid at 1024 px light and dark, a cell in edit mode, the delete confirmation.

- [ ] **Step 10: Verify and commit** — `bun run lint && bun run typecheck && bun run test` → PASS. Commit: `feat: select mode, bulk list actions and the editable roster grid`.

---

### Task 10: Import dialog (Source → Match columns → Preview)

**Labels:** `area:frontend`

**Files:**
- Create: `src/app/w/[slug]/lists/import/import-dialog.tsx` + test, `source-step.tsx` + test, `match-step.tsx` + test, `preview-step.tsx` + test, `wizard-footer.tsx`
- Create: `e2e/fixtures/roster.csv`
- Modify: `src/app/w/[slug]/lists/roster-view.tsx` + test (Import button, empty-state Import/Paste, `next/dynamic`), `messages/en.json` (`ListsImport`, `Lists.import`, `Lists.paste`), `e2e/roster.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`readImportFile`, `ImportFileError`, `parsePaste`, `guessColumns`, `mappingProblem`, `buildImportRows`, types), Task 6 (`SegmentedControl`, `FileDropZone`, `Textarea`, `Switch`), Task 4 (`useImportContacts`, `ImportResult`, `ImportRowResult`, `Roster`, `IMPORT_FILE_MAX_BYTES`), Task 8 (`ListPicker`, `ListTag`), `Select*`, `Dialog*`, `Button`.
- Produces:
  - `ImportDialog({ slug, roster, initialSource, open, onOpenChange })` with `initialSource: "file" | "paste"`.
  - `SourceStep({ source, onSourceChange, sheets, sheetIndex, onSheets, onSheetIndex, pasteText, onPasteText })`.
  - `MatchStep({ grid, mapping, onMappingChange, rowCount, rowLimit, lists, alsoAddToListId, onAlsoAddChange })`.
  - `PreviewStep({ result, limits })`.
  - `WizardFooter({ backLabel?, onBack?, primaryLabel, onPrimary, primaryDisabled })` — every button `h-11` (44 px) and `whitespace-nowrap`; Back has a fixed width, the primary action fills the rest (owner request, 2026-10-06).

- [ ] **Step 1: Messages** — add to `Lists`: `"import": "Import"`, `"paste": "Paste from Sheets"`. Add the namespace `ListsImport`:
```json
"ListsImport": {
  "title": "Import people",
  "stepOf": "Step {step} of 3",
  "sourceLabel": "Import from",
  "sourceFile": "File",
  "sourcePaste": "Paste",
  "dropTitle": "Choose a .csv or .xlsx",
  "dropHint": "Up to {megabytes} MB. The file stays on your device.",
  "fileChosen": "{name}: {rows, plural, one {# row} other {# rows}}",
  "sheetLabel": "Sheet",
  "pasteLabel": "Paste rows",
  "pasteHint": "Copy the cells in Google Sheets or Excel, then paste them here.",
  "fileErrors": {
    "too_large": "This file is bigger than {megabytes} MB.",
    "xls": "Old .xls files can't be read. Save it as .xlsx or CSV and try again.",
    "unsupported": "Choose a .csv or .xlsx file.",
    "unreadable": "This file couldn't be read. Is it really an .xlsx file?",
    "empty": "This file has no rows."
  },
  "next": "Next",
  "back": "Back",
  "previewAction": "Preview",
  "matchIntro": "We matched your columns from their names. {rows, plural, one {# row} other {# rows}} to import.",
  "headerSwitch": "First row is headers",
  "columnN": "Column {n}",
  "columnTarget": "What is {column}?",
  "sampleEmpty": "(empty)",
  "targets": { "fullName": "Full name", "email": "Email", "lists": "Lists", "ignore": "Ignore" },
  "alsoAdd": "Also add everyone to",
  "alsoAddPick": "Choose a list",
  "alsoAddClear": "No list",
  "problems": {
    "no_email": "Match one column to Email.",
    "several_emails": "Only one column can be Email.",
    "too_many_rows": "{rows} rows is more than the {max} allowed in one import. Split the sheet and import each part.",
    "no_rows": "There are no rows to import."
  },
  "tiles": { "new": "New", "updated": "Updated", "unchanged": "Unchanged", "merged": "Merged duplicates", "invalid": "Invalid, skipped" },
  "showAll": "Show all rows",
  "newLists": "New lists:",
  "limitContacts": "This import would go past your roster limit of {max} people.",
  "limitLists": "This import would go past the limit of {max} lists.",
  "rowLabel": "Row {row}",
  "tags": { "new": "NEW", "updated": "UPDATED", "unchanged": "SAME", "invalid": "INVALID" },
  "reasons": {
    "email_missing": "No email",
    "email_invalid": "\"{email}\" is not an email address",
    "name_missing": "No name for a new person",
    "name_too_long": "The name is longer than 120 characters",
    "list_name_too_long": "A list name is longer than 60 characters"
  },
  "addedLists": "Adds {lists}",
  "renamed": "{from} → {to}",
  "mergedRows": "Merged with {rows, plural, one {row} other {rows}} {list}",
  "importAction": "{count, plural, =0 {Nothing to import} one {Import # person} other {Import # people}}",
  "done": "{added} added, {updated} updated{lists, plural, =0 {} one {, # list created} other {, # lists created}}."
}
```
(`"→"` is a plain arrow character, not an emoji.)

- [ ] **Step 2: Failing tests**

`src/app/w/[slug]/lists/import/source-step.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { ImportSheet } from "@/lib/import/types";
import { makeXlsx } from "@/test/fixtures/xlsx";
import { renderWithProviders } from "@/test/render";
import { SourceStep } from "./source-step";

function Harness({ initial = "file" as "file" | "paste" }) {
  const [source, setSource] = useState(initial);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [pasteText, setPasteText] = useState("");
  return (
    <>
      <SourceStep
        source={source}
        onSourceChange={setSource}
        sheets={sheets}
        sheetIndex={sheetIndex}
        onSheets={setSheets}
        onSheetIndex={setSheetIndex}
        pasteText={pasteText}
        onPasteText={setPasteText}
      />
      <output>{sheets.map((s) => s.name).join("|")}</output>
    </>
  );
}

describe("SourceStep", () => {
  it("reads a multi-sheet workbook on the device and offers a sheet choice", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const workbook = makeXlsx([
      { name: "Members 2026", rows: [["Email"], ["a@example.com"], ["b@example.com"]] },
      { name: "Alumni", rows: [["Email"], ["c@example.com"]] },
    ]);
    await user.upload(screen.getByLabelText("Choose a .csv or .xlsx"), new File([workbook], "club.xlsx"));
    expect(await screen.findByRole("status")).toHaveTextContent("Members 2026|Alumni");
    expect(screen.getByRole("combobox", { name: "Sheet" })).toHaveTextContent("Members 2026");
    expect(screen.getByText("club.xlsx: 3 rows")).toBeInTheDocument();
  });

  it("explains files it cannot read", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.upload(screen.getByLabelText("Choose a .csv or .xlsx"), new File(["x"], "old.xls"));
    expect(await screen.findByText("Old .xls files can't be read. Save it as .xlsx or CSV and try again.")).toBeInTheDocument();
  });

  it("switches to a paste box", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("radio", { name: "Paste" }));
    expect(screen.getByLabelText("Paste rows").tagName).toBe("TEXTAREA");
  });
});
```
`src/app/w/[slug]/lists/import/match-step.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { guessColumns } from "@/lib/import/guess-columns";
import { parsePaste } from "@/lib/import/parse-delimited";
import type { ColumnMapping } from "@/lib/import/types";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { MatchStep } from "./match-step";

const grid = parsePaste("Prénom\tNom\tE-mail\tÉquipe\tPhone\nInès\tBen Salah\tines@example.com\tDev\t+216");

function Harness({ rowLimit = 2000 }) {
  const [mapping, setMapping] = useState<ColumnMapping>(guessColumns(grid));
  const [alsoAdd, setAlsoAdd] = useState<string | null>(null);
  return (
    <MatchStep
      grid={grid}
      mapping={mapping}
      onMappingChange={setMapping}
      rowCount={1}
      rowLimit={rowLimit}
      lists={rosterFixture.lists}
      alsoAddToListId={alsoAdd}
      onAlsoAddChange={setAlsoAdd}
    />
  );
}

describe("MatchStep", () => {
  it("shows each column with a sample and its guessed target (Review Focus 3)", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole("combobox", { name: "What is Prénom?" })).toHaveTextContent("Full name");
    expect(screen.getByRole("combobox", { name: "What is Nom?" })).toHaveTextContent("Full name");
    expect(screen.getByRole("combobox", { name: "What is E-mail?" })).toHaveTextContent("Email");
    expect(screen.getByRole("combobox", { name: "What is Équipe?" })).toHaveTextContent("Lists");
    expect(screen.getByRole("combobox", { name: "What is Phone?" })).toHaveTextContent("Ignore");
    expect(screen.getByText("ines@example.com")).toBeInTheDocument();
  });

  it("explains a missing Email column", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "What is E-mail?" }));
    await user.click(screen.getByRole("option", { name: "Ignore" }));
    expect(screen.getByText("Match one column to Email.")).toBeInTheDocument();
  });

  it("explains a sheet over the row limit", () => {
    renderWithProviders(<Harness rowLimit={0} />);
    expect(screen.getByText(/more than the 0 allowed/)).toBeInTheDocument();
  });

  it("renames headers to 'Column N' when the first row is data", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("switch", { name: "First row is headers" }));
    expect(screen.getByRole("combobox", { name: "What is Column 1?" })).toBeInTheDocument();
  });
});
```
`src/app/w/[slug]/lists/import/preview-step.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { importPreviewFixture, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { PreviewStep } from "./preview-step";

describe("PreviewStep", () => {
  it("summarizes the dry run and filters rows by tile", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreviewStep result={importPreviewFixture} limits={rosterFixture.limits} />);
    expect(screen.getByRole("button", { name: "1 New" })).toBeInTheDocument();
    expect(screen.getByText("New lists:")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("\"mehdi.g@gmail\" is not an email address")).toBeInTheDocument();
    expect(screen.getByText("Youssef Trabelsi → Youssef T.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1 Invalid, skipped" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Show all rows" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("warns when the import would pass a limit", () => {
    renderWithProviders(
      <PreviewStep result={{ ...importPreviewFixture, limitExceeded: "contacts" }} limits={rosterFixture.limits} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This import would go past your roster limit of 2000 people.");
  });
});
```
`src/app/w/[slug]/lists/import/import-dialog.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { importPreviewFixture, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ImportDialog } from "./import-dialog";

const IMPORT = "POST /api/workspaces/club-ab12/contacts/import";

describe("ImportDialog", () => {
  it("pastes, matches, previews and imports", async () => {
    const committed = { ...importPreviewFixture, summary: { ...importPreviewFixture.summary } };
    const fetchMock = routeFetch({
      [IMPORT]: (init) =>
        new Response(JSON.stringify(JSON.parse(String(init?.body)).dryRun ? importPreviewFixture : committed), { status: 200 }),
      "GET /api/workspaces/club-ab12/contacts": () => new Response(JSON.stringify(rosterFixture)),
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ImportDialog slug="club-ab12" roster={rosterFixture} initialSource="paste" open onOpenChange={onOpenChange} />,
      { toaster: true },
    );
    expect(screen.getByRole("dialog", { name: "Import people" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Paste rows"));
    await user.paste("Full name\tEmail\tTeam\nAmira\tamira@example.com\tEvents");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies()[0]).toEqual({
      rows: [{ row: 2, fullName: "Amira", email: "amira@example.com", lists: ["Events"] }],
      dryRun: true,
    });
    await user.click(screen.getByRole("button", { name: "Import 2 people" }));
    expect(await screen.findByText("1 added, 1 updated, 1 list created.")).toBeInTheDocument();
    expect(bodies()[1]).toMatchObject({ dryRun: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps every footer button the same height on every step (owner request)", async () => {
    const user = userEvent.setup();
    routeFetch({ [IMPORT]: () => new Response(JSON.stringify(importPreviewFixture)) });
    renderWithProviders(
      <ImportDialog slug="club-ab12" roster={rosterFixture} initialSource="paste" open onOpenChange={vi.fn()} />,
    );
    const footerButtons = () => screen.getAllByRole("button").filter((b) => b.closest("[data-slot=wizard-footer]"));
    const expectEqualHeights = () => {
      for (const button of footerButtons()) {
        expect(button).toHaveClass("h-11", "whitespace-nowrap");
      }
    };
    expectEqualHeights();
    await user.click(screen.getByLabelText("Paste rows"));
    await user.paste("Email\na@example.com");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expectEqualHeights();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("Step 3 of 3");
    expectEqualHeights();
    expect(footerButtons()).toHaveLength(2);
  });
});
```
Extend `roster-view.test.tsx`:
```tsx
it("opens the import dialog from the header and the empty state", async () => {
  const user = userEvent.setup();
  renderWithProviders(<RosterView workspace={owner} roster={rosterFixture} />);
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByRole("dialog", { name: "Import people" })).toBeInTheDocument();
});
```
Run → FAIL.

- [ ] **Step 3: WizardFooter** — `src/app/w/[slug]/lists/import/wizard-footer.tsx`:
```tsx
import { Button } from "@/components/ui/button";

/** Dialog footer for the import steps: one fixed button height and single-line labels on every step. */
export function WizardFooter({
  backLabel,
  onBack,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  backLabel?: string;
  onBack?: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled: boolean;
}) {
  return (
    <div data-slot="wizard-footer" className="mt-auto flex gap-3 pt-3">
      {backLabel && onBack ? (
        <Button onClick={onBack} className="h-11 w-24 shrink-0 justify-center whitespace-nowrap">
          {backLabel}
        </Button>
      ) : null}
      <Button
        tone="primary"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="h-11 min-w-0 flex-1 justify-center truncate whitespace-nowrap"
      >
        {primaryLabel}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: SourceStep** — `src/app/w/[slug]/lists/import/source-step.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { IMPORT_FILE_MAX_BYTES } from "@/config/roster";
import { ImportFileError, readImportFile, type ImportFileErrorReason } from "@/lib/import/read-import-file";
import type { ImportSheet } from "@/lib/import/types";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const ACCEPT = ".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Step 1: a file read on the device (with a sheet choice) or text pasted from a spreadsheet. */
export function SourceStep({
  source,
  onSourceChange,
  sheets,
  sheetIndex,
  onSheets,
  onSheetIndex,
  pasteText,
  onPasteText,
}: {
  source: "file" | "paste";
  onSourceChange: (source: "file" | "paste") => void;
  sheets: ImportSheet[];
  sheetIndex: number;
  onSheets: (sheets: ImportSheet[]) => void;
  onSheetIndex: (index: number) => void;
  pasteText: string;
  onPasteText: (text: string) => void;
}) {
  const t = useTranslations("ListsImport");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<ImportFileErrorReason | null>(null);
  const megabytes = IMPORT_FILE_MAX_BYTES / BYTES_PER_MEGABYTE;
  const current = sheets[sheetIndex];
  const rowCount = current ? current.grid.filter((row) => row.some((cell) => cell !== "")).length : 0;

  const onFile = async (file: File) => {
    setFileError(null);
    try {
      const read = await readImportFile(file);
      setFileName(file.name);
      onSheetIndex(0);
      onSheets(read);
    } catch (error) {
      setFileName(null);
      onSheets([]);
      setFileError(error instanceof ImportFileError ? error.reason : "unreadable");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label={t("sourceLabel")}
        value={source}
        onValueChange={(value) => onSourceChange(value === "paste" ? "paste" : "file")}
        options={[
          { value: "file", label: t("sourceFile") },
          { value: "paste", label: t("sourcePaste") },
        ]}
      />
      {source === "file" ? (
        <>
          <FileDropZone
            id="import-file"
            title={t("dropTitle")}
            hint={t("dropHint", { megabytes })}
            accept={ACCEPT}
            onFile={(file) => void onFile(file)}
          />
          {fileError ? (
            <p role="alert" className="font-bold">
              {t(`fileErrors.${fileError}`, { megabytes })}
            </p>
          ) : null}
          {fileName && current ? <p className="text-sm break-all">{t("fileChosen", { name: fileName, rows: rowCount })}</p> : null}
          {sheets.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <span id="import-sheet-label" className="text-sm font-bold">
                {t("sheetLabel")}
              </span>
              <Select value={String(sheetIndex)} onValueChange={(value) => onSheetIndex(Number(value))}>
                <SelectTrigger aria-labelledby="import-sheet-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((sheet, index) => (
                    <SelectItem key={sheet.name} value={String(index)}>
                      {sheet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </>
      ) : (
        <Textarea
          id="import-paste"
          label={t("pasteLabel")}
          hint={t("pasteHint")}
          value={pasteText}
          onChange={(event) => onPasteText(event.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: MatchStep** — `src/app/w/[slug]/lists/import/match-step.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { mappingProblem } from "@/lib/import/guess-columns";
import type { ColumnMapping, ColumnTarget, SheetGrid } from "@/lib/import/types";
import type { ListSummary } from "@/shared/api/roster";
import { ListTag } from "../list-tag";

const TARGETS: readonly ColumnTarget[] = ["fullName", "email", "lists", "ignore"];
const isColumnTarget = (value: string): value is ColumnTarget => TARGETS.some((target) => target === value);

/** Step 2: what each column means, whether row 1 is a header, and an optional list for everyone. */
export function MatchStep({
  grid,
  mapping,
  onMappingChange,
  rowCount,
  rowLimit,
  lists,
  alsoAddToListId,
  onAlsoAddChange,
}: {
  grid: SheetGrid;
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  rowCount: number;
  rowLimit: number;
  lists: ListSummary[];
  alsoAddToListId: string | null;
  onAlsoAddChange: (listId: string | null) => void;
}) {
  const t = useTranslations("ListsImport");
  const headerIndex = grid.findIndex((row) => row.some((cell) => cell !== ""));
  const header = grid[headerIndex] ?? [];
  const firstData = grid.slice(mapping.hasHeader ? headerIndex + 1 : headerIndex).filter((row) => row.some((c) => c !== ""));
  const problem = mappingProblem(mapping);
  const alsoAdd = lists.find((list) => list.id === alsoAddToListId);
  const columnName = (column: number) =>
    mapping.hasHeader && header[column] ? header[column] : t("columnN", { n: column + 1 });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-ink">{t("matchIntro", { rows: rowCount })}</p>
      <label className="flex min-h-11 items-center gap-3 font-bold">
        <Switch
          checked={mapping.hasHeader}
          onCheckedChange={(hasHeader) => onMappingChange({ ...mapping, hasHeader })}
        />
        {t("headerSwitch")}
      </label>
      <ul className="flex flex-col divide-y-2 divide-dashed divide-fill-neutral rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface px-3 shadow-brutal-sm">
        {mapping.targets.map((target, column) => {
          const sample = firstData.map((row) => row[column] ?? "").find((cell) => cell !== "");
          const labelId = `match-column-${column}`;
          return (
            <li key={column} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p id={labelId} className="truncate font-bold">
                  {columnName(column)}
                </p>
                <p className="truncate text-xs text-muted-ink">{sample ?? t("sampleEmpty")}</p>
              </div>
              <Select
                value={target}
                onValueChange={(value) => {
                  if (isColumnTarget(value)) {
                    onMappingChange({ ...mapping, targets: mapping.targets.map((old, i) => (i === column ? value : old)) });
                  }
                }}
              >
                <SelectTrigger aria-label={t("columnTarget", { column: columnName(column) })} className="w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGETS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`targets.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{t("alsoAdd")}</span>
        {alsoAdd ? <ListTag list={alsoAdd} /> : null}
        <ListPicker
          mode="single"
          lists={lists}
          selectedIds={alsoAddToListId ? [alsoAddToListId] : []}
          onChange={([listId]) => onAlsoAddChange(listId ?? null)}
          triggerLabel={t("alsoAddPick")}
        />
        {alsoAdd ? <Button onClick={() => onAlsoAddChange(null)}>{t("alsoAddClear")}</Button> : null}
      </div>
      {problem ? (
        <p role="alert" className="font-bold">
          {t(`problems.${problem}`)}
        </p>
      ) : null}
      {rowCount > rowLimit ? (
        <p role="alert" className="font-bold">
          {t("problems.too_many_rows", { rows: rowCount, max: rowLimit })}
        </p>
      ) : null}
      {rowCount === 0 ? (
        <p role="alert" className="font-bold">
          {t("problems.no_rows")}
        </p>
      ) : null}
    </div>
  );
}
```
The "Also add everyone to" picker has no `onCreate` on purpose: a list chosen here must already exist (the API checks its id).

- [ ] **Step 6: PreviewStep** — `src/app/w/[slug]/lists/import/preview-step.tsx`:
```tsx
"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";
import type { ImportOutcome, ImportResult, ImportRowResult, Roster } from "@/shared/api/roster";

type Tile = ImportOutcome | "merged";
const TILES: readonly Tile[] = ["new", "updated", "unchanged", "merged", "invalid"];
const TONE: Record<Tile, FillTone> = { new: "success", updated: "info", unchanged: "neutral", merged: "warning", invalid: "danger" };
const FILL: Record<FillTone, string> = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
};
const ROW_ESTIMATE_PX = 64;
const OVERSCAN = 8;

const matches = (tile: Tile | null, row: ImportRowResult): boolean =>
  tile === null || (tile === "merged" ? row.mergedRows.length > 0 : row.outcome === tile);

/** Step 3: the server's dry run — counts first (tap to filter), new lists, then every row with its reason. */
export function PreviewStep({ result, limits }: { result: ImportResult; limits: Roster["limits"] }) {
  const t = useTranslations("ListsImport");
  const [tile, setTile] = useState<Tile | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const rows = result.rows.filter((row) => matches(tile, row));
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    initialRect: { width: 0, height: ROW_ESTIMATE_PX * OVERSCAN },
  });

  const detail = (row: ImportRowResult): string | null => {
    if (row.reason) {
      return t(`reasons.${row.reason}`, { email: row.email });
    }
    const parts = [
      row.previousName && row.fullName ? t("renamed", { from: row.previousName, to: row.fullName }) : null,
      row.addedLists.length ? t("addedLists", { lists: row.addedLists.join(", ") }) : null,
      row.mergedRows.length ? t("mergedRows", { rows: row.mergedRows.length, list: row.mergedRows.join(", ") }) : null,
    ].filter((part): part is string => part !== null);
    return parts.length ? parts.join(" · ") : null;
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {TILES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tile === key}
            onClick={() => setTile(tile === key ? null : key)}
            className={cn(
              "flex flex-col items-start rounded-control border-[length:var(--tn-border-width)] border-outline px-3 py-2 text-left text-sm font-bold text-on-fill shadow-brutal-sm aria-pressed:translate-y-0.5 aria-pressed:shadow-none",
              FILL[TONE[key]],
              key === "invalid" && "col-span-2",
            )}
          >
            <span className="font-display text-xl">{result.summary[key]}</span> {t(`tiles.${key}`)}
          </button>
        ))}
      </div>
      {tile ? (
        <button type="button" onClick={() => setTile(null)} className="min-h-11 self-start text-sm font-bold underline">
          {t("showAll")}
        </button>
      ) : null}
      {result.newLists.length ? (
        <p className="flex flex-wrap items-center gap-1 text-sm">
          <span className="font-bold">{t("newLists")}</span>
          {result.newLists.map((name) => (
            <span key={name} className="rounded-full border-2 border-outline bg-fill-success px-2 text-xs font-bold text-on-fill">
              {name}
            </span>
          ))}
        </p>
      ) : null}
      {result.limitExceeded ? (
        <p role="alert" className="rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-danger p-3 font-bold text-on-fill">
          {result.limitExceeded === "contacts"
            ? t("limitContacts", { max: limits.contactsMax })
            : t("limitLists", { max: limits.listsMax })}
        </p>
      ) : null}
      <div ref={setScroller} className="max-h-[40dvh] min-h-24 overflow-y-auto rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface">
        <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            const text = detail(row);
            return (
              <li
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full border-b-2 border-dashed border-fill-neutral px-3 py-2 text-sm"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-md border-2 border-outline px-1 text-xs font-bold text-on-fill", FILL[TONE[row.outcome]])}>
                    {t(`tags.${row.outcome}`)}
                  </span>
                  <span className="text-muted-ink">{t("rowLabel", { row: row.row })}</span>
                  <span className="min-w-0 font-bold break-words">{row.fullName ?? row.email}</span>
                </p>
                {text ? <p className="break-all text-muted-ink">{text}</p> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```
`initialRect` gives the virtualizer a first size before the scroll box is measured (jsdom never measures it), so the first paint and the tests show rows; the browser replaces it on mount.

- [ ] **Step 7: ImportDialog** — `src/app/w/[slug]/lists/import/import-dialog.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useImportContacts } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import { buildImportRows } from "@/lib/import/build-import-rows";
import { guessColumns, mappingProblem } from "@/lib/import/guess-columns";
import { parsePaste } from "@/lib/import/parse-delimited";
import type { ColumnMapping, ImportSheet } from "@/lib/import/types";
import type { ImportResult, Roster } from "@/shared/api/roster";
import { MatchStep } from "./match-step";
import { PreviewStep } from "./preview-step";
import { SourceStep } from "./source-step";
import { WizardFooter } from "./wizard-footer";

type Step = 1 | 2 | 3;
const EMPTY_MAPPING: ColumnMapping = { hasHeader: true, targets: [] };

/**
 * Import wizard (spec §7.14): full screen on phones. Nothing is saved before the last button;
 * Preview asks the server for a dry run of exactly the rows the commit will send.
 */
export function ImportDialog({
  slug,
  roster,
  initialSource,
  open,
  onOpenChange,
}: {
  slug: string;
  roster: Roster;
  initialSource: "file" | "paste";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("ListsImport");
  const tErrors = useTranslations("ApiErrors");
  const importContacts = useImportContacts(slug);
  const [step, setStep] = useState<Step>(1);
  const [source, setSource] = useState(initialSource);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [pasteText, setPasteText] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [alsoAddToListId, setAlsoAddToListId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const grid = source === "paste" ? parsePaste(pasteText) : (sheets[sheetIndex]?.grid ?? []);
  const hasContent = grid.some((row) => row.some((cell) => cell !== ""));
  const rows = step >= 2 ? buildImportRows(grid, mapping) : [];
  const onError = (error: Error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal"));
  const body = (dryRun: boolean) => ({ rows, dryRun, ...(alsoAddToListId ? { alsoAddToListId } : {}) });
  const importCount = preview ? preview.summary.new + preview.summary.updated : 0;

  const footer = {
    1: {
      primaryLabel: t("next"),
      primaryDisabled: !hasContent,
      onPrimary: () => {
        setMapping(guessColumns(grid));
        setStep(2);
      },
    },
    2: {
      primaryLabel: t("previewAction"),
      primaryDisabled:
        importContacts.isPending || mappingProblem(mapping) !== null || rows.length === 0 || rows.length > roster.limits.importRowsMax,
      onPrimary: () =>
        importContacts.mutate(body(true), {
          onSuccess: (result) => {
            setPreview(result);
            setStep(3);
          },
          onError,
        }),
    },
    3: {
      primaryLabel: t("importAction", { count: importCount }),
      primaryDisabled: importContacts.isPending || importCount === 0 || preview?.limitExceeded !== null,
      onPrimary: () =>
        importContacts.mutate(body(false), {
          onSuccess: (result) => {
            toast(t("done", { added: result.summary.new, updated: result.summary.updated, lists: result.newLists.length }));
            onOpenChange(false);
          },
          onError,
        }),
    },
  }[step];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 max-h-dvh rounded-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-card">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("stepOf", { step })}</DialogDescription>
        </DialogHeader>
        {step === 1 ? (
          <SourceStep
            source={source}
            onSourceChange={setSource}
            sheets={sheets}
            sheetIndex={sheetIndex}
            onSheets={setSheets}
            onSheetIndex={setSheetIndex}
            pasteText={pasteText}
            onPasteText={setPasteText}
          />
        ) : null}
        {step === 2 ? (
          <MatchStep
            grid={grid}
            mapping={mapping}
            onMappingChange={setMapping}
            rowCount={rows.length}
            rowLimit={roster.limits.importRowsMax}
            lists={roster.lists}
            alsoAddToListId={alsoAddToListId}
            onAlsoAddChange={setAlsoAddToListId}
          />
        ) : null}
        {step === 3 && preview ? <PreviewStep result={preview} limits={roster.limits} /> : null}
        <WizardFooter
          backLabel={step > 1 ? t("back") : undefined}
          onBack={step > 1 ? () => setStep(step === 3 ? 2 : 1) : undefined}
          {...footer}
        />
      </DialogContent>
    </Dialog>
  );
}
```
Changing the mapping or the "also add" list after a preview takes the user back through Step 2's Preview button, so the commit always sends what was previewed.

- [ ] **Step 8: Wire into RosterView** — at the top of `roster-view.tsx` (module scope, per the imports rule):
```tsx
const ImportDialog = dynamic(() => import("./import/import-dialog").then((module) => module.ImportDialog), {
  ssr: false,
});
```
State `importing: "file" | "paste" | null`. Header (when `canEdit`): `<Button onClick={() => setImporting("file")}><UploadSimple weight="bold" aria-hidden />{t("import")}</Button>` before "+ Add". Empty state actions, in order: Import (`"file"`), Paste from Sheets (`"paste"`), Add. Render:
```tsx
{canEdit && importing ? (
  <ImportDialog
    slug={workspace.slug}
    roster={roster}
    initialSource={importing}
    open
    onOpenChange={(open) => (open ? undefined : setImporting(null))}
  />
) : null}
```
(mounting only while open keeps the parsers out of the roster page's first load and resets the wizard each time). Run all tests → PASS. `next/dynamic` resolves through `React.lazy` under Vitest, so the RosterView test awaits the dialog with `findByRole`; if it still fails to load there, mock `next/dynamic` in that test file with a factory that awaits the loader and renders the resolved component, and record a `Ruling:`.

- [ ] **Step 9: e2e** — `e2e/fixtures/roster.csv` (UTF-8, comma-separated, a duplicate and an invalid row):
```csv
Nom complet,E-mail,Équipe,Year
Inès Ben Salah,ines@example.test,"Dev, Events",2
Youssef Trabelsi,youssef@example.test,Design,3
Mohamed Ali Ben Abdallah El Kefi,mohamedali.benabdallah.elkefi@etudiant-issatso.u-sousse.tn,Dev,1
Sarra Khelifi,sarra@example.test,Media,2
Mehdi Gharbi,mehdi.g@gmail,Events,1
Inès B.,INES@example.test,Media,2
```
Append to `e2e/roster.spec.ts`:
```ts
import path from "node:path";

test("imports a CSV with a preview, and re-importing reports 0 new", async ({ page }) => {
  await createWorkspace(page, "Import Club");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Lists" }).click();
  const importOnce = async () => {
    await page.getByRole("button", { name: "Import" }).first().click();
    await page.getByLabel("Choose a .csv or .xlsx").setInputFiles(path.join(__dirname, "fixtures", "roster.csv"));
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("combobox", { name: "What is Équipe?" })).toHaveText(/Lists/);
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("Step 3 of 3")).toBeVisible();
    await expectNoHorizontalScroll(page);
  };

  await importOnce();
  await expect(page.getByRole("button", { name: "4 New" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1 Merged duplicates" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1 Invalid, skipped" })).toBeVisible();
  await page.getByRole("button", { name: "Import 4 people" }).click();
  await expect(page.getByText("4 added, 0 updated, 4 lists created.")).toBeVisible();
  await expect(page.getByText("4 people")).toBeVisible();
  await expect(page.getByRole("button", { name: "Dev 2" })).toBeVisible();

  await importOnce();
  await expect(page.getByRole("button", { name: "0 New" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nothing to import" })).toBeDisabled();
});
```
Run `bun run test:e2e -- e2e/roster.spec.ts` → PASS on both projects.

- [ ] **Step 10: Visual check** — screenshots of the three steps at 390 px light and 320 px dark (file and paste variants, a multi-sheet workbook, the preview with a limit warning): the dialog fills the phone screen, the footer buttons are the same height on every step with one-line labels, and nothing scrolls sideways.

- [ ] **Step 11: Verify and commit** — `bun run lint && bun run typecheck && bun run test` → PASS. Commit: `feat: three-step roster import with column matching and dry-run preview`.

---

### Task 11: #87 leftovers — Settings skeleton, Google "G" in WebKit/Firefox, preview `VERCEL_URL`

**Labels:** `area:frontend`, `area:infra`

**Files:**
- Create: `src/app/w/[slug]/settings/page.test.tsx`
- Modify: `src/app/w/[slug]/settings/page.tsx`; possibly `public/brand/google-g.svg` (only if Step 3 finds it broken); `.env.local` untouched
- Issue: #87 (close when this merges; the two spec items were settled in PR #92)

**Interfaces:**
- Consumes: `useMembers`, `Skeleton`, `routeFetch`, Vercel project `tapnshow` (team `dalychouikhs-projects`).
- Produces: Settings keeps its layout while members load; a recorded WebKit/Firefox result for the Google button; a recorded `autoExposeSystemEnvs` value for the Vercel project.

- [ ] **Step 1: Failing test** — `src/app/w/[slug]/settings/page.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { okContext } from "@/test/workspace-context-mock";
import SettingsPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "club-ab12" }),
  useRouter: () => ({ replace: vi.fn() }),
}));
afterEach(() => vi.unstubAllGlobals());

describe("/w/[slug]/settings", () => {
  it("holds the Danger zone's place with a skeleton while members load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/members")) {
          return new Promise<Response>(() => undefined);
        }
        if (url === "/api/me") {
          return new Response(
            JSON.stringify({
              userId: "00000000-0000-4000-8000-00000000000a",
              profile: { displayName: "Me", avatarUrl: null, email: "me@example.test" },
              workspaces: [],
              lastWorkspaceSlug: null,
            }),
          );
        }
        if (url.endsWith("/invites")) {
          return new Response("[]");
        }
        return new Response(JSON.stringify(okContext.workspace));
      }),
    );
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByTestId("danger-zone-skeleton")).toBeInTheDocument();
  });
});
```
The `/api/me` stub follows `meResponseSchema` (`src/shared/api/me.ts`) and the `next/navigation` mock matches `danger-zone.test.tsx`. Run → FAIL (no skeleton).

- [ ] **Step 2: Fix** — in `src/app/w/[slug]/settings/page.tsx` replace the `members.data ? (<DangerZone …/>) : null` branch with:
```tsx
{members.data ? (
  <DangerZone workspace={workspace.data} myId={me.data.userId} members={members.data} />
) : (
  <div data-testid="danger-zone-skeleton">
    <Skeleton className="h-40 w-full" />
  </div>
)}
```
Run → PASS.

- [ ] **Step 3: Google "G" in WebKit and Firefox** — `bunx playwright install webkit firefox`, then with `bun run dev` running against `.env.local` (Google sign-in is enabled locally), run this throwaway script from the scratchpad (not committed):
```ts
import { firefox, webkit } from "@playwright/test";

for (const [name, engine] of [["webkit", webkit], ["firefox", firefox]] as const) {
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:3000/login");
  const button = page.getByRole("link", { name: /Google/ });
  await button.screenshot({ path: `google-button-${name}.png` });
  const drawn = await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('img[src*="google-g"]');
    return image ? { complete: image.complete, width: image.naturalWidth } : null;
  });
  console.info(name, drawn);
  await browser.close();
}
```
(The Google button is an `<a>` with the `/brand/google-g.svg` image.) Open both PNGs. **Pass:** the four-colour G is visible in both. **If either is blank or monochrome:** the `foreignObject` gradient is not rendered there — download Google's official sign-in branding assets (developers.google.com/identity/branding-guidelines, "Download assets"), take the standard-colour "G" SVG (four flat paths, no `foreignObject`), replace `public/brand/google-g.svg` with it unmodified, re-run the script in both engines and Chromium, and keep the PNGs for the PR. Stop the dev server afterwards.

- [ ] **Step 4: `VERCEL_URL` on previews** — read the project setting instead of guessing: with the Vercel MCP `get_project` (project `tapnshow`, team `dalychouikhs-projects`) or `vercel api /v9/projects/tapnshow --scope dalychouikhs-projects`, record `autoExposeSystemEnvs`.
  - `true` → previews know `VERCEL_URL` / `VERCEL_BRANCH_URL`; note it in #87.
  - `false` → **ask the owner** before changing anything: "Enable 'Automatically expose System Environment Variables' for tapnshow (recommended: invite links on previews then point at the preview instead of production)?" On yes, set it (MCP `update_project` with `autoExposeSystemEnvs: true`, or the dashboard toggle the owner prefers) and re-read it.
  - Then ask the owner to confirm once on this PR's preview deployment (behind Vercel SSO): Settings → People → invite → "Copy link"; the link must start with the preview URL. Record the result in #87.

- [ ] **Step 5: Verify, commit, close** — `bun run lint && bun run typecheck && bun run test` → PASS. Commit: `fix: settings skeleton and #87 checks`. PR body: the Step 3 PNGs and outcome, the Step 4 value. After merge, comment the outcomes on #87 and close it (rate-limit cleanup already moved to M4 in Tracking).

---

### Task 12: Rollout — e2e story, hosted checks, real roster import, final review

**Labels:** `area:infra`, `area:frontend`

**Files:**
- Modify: `e2e/roster.spec.ts` (the M3 story + Viewer), `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§14 M3 row done, §12 outcomes), `.env.local` (nothing new expected; confirm)

**Interfaces:**
- Consumes: everything above.
- Produces: M3 shipped on `https://tapnshow.vercel.app`; epic #5 and milestone M3 closed; final-review findings fixed or filed.

- [ ] **Step 1: Viewer e2e** — the organizer story is already covered by the Task 7–10 tests in `e2e/roster.spec.ts` (import → preview counts → roster and chips → re-import 0 new → sheet edit survives reload → Undo → bulk). Add the Viewer side (add `seedMember` to the `./helpers/seed` import):
```ts
test("a Viewer sees the roster read-only", async ({ page, browser }, testInfo) => {
  const slug = await createWorkspace(page, "Viewer Club");
  await seedRoster(slug, [{ fullName: "Inès Ben Salah", email: "ines@example.test", lists: ["Dev"] }]);
  const viewer = await seedMember(slug, "viewer", "Vic Viewer");

  const context = await browser.newContext({ ...testInfo.project.use });
  const viewerPage = await context.newPage();
  await signInWithCode(viewerPage, viewer.email, { startPath: "/login" });
  await viewerPage.goto(`/w/${slug}/lists`);
  await expect(viewerPage.getByText("1 person")).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "Import" })).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "Select" })).toHaveCount(0);
  await viewerPage.getByRole("button", { name: /Inès Ben Salah/ }).click();
  await expect(viewerPage.getByText("Only Owners and Admins can edit the roster.")).toBeVisible();
  await context.close();
});
```
`seedMember` sets the Viewer's display name, so sign-in skips the name step. Run the whole suite: stop any `next dev`, `bun run test:e2e` → PASS on `phone` and `small-phone` (M2 specs included).

- [ ] **Step 2: Hosted database audit** — for both projects (preview, then prod; re-link to prod at the end), as in the Task 1–3 rollout steps: `supabase migration list --linked` shows the three M3 migrations applied; `supabase db advisors --linked` shows no WARN/ERROR (lint 0029 gone since Task 1).

- [ ] **Step 3: Environment audit** — M3 adds no environment variables. `vercel env ls --scope dalychouikhs-projects` (names only) matches the M2 list; `.env.local`'s backup blocks need no change. Note it in the ledger.

- [ ] **Step 4: Production smoke test with the owner (both on phones)** — this is the epic's completion criterion:
  1. Owner exports the real club roster sheet (Google Sheets → File → Download → `.xlsx`, or `.csv`) and imports it on `https://tapnshow.vercel.app` → Lists → Import: check the guessed columns (Team → Lists), the preview counts and new lists, then Import.
  2. Owner imports the same file again: the preview shows **0 new** and "Nothing to import".
  3. Owner edits one person in the sheet, checks a list chip filter, and deletes then restores someone with Undo.
  4. The workspace's Viewer (from M2) opens Lists on their phone: read-only.
  Record each result (pass/fail, counts, screenshots with emails blurred) in the ledger and the PR. No roster content goes into GitHub.

- [ ] **Step 5: Monitoring** — Sentry (org `dev-daly`, project `tapnshow`): search issues from the last 24 h with the Sentry MCP; expected none from the roster routes. Spot-check a Vercel runtime log line from `POST /api/workspaces/[slug]/contacts/import` and confirm no names or emails appear in it.

- [ ] **Step 6: Spec + tracking** — in the spec: set §14's M3 "Done when" to done (date) with the real-roster result; add any rulings made during M3 to the relevant sections (e.g. a Google "G" swap in §4 Branding, `autoExposeSystemEnvs` in §9). Tick the epic's checklist.

- [ ] **Step 7: Final review** — use superpowers:requesting-code-review with a **fresh reviewer on the most capable model** over the whole M3 range (`git log` from this plan's merge to `HEAD`), with this plan, the spec and the Review Focus list as the brief. Grade findings Critical / Important / Minor. Fix Critical + Important in one `fix/` PR under a new `[task] M3 final review fixes` issue (test first for each); file the Minor ones as one issue under the M4 epic #6, as was done for #51 and #87. Record `Final:` lines in the ledger.

- [ ] **Step 8: Close** — close epic #5 and milestone `M3 Contacts & lists`; delete `.superpowers/sdd/2026-10-06-m3-contacts-and-lists/`. Commit (docs PR): `docs: M3 rollout results`.

---

## Self-review notes (plan author)

- **Spec coverage:** §4 member list editing (layout, autosave, merge rules, Team → lists) → Tasks 3, 5, 7–10; §6 tables, access pattern, caps, `import_contacts` → Tasks 2, 3; §7.13 `invite_preview` decision → settled in PR #92 (Task 11 closes #87); §7.14 roster page, edits + Undo, import dialog, empty state, Home link → Tasks 7–10; §10 roster API, error codes, libraries → Tasks 4, 5, 7, 9; §11 wrapper pattern → Task 1 (and every new function is invoker), visibility note → PR #92, import rate limits → Tasks 2, 3; §12 M3 tests → Tasks 2, 3, 5, 7–10, 12; §14 done criteria → Task 12.
- **Verified while planning (not assumed):** Supabase `max_rows = 1000` (config); trigger functions fire without `EXECUTE`; `on conflict (workspace_id, lower(name))`; `jsonb_to_recordset` into `text[]`; the email regex agrees with Zod 4.6; `import_contacts` dry run / commit / re-import on the local stack and its 2,000-row timings; `read-excel-file/universal` on fflate-built workbooks (multi-sheet, empty sheet, broken zip); PapaParse delimiter detection and Windows-1252 decoding; jsdom 30 `Blob.arrayBuffer`; Radix ToggleGroup single = `radiogroup`/`radio`; TanStack Table 9.2.6 `sortFn` and `getToggleSortingHandler`; the Google "G" asset uses `mask` + `foreignObject`.
- **Deliberately not in M3:** `is_adhoc` behaviour and flipping it back to roster, `unsubscribed_at`, the "Not my group" flow (M4); `contacts.user_id` linking (M8); roster export (M5 exports responses); the daily `rate_limit_events` cleanup (M4).
- **Known follow-ups:** `private.rate_limit_events` grows by one row per import/preview until M4's cleanup; preview row counts in Step 1 of the import include the header row.

