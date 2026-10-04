# TapNShow M0 + M1 (Spikes & Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the four platform unknowns (S1–S4) with evidence, and ship a deployed, tested Next.js foundation for TapNShow whose Soft-Neobrutalist design system is visible on a `/design` showcase page at `https://tapnshow.vercel.app/design`.

**Architecture:** One Next.js 16 App Router codebase (bun, strict TypeScript) deployed on Vercel Hobby, backed by two free Supabase projects (Preview, Production). M1 builds only cross-cutting foundations — config, logging, error monitoring, i18n, design tokens, core UI components, motion primitives, Supabase client factories, CI — with no product features. Spikes live on throwaway `spike/*` branches; only their written findings are merged.

**Tech Stack:** Next.js 16.3.8, React 19.2, TypeScript 5 (as pinned by `create-next-app`), bun 1.3.11, Tailwind CSS 4, shadcn 4.21 (Radix base, `lyra` preset → Phosphor icons), `@phosphor-icons/react` 2.1, `motion` 14, `next-intl` 4.14, `next-themes` 0.4.6, `zod` 4, `pino` 10, `@sentry/nextjs` 11.4, `@supabase/supabase-js` 2 + `@supabase/ssr` 0.12, Vitest 5 + Vite 8 + React Testing Library, Playwright 1.63 + `@axe-core/playwright`, Supabase CLI 2.119.

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md` — read §2 (constraints), §5 (architecture), §10 (frontend), §12 (testing) and §13 (spikes) before starting.

## Global Constraints

- Free only: Vercel Hobby, Supabase Free (2 projects), Sentry Developer (free), GitHub Actions on the public repo. Nothing that costs money, ever.
- Package manager and script runner: **bun** (`bun add`, `bun run <script>`, `bunx`). Never npm/yarn/pnpm.
- **No Server Actions.** All data reads and writes go through `src/app/api/**/route.ts`. (M1 has one route: `/api/health`.)
- **No emojis** anywhere — UI, tests' visible strings, emails, commit messages are fine but keep product copy emoji-free. Icons come from `@phosphor-icons/react` (Bold weight) inside `<Sticker>`.
- TypeScript: no `any`, no `unknown` written in code (enforced by ESLint in Task 2). Fix type errors; never suppress them.
- No `console.*` in `src/` — use `logger` (Task 4).
- Dates: `date-fns` / `@date-fns/tz` only (none needed in M1).
- JSDoc on every exported function, component, and constant.
- No hardcoded values: product name, URLs, limits, colors live in `src/config/*` or `src/design/*`.
- SQL lives only in `supabase/migrations/*` and `src/server/queries/*`; routes import query functions.
- Every UI string goes through next-intl (`messages/en.json`).
- Visual style: Soft Neobrutalism — thick outlines (2.5 px), rounded corners, hard downward shadows, pastel fills, dark ink text on every fill in both themes. Fonts: Archivo Black (display) + Space Grotesk (body).
- Motion: Expressive (springy). `prefers-reduced-motion: reduce` → no transforms, no confetti, final state shown immediately.
- Accessibility: WCAG 2.2 AA; text/background contrast ≥ 4.5:1; tap targets ≥ 44 px; visible focus rings.
- Browser support: latest 2 Chrome/Edge/Firefox/Safari, iOS Safari 16.4+, Android Chrome.
- Git: one branch per task (`feat/<issue#>-<slug>`), PR with `.github/pull_request_template.md`, CI green, squash-merge into `main`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (Next 16 has breaking changes vs. older training data — e.g. `middleware` is now `proxy`).

## Review Focus

1. **Theme flash on first paint** — a user whose phone is in dark mode must never see a cream/light frame before dark applies. Pinned by the e2e test in Task 16 (`colorScheme: "dark"` → first-paint background is the dark token).
2. **Unreadable text on pastel fills in dark mode** — every fill must keep dark ink text with ≥ 4.5:1 contrast in both themes. Pinned by the contrast unit tests in Task 11.
3. **Reduced-motion users** — the CONFIRMED stamp must appear instantly with no confetti and no shake. Pinned by unit test (Task 14) and e2e test with `reducedMotion: "reduce"` (Task 16).
4. **Missing or malformed env vars in production** — the app must fail fast with a message naming the variable, not crash later with `undefined`; server secrets must never be importable from client code. Pinned by the env parser tests (Task 3) and the `server-only` guard.
5. **Secrets/tokens leaking into logs or Sentry** — personal-link tokens (`/r/<token>`), `Authorization` headers, cookies and refresh tokens must be redacted. Pinned by logger redaction tests (Task 4) and the URL scrubber tests (Task 9).

## Execution Order

| Order | Item | Milestone | Depends on |
|---|---|---|---|
| 0 | Merge the docs branch (spec + this plan) | — | — |
| 1 | Task 1 — Scaffold & claim `tapnshow.vercel.app` | M1 | 0 |
| 2 | Task 2 — Quality tooling, CI, branch protection | M1 | 1 |
| 3 | Task 3 — Typed configuration | M1 | 2 |
| 4 | Task 4 — Logger | M1 | 3 |
| 5 | Spikes S1, S2, S3, S4 (can run in parallel with Tasks 9–16; S4 needs ≥ 8 calendar days) | M0 | 1 (S1, S3), 3 (S3) |
| 6 | Task 9 — Sentry | M1 | 4 |
| 7 | Task 10 — i18n | M1 | 3 |
| 8 | Task 11 — Design tokens & theming | M1 | 10 |
| 9 | Task 12 — Sticker & Button | M1 | 11 |
| 10 | Task 13 — Card, Chip, Input | M1 | 12 |
| 11 | Task 14 — Motion primitives | M1 | 11 |
| 12 | Task 15 — Supabase baseline & `/api/health` | M1 | 3, 4, S1 (projects exist) |
| 13 | Task 16 — `/design` showcase, e2e, production deploy | M1 | 12–15 |

(Spikes are numbered S1–S4 and documented as Tasks 5–8 below.)

## Tracking (done once, before Task 1)

- [ ] **Merge docs:** open a PR from `docs/design-spec` to `main` titled `docs: TapNShow design spec and M0+M1 plan`; merge it.
- [ ] **Labels:**
```bash
for l in "type:epic:5319e7" "type:task:1d76db" "type:spike:fbca04" "type:decision:d93f0b" "type:bug:b60205" \
         "area:infra:c5def5" "area:design-system:f9d0c4" "area:config:bfdadc" "area:observability:d4c5f9" \
         "area:i18n:fef2c0" "area:db:0e8a16" "area:email:e99695" "area:calendar:c2e0c6" "area:auth:bfd4f2"; do
  IFS=: read -r a b c <<<"$l"; gh label create "$a:$b" --color "$c" --force
done
```
- [ ] **Milestones M0–M9** (titles from spec §14):
```bash
for m in "M0 Spikes" "M1 Foundation" "M2 Auth & workspaces" "M3 Contacts & lists" "M4 Meetings & sending" \
         "M5 Responses (MVP)" "M6 Lifecycle & reminders" "M7 Google integrations" "M8 Member accounts & PWA" "M9 Public launch"; do
  gh api repos/DalyChouikh/meetings-confirmation/milestones -f title="$m" -f state=open >/dev/null
done
```
- [ ] **Epics:** one `[epic]` issue per milestone M0–M9 (epic template fields filled from spec §14). M2–M9 epics list their scope only; their sub-issues are created when their own plan is written. Example:
```bash
gh issue create --title "[epic] M1 Foundation" --label "type:epic" --milestone "M1 Foundation" --body-file - <<'EOF'
### Outcome
A deployed, tested Next.js foundation with the Soft-Neobrutalist design system visible at /design.
### Why this matters
Every later milestone builds on its config, logging, monitoring, i18n, tokens, components and CI.
### Scope
Included: Tasks 1-4 and 9-16 of docs/superpowers/plans/2026-10-05-m0-m1-spikes-and-foundation.md
Excluded: any product feature (auth, workspaces, meetings)
### Expected sub-issues
- [ ] One per task (linked as sub-issues)
### Completion criteria
https://tapnshow.vercel.app/design and /api/health return 200 in production; CI green on main.
EOF
```
- [ ] **Sub-issues for this plan:** one `[task]` issue per Task 1–4 and 9–16 and one `[spike]` issue per S1–S4, using the agent-task template fields (Parent = the epic, Goal/Context/Scope/Constraints/Acceptance/Validation/Stop conditions copied from the task below), then attached as sub-issues of their epic:
```bash
# example: attach issue #12 as a sub-issue of epic #3
SUB_ID=$(gh api repos/DalyChouikh/meetings-confirmation/issues/12 -q .id)
gh api -X POST repos/DalyChouikh/meetings-confirmation/issues/3/sub_issues -F sub_issue_id="$SUB_ID"
```

---

# Part B — M1 Foundation (first four tasks)

### Task 1: Scaffold Next.js app and claim `tapnshow.vercel.app`

**Files:**
- Create (from scaffold): `package.json`, `bun.lock`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `next-env.d.ts`, `AGENTS.md`, `CLAUDE.md`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/favicon.ico`
- Create: `src/config/app.ts`
- Modify: `.gitignore`, `README.md` (replace scaffold README)

**Interfaces:**
- Produces: `APP_NAME: "TapNShow"`, `APP_DESCRIPTION: string` from `@/config/app`.

- [ ] **Step 1: Branch**
```bash
git checkout main && git pull && git checkout -b feat/<issue#>-scaffold
```

- [ ] **Step 2: Scaffold into a temp dir (the repo is not empty, so scaffold elsewhere and copy)**
```bash
SCAF=/tmp/claude-1000/tapnshow-scaffold && rm -rf "$SCAF"
bunx create-next-app@16.3.8 "$SCAF" --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-bun --agents-md --disable-git --yes
rsync -a --exclude node_modules --exclude .next --exclude .gitignore --exclude README.md --exclude public "$SCAF"/ ./
cat "$SCAF/.gitignore" >> .gitignore
bun install
```
Expected: `package.json` lists `next 16.3.8`, `react 19.2.x`.

- [ ] **Step 3: Fix the package name and Node types**

In `package.json` set `"name": "tapnshow"` and replace `"@types/node": "^20"` with `"@types/node": "^24"` (Vitest 5 requires `^22 || >=24`; we run Node 24). Then `bun install`.

- [ ] **Step 4: Add `.gitignore` entries not covered by the scaffold**

Append:
```gitignore
# local tooling
.superpowers/
.vercel
.env*.local
playwright-report/
test-results/
spikes/**/.token.json
supabase/.temp/
```

- [ ] **Step 5: Create `src/config/app.ts`**
```ts
/** Product name shown in the UI, metadata, and email "via" lines. */
export const APP_NAME = "TapNShow";

/** One-line product description used in metadata and the PWA manifest. */
export const APP_DESCRIPTION =
  "Meeting invites your group actually sees. Confirm, say you're late, or excuse yourself in one tap.";
```

- [ ] **Step 6: Replace the scaffold page and metadata**

`src/app/page.tsx`:
```tsx
import { APP_NAME } from "@/config/app";

/** Temporary landing placeholder until the M9 landing page exists. */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <h1 className="text-4xl font-bold">{APP_NAME}</h1>
    </main>
  );
}
```
In `src/app/layout.tsx` replace the `metadata` object with:
```tsx
export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};
```
and add `import { APP_DESCRIPTION, APP_NAME } from "@/config/app";`. (The heading moves to next-intl in Task 10.)

- [ ] **Step 7: Point agents at the project rules**

Append to `AGENTS.md` (below the generated Next.js block):
```md
# TapNShow project rules

- Product/architecture spec: `docs/superpowers/specs/2026-10-04-tapnshow-design.md`
- Current plan: `docs/superpowers/plans/2026-10-05-m0-m1-spikes-and-foundation.md`
- Coding rules: `.agents/01-core-rules.md` (bun, strict types, JSDoc, tests, no console.log)
- Never use Server Actions; all reads/writes go through `src/app/api/**/route.ts`.
- Never use emojis in the product; use Phosphor Bold icons inside `<Sticker>`.
```
Replace `README.md` with:
```md
# TapNShow

Meeting invites your group actually sees. See `docs/superpowers/specs/2026-10-04-tapnshow-design.md`.

