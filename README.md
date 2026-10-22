# TapNShow

**Know who's coming before the meeting starts.** TapNShow sends meeting invites from a group's own
Gmail. Members answer in one tap, with no app and no account. Organizers see who's going, who's
running late and who can't make it, as it happens.

Live at **https://www.tapnshow.tn**. It's free for groups in Tunisia that meet regularly: student
clubs, associations, volunteer teams and communities.

## What it does

- **Invites from your Gmail.** A workspace's Owner connects the group's Gmail address. Invites,
  updates, cancellations and reminders are sent from that address, so members see their group's
  name, not an unknown sender. TapNShow asks Google only for permission to send (`gmail.send`) and
  to keep the one sheet it creates (`drive.file`). It never reads the inbox.
- **One-tap answers.** Every invite carries a personal link. Members answer from the email on any
  phone: "I'm going", "I'll be late" or "I can't come" for attendance meetings, "Going" or "Not
  going" for RSVPs. Announcements carry no buttons. Members can add a reason or a comment.
- **Live results and door check-in.** The meeting page counts answers as they arrive. At the door,
  organizers mark who actually came.
- **Reminders.** By email, and as phone notifications for members who turn them on.
- **Members and lists.** Import members from a spreadsheet or CSV file once, group them in lists,
  and pick who to invite each time.
- **Google Sheet and exports.** A live copy of every answer in a Google Sheet for the committee,
  and Excel exports.
- **Roles.** Each workspace has one Owner, Admins and Viewers (committee members who can look but
  not change anything).
- **Member accounts.** Optional: members can sign in to see all their invites in one place, and
  install TapNShow as an app on their phone.
- **Platform admin.** An admin area for the platform's operators: usage figures, abuse reports,
  pausing a workspace's sending, and admin invites.

