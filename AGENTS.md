<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TapNShow project rules

The person you work with is **the Owner**. Setup, commands and the architecture overview are in
`README.md`.

## Where things are

- Product and architecture spec (binding): `docs/superpowers/specs/2026-10-04-tapnshow-design.md`.
- Design documents for later work: `docs/superpowers/specs/` (for example the logo,
  `2026-10-17-logo-design.md`).
- Plans, one per milestone: `docs/superpowers/plans/` (the newest is the current one).
- Runbooks (operations, restore, admin, domain and search, Google verification):
  `docs/runbooks/`.
- Coding rules: `.agents/01-core-rules.md`.

## Engineering

- **DRY:** one rule in one place. A TypeScript constant that mirrors SQL names its twin, and a test
  pins the pair.
- **Clean architecture:** `src/lib` never imports from `src/app`; shared facts live in
  `src/config/*`; no hardcoded values (limits in `private.app_limits`, client tuning in
  `src/config/*`).
- **Judge designs by robustness, tests, performance and scale,** never by how little code they
  take. List the edge cases first (timeouts, retries, races, duplicates, shared devices, privacy,
  limits, time zones), recommend the durable design, and pin each case with a test.
- **Never speculate.** Check facts in official docs (and `node_modules/next/dist/docs/` for Next)
  and cite them.
- Remove whatever becomes unused in the same change. Zero warnings from lint, typecheck, tests and
  the build.

## Code

- bun only. Strict types: no `any`, and no `unknown` (the lint rule bans the keyword, even in
  `as unknown as`). Typed mocks: `vi.fn<Signature>()`. Zod for parsing.
- JSDoc on every export. No `console.*` (use the logger). Imports at the top. date-fns for dates.
- Every user-facing string goes through next-intl (`messages/en.json`).
- **No Server Actions and no data reads in server components.** Every read and write goes through
  `src/app/api/**/route.ts`, called with TanStack Query and Zod schemas shared from `src/shared/api`.
  Mutations reject cross-origin requests (`rejectCrossOrigin`, `src/server/http/request.ts`).
- Every route anyone can call has a rate limit, recorded in `ROUTES`
  (`src/server/http/route-registry.ts`). Pass nullable RPC arguments through `sqlNullable()`. Logs
  carry counts and ids only.

## Database

- SQL lives only in `supabase/migrations/*` and `src/server/queries/*`.
- Row-level security on every table. `SECURITY DEFINER` functions only in `private`, behind
  `public` invoker wrappers with `search_path = ''`, each listed in
  `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (`src/server/db/function-security.db.test.ts`).
- Before changing a function, copy its newest definition
  (`grep -ln "function private.<name>" supabase/migrations/* | sort | tail -1`). A signature change
  means drop, create and grant again.
- Set-based SQL, keyset pagination (every list that can grow loads in pages), no N+1. Measure plans
  on realistic volumes before claiming performance.
- After every migration: `supabase db reset --local`, `bun run db:types`, `bun run test:db`, and
  `supabase db advisors --local` with no new warning.

## UI

- Soft Neobrutalism from the tokens in `src/design/tokens.ts`. **No emojis** anywhere in the
  product, emails or notifications: Phosphor Bold icons inside `<Sticker>`.
- **No native form controls:** use the styled ones in `src/components/ui/`.
- **No technical words for users** ("token", "rate limit", "CSP"...): say what they can do.
- An "Are you sure?" dialog that names the consequence before sends, cancels, deletes without Undo
  and disconnects.
- Tap targets of at least 44 px. No sideways scroll at 320 px. Dialogs centred at 1024 px. Padded
  menus and popovers. Chip rows use `CHIP_ROW_CLASS` (`src/components/ui/chip-row.ts`).
- Never use "GDG ISSAT" or "ISSAT" as an example anywhere. Invent neutral names (Robotics Club,
  Riverside Volunteers).
- Look at every screenshot yourself (390 light, 320 dark, 1024), send it to the Owner and ask
  "Looks right?" before merging a screen change.

## Process

- One issue and one branch per change. Test first: watch each test fail for the right reason; a
  test that passes at once gets a mutation check.
- Before a pull request:
  `bunx prettier --write <touched files> && bun run format:check && bun run lint && bun run typecheck && bun run test -- --run`.
  Database work adds the database steps above; flow changes add `TZ=UTC bun run test:e2e` and
  `bun scripts/check-build-log.ts .e2e-build.log`.
- Pull requests follow `.github/pull_request_template.md`. **Never write "closes/fixes/resolves #N"
  for an issue that shouldn't close.**
- Ask the Owner before: any production send or production database write (read-only checks are
  fine); anything touching a real group's workspace or members; rotating secrets; writing env
  values to Vercel or GitHub; firewall changes; pushing auth templates or config; deleting
  branches, worktrees with work, or plan ledgers; installing tools.
- **Privacy:** counts only in chat, issues and pull requests; never paste emails, names, tokens or
  webhook URLs. Never overwrite `.env.local`. Never commit screenshots that show personal data.

# Motion studio rules

## Render contract

- Every film is a pure function of time: `window.seek(t)` paints frame t.
- No CSS transitions, no setTimeout, no requestAnimationFrame in render mode,
  no state carried between frames. Seeded noise only (mulberry32), never Math.random.
- Render with `node render.mjs`, encode H.264 yuv420p, CRF 16.

## Look

- Banned defaults: centered title on gradient, everything fading in,
  corner labels and frame borders, glow on UI chrome, generic particle bursts.
- One display face, one UI face. One accent color unless the brief says otherwise.
- Every 2 to 4 seconds something new must happen on screen.

## Sound

- Score and SFX are synthesized in code unless a track is supplied.
- Place hits on the measured beat grid (beats.json). Loudness -14 LUFS.

## Loop before you show me anything

1. Render one frame per beat as a contact sheet and LOOK at it.
2. Score it 1-10 on: hook in first 2s, readability at phone size,
   motion quality, variety, brand accuracy, sound sync.
3. Fix the 3 worst problems. Repeat until every score is 8+.
4. Only then do the full render.