## Develop

    bun install
    bun run dev
```

- [ ] **Step 8: Verify the build**

Run: `bun run build`
Expected: build succeeds, route `/` listed.

- [ ] **Step 9: Deploy to claim the subdomain**

The user must run `! bunx vercel@latest login` once if not logged in. Then:
```bash
bunx vercel@latest link --yes --project tapnshow
bunx vercel@latest deploy --prod
curl -s -o /dev/null -w "%{http_code}\n" https://tapnshow.vercel.app
```
Expected: `200`. If `tapnshow.vercel.app` is not the assigned production domain, stop and ask the user (the name may have been taken since 2026-10-04).

- [ ] **Step 10: Connect Git for automatic deployments**
```bash
bunx vercel@latest git connect --yes
```
Expected: pushes to PR branches create Preview deployments; merges to `main` deploy Production.

- [ ] **Step 11: Commit and open PR**
```bash
git add -A
git commit -m "feat: scaffold Next.js 16 app for TapNShow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --fill --body-file .github/pull_request_template.md
```

---

### Task 2: Quality tooling, CI, and branch protection

**Files:**
- Create: `vitest.config.mts`, `vitest.setup.ts`, `src/test/server-only-stub.ts`, `src/test/match-media.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `.prettierrc.json`, `.prettierignore`, `.github/workflows/ci.yml`, `src/config/app.test.ts`
- Modify: `package.json` (scripts), `eslint.config.mjs`, `tsconfig.json` (exclude)

**Interfaces:**
- Produces: scripts `lint`, `format`, `format:check`, `typecheck`, `test`, `test:e2e`; `setReducedMotion(value: boolean): void` from `@/test/match-media`; CI check named `quality`.

- [ ] **Step 1: Install dev tooling**
```bash
bun add -D vitest@5.0.3 vite@^8 @vitejs/plugin-react@6.1.1 vite-tsconfig-paths@6.1.1 jsdom \
  @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event \
  @playwright/test@1.63.0 @axe-core/playwright prettier prettier-plugin-tailwindcss
```

- [ ] **Step 2: Write the first failing test** — `src/config/app.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { APP_DESCRIPTION, APP_NAME } from "./app";

describe("app config", () => {
  it("exposes the product name", () => {
    expect(APP_NAME).toBe("TapNShow");
  });

  it("has a description without emojis", () => {
    expect(APP_DESCRIPTION).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
```

- [ ] **Step 3: Run it to confirm the runner is missing**

Run: `bun run test`
Expected: FAIL — `Script not found "test"`.

- [ ] **Step 4: Add Vitest config, setup, and stubs**

`vitest.config.mts`:
```ts
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // `server-only` throws outside React Server bundles; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    css: false,
  },
});
```
`src/test/server-only-stub.ts`:
```ts
/** Empty stand-in for the `server-only` package inside Vitest. */
export {};
```
`src/test/match-media.ts`:
```ts
let reducedMotion = false;

/**
 * Toggles the emulated `prefers-reduced-motion: reduce` media query for tests.
 * @param value - true to emulate a user who prefers reduced motion
 */
export function setReducedMotion(value: boolean): void {
  reducedMotion = value;
}

/** Installs a deterministic `window.matchMedia` (jsdom has none). */
export function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
```
`vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { installMatchMedia, setReducedMotion } from "./src/test/match-media";

installMatchMedia();

afterEach(() => {
  cleanup();
  setReducedMotion(false);
});
```

- [ ] **Step 5: Add scripts** — in `package.json` `"scripts"`:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc --noEmit",
  "test": "vitest",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 6: Run the test**

Run: `CI=true bun run test`
Expected: PASS (2 tests). (`CI=true` makes Vitest run once instead of watching; CI sets it automatically.)

- [ ] **Step 7: Enforce repo rules in ESLint** — replace `eslint.config.mjs`:
```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "TSUnknownKeyword", message: "Repo rule: use an explicit type instead of `unknown`." },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "spikes/**",
    ".superpowers/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
```
Add `"spikes"` and `".superpowers"` to the `"exclude"` array in `tsconfig.json`.

- [ ] **Step 8: Prove the lint rules bite**
```bash
printf 'export const x: unknown = 1;\nconsole.log(x);\n' > src/lint-probe.ts
bun run lint; echo "exit=$?"
rm src/lint-probe.ts
```
Expected: two errors (`no-restricted-syntax`, `no-console`), `exit=1`.

- [ ] **Step 9: Prettier** — `.prettierrc.json`:
```json
{
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/app/globals.css"
}
```
`.prettierignore`:
```
.next
bun.lock
docs
.superpowers
spikes
playwright-report
test-results
src/server/db/database.types.ts
```
Run: `bun run format && bun run format:check` → Expected: `All matched files use Prettier code style!`

- [ ] **Step 10: Playwright smoke test** — `playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "small-phone", use: { ...devices["iPhone SE"], browserName: "chromium" } },
  ],
  webServer: {
    command: `bun run build && bun run start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
```
`e2e/smoke.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("home page renders the product name without horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("TapNShow");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
```
Run: `bunx playwright install chromium && bun run test:e2e`
Expected: 2 passed (phone, small-phone).

- [ ] **Step 11: CI workflow** — `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  quality:
    runs-on: ubuntu-latest
    env:
      NEXT_PUBLIC_APP_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run format:check
      - run: bun run typecheck
      - run: bun run test
      - run: bunx playwright install --with-deps chromium
      - run: bun run test:e2e
```
(`NEXT_PUBLIC_APP_URL` is unused until Task 3 but declared now so CI never needs editing for it.)

- [ ] **Step 12: Commit, push, confirm CI is green**
```bash
git add -A && git commit -m "chore: add vitest, playwright, prettier, eslint rules and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && gh pr create --fill
gh pr checks --watch
```
Expected: `quality` passes. Merge the PR (squash).

- [ ] **Step 13: Protect `main`** (after the first green `quality` run exists)
```bash
gh api -X PUT repos/DalyChouikh/meetings-confirmation/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["quality"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```
Expected: JSON response containing `"required_status_checks"`. Verify: `git push origin HEAD:main` from a scratch commit is rejected (then delete the scratch commit locally).

---

### Task 3: Typed configuration

**Files:**
- Create: `src/config/env-utils.ts`, `src/config/env.ts`, `src/config/public-env.ts`, `src/config/env.test.ts`, `src/config/public-env.test.ts`, `.env.example`
- Modify: `src/app/layout.tsx` (Search Console verification meta for S3)

**Interfaces:**
- Produces:
  - `parseServerEnv(source: EnvSource): ServerEnv`, `getServerEnv(): ServerEnv` (memoized, server-only) — `ServerEnv` = `{ NODE_ENV: "development" | "test" | "production"; LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" }` (Task 15 extends it with Supabase keys).
  - `parsePublicEnv(source: EnvSource): PublicEnv`, `publicEnv: PublicEnv` — `PublicEnv` = `{ NEXT_PUBLIC_APP_URL: string; NEXT_PUBLIC_SENTRY_DSN?: string; NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?: string }`.
  - `type EnvSource = Record<string, string | undefined>`; `blankToUndefined(source: EnvSource): EnvSource`; `formatEnvError(error: z.ZodError): string`.

- [ ] **Step 1: Failing tests** — `src/config/public-env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./public-env";

describe("parsePublicEnv", () => {
  it("parses a valid environment", () => {
    const env = parsePublicEnv({ NEXT_PUBLIC_APP_URL: "https://tapnshow.vercel.app" });
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://tapnshow.vercel.app");
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it("treats empty strings as missing", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SENTRY_DSN: "",
    });
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it("names the missing variable in the error", () => {
    expect(() => parsePublicEnv({})).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("rejects a malformed URL", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_URL: "not a url" })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
```
`src/config/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

describe("parseServerEnv", () => {
  it("applies defaults", () => {
    const env = parseServerEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("rejects an unknown log level and names it", () => {
    expect(() => parseServerEnv({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true bun run test src/config`
Expected: FAIL — cannot resolve `./public-env` / `./env`.

- [ ] **Step 3: Implement** — first `bun add zod@^4 server-only`.

`src/config/env-utils.ts`:
```ts
import { z } from "zod";

/** Raw environment variables as provided by the runtime. */
export type EnvSource = Record<string, string | undefined>;

/**
 * Treats empty-string variables as unset so optional values behave consistently
 * across Vercel, CI and local `.env` files.
 */
export function blankToUndefined(source: EnvSource): EnvSource {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
}

/** Builds a readable, variable-naming error message from a Zod failure. */
export function formatEnvError(error: z.ZodError): string {
  return `Invalid environment variables:\n${z.prettifyError(error)}`;
}
```
`src/config/public-env.ts`:
```ts
import { z } from "zod";
import { blankToUndefined, formatEnvError, type EnvSource } from "./env-utils";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().min(1).optional(),
});

/** Environment variables that are safe to expose to the browser. */
export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Validates browser-safe environment variables.
 * @throws Error naming every invalid or missing variable
 */
export function parsePublicEnv(source: EnvSource): PublicEnv {
  const result = publicEnvSchema.safeParse(blankToUndefined(source));
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

/**
 * Validated public env. Each variable is referenced literally so Next.js can inline it
 * into client bundles.
 */
export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
});
```
`src/config/env.ts`:
```ts
import "server-only";
import { z } from "zod";
import { blankToUndefined, formatEnvError, type EnvSource } from "./env-utils";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

/** Server-only environment variables (secrets live here, never in PublicEnv). */
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates server environment variables.
 * @throws Error naming every invalid or missing variable
 */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverEnvSchema.safeParse(blankToUndefined(source));
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Returns the validated server env, parsing `process.env` once per process. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
```
Because `public-env.test.ts` imports a module that parses `process.env` at import time, add to `vitest.config.mts` under `test`: `env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },`.

- [ ] **Step 4: Run tests**

Run: `CI=true bun run test src/config`
Expected: PASS (all config tests).

- [ ] **Step 5: `.env.example`** (committed; real values go in `.env.local` and Vercel)
```bash
# Public (browser-safe)
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=

# Server
LOG_LEVEL=info
```
Create `.env.local` with `NEXT_PUBLIC_APP_URL=http://localhost:3000`. Set Production in Vercel:
```bash
printf 'https://tapnshow.vercel.app' | bunx vercel@latest env add NEXT_PUBLIC_APP_URL production
```
For Preview, set `NEXT_PUBLIC_APP_URL` to `https://tapnshow.vercel.app` as well (previews only need a valid URL until auth arrives in M2).

- [ ] **Step 6: Search Console verification hook (used by S3)** — in `src/app/layout.tsx` extend metadata:
```tsx
export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  verification: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};
```
with `import { publicEnv } from "@/config/public-env";`.

- [ ] **Step 7: Verify and commit**

Run: `bun run lint && bun run typecheck && CI=true bun run test && bun run build` → all pass.
```bash
git add -A && git commit -m "feat: add validated server and public environment config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Open PR, wait for `quality`, squash-merge.

---

### Task 4: Logger

**Files:**
- Create: `src/lib/logger.ts`, `src/lib/logger.test.ts`

**Interfaces:**
- Consumes: `getServerEnv()` (Task 3), `APP_NAME` (Task 1).
- Produces: `createLogger(options: { level: LogLevel; destination?: DestinationStream }): Logger`, `logger: Logger`, `REDACT_PATHS: readonly string[]`, `type LogLevel`.

- [ ] **Step 1: Failing test** — `src/lib/logger.test.ts`:
```ts
import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function memoryStream(): { stream: DestinationStream; lines: string[] } {
  const lines: string[] = [];
  return { lines, stream: { write: (message: string) => void lines.push(message) } };
}

describe("createLogger", () => {
  it("writes structured JSON with the app name", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "info", destination: stream }).info({ meetingId: "m1" }, "sent");
    const entry = JSON.parse(lines[0]) as { app: string; meetingId: string; msg: string };
    expect(entry).toMatchObject({ app: "TapNShow", meetingId: "m1", msg: "sent" });
  });

  it("redacts secrets, tokens, cookies and authorization headers", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "info", destination: stream }).info(
      {
        token: "personal-link-token",
        refreshToken: "1//refresh",
        headers: { authorization: "Bearer abc", cookie: "sb=xyz" },
        job: { token: "nested-token", secret: "s3cr3t" },
      },
      "request",
    );
    const raw = lines[0];
    for (const secret of ["personal-link-token", "1//refresh", "Bearer abc", "sb=xyz", "nested-token", "s3cr3t"]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain("[REDACTED]");
  });

  it("respects the level", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "warn", destination: stream }).info("hidden");
    expect(lines).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`./logger` missing): `CI=true bun run test src/lib/logger`