The product is in English. French and Arabic are planned
([#375](https://github.com/DalyChouikh/TapNShow/issues/375)).

## How it's built

| Part        | What we use                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| App         | Next.js 16 (App Router) and React 19, TypeScript in strict mode, run with Bun                                 |
| Data        | Supabase: Postgres 17 with row-level security on every table, Auth (email codes and Google), Cron             |
| Client data | TanStack Query against the app's own API routes, with Zod schemas shared by both sides                        |
| UI          | Tailwind CSS 4, Radix primitives restyled as "Soft Neobrutalism", Phosphor icons, `motion`                    |
| Text        | next-intl (`messages/en.json`)                                                                                |
| Email       | React Email templates, sent with the Gmail API (meeting emails) or SMTP (system emails such as sign-in codes) |
| Phone app   | A web app manifest and a Serwist service worker, with Web Push for reminders                                  |
| Operations  | Vercel (hosting, Analytics, Speed Insights), Sentry (errors, logs, uptime), GitHub Actions                    |

A few rules shape the whole codebase:

- **Every read and write goes through an API route** (`src/app/api/**/route.ts`). There are no
  Server Actions, and server components don't read data. Pages are client components that call the
  API through TanStack Query.
- **The database enforces access.** Row-level security is on for every table.
  `SECURITY DEFINER` functions live only in the `private` schema, behind thin `public` wrappers.
  SQL lives only in `supabase/migrations/` and `src/server/queries/`.
- **Email goes out through an outbox.** Sending a meeting writes jobs to the database. A dispatcher
  sends them in batches, under per-Gmail quotas, with retries. It runs right after the request that
  queued the work (Next's `after()`). On production, Supabase Cron also calls it every minute.

The full product and architecture spec is
[`docs/superpowers/specs/2026-10-04-tapnshow-design.md`](docs/superpowers/specs/2026-10-04-tapnshow-design.md).

## Repository layout

```text
src/
  app/          Pages, layouts and API routes (App Router)
  components/   UI, by feature; restyled primitives in components/ui
  config/       Constants and environment parsing (one place for every value)
  design/       Theme tokens (colours, shapes, motion)
  emails/       React Email templates
  hooks/        React hooks (data hooks wrap TanStack Query)
  lib/          Code shared by client and server
  server/       Server-only code: queries, workers (dispatch, sheets, push), auth, crypto
  shared/       Zod schemas shared by the API and its clients
  content/      Legal pages as typed content
supabase/       Local stack config, migrations, auth email templates
messages/       UI text (next-intl)
e2e/            Playwright tests, with fake Google and push servers
scripts/        Repo scripts (local Supabase wrapper, auth config, admin and ops tools)
docs/           Spec and plans (superpowers/), spike reports, runbooks
```

## Developer onboarding

### Prerequisites

- **Bun** at the version pinned in `package.json` (`packageManager`; CI installs the same one).
- **Node.js 24**, the line Vercel runs: 24.22.1 or later has the October 2026 security fixes.
- **Supabase CLI 2.119.0** (the version CI uses) and **Docker**, for the local database.
- On Windows, work inside **WSL 2**. The local stack uses ports 44320–44329 rather than Supabase's
  default 543xx, because Windows reserves blocks in its dynamic port range.

### First run

```bash
git clone https://github.com/DalyChouikh/TapNShow.git
cd TapNShow
bun install
supabase start                 # starts Postgres, Auth, Studio and Mailpit in Docker, applies the migrations
cp .env.example .env.local
```

Then fill in the three secrets that sending needs, in `.env.local`:

```bash
# GOOGLE_TOKEN_ENCRYPTION_KEY: 32 bytes, base64
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# INVITE_TOKEN_SECRET and DISPATCH_SECRET: 32 bytes each, base64url
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Start the app against the local stack:

```bash
bun scripts/with-local-supabase.ts bun run dev
```

The wrapper reads `supabase status` and passes the local Supabase URL and keys, and Mailpit as the
mail server, to the command it runs. Those values win over anything in `.env.local`.

Open http://localhost:3000 and sign in with any address. The 8-digit code arrives in **Mailpit**
at http://127.0.0.1:44324. Choose a name, then create a workspace. **Studio**, the database UI, is
at http://127.0.0.1:44323.

### Optional services

- **Gmail sending.** Connecting a Gmail account needs your own OAuth client in Google Cloud, with
  the redirect URI `http://localhost:3000/api/integrations/google/callback`. Set
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `NEXT_PUBLIC_GMAIL_CONNECT_ENABLED=true` in
  `.env.local`. You don't need this for most work: the e2e suite runs the Gmail and Google Sheets
  flows against a fake Google (`e2e/helpers/fake-google.ts`).
- **Google sign-in** isn't set up on the local stack (`supabase/config.toml` has no Google
  provider), so the wrapper turns it off. Sign in with email codes locally.
- **Phone notifications.** Run `bunx web-push generate-vapid-keys` and set all three of
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or
  `https:` contact). Without them the reminder settings stay hidden.
- **Platform admin.** Sign in once, then make your account the platform owner:
  `bun scripts/set-platform-owner.ts --email you@example.com --project local`.

### Everyday commands

| Command                                                                 | What it does                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `bun run dev`                                                           | Development server                                                    |
| `bun run lint` / `bun run format` / `bun run format:check`              | ESLint, Prettier                                                      |
| `bun run typecheck`                                                     | Route types, then `tsc` for the app and the service worker            |
| `bun run test`                                                          | Unit and component tests (Vitest; add `-- --run` for a single run)    |
| `supabase db reset --local` then `bun run test:db`                      | Database tests (RLS, functions, plans) against a fresh local database |
| `bunx playwright install chromium` once, then `TZ=UTC bun run test:e2e` | Builds the app and runs Playwright against it                         |
| `bun run db:types`                                                      | Regenerates `src/server/db/database.types.ts` from the local database |
| `bun run tokens`                                                        | Regenerates the theme's CSS variables from `src/design/tokens.ts`     |

Before opening a pull request, run the whole chain:

```bash
bun run format:check && bun run lint && bun run typecheck && bun run test -- --run
supabase db reset --local && bun run db:types && bun run test:db && supabase db advisors --local  # database changes
TZ=UTC bun run test:e2e && bun scripts/check-build-log.ts .e2e-build.log                          # flow changes
```

CI runs the same steps. The `quality` job runs lint, format, typecheck and unit tests. The `db`
job runs the advisors, the database tests and the e2e suite on a fresh Supabase stack. A change to
documentation only (files under `docs/` and `*.md` files, `scripts/docs-only.sh`) runs only the
format check, and Vercel skips its build. A pull request runs only the database tests its change
can reach (`scripts/db-test-scope.ts`: Vitest's `related` follows the imports), and all of them when
it touches `supabase/`, the dependencies, the tests' config or the workflows; main always runs them
all.

**About `.env.local` and e2e:** Playwright sets the variables the tests need (`playwright.config.ts`,
`webServer.env`). Anything it doesn't set falls back to `.env.local` on your machine, and CI has no
`.env.local`. A story that needs a new flag or URL must set it in `playwright.config.ts`.

### Database changes

1. `supabase migration new <name>`, then write the SQL. When you change an existing function, start
   from its newest definition:
   `grep -ln "function private.<name>" supabase/migrations/* | sort | tail -1`.
2. `supabase db reset --local` applies every migration from scratch.
3. `bun run db:types`, then the tests, then `supabase db advisors --local` (no new warnings).

Migrations reach the hosted projects after the pull request merges.

### How we work

- One issue and one branch per change. Issue templates are in `.github/ISSUE_TEMPLATE/`.
- Test first: write the test, watch it fail, then make it pass.
- Pull requests follow `.github/pull_request_template.md` and are squash-merged once CI is green.
- Coding rules: [`AGENTS.md`](AGENTS.md) and [`.agents/01-core-rules.md`](.agents/01-core-rules.md).
  In short: strict types (no `any`, no `unknown`), JSDoc on every export, no `console.*`, no
  hardcoded values, every user-facing string in `messages/en.json`, and no emojis anywhere in the
  product.

## Environments

| Environment | App                               | Database                             |
| ----------- | --------------------------------- | ------------------------------------ |
| Local       | http://localhost:3000             | Local Supabase (Docker)              |
| Preview     | A Vercel preview per pull request | Hosted Supabase project "preview"    |
| Production  | https://www.tapnshow.tn (Vercel)  | Hosted Supabase project "production" |

GitHub Actions also runs a keep-alive (the free Supabase plan pauses idle projects), nightly
encrypted backups, and deploy notices.

## Documentation

- [`docs/superpowers/specs/`](docs/superpowers/specs/): the product spec and design documents.
- [`docs/superpowers/plans/`](docs/superpowers/plans/): implementation plans, one per milestone.
- [`docs/runbooks/`](docs/runbooks/): monitoring, restore, platform admin, domain and search, Google
  verification, and the data-protection declaration.
- [`docs/spikes/`](docs/spikes/): the reports of the early technical spikes.

## Author

Made by Mohamed Ali Chouikh.