- [ ] **Step 3: Implement** — `bun add pino@^10`, then `src/lib/logger.ts`:
```ts
import "server-only";
import pino, { type DestinationStream, type Logger } from "pino";
import { APP_NAME } from "@/config/app";
import { getServerEnv, type ServerEnv } from "@/config/env";

/** Log levels accepted by the logger (mirrors `LOG_LEVEL`). */
export type LogLevel = ServerEnv["LOG_LEVEL"];

/** Object paths whose values are replaced with "[REDACTED]" before writing. */
export const REDACT_PATHS = [
  "token",
  "*.token",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "authorization",
  "headers.authorization",
  "headers.cookie",
  "*.headers.authorization",
  "*.headers.cookie",
] as const;

/**
 * Creates a structured JSON logger with secret redaction.
 * @param options.level - minimum level to write
 * @param options.destination - optional stream (tests); defaults to stdout
 */
export function createLogger(options: { level: LogLevel; destination?: DestinationStream }): Logger {
  return pino(
    {
      level: options.level,
      base: { app: APP_NAME },
      redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    },
    options.destination,
  );
}

/** Application-wide server logger. Use instead of `console.*`. */
export const logger: Logger = createLogger({ level: getServerEnv().LOG_LEVEL });
```

- [ ] **Step 4: Run — expect PASS**: `CI=true bun run test src/lib/logger`

- [ ] **Step 5: Confirm Next bundles pino on the server**

Run: `bun run build`
Expected: success. If the build reports a pino worker/thread-stream error, add `serverExternalPackages: ["pino"]` to `next.config.ts` (see `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`) and rebuild.

- [ ] **Step 6: Commit, PR, merge**
```bash
git add -A && git commit -m "feat: add redacting structured logger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part A — M0 Spikes

Spike rules:
- Work on a branch `spike/<id>-<slug>`; code goes in `spikes/<id>-<slug>/` (ignored by lint, typecheck and Prettier). **Spike branches are never merged.**
- Findings are written to `docs/spikes/<id>.md` on a separate `docs/spike-<id>` branch, merged via PR, and summarized in a **Decision** issue (template `decision.yml`) linked to the M0 epic.
- If a spike's outcome contradicts the spec, update the spec section named in its Decision issue in the same docs PR.

### Task 5 (S1): Supabase Cron on the Free plan calling Vercel every minute

**Needs:** Task 1 deployed (`https://tapnshow.vercel.app` returns 200).

**Files:**
- Create: `docs/spikes/S1.md` (findings only)

- [ ] **Step 1: Create both Supabase projects** (Supabase dashboard, or the Supabase MCP after `authenticate`): `tapnshow-prod` and `tapnshow-preview`, Free plan, region **Central EU (Frankfurt) `eu-central-1`**. Record both project refs in a password manager; database passwords never go in the repo.

- [ ] **Step 2: Check extension availability** (SQL editor of `tapnshow-prod`):
```sql
select name, default_version, installed_version
from pg_available_extensions
where name in ('pg_cron', 'pg_net');
```
Expected: both rows present. If either is missing, skip to Step 6.

- [ ] **Step 3: Schedule a ping every minute**
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  's1-spike-ping',
  '* * * * *',
  $$ select net.http_get(url := 'https://tapnshow.vercel.app/') $$
);
```

- [ ] **Step 4: After at least 65 minutes, collect evidence**
```sql
with runs as (
  select start_time, status,
         start_time - lag(start_time) over (order by start_time) as gap
  from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 's1-spike-ping')
)
select count(*) as runs,
       count(*) filter (where status = 'succeeded') as succeeded,
       max(gap) as max_gap,
       avg(gap) as avg_gap
from runs;

select status_code, count(*) from net._http_response group by status_code;
```
Pass: `runs ≥ 60` within 65 min, `max_gap ≤ 00:02:00`, ≥ 95 % of responses `200`.

- [ ] **Step 5: Clean up**
```sql
select cron.unschedule('s1-spike-ping');
```

- [ ] **Step 6 (only if Step 2 or Step 4 failed): evaluate the GitHub Actions fallback** — scheduled workflows only run from the default branch, and `main` is protected, so evaluate from documentation rather than a live run: open `https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule`, quote the minimum interval and the note about delays during high load into the findings, and state whether a dispatcher running at that cadence still meets spec §8 (invites start within seconds via `after()`; only reminders and retries depend on the scheduler).

- [ ] **Step 7: Write `docs/spikes/S1.md`** with: date, project ref (not secrets), the two SQL result tables pasted verbatim, pass/fail per criterion, and the decision ("Dispatcher scheduled by Supabase Cron every minute" or "fallback: …"). Open a **Decision** issue "S1: dispatcher scheduler" with the same content. Merge the docs PR.

### Task 6 (S2): `.ics` `REQUEST` vs `PUBLISH` across Gmail, Outlook and Apple Calendar

**Needs:** a dedicated platform Gmail account with 2-Step Verification and an **App password** (user creates it; suggested name `tapnshow.app@gmail.com` or the closest available). Test inboxes: one Gmail, one Outlook.com, one iCloud (create free accounts if missing).

**Files (spike branch only):**
- Create: `spikes/s2-ics/send-variants.ts`, `spikes/s2-ics/.env` (gitignored by `.env*` rule — verify with `git check-ignore spikes/s2-ics/.env`)
- Create (docs branch): `docs/spikes/S2.md`

- [ ] **Step 1: Install spike-only deps** (on the spike branch): `bun add -D nodemailer @types/nodemailer ics`

- [ ] **Step 2: Write the sender** — `spikes/s2-ics/send-variants.ts`:
```ts
import { createEvent, type EventAttributes } from "ics";
import nodemailer from "nodemailer";

type Method = "REQUEST" | "PUBLISH" | "CANCEL";
type Step = "invite" | "update" | "cancel";

const user = process.env.S2_GMAIL_USER ?? "";
const pass = process.env.S2_GMAIL_APP_PASSWORD ?? "";
const recipients = (process.env.S2_RECIPIENTS ?? "").split(",").filter(Boolean);
const step = (process.argv[2] ?? "invite") as Step;

const base = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
base.setUTCMinutes(0, 0, 0);

function eventFor(uid: string, method: Method, sequence: number, hourShift: number): string {
  const start = new Date(base.getTime() + hourShift * 60 * 60 * 1000);
  const attrs: EventAttributes = {
    uid,
    method,
    sequence,
    status: method === "CANCEL" ? "CANCELLED" : "CONFIRMED",
    title: `S2 spike ${uid.split("@")[0]}`,
    description: "TapNShow calendar spike. Safe to ignore.",
    location: "ISSAT Sousse, Room B12",
    start: [start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), start.getUTCHours(), 0],
    startInputType: "utc",
    startOutputType: "utc",
    duration: { hours: 1, minutes: 30 },
    organizer: { name: "TapNShow Spike", email: user },
    attendees: recipients.map((email) => ({ email, rsvp: method === "REQUEST" })),
  };
  const { error, value } = createEvent(attrs);
  if (error || !value) throw error ?? new Error("ics generation failed");
  return value;
}

const plan: Record<Step, Array<{ uid: string; method: Method; sequence: number; shift: number }>> = {
  invite: [
    { uid: "s2-request@tapnshow.vercel.app", method: "REQUEST", sequence: 0, shift: 0 },
    { uid: "s2-publish@tapnshow.vercel.app", method: "PUBLISH", sequence: 0, shift: 0 },
  ],
  update: [
    { uid: "s2-request@tapnshow.vercel.app", method: "REQUEST", sequence: 1, shift: 1 },
    { uid: "s2-publish@tapnshow.vercel.app", method: "PUBLISH", sequence: 1, shift: 1 },
  ],
  cancel: [
    { uid: "s2-request@tapnshow.vercel.app", method: "CANCEL", sequence: 2, shift: 1 },
    { uid: "s2-publish@tapnshow.vercel.app", method: "CANCEL", sequence: 2, shift: 1 },
  ],
};

const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });

for (const variant of plan[step]) {
  const ics = eventFor(variant.uid, variant.method, variant.sequence, variant.shift);
  for (const to of recipients) {
    await transport.sendMail({
      from: `TapNShow Spike <${user}>`,
      to,
      subject: `[S2 ${step}] ${variant.method} ${variant.uid.split("@")[0]}`,
      text: `Variant ${variant.method}, sequence ${variant.sequence}.`,
      icalEvent: { method: variant.method, filename: "invite.ics", content: ics },
    });
    process.stdout.write(`sent ${step} ${variant.method} to ${to}\n`);
  }
}
```

- [ ] **Step 3: Run the three steps, observing each client between them**
```bash
cd spikes/s2-ics && set -a && . ./.env && set +a
bun send-variants.ts invite   # then inspect all 3 clients
bun send-variants.ts update   # then inspect
bun send-variants.ts cancel   # then inspect
```

- [ ] **Step 4: Record the observation matrix** in `docs/spikes/S2.md` — for each client × method, answer: invitation card shown? RSVP buttons shown? Auto-added to calendar without a click? One-click add available? Update moved the existing event (no duplicate)? Cancel removed the event? Attach one screenshot per client.

- [ ] **Step 5: Decide** — Pass criterion: the chosen method adds (or one-click adds), updates in place, and removes the event in all three clients, and does **not** show competing RSVP buttons. Record the decision (expected per spec hypothesis: `PUBLISH`; the evidence decides). Decision issue "S2: .ics method". If neither method passes, the decision is "calendar link + downloadable .ics only" (spec §13 fallback). Merge docs PR; update spec §9 if needed.

### Task 7 (S3): Search Console ownership of `tapnshow.vercel.app` as an OAuth authorized domain

**Needs:** Task 3 merged and deployed (verification meta hook).

**Files:**
- Create: `docs/spikes/S3.md`

- [ ] **Step 1:** In Google Search Console add a **URL-prefix** property `https://tapnshow.vercel.app/`, choose the **HTML tag** method, copy the `content` value.
- [ ] **Step 2:** Set it on Vercel Production and redeploy:
```bash
printf '<content value>' | bunx vercel@latest env add NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION production
bunx vercel@latest deploy --prod
curl -s https://tapnshow.vercel.app | grep -o '<meta name="google-site-verification"[^>]*>'
```
Expected: the meta tag is printed. Click **Verify** in Search Console; record the result.
- [ ] **Step 3:** In Google Cloud console create project **tapnshow** (no billing account). Open **Google Auth Platform → Branding**, set app name `TapNShow`, user support email, and add **Authorized domain** `tapnshow.vercel.app`. Record whether it is accepted or rejected and the exact message (screenshot).
- [ ] **Step 4:** Write `docs/spikes/S3.md` (property type, verification result, authorized-domain result, screenshots). Decision issue "S3: verification domain". Fail → spec §13 fallback (Gmail sending stays unverified with the 100-user cap). Merge docs PR.

### Task 8 (S4): Gmail API send from an unverified app

**Needs:** the Google Cloud project from S3. Runs ≥ 8 calendar days (token-lifetime check), in parallel with M1.

**Files (spike branch only):**
- Create: `spikes/s4-gmail/authorize.ts`, `spikes/s4-gmail/send.ts`, `spikes/s4-gmail/.env`
- Create (docs branch): `docs/spikes/S4.md`

- [ ] **Step 1: Configure Google Cloud** — enable **Gmail API**; Google Auth Platform → **Audience**: External, publishing status **Testing**, add your Gmail as test user; **Data Access**: add scope `https://www.googleapis.com/auth/gmail.send` and note the sensitivity label the console shows for it (screenshot); **Clients**: create OAuth client "Web application" with redirect URI `http://127.0.0.1:53682/callback`. Put client id/secret in `spikes/s4-gmail/.env` as `S4_CLIENT_ID`, `S4_CLIENT_SECRET`.

- [ ] **Step 2: Spike deps**: `bun add -D googleapis`

- [ ] **Step 3: `spikes/s4-gmail/authorize.ts`**
```ts
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { google } from "googleapis";

const REDIRECT = "http://127.0.0.1:53682/callback";
const client = new google.auth.OAuth2(process.env.S4_CLIENT_ID, process.env.S4_CLIENT_SECRET, REDIRECT);
const url = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/gmail.send"],
});
process.stdout.write(`Open this URL:\n${url}\n`);

const server = createServer(async (req, res) => {
  const code = new URL(req.url ?? "/", REDIRECT).searchParams.get("code");
  if (!code) {
    res.end("missing code");
    return;
  }
  const { tokens } = await client.getToken(code);
  writeFileSync(new URL("./.token.json", import.meta.url), JSON.stringify({ ...tokens, obtained_at: new Date().toISOString() }, null, 2));
  res.end("Authorized. You can close this tab.");
  server.close();
});
server.listen(53682, "127.0.0.1");
```

- [ ] **Step 4: `spikes/s4-gmail/send.ts`**
```ts
import { readFileSync } from "node:fs";
import { google } from "googleapis";

const tokens = JSON.parse(readFileSync(new URL("./.token.json", import.meta.url), "utf8")) as {
  refresh_token: string;
  obtained_at: string;
};
const client = new google.auth.OAuth2(process.env.S4_CLIENT_ID, process.env.S4_CLIENT_SECRET);
client.setCredentials({ refresh_token: tokens.refresh_token });

const to = process.env.S4_TO ?? "";
const raw = Buffer.from(
  [`To: ${to}`, "Subject: S4 spike", "Content-Type: text/plain; charset=UTF-8", "", `Sent at ${new Date().toISOString()}; token obtained ${tokens.obtained_at}`].join("\r\n"),
).toString("base64url");

const gmail = google.gmail({ version: "v1", auth: client });
const result = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
process.stdout.write(`sent id=${result.data.id}\n`);
```

- [ ] **Step 5: Day 0 run (Testing status)**
```bash
cd spikes/s4-gmail && set -a && . ./.env && set +a
bun authorize.ts   # complete consent in the browser; screenshot every screen
bun send.ts        # expect "sent id=..."
```
- [ ] **Step 6: Unverified "In production" run** — switch Audience publishing status to **In production**, delete `.token.json`, run `bun authorize.ts` again with a **second** Google account that is not a test user. Screenshot the "Google hasn't verified this app" screen and note the steps needed to continue; run `bun send.ts` with that token.
- [ ] **Step 7: Day 8 run** — re-run `bun send.ts` with each saved token (keep both token files, renamed `.token.testing.json` / `.token.production.json`, adjusting the path in `send.ts`). Record success or the exact error (e.g. `invalid_grant`).
- [ ] **Step 8: Daily limit** — read Google's official Gmail sending-limits and Gmail API usage-limits pages; quote the consumer-account daily recipient limit that applies to API sends, with URLs.
- [ ] **Step 9: Write `docs/spikes/S4.md`** (screenshots, scope sensitivity label, token results per status, quoted limits) and Decision issue "S4: organizer Gmail sending". Fail → fallback SMTP becomes the default sender (spec §13). Merge docs PR; update spec §8 quota figure with the quoted limit.

---

# Part B (continued) — M1 Foundation

### Task 9: Sentry error monitoring

**Files:**
- Create: `src/lib/observability/scrub.ts`, `src/lib/observability/scrub.test.ts`, `src/lib/observability/sentry-options.ts`, `src/lib/observability/sentry-options.test.ts`, `src/sentry.server.config.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/app/global-error.tsx`
- Modify: `next.config.ts`, `.env.example`

**Interfaces:**
- Consumes: `publicEnv.NEXT_PUBLIC_SENTRY_DSN` (Task 3).
- Produces: `scrubUrl(url: string): string`, `buildSentryOptions(input: { dsn?: string; environment: string }): SentryOptions` where `SentryOptions = { enabled: boolean; dsn?: string; environment: string; tracesSampleRate: number; sendDefaultPii: false; beforeSend: (event: ErrorEvent) => ErrorEvent }`.

- [ ] **Step 1: User setup** — create a free Sentry account, organization, and a `javascript-nextjs` project named `tapnshow`; create an auth token with `project:releases` and `org:read`. Store: `NEXT_PUBLIC_SENTRY_DSN` (Vercel Production + Preview, and `.env.local`), `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (Vercel build env only). Add the four names (empty) to `.env.example`.

- [ ] **Step 2: Failing tests** — `src/lib/observability/scrub.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { scrubUrl } from "./scrub";

describe("scrubUrl", () => {
  it("redacts personal-link tokens but keeps the query", () => {
    expect(scrubUrl("https://tapnshow.vercel.app/r/abc123XYZ?choice=late")).toBe(
      "https://tapnshow.vercel.app/r/[REDACTED]?choice=late",
    );
  });

  it("redacts relative token paths", () => {
    expect(scrubUrl("/r/abc123/")).toBe("/r/[REDACTED]/");
  });

  it("leaves other URLs untouched", () => {
    expect(scrubUrl("https://tapnshow.vercel.app/w/gdg/meetings")).toBe(
      "https://tapnshow.vercel.app/w/gdg/meetings",
    );
  });
});
```
`src/lib/observability/sentry-options.test.ts`:
```ts
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { buildSentryOptions } from "./sentry-options";

describe("buildSentryOptions", () => {
  it("is disabled without a DSN", () => {
    expect(buildSentryOptions({ environment: "test" }).enabled).toBe(false);
  });

  it("is enabled with a DSN and never sends PII", () => {
    const options = buildSentryOptions({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "production" });
    expect(options.enabled).toBe(true);
    expect(options.sendDefaultPii).toBe(false);
  });

  it("scrubs token URLs from events", () => {
    const options = buildSentryOptions({ environment: "test" });
    const event = { type: undefined, request: { url: "https://x.app/r/secret-token" } } as ErrorEvent;
    expect(options.beforeSend(event).request?.url).toBe("https://x.app/r/[REDACTED]");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**: `CI=true bun run test src/lib/observability`

- [ ] **Step 4: Implement** — `bun add @sentry/nextjs@^11`

`src/lib/observability/scrub.ts`:
```ts
const PERSONAL_LINK = /\/r\/[^/?#]+/g;

/**
 * Replaces personal response-link tokens (`/r/<token>`) with a placeholder so they never
 * reach logs or error reports.
 */
export function scrubUrl(url: string): string {
  return url.replace(PERSONAL_LINK, "/r/[REDACTED]");
}
```
`src/lib/observability/sentry-options.ts`:
```ts
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubUrl } from "./scrub";

/** Sample rate for performance traces (free tier friendly). */
export const TRACES_SAMPLE_RATE = 0.1;

/** The subset of Sentry init options TapNShow controls. */
export type SentryOptions = {
  enabled: boolean;
  dsn?: string;
  environment: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  beforeSend: (event: ErrorEvent) => ErrorEvent;
};

/**
 * Builds Sentry options shared by server and client init.
 * Disabled when no DSN is configured (local dev, CI).
 */
export function buildSentryOptions(input: { dsn?: string; environment: string }): SentryOptions {
  return {
    enabled: Boolean(input.dsn),
    dsn: input.dsn,
    environment: input.environment,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: (event) => {
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      return event;
    },
  };
}
```
`src/sentry.server.config.ts`:
```ts
import * as Sentry from "@sentry/nextjs";
import { publicEnv } from "@/config/public-env";
import { buildSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(
  buildSentryOptions({
    dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
  }),
);
```
`src/instrumentation.ts`:
```ts
import * as Sentry from "@sentry/nextjs";

/** Registers server-side instrumentation (Node.js runtime only; Edge is not used). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

/** Reports errors thrown while handling requests. */
export const onRequestError = Sentry.captureRequestError;
```
`src/instrumentation-client.ts`:
```ts
import * as Sentry from "@sentry/nextjs";
import { publicEnv } from "@/config/public-env";
import { buildSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(
  buildSentryOptions({
    dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  }),
);

/** Lets Sentry trace client-side navigations. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```
`src/app/global-error.tsx`:
```tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort error boundary; reports to Sentry and shows a minimal page. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center p-4">
        <p>Something went wrong. Please reload the page.</p>
      </body>
    </html>
  );
}
```
(This one string is outside the i18n provider by necessity; Task 10 replaces it with a message from `messages/en.json`.)

`next.config.ts`:
```ts
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
```
(If Task 4 added `serverExternalPackages`, keep it inside `nextConfig`.)

- [ ] **Step 5: Run tests and build**

Run: `CI=true bun run test src/lib/observability && bun run typecheck && bun run build`
Expected: PASS; build succeeds without Sentry env (upload skipped).

- [ ] **Step 6: Prove it reports** — on this branch only, create `src/app/api/debug/sentry/route.ts`:
```ts
/** Temporary wiring check — delete before merging. */
export function GET(): never {
  throw new Error("Sentry wiring check");
}
```
Push, open `<preview-url>/api/debug/sentry`, and confirm an issue "Sentry wiring check" appears in Sentry with environment `preview`. Then `git rm src/app/api/debug/sentry/route.ts` and commit before merging.

- [ ] **Step 7: Commit, PR, merge**
```bash
git add -A && git commit -m "feat: add Sentry error monitoring with token scrubbing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Internationalization (next-intl, English only, i18n-ready)

**Files:**
- Create: `messages/en.json`, `src/config/i18n.ts`, `src/config/i18n.test.ts`, `src/i18n/request.ts`, `src/i18n/global.d.ts`, `src/test/render.tsx`, `src/app/page.test.tsx`
- Modify: `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/global-error.tsx`

**Interfaces:**
- Produces: `SUPPORTED_LOCALES = ["en"] as const`, `type Locale`, `DEFAULT_LOCALE: Locale`, `resolveLocale(candidate: string | null | undefined): Locale`; `renderWithProviders(ui: ReactElement): RenderResult` from `@/test/render`.

- [ ] **Step 1: Failing tests** — `src/config/i18n.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, resolveLocale } from "./i18n";

describe("resolveLocale", () => {
  it("returns a supported locale unchanged", () => {
    expect(resolveLocale("en")).toBe("en");
  });

  it("falls back to the default for unsupported or missing values", () => {
    expect(resolveLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });
});
```
`src/app/page.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the translated product name heading", () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("TapNShow");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**: `CI=true bun run test src/config/i18n src/app/page`

- [ ] **Step 3: Implement** — `bun add next-intl@^4`

`messages/en.json`:
```json
{
  "Home": {
    "title": "{appName}"
  },
  "Errors": {
    "global": "Something went wrong. Please reload the page."
  }
}
```
`src/config/i18n.ts`:
```ts
/** Locales with complete translations. Add "fr"/"ar" here when their messages exist. */
export const SUPPORTED_LOCALES = ["en"] as const;

/** A supported locale code. */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locale used when no supported preference is known. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Maps a stored preference (user or workspace setting) to a supported locale.
 * @param candidate - locale code from settings, possibly unsupported or missing
 */
export function resolveLocale(candidate: string | null | undefined): Locale {
  return SUPPORTED_LOCALES.find((locale) => locale === candidate) ?? DEFAULT_LOCALE;
}
```
`src/i18n/request.ts`:
```ts
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE } from "@/config/i18n";

/** Locale is not in the URL; it will come from user/workspace settings starting in M2. */
export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```
`src/i18n/global.d.ts`:
```ts
import type messages from "../../messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
```
`src/test/render.tsx`:
```tsx
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../messages/en.json";
import { DEFAULT_LOCALE } from "@/config/i18n";

/** Renders a component inside the same providers the app uses (i18n; theme added in Task 11). */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}
```
`src/app/page.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { APP_NAME } from "@/config/app";

/** Temporary landing placeholder until the M9 landing page exists. */
export default function HomePage() {
  const t = useTranslations("Home");
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <h1 className="text-4xl font-bold">{t("title", { appName: APP_NAME })}</h1>
    </main>
  );
}
```
`next.config.ts` — wrap with the plugin inside Sentry:
```ts
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {};
const withNextIntl = createNextIntlPlugin();

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
```
`src/app/layout.tsx` — make the root layout async, wrap children, set `lang`:
```tsx
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
// ...existing imports
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```
(Remove the scaffold's Geist font imports here; Task 11 adds the real fonts.)

`src/app/global-error.tsx` — replace the literal paragraph:
```tsx
import messages from "../../messages/en.json";
// ...
<p>{messages.Errors.global}</p>
```

- [ ] **Step 4: Run — expect PASS**: `CI=true bun run test && bun run typecheck && bun run build`

- [ ] **Step 5: Commit, PR, merge**
```bash
git add -A && git commit -m "feat: add next-intl with typed English messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Design tokens, fonts, and light/dark theming

**Files:**
- Create: `src/design/tokens.ts`, `src/design/contrast.ts`, `src/design/contrast.test.ts`, `src/design/tokens.test.ts`, `src/design/render-tokens-css.ts`, `src/design/render-tokens-css.test.ts`, `scripts/generate-tokens-css.ts`, `src/app/tokens.css` (generated), `src/app/fonts.ts`, `src/components/theme/theme-provider.tsx`, `src/components/theme/theme-toggle.tsx`, `src/components/theme/theme-toggle.test.tsx`, `components.json` (shadcn)
- Modify: `src/app/globals.css` (rewrite), `src/app/layout.tsx`, `src/test/render.tsx`, `messages/en.json`, `package.json` (script `tokens`)

**Interfaces:**
- Produces:
  - `THEMES = ["light", "dark"] as const`, `type ThemeName`, `FILL_TONES = ["primary","success","warning","danger","info","neutral"] as const`, `type FillTone`, `palette: Record<ThemeName, ThemeColors>` where `ThemeColors = { background; surface; ink; muted; outline; onFill } & Record<FillTone, string>` (all hex strings), `shape = { borderWidth: "2.5px", radiusSticker: "10px", radiusControl: "16px", radiusCard: "20px", shadowSm: "2px", shadow: "4px", shadowLg: "6px" }`, `EASE_SPRING_CSS = "cubic-bezier(0.34, 1.56, 0.64, 1)"`.
  - `contrastRatio(foreground: string, background: string): number`.
  - `renderTokensCss(): string`.
  - Tailwind utilities from `@theme`: `bg-background`, `bg-surface`, `text-ink`, `text-muted-ink`, `border-outline`, `text-on-fill`, `bg-fill-{primary|success|warning|danger|info|neutral}`, `shadow-brutal-sm|brutal|brutal-lg`, `rounded-sticker|control|card`, `font-display`, `font-sans`, `ease-spring`.
  - `<ThemeProvider>`, `<ThemeToggle>` (cycles system → light → dark; `aria-label` from `Theme.toggle`).

- [ ] **Step 1: Initialize shadcn (Radix base, Phosphor icons)**
```bash
bunx shadcn@4.21.1 init -b radix -p lyra --no-monorepo --no-rtl -y
grep '"iconLibrary": "phosphor"' components.json
```
Expected: the grep prints the line; `@phosphor-icons/react`, `radix-ui`, `class-variance-authority`, `cn`, `tw-animate-css` are now dependencies; `src/lib/utils.ts` exists. shadcn rewrote `globals.css` and may have changed fonts in `layout.tsx` — both are overwritten in later steps.

- [ ] **Step 2: Failing tests** — `src/design/contrast.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("is 1 for identical colors", () => {
    expect(contrastRatio("#C4B5FD", "#C4B5FD")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1E1B2E", "#FDE68A")).toBeCloseTo(contrastRatio("#FDE68A", "#1E1B2E"), 5);
  });
});
```
`src/design/tokens.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { FILL_TONES, THEMES, palette } from "./tokens";

const AA = 4.5;

describe.each(THEMES)("%s theme contrast (WCAG AA)", (theme) => {
  const colors = palette[theme];

  it.each(["background", "surface"] as const)("ink on %s", (bg) => {
    expect(contrastRatio(colors.ink, colors[bg])).toBeGreaterThanOrEqual(AA);
  });

  it.each(["background", "surface"] as const)("muted ink on %s", (bg) => {
    expect(contrastRatio(colors.muted, colors[bg])).toBeGreaterThanOrEqual(AA);
  });

  it.each(FILL_TONES)("on-fill text on %s fill", (tone) => {
    expect(contrastRatio(colors.onFill, colors[tone])).toBeGreaterThanOrEqual(AA);
  });

  it("outline is visible against the background (non-text, 3:1)", () => {
    expect(contrastRatio(colors.outline, colors.background)).toBeGreaterThanOrEqual(3);
  });
});
```
`src/design/render-tokens-css.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "./render-tokens-css";
import { FILL_TONES, palette } from "./tokens";

describe("renderTokensCss", () => {
  const css = renderTokensCss();

  it("declares every light and dark color", () => {
    for (const tone of FILL_TONES) {
      expect(css).toContain(`--tn-fill-${tone}: ${palette.light[tone]};`);
      expect(css).toContain(`--tn-fill-${tone}: ${palette.dark[tone]};`);
    }
  });

  it("has a dark block for data-theme and a no-JS system fallback", () => {
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("matches the committed src/app/tokens.css (run `bun run tokens` after editing tokens.ts)", () => {
    expect(readFileSync("src/app/tokens.css", "utf8")).toBe(css);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**: `CI=true bun run test src/design`

- [ ] **Step 4: Implement tokens and contrast**

`src/design/tokens.ts`:
```ts
/** Theme names supported by the design system. */
export const THEMES = ["light", "dark"] as const;
export type ThemeName = (typeof THEMES)[number];

/** Pastel fill tones used by buttons, stickers, chips and status badges. */
export const FILL_TONES = ["primary", "success", "warning", "danger", "info", "neutral"] as const;
export type FillTone = (typeof FILL_TONES)[number];

/** Every color a theme must define (hex). `onFill` is the text color on any pastel fill. */
export type ThemeColors = {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  outline: string;
  onFill: string;
} & Record<FillTone, string>;

/** Soft Neobrutalism palette. Fills stay light in dark mode so dark ink remains readable. */
export const palette: Record<ThemeName, ThemeColors> = {
  light: {
    background: "#F3EEFF",
    surface: "#FFFFFF",
    ink: "#1E1B2E",
    muted: "#5B5670",
    outline: "#1E1B2E",
    onFill: "#1E1B2E",
    primary: "#C4B5FD",
    success: "#BBF7D0",
    warning: "#FDE68A",
    danger: "#FECACA",
    info: "#BAE6FD",
    neutral: "#E5E7EB",
  },
  dark: {
    background: "#16131F",
    surface: "#221E30",
    ink: "#F4F1FF",
    muted: "#B7B0CC",
    outline: "#F4F1FF",
    onFill: "#1E1B2E",
    primary: "#C4B5FD",
    success: "#86EFAC",
    warning: "#FCD34D",
    danger: "#FCA5A5",
    info: "#7DD3FC",
    neutral: "#CBD5E1",
  },
};

/** Shape tokens: thick outlines, rounded corners, hard downward shadows. */
export const shape = {
  borderWidth: "2.5px",
  radiusSticker: "10px",
  radiusControl: "16px",
  radiusCard: "20px",
  shadowSm: "2px",
  shadow: "4px",
  shadowLg: "6px",
} as const;

/** Overshooting spring curve for CSS transitions (matches the Expressive motion style). */
export const EASE_SPRING_CSS = "cubic-bezier(0.34, 1.56, 0.64, 1)";
```
`src/design/contrast.ts`:
```ts
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#RRGGBB` color. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colors (1–21). */
export function contrastRatio(foreground: string, background: string): number {
  const [hi, lo] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
```
`src/design/render-tokens-css.ts`:
```ts
import { EASE_SPRING_CSS, FILL_TONES, palette, shape, type ThemeColors } from "./tokens";

function colorVars(colors: ThemeColors, indent: string): string {
  const base = [
    ["background", colors.background],
    ["surface", colors.surface],
    ["ink", colors.ink],
    ["muted", colors.muted],
    ["outline", colors.outline],
    ["on-fill", colors.onFill],
  ];
  const fills = FILL_TONES.map((tone) => [`fill-${tone}`, colors[tone]]);
  return [...base, ...fills].map(([name, value]) => `${indent}--tn-${name}: ${value};`).join("\n");
}

const shapeVars = [
  `  --tn-border-width: ${shape.borderWidth};`,
  `  --tn-radius-sticker: ${shape.radiusSticker};`,
  `  --tn-radius-control: ${shape.radiusControl};`,
  `  --tn-radius-card: ${shape.radiusCard};`,
  `  --tn-shadow-sm: ${shape.shadowSm};`,
  `  --tn-shadow: ${shape.shadow};`,
  `  --tn-shadow-lg: ${shape.shadowLg};`,
  `  --tn-ease-spring: ${EASE_SPRING_CSS};`,
].join("\n");

/**
 * Renders `src/app/tokens.css` from `tokens.ts` (single source of truth).
 * Run `bun run tokens` to regenerate after editing tokens.
 */
export function renderTokensCss(): string {
  return `/* Generated by scripts/generate-tokens-css.ts — do not edit by hand. */
:root,
[data-theme="light"] {
${colorVars(palette.light, "  ")}
${shapeVars}
  color-scheme: light;
}

[data-theme="dark"] {
${colorVars(palette.dark, "  ")}
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${colorVars(palette.dark, "    ")}
    color-scheme: dark;
  }
}
`;
}
```
`scripts/generate-tokens-css.ts`:
```ts
import { writeFileSync } from "node:fs";
import { renderTokensCss } from "../src/design/render-tokens-css";

writeFileSync("src/app/tokens.css", renderTokensCss());
process.stdout.write("wrote src/app/tokens.css\n");
```
Add script `"tokens": "bun scripts/generate-tokens-css.ts"`, then run `bun run tokens`. Add `src/app/tokens.css` to `.prettierignore` (generated).

- [ ] **Step 5: Run — expect PASS**: `CI=true bun run test src/design`. If a contrast test fails, adjust that hex in `tokens.ts`, re-run `bun run tokens`, and re-test — never lower the threshold.

- [ ] **Step 6: Rewrite `src/app/globals.css`**
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "./tokens.css";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme inline {
  --color-background: var(--tn-background);
  --color-surface: var(--tn-surface);
  --color-ink: var(--tn-ink);
  --color-muted-ink: var(--tn-muted);
  --color-outline: var(--tn-outline);
  --color-on-fill: var(--tn-on-fill);
  --color-fill-primary: var(--tn-fill-primary);
  --color-fill-success: var(--tn-fill-success);
  --color-fill-warning: var(--tn-fill-warning);
  --color-fill-danger: var(--tn-fill-danger);
  --color-fill-info: var(--tn-fill-info);
  --color-fill-neutral: var(--tn-fill-neutral);

  /* shadcn semantic aliases so future Radix components follow our tokens */
  --color-foreground: var(--tn-ink);
  --color-card: var(--tn-surface);
  --color-card-foreground: var(--tn-ink);
  --color-popover: var(--tn-surface);
  --color-popover-foreground: var(--tn-ink);
  --color-primary: var(--tn-fill-primary);
  --color-primary-foreground: var(--tn-on-fill);
  --color-secondary: var(--tn-fill-neutral);
  --color-secondary-foreground: var(--tn-on-fill);
  --color-muted: var(--tn-fill-neutral);
  --color-muted-foreground: var(--tn-muted);
  --color-accent: var(--tn-fill-info);
  --color-accent-foreground: var(--tn-on-fill);
  --color-destructive: var(--tn-fill-danger);
  --color-border: var(--tn-outline);
  --color-input: var(--tn-outline);
  --color-ring: var(--tn-outline);

  --radius-sticker: var(--tn-radius-sticker);
  --radius-control: var(--tn-radius-control);
  --radius-card: var(--tn-radius-card);

  --shadow-brutal-sm: 0 var(--tn-shadow-sm) 0 var(--tn-outline);
  --shadow-brutal: 0 var(--tn-shadow) 0 var(--tn-outline);
  --shadow-brutal-lg: 0 var(--tn-shadow-lg) 0 var(--tn-outline);

  --ease-spring: var(--tn-ease-spring);

  --font-sans: var(--font-space-grotesk);
  --font-display: var(--font-archivo-black);
}

@layer base {
  * {
    border-color: var(--tn-outline);
  }
  html {
    background-color: var(--tn-background);
    color: var(--tn-ink);
  }
  body {
    @apply bg-background font-sans text-ink;
  }
  :focus-visible {
    outline: 3px solid var(--tn-outline);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 7: Fonts** — `src/app/fonts.ts`:
```ts
import { Archivo_Black, Space_Grotesk } from "next/font/google";

/** Display font for headings (Neobrutalist weight). */
export const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-archivo-black",
  display: "swap",
});

/** Body font. */
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});
```

- [ ] **Step 8: Theme provider and toggle** — `bun add next-themes@^0.4.6`

Add to `messages/en.json`:
```json
"Theme": {
  "toggle": "Color theme: {mode}. Activate to switch.",
  "system": "system",
  "light": "light",
  "dark": "dark"
}
```
`src/components/theme/theme-provider.tsx`:
```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/** Applies `data-theme` on <html> before paint (no flash) and follows the OS by default. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
```
Failing test first — `src/components/theme/theme-toggle.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  it("cycles system -> light -> dark -> system and updates its label", async () => {
    renderWithProviders(<ThemeToggle />);
    const button = await screen.findByRole("button", { name: /color theme: system/i });
    await userEvent.click(button);
    expect(await screen.findByRole("button", { name: /color theme: light/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("button", { name: /color theme: dark/i })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("button", { name: /color theme: system/i })).toBeInTheDocument();
  });
});
```
Update `src/test/render.tsx` to also wrap in `<ThemeProvider>`:
```tsx
import { ThemeProvider } from "@/components/theme/theme-provider";
// ...
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <ThemeProvider>{ui}</ThemeProvider>
    </NextIntlClientProvider>
```
Run: `CI=true bun run test src/components/theme` → FAIL (`./theme-toggle` missing).

`src/components/theme/theme-toggle.tsx`:
```tsx
"use client";

import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const ORDER = ["system", "light", "dark"] as const;
type Mode = (typeof ORDER)[number];

const ICONS: Record<Mode, typeof SunIcon> = { system: DesktopIcon, light: SunIcon, dark: MoonIcon };

function isMode(value: string | undefined): value is Mode {
  return ORDER.some((mode) => mode === value);
}

/** Cycles the color theme: system -> light -> dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("Theme");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current: Mode = mounted && isMode(theme) ? theme : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = ICONS[current];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={t("toggle", { mode: t(current) })}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface text-ink shadow-brutal transition-transform ease-spring active:translate-y-1 active:shadow-none motion-reduce:transition-none",
        className,
      )}
    >
      <Icon weight="bold" size={20} aria-hidden />
    </button>
  );
}
```
Verify the icon export names exist before running: `grep -o 'DesktopIcon\|SunIcon\|MoonIcon' node_modules/@phosphor-icons/react/dist/index.d.ts | sort -u` → three names. (If the package exports `Desktop`/`Sun`/`Moon` without the `Icon` suffix, use those.)

Run: `CI=true bun run test src/components/theme` → PASS.

- [ ] **Step 9: Wire the layout** — `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { publicEnv } from "@/config/public-env";
import { archivoBlack, spaceGrotesk } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  verification: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

/** Root layout: fonts, theme (no-flash), and i18n providers. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning className={`${archivoBlack.variable} ${spaceGrotesk.variable} h-full antialiased`}>
      <body className="min-h-full">
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```
Give the home heading the display font: in `src/app/page.tsx` change the `h1` class to `"font-display text-4xl"`.

- [ ] **Step 10: Verify and commit**

Run: `bun run lint && bun run typecheck && CI=true bun run test && bun run build && bun run test:e2e` → all pass.
```bash
git add -A && git commit -m "feat: add Soft Neobrutalism design tokens, fonts and theme toggle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `Sticker` and `Button`

**Files:**
- Create: `src/components/ui/sticker.tsx`, `src/components/ui/sticker.test.tsx`, `src/components/ui/button.test.tsx`
- Modify/replace: `src/components/ui/button.tsx` (from `bunx shadcn@4.21.1 add button`, then rewritten)

**Interfaces:**
- Consumes: Tailwind token utilities, `FillTone` (Task 11).
- Produces:
  - `type StickerTone = FillTone | "surface"`; `<Sticker tone?: StickerTone size?: "sm" | "md" label?: string>{icon}</Sticker>` — decorative (`aria-hidden`) unless `label` is given (then `role="img"` + `aria-label`).
  - `<Button tone?: FillTone | "surface" size?: "md" | "lg" asChild?: boolean ...ButtonHTMLAttributes>`; renders `data-tone` and `data-size` attributes; `buttonVariants` cva export.

- [ ] **Step 1: Add shadcn button (to keep Radix `Slot` wiring)**: `bunx shadcn@4.21.1 add button -y`

- [ ] **Step 2: Failing tests** — `src/components/ui/sticker.test.tsx`:
```tsx
import { CheckIcon } from "@phosphor-icons/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sticker } from "./sticker";

describe("Sticker", () => {
  it("is decorative by default", () => {
    const { container } = render(
      <Sticker tone="success">
        <CheckIcon weight="bold" />
      </Sticker>,
    );
    const el = container.firstElementChild;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("data-tone", "success");
  });

  it("is an accessible image when labelled", () => {
    render(
      <Sticker tone="info" label="Location">
        <CheckIcon weight="bold" />
      </Sticker>,
    );
    expect(screen.getByRole("img", { name: "Location" })).toBeInTheDocument();
  });
});
```
`src/components/ui/button.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders a button with its tone and size", () => {
    render(<Button tone="warning" size="lg">I'll be late</Button>);
    const button = screen.getByRole("button", { name: "I'll be late" });
    expect(button).toHaveAttribute("data-tone", "warning");
    expect(button).toHaveAttribute("data-size", "lg");
    expect(button).toHaveAttribute("type", "button");
  });

  it("defaults to the surface tone and md size", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-tone", "surface");
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "md");
  });

  it("calls onClick and ignores clicks when disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} disabled>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders its child element when asChild is set", () => {
    render(
      <Button asChild tone="primary">
        <a href="/w/demo">Open</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("data-tone", "primary");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**: `CI=true bun run test src/components/ui`

- [ ] **Step 4: Implement** — `src/components/ui/sticker.tsx`:
```tsx
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Sticker background tones: any pastel fill, or the plain surface. */
const stickerVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-sticker border-2 border-outline text-on-fill shadow-brutal-sm [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        surface: "bg-surface text-ink",
        primary: "bg-fill-primary",
        success: "bg-fill-success",
        warning: "bg-fill-warning",
        danger: "bg-fill-danger",
        info: "bg-fill-info",
        neutral: "bg-fill-neutral",
      },
      size: {
        sm: "size-7 [&_svg]:size-4",
        md: "size-8 [&_svg]:size-[18px]",
      },
    },
    defaultVariants: { tone: "surface", size: "md" },
  },
);

/** Tone accepted by `<Sticker>`. */
export type StickerTone = NonNullable<VariantProps<typeof stickerVariants>["tone"]>;

/**
 * Outlined pastel tile that frames a Phosphor icon (the app's emoji replacement).
 * Decorative unless `label` is provided.
 */
export function Sticker({
  tone = "surface",
  size = "md",
  label,
  className,
  children,
}: {
  tone?: StickerTone;
  size?: "sm" | "md";
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(stickerVariants({ tone, size }), className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {children}
    </span>
  );
}
```
`src/components/ui/button.tsx` (replace the shadcn file entirely):
```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Pressable Neobrutalist button: thick outline, hard shadow that collapses on press,
 * springy hover tilt. All motion is disabled for reduced-motion users.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-between gap-3 rounded-control border-[length:var(--tn-border-width)] border-outline px-4 font-bold text-on-fill shadow-brutal transition-[transform,box-shadow] duration-300 ease-spring select-none hover:-translate-y-0.5 hover:-rotate-[1.5deg] hover:shadow-brutal-lg active:translate-y-1 active:rotate-0 active:shadow-none active:duration-75 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:rotate-0",
  {
    variants: {
      tone: {
        surface: "bg-surface text-ink",
        primary: "bg-fill-primary",
        success: "bg-fill-success",
        warning: "bg-fill-warning",
        danger: "bg-fill-danger",
        info: "bg-fill-info",
        neutral: "bg-fill-neutral",
      },
      size: {
        md: "min-h-11 text-sm",
        lg: "min-h-12 w-full text-base",
      },
    },
    defaultVariants: { tone: "surface", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element (e.g. a link) with button styling. */
    asChild?: boolean;
  };

/** The app's primary interactive control. Defaults to `type="button"`. */
export function Button({ tone = "surface", size = "md", asChild = false, className, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      data-tone={tone}
      data-size={size}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ tone, size }), className)}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Run — expect PASS**: `CI=true bun run test src/components/ui && bun run typecheck`

- [ ] **Step 6: Commit, PR, merge**
```bash
git add -A && git commit -m "feat: add Sticker and pressable Neobrutalist Button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `Card`, `Chip`, `Input`

**Files:**
- Create: `src/components/ui/card.tsx`, `src/components/ui/chip.tsx`, `src/components/ui/input.tsx`, and a `.test.tsx` next to each

**Interfaces:**
- Produces:
  - `<Card as?: "div" | "section" | "article" className children>` — surface, outline, `rounded-card`, `shadow-brutal`, `p-4`.
  - `<Chip pressed: boolean onPressedChange: (pressed: boolean) => void tone?: FillTone>` — toggle button with `aria-pressed`; selected chips use their tone fill, unselected use surface.
  - `<Input id label error? hint? ...InputHTMLAttributes>` — renders `<label for>`, sets `aria-invalid` and `aria-describedby` (pointing to hint/error ids) when relevant.

- [ ] **Step 1: Failing tests**

`src/components/ui/card.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./card";

describe("Card", () => {
  it("renders as a div by default and as the requested element", () => {
    const { rerender } = render(<Card>Body</Card>);
    expect(screen.getByText("Body").tagName).toBe("DIV");
    rerender(<Card as="section" aria-label="Meeting">Body</Card>);
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
  });
});
```
`src/components/ui/chip.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Chip } from "./chip";

function Harness() {
  const [pressed, setPressed] = useState(false);
  return (
    <Chip tone="warning" pressed={pressed} onPressedChange={setPressed}>
      10-20 min
    </Chip>
  );
}

describe("Chip", () => {
  it("toggles aria-pressed", async () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "10-20 min" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });
});
```
`src/components/ui/input.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("is labelled", () => {
    render(<Input id="reason" label="Reason for delay" />);
    expect(screen.getByLabelText("Reason for delay")).toBeInTheDocument();
  });

  it("links the hint", () => {
    render(<Input id="reason" label="Reason" hint="Visible to organizers" />);
    expect(screen.getByLabelText("Reason")).toHaveAccessibleDescription("Visible to organizers");
  });

  it("marks errors as invalid and describes them", () => {
    render(<Input id="reason" label="Reason" error="Please enter a reason" />);
    const input = screen.getByLabelText("Reason");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Please enter a reason");
  });
});
```
Run: `CI=true bun run test src/components/ui` → FAIL.

- [ ] **Step 2: Implement**

`src/components/ui/card.tsx`:
```tsx
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Outlined surface container with the hard Neobrutalist shadow. */
export function Card({
  as: Component = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" }) {
  return (
    <Component
      className={cn(
        "rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-4 text-ink shadow-brutal",
        className,
      )}
      {...props}
    />
  );
}
```
`src/components/ui/chip.tsx`:
```tsx
"use client";

import type { ReactNode } from "react";
import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";

const PRESSED_FILL: Record<FillTone, string> = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
};

/** Pill-shaped toggle (e.g. delay options). Selected chips take their tone's fill. */
export function Chip({
  pressed,
  onPressedChange,
  tone = "primary",
  className,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  tone?: FillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-outline px-4 text-sm font-bold shadow-brutal-sm transition-transform duration-300 ease-spring active:translate-y-0.5 active:shadow-none motion-reduce:transition-none",
        pressed ? cn(PRESSED_FILL[tone], "text-on-fill") : "bg-surface text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
```
`src/components/ui/input.tsx`:
```tsx
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

/** Labelled text input with accessible hint and error wiring. */
export function Input({ id, label, hint, error, className, ...props }: InputProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-11 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-base text-ink shadow-brutal-sm placeholder:text-muted-ink aria-invalid:bg-fill-danger aria-invalid:text-on-fill",
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
(`text-base` on the input prevents iOS Safari from zooming on focus.)

- [ ] **Step 3: Run — expect PASS**: `CI=true bun run test src/components/ui && bun run typecheck`

- [ ] **Step 4: Commit, PR, merge**
```bash
git add -A && git commit -m "feat: add Card, Chip and Input components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Motion tokens and primitives

**Files:**
- Create: `src/design/motion.ts`, `src/components/motion/use-prefers-reduced-motion.ts`, `src/components/motion/motion-provider.tsx`, `src/components/motion/stagger.tsx`, `src/components/motion/confirm-stamp.tsx`, `src/components/motion/confirm-stamp.test.tsx`
- Modify: `src/app/layout.tsx` (add `MotionProvider`), `src/test/render.tsx`, `messages/en.json`

**Interfaces:**
- Produces:
  - `springs = { press, pop, enter, stamp }` (motion `Transition` objects), `STAGGER_SECONDS = 0.07`, `CONFETTI_PIECES: ReadonlyArray<{ x: number; y: number; rotate: number; tone: FillTone }>` (6 entries).
  - `usePrefersReducedMotion(): boolean` — live `matchMedia("(prefers-reduced-motion: reduce)")` via `useSyncExternalStore` (server snapshot `false`). Used instead of motion's `useReducedMotion`, which caches its first reading process-wide and makes tests order-dependent.
  - `<MotionProvider>` (wraps `MotionConfig reducedMotion="user"`).
  - `<Stagger>` / `<StaggerItem>` — children rise in one after another.
  - `<ConfirmStamp label: string show: boolean>` — renders the stamp; when motion is allowed and `show` is true, plays slam + shake + confetti; pieces carry `data-testid="confetti-piece"`; with reduced motion renders the stamp statically and **no** confetti.

- [ ] **Step 1: Install**: `bun add motion@^14` and read `node_modules/motion/package.json` `"exports"` to confirm the `"./react"` entry (`import { motion } from "motion/react"`).

- [ ] **Step 2: Failing test** — `src/components/motion/confirm-stamp.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setReducedMotion } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import { ConfirmStamp } from "./confirm-stamp";

describe("ConfirmStamp", () => {
  it("renders the stamp with confetti when motion is allowed", () => {
    renderWithProviders(<ConfirmStamp label="Confirmed" show />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getAllByTestId("confetti-piece")).toHaveLength(6);
  });

  it("renders the stamp instantly without confetti for reduced-motion users", () => {
    setReducedMotion(true);
    renderWithProviders(<ConfirmStamp label="Confirmed" show />);
    expect(screen.getByText("Confirmed")).toBeVisible();
    expect(screen.queryAllByTestId("confetti-piece")).toHaveLength(0);
  });

  it("renders nothing when hidden", () => {
    renderWithProviders(<ConfirmStamp label="Confirmed" show={false} />);
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });
});
```
Run: `CI=true bun run test src/components/motion` → FAIL.

- [ ] **Step 3: Implement**

`src/design/motion.ts`:
```ts
import type { Transition } from "motion/react";
import type { FillTone } from "./tokens";

/** Spring presets for the Expressive motion style. */
export const springs = {
  press: { type: "spring", stiffness: 600, damping: 30 },
  pop: { type: "spring", stiffness: 500, damping: 18 },
  enter: { type: "spring", stiffness: 260, damping: 20 },
  stamp: { type: "spring", stiffness: 420, damping: 14 },
} as const satisfies Record<string, Transition>;

/** Delay between siblings in staggered entrances, in seconds. */
export const STAGGER_SECONDS = 0.07;

/** Confetti burst layout: offsets (px), rotation (deg), and fill tone per piece. */
export const CONFETTI_PIECES: ReadonlyArray<{ x: number; y: number; rotate: number; tone: FillTone }> = [
  { x: -110, y: -120, rotate: -200, tone: "warning" },
  { x: 100, y: -130, rotate: 220, tone: "danger" },
  { x: -120, y: 90, rotate: 160, tone: "primary" },
  { x: 115, y: 100, rotate: -180, tone: "info" },
  { x: 10, y: -160, rotate: 300, tone: "success" },
  { x: -20, y: 150, rotate: -260, tone: "neutral" },
];
```
`src/components/motion/use-prefers-reduced-motion.ts`:
```ts
"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the OS asks for reduced motion; re-renders if the setting changes. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
```
`src/components/motion/motion-provider.tsx`:
```tsx
"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Makes every motion component honor the OS "reduce motion" setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
```
`src/components/motion/stagger.tsx`:
```tsx
"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { STAGGER_SECONDS, springs } from "@/design/motion";

/** Container whose `StaggerItem` children rise in one after another. */
export function Stagger({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: STAGGER_SECONDS } } }}
    >
      {children}
    </motion.div>
  );
}

/** One staggered child. */
export function StaggerItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: springs.enter } }}
    >
      {children}
    </motion.div>
  );
}
```
`src/components/motion/confirm-stamp.tsx`:
```tsx
"use client";

import { motion } from "motion/react";
import { CONFETTI_PIECES, springs } from "@/design/motion";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const CONFETTI_FILL = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
} as const;

/**
 * The "CONFIRMED" moment: a stamp slams in, the card shakes, confetti bursts.
 * Reduced-motion users get the stamp immediately with no movement or confetti.
 */
export function ConfirmStamp({ label, show }: { label: string; show: boolean }) {
  const reduced = usePrefersReducedMotion();
  if (!show) return null;

  return (
    <motion.div
      className="relative flex items-center justify-center py-6"
      animate={reduced ? undefined : { x: [0, -4, 4, 0] }}
      transition={{ delay: 0.35, duration: 0.35 }}
    >
      <motion.span
        className="rounded-control border-4 border-outline bg-surface px-4 py-1.5 font-display text-2xl text-ink shadow-brutal-lg"
        initial={reduced ? false : { scale: 2.4, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: -8, opacity: 1 }}
        transition={springs.stamp}
      >
        {label}
      </motion.span>
      {reduced
        ? null
        : CONFETTI_PIECES.map((piece, index) => (
            <motion.span
              key={index}
              data-testid="confetti-piece"
              aria-hidden
              className={cn("absolute h-3.5 w-2.5 rounded-sm border-2 border-outline", CONFETTI_FILL[piece.tone])}
              initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
              animate={{ x: piece.x, y: piece.y, rotate: piece.rotate, opacity: 0 }}
              transition={{ delay: 0.3, duration: 0.9, ease: [0.2, 0.8, 0.3, 1] }}
            />
          ))}
    </motion.div>
  );
}
```
Add `<MotionProvider>` inside `ThemeProvider` in both `src/app/layout.tsx` and `src/test/render.tsx`.

- [ ] **Step 4: Run — expect PASS**: `CI=true bun run test src/components/motion`

- [ ] **Step 5: Commit, PR, merge**
```bash
git add -A && git commit -m "feat: add motion tokens, stagger and confirm stamp primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Supabase baseline and `/api/health`

**Needs:** S1 Step 1 (both projects exist). Docker is **not** required for this task.

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/<timestamp>_baseline_healthcheck.sql`, `src/server/db/database.types.ts` (generated), `src/server/supabase/server-client.ts`, `src/server/supabase/admin-client.ts`, `src/server/supabase/server-client.test.ts`, `src/server/queries/health.ts`, `src/server/queries/health.test.ts`, `src/app/api/health/route.ts`, `src/app/api/health/route.test.ts`
- Modify: `src/config/env.ts`, `src/config/env.test.ts`, `.env.example`, `package.json` (script `db:types`)

**Interfaces:**
- Consumes: `getServerEnv()`, `logger`.
- Produces:
  - `ServerEnv` gains `NEXT_PUBLIC_SUPABASE_URL: string`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string`, `SUPABASE_SECRET_KEY: string`.
  - `createSupabaseServerClient(): Promise<SupabaseClient<Database>>` (user session, RLS applies), `createSupabaseAdminClient(): SupabaseClient<Database>` (secret key; **only** dispatcher and token routes may import it later).
  - `type HealthcheckClient`, `getDatabaseTime(client: HealthcheckClient): Promise<string>` (ISO timestamp).
  - `GET /api/health` → `200 { status: "ok", app: "TapNShow", databaseTime: string }` or `503 { status: "degraded", app: "TapNShow" }`.

- [ ] **Step 1: Init and link**
```bash
supabase init   # answer "N" to IDE settings prompts
bun add @supabase/supabase-js@^2 @supabase/ssr@^0.12
```
Set the Vercel Function region to match the database: Vercel dashboard → Project → Settings → Functions → Region → **Frankfurt (fra1)** (confirm in Vercel's "Configuring regions" docs that Hobby allows choosing one region; if not, record it in the PR and continue with the default).

- [ ] **Step 2: Baseline migration** — `supabase migration new baseline_healthcheck`, then fill the created file:
```sql
-- Health probe used by GET /api/health. Callable only with the secret (service) key.
create or replace function public.healthcheck()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select now();
$$;

revoke execute on function public.healthcheck() from public, anon, authenticated;
grant execute on function public.healthcheck() to service_role;
```
Apply to Preview, then Production:
```bash
supabase link --project-ref <preview-ref> && supabase db push
supabase link --project-ref <prod-ref> && supabase db push
```
If `db push` fails for lack of Docker, apply the same SQL with the Supabase MCP `apply_migration` tool (name `baseline_healthcheck`) on each project.

- [ ] **Step 3: Generate types**

Add script `"db:types": "supabase gen types typescript --project-id \"$SUPABASE_PROJECT_REF\" --schema public > src/server/db/database.types.ts"`, then:
```bash
SUPABASE_PROJECT_REF=<prod-ref> bun run db:types
grep -q healthcheck src/server/db/database.types.ts && echo ok
```
Expected: `ok`.

- [ ] **Step 4: Extend env (test first)** — add to `src/config/env.test.ts`:
```ts
const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};

it("requires the Supabase keys and names the missing one", () => {
  expect(() => parseServerEnv({ ...supabase, SUPABASE_SECRET_KEY: undefined })).toThrow(/SUPABASE_SECRET_KEY/);
  expect(parseServerEnv(supabase).NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co");
});
```
and change the two existing tests to call `parseServerEnv({ ...supabase, ... })`. Run → FAIL. Then extend the schema in `src/config/env.ts`:
```ts
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
```
Add the three names to `vitest.config.mts` `test.env` with dummy values, to `.env.example`, to `.env.local` (Preview project values), and to Vercel (`Preview` = preview project keys, `Production` = prod project keys) via `bunx vercel@latest env add`. Add dummy values to the CI workflow `env:` block. Run → PASS.

- [ ] **Step 5: Failing tests for clients, query, and route**

`src/server/supabase/server-client.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type CookieRecord = { name: string; value: string; options?: object };
type CookieAdapter = { cookies: { getAll: () => CookieRecord[]; setAll: (cookies: CookieRecord[]) => void } };

// vi.mock factories are hoisted above imports, so shared doubles must be created with vi.hoisted.
const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn((url: string, key: string, options: CookieAdapter) => ({ url, key, options })),
  cookieStore: { getAll: vi.fn((): CookieRecord[] => [{ name: "sb", value: "1" }]), set: vi.fn() },
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookieStore }));

describe("createSupabaseServerClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the publishable key and delegates cookies to Next", async () => {
    const { createSupabaseServerClient } = await import("./server-client");
    await createSupabaseServerClient();
    const [url, key, options] = mocks.createServerClient.mock.calls[0];
    const cookieStore = mocks.cookieStore;
    expect(url).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(key).toBe(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(options.cookies.getAll()).toEqual([{ name: "sb", value: "1" }]);
    options.cookies.setAll([{ name: "sb", value: "2", options: {} }]);
    expect(cookieStore.set).toHaveBeenCalledWith("sb", "2", {});
  });
});
```
`src/server/queries/health.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { getDatabaseTime, type HealthcheckClient } from "./health";

function clientReturning(result: { data: string | null; error: { message: string } | null }): HealthcheckClient {
  return { rpc: vi.fn(async () => result) };
}

describe("getDatabaseTime", () => {
  it("returns the database timestamp", async () => {
    await expect(getDatabaseTime(clientReturning({ data: "2026-10-05T10:00:00+00:00", error: null }))).resolves.toBe(
      "2026-10-05T10:00:00+00:00",
    );
  });

  it("throws on database errors", async () => {
    await expect(getDatabaseTime(clientReturning({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
```
`src/app/api/health/route.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

const { getDatabaseTime } = vi.hoisted(() => ({ getDatabaseTime: vi.fn(async (): Promise<string> => "") }));
vi.mock("@/server/queries/health", () => ({ getDatabaseTime }));
vi.mock("@/server/supabase/admin-client", () => ({ createSupabaseAdminClient: () => ({}) }));

describe("GET /api/health", () => {
  it("returns ok with the database time", async () => {
    getDatabaseTime.mockResolvedValueOnce("2026-10-05T10:00:00+00:00");
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", app: "TapNShow", databaseTime: "2026-10-05T10:00:00+00:00" });
  });

  it("returns 503 without leaking the error", async () => {
    getDatabaseTime.mockRejectedValueOnce(new Error("connection refused at 10.0.0.1"));
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("10.0.0.1");
  });
});
```
Run: `CI=true bun run test src/server src/app/api` → FAIL.

- [ ] **Step 6: Implement**

`src/server/supabase/server-client.ts`:
```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServerEnv } from "@/config/env";
import type { Database } from "@/server/db/database.types";

/**
 * Supabase client acting as the signed-in user (RLS applies). Use in API route handlers.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
```
`src/server/supabase/admin-client.ts`:
```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/config/env";
import type { Database } from "@/server/db/database.types";

/**
 * Supabase client with the secret key — bypasses RLS. Allowed callers (spec §11):
 * the outbox dispatcher, the public token route, and the health probe.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  const env = getServerEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```
`src/server/queries/health.ts`:
```ts
import "server-only";

/**
 * The slice of a Supabase client this query needs. `SupabaseClient<Database>` satisfies it
 * structurally, and tests can pass a plain double without casts.
 */
export type HealthcheckClient = {
  rpc: (fn: "healthcheck") => PromiseLike<{ data: string | null; error: { message: string } | null }>;
};

/**
 * Reads the database clock through the `healthcheck()` function.
 * @throws Error with the database message when the call fails
 */
export async function getDatabaseTime(client: HealthcheckClient): Promise<string> {
  const { data, error } = await client.rpc("healthcheck");
  if (error || !data) {
    throw new Error(error?.message ?? "healthcheck returned no data");
  }
  return data;
}
```
`src/app/api/health/route.ts`:
```ts
import { NextResponse } from "next/server";
import { APP_NAME } from "@/config/app";
import { logger } from "@/lib/logger";
import { getDatabaseTime } from "@/server/queries/health";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/** Liveness + database connectivity probe. Never exposes error details. */
export async function GET(): Promise<NextResponse> {
  try {
    const admin = createSupabaseAdminClient();
    const databaseTime = await getDatabaseTime({ rpc: (fn) => admin.rpc(fn) });
    return NextResponse.json({ status: "ok", app: APP_NAME, databaseTime });
  } catch (error) {
    logger.error({ err: error }, "health check failed");
    return NextResponse.json({ status: "degraded", app: APP_NAME }, { status: 503 });
  }
}
```
Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` first and confirm GET handlers are uncached by default in 16.x; if not, add `export const dynamic = "force-dynamic";`.

- [ ] **Step 7: Run — expect PASS**: `CI=true bun run test && bun run lint && bun run typecheck && bun run build`

- [ ] **Step 8: Verify on Preview** — push; open `<preview-url>/api/health` (log in through Vercel protection if prompted) → `{"status":"ok",...}` with the preview database time.

- [ ] **Step 9: Commit, PR, merge**
```bash
git add -A && git commit -m "feat: add Supabase clients, baseline migration and health endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: `/design` showcase, end-to-end checks, production deploy

**Files:**
- Create: `src/app/design/page.tsx`, `src/app/design/design-showcase.tsx`, `src/app/design/design-showcase.test.tsx`, `e2e/design-system.spec.ts`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: everything from Tasks 10–14.
- Produces: route `/design` (noindex) showing color tokens, Stickers, all Button tones, Chips, Input (normal/hint/error), Card, ThemeToggle, a response demo (Attending → ConfirmStamp; Late → delay chips), and a Stagger entrance.

- [ ] **Step 1: Messages** — add to `messages/en.json`:
```json
"Design": {
  "title": "Design system",
  "colors": "Colors",
  "buttons": "Buttons",
  "inputs": "Inputs",
  "demo": "Response demo",
  "meetingTitle": "Bureau Weekly Meeting",
  "meetingDate": "Tue, 14 Oct 2026",
  "meetingTime": "18:00 - 19:30",
  "meetingPlace": "ISSAT Sousse, Room B12",
  "attend": "I'll be there",
  "late": "I'll be late",
  "absent": "I can't make it",
  "delay": "How late will you be?",
  "delayShort": "5-10 min",
  "delayMedium": "10-20 min",
  "delayLong": "20-30 min",
  "reasonLabel": "Reason for delay",
  "reasonHint": "Visible to the workspace organizers",
  "reasonError": "Please enter a reason",
  "confirmed": "CONFIRMED",
  "reset": "Reset demo",
  "tone": "Fill: {tone}"
}
```

- [ ] **Step 2: Failing component test** — `src/app/design/design-showcase.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { DesignShowcase } from "./design-showcase";

describe("DesignShowcase response demo", () => {
  it("shows delay chips after choosing late", async () => {
    renderWithProviders(<DesignShowcase />);
    expect(screen.queryByRole("button", { name: "10-20 min" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /I'll be late/ }));
    expect(screen.getByRole("button", { name: "10-20 min" })).toHaveAttribute("aria-pressed", "false");
  });

  it("stamps CONFIRMED after choosing attend", async () => {
    renderWithProviders(<DesignShowcase />);
    await userEvent.click(screen.getByRole("button", { name: /I'll be there/ }));
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implement** — `src/app/design/page.tsx`:
```tsx
import type { Metadata } from "next";
import { DesignShowcase } from "./design-showcase";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Internal design-system showcase (not linked from the product). */
export default function DesignPage() {
  return <DesignShowcase />;
}
```
`src/app/design/design-showcase.tsx`:
```tsx
"use client";

import { CalendarBlankIcon, CheckIcon, ClockIcon, HourglassMediumIcon, MapPinIcon, XIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmStamp } from "@/components/motion/confirm-stamp";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Sticker } from "@/components/ui/sticker";
import { FILL_TONES } from "@/design/tokens";

type Choice = "none" | "attend" | "late";
const DELAYS = ["delayShort", "delayMedium", "delayLong"] as const;

/** Interactive tour of tokens, components and motion. */
export function DesignShowcase() {
  const t = useTranslations("Design");
  const [choice, setChoice] = useState<Choice>("none");
  const [delay, setDelay] = useState<(typeof DELAYS)[number] | null>(null);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <ThemeToggle />
      </header>

      <Stagger className="flex flex-col gap-6">
        <StaggerItem>
          <Card as="section" aria-label={t("colors")}>
            <h2 className="mb-3 font-bold">{t("colors")}</h2>
            <div className="flex flex-wrap gap-2">
              {FILL_TONES.map((tone) => (
                <Sticker key={tone} tone={tone} label={t("tone", { tone })}>
                  <CheckIcon weight="bold" />
                </Sticker>
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card as="section" aria-label={t("demo")}>
            <h2 className="mb-3 font-display text-xl">{t("meetingTitle")}</h2>
            <ul className="mb-4 flex flex-col gap-2 text-sm font-medium">
              <li className="flex items-center gap-3">
                <Sticker tone="primary"><CalendarBlankIcon weight="bold" /></Sticker>
                {t("meetingDate")}
              </li>
              <li className="flex items-center gap-3">
                <Sticker tone="warning"><ClockIcon weight="bold" /></Sticker>
                {t("meetingTime")}
              </li>
              <li className="flex items-center gap-3">
                <Sticker tone="info"><MapPinIcon weight="bold" /></Sticker>
                {t("meetingPlace")}
              </li>
            </ul>

            {choice === "attend" ? (
              <div className="flex flex-col gap-3">
                <ConfirmStamp label={t("confirmed")} show />
                <Button onClick={() => setChoice("none")}>{t("reset")}</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Button tone="success" size="lg" onClick={() => setChoice("attend")}>
                  {t("attend")}
                  <Sticker size="sm"><CheckIcon weight="bold" /></Sticker>
                </Button>
                <Button tone="warning" size="lg" onClick={() => setChoice("late")}>
                  {t("late")}
                  <Sticker size="sm"><HourglassMediumIcon weight="bold" /></Sticker>
                </Button>
                {choice === "late" ? (
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-2 text-sm font-bold">{t("delay")}</legend>
                    <div className="flex flex-wrap gap-2">
                      {DELAYS.map((key) => (
                        <Chip key={key} tone="warning" pressed={delay === key} onPressedChange={(on) => setDelay(on ? key : null)}>
                          {t(key)}
                        </Chip>
                      ))}
                    </div>
                    <Input id="demo-reason" label={t("reasonLabel")} hint={t("reasonHint")} />
                  </fieldset>
                ) : null}
                <Button tone="danger" size="lg">
                  {t("absent")}
                  <Sticker size="sm"><XIcon weight="bold" /></Sticker>
                </Button>
              </div>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card as="section" aria-label={t("inputs")}>
            <h2 className="mb-3 font-bold">{t("inputs")}</h2>
            <Input id="demo-error" label={t("reasonLabel")} error={t("reasonError")} />
          </Card>
        </StaggerItem>
      </Stagger>
    </main>
  );
}
```
Before running, confirm each icon export exists: `grep -o -w 'CalendarBlankIcon\|CheckIcon\|ClockIcon\|HourglassMediumIcon\|MapPinIcon\|XIcon' node_modules/@phosphor-icons/react/dist/index.d.ts | sort -u` → six names.

Run: `CI=true bun run test src/app/design` → PASS.

- [ ] **Step 4: End-to-end checks** — `e2e/design-system.spec.ts`:
```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("/design", () => {
  test("has no WCAG 2.2 AA violations in light and dark", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/design");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations).toEqual([]);
    }
  });

  test("no horizontal scroll and every button is at least 44px tall", async ({ page }) => {
    await page.goto("/design");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("dark-mode users get the dark background on first paint (no flash)", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/design", { waitUntil: "commit" });
    await page.waitForSelector("body");
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(bg).toBe("rgb(22, 19, 31)");
    await context.close();
  });

  test("theme toggle switches data-theme", async ({ page }) => {
    await page.goto("/design");
    const toggle = page.getByRole("button", { name: /color theme/i });
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: /color theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("reduced motion: stamp appears instantly without confetti", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/design");
    await page.getByRole("button", { name: /I'll be there/ }).click();
    await expect(page.getByText("CONFIRMED")).toBeVisible({ timeout: 100 });
    await expect(page.getByTestId("confetti-piece")).toHaveCount(0);
    await context.close();
  });
});
```
Run: `bun run test:e2e` → all pass on `phone` and `small-phone`. A failure here is a real defect: fix the component or token, never loosen the assertion.

- [ ] **Step 5: Visual check with the Playwright MCP** (repo rule) — open `http://localhost:3000/design` at 390×844 and 320×568 in light and dark; take screenshots; confirm the look matches the approved mockups (style B, Phosphor stickers, Expressive motion) and attach them to the PR.

- [ ] **Step 6: Merge and verify production**
```bash
git add -A && git commit -m "feat: add design system showcase with accessibility and motion e2e tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && gh pr create --fill && gh pr checks --watch
gh pr merge --squash --delete-branch
sleep 90
curl -s -o /dev/null -w "%{http_code}\n" https://tapnshow.vercel.app/design
curl -s https://tapnshow.vercel.app/api/health
```
Expected: `200`, then `{"status":"ok","app":"TapNShow","databaseTime":"..."}` from the production database. Close the M1 epic when all its sub-issues are closed.
