# TapNShow M2 (Auth & Workspaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An organizer signs in (emailed 8-digit code or Google), creates a workspace, and invites a Viewer who accepts; RLS tests prove that workspaces are isolated and that only the Owner manages Admins.

**Architecture:** Postgres (Supabase) holds profiles, workspaces, roles, invites and rate-limit counters. Reads go through RLS; membership and ownership changes go only through `SECURITY DEFINER` functions that re-check the caller. Next.js API route handlers are the only server entry points; pages are client components that use TanStack Query against them. Sessions are `@supabase/ssr` cookies refreshed in `src/proxy.ts`. Google sign-in uses our own OAuth callback and `signInWithIdToken`. System emails (sign-in codes from Supabase Auth, invite emails from our `SystemMailer`) go through the platform Gmail and share the Soft Neobrutalism email design.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript 5, bun 1.3.11, `@supabase/supabase-js` 2.117.2 + `@supabase/ssr` 0.12.7, Supabase CLI 2.119.0 (local stack on ports 443xx), Postgres 17, `zod` 4, `@tanstack/react-query` 5.104, `react-hook-form` 7.89 + `@hookform/resolvers` 5.9, `nodemailer` 10.0 (ships its own types), `react-email` 6.11 (components and `render` are imported from `react-email`; `@react-email/components` is deprecated), shadcn 4.21.1 (`radix-lyra` preset) for Dialog / DropdownMenu / Popover / Command / Sonner, Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md` — read §3 (roles), §4 (decisions), §6 (data model + access pattern), §7.1, §7.11, §7.13, §8 (platform Gmail budget), §9 (sign-in), §10 (routes), §11 (security) and §12 (testing) before starting. Decisions: #54 (Google callback), #55 (Owner).

## Global Constraints

- Everything from the M0+M1 plan's Global Constraints still applies (free only; bun; no Server Actions; no emojis; no `any`/`unknown`; no `console.*`; JSDoc on exports; no hardcoded values; SQL only in `supabase/migrations/*` and `src/server/queries/*`; every UI string through next-intl; Soft Neobrutalism; Expressive motion with reduced-motion fallback; WCAG 2.2 AA; one branch + PR per task, squash merge, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code. Verified for this plan: `src/proxy.ts` must export a function named `proxy` (or a default export) — Supabase's guide still says `middleware`, ignore that; route handler params are typed with the global `RouteContext<'/path/[param]'>` and read with `await ctx.params`; client pages read params with `useParams()`.
- Supabase: every new `public` table gets `enable row level security`, `revoke all … from anon, authenticated`, then explicit `GRANT`s to `authenticated` only (new tables are not exposed by default since 2026-04-28). Policies use `TO authenticated` plus an ownership/membership predicate; UPDATE policies have `USING` and `WITH CHECK`; never read `user_metadata` for authorization.
- `SECURITY DEFINER` functions (spec §11 exception): `set search_path = ''`, fully-qualified names, check `auth.uid()` and the caller's role inside, `revoke execute … from public, anon, authenticated` then `grant execute … to authenticated` (or `service_role`). Helpers live in schema `private` (not exposed by the Data API). Run `supabase db advisors --local` after every migration and fix every finding.
- Database errors meant for users are raised as `raise exception 'tn:<code>' using errcode = 'P0001'`; TypeScript maps `tn:<code>` to API error codes (Task 5). Never put user data in exception messages.
- Limits live in one place: table `private.app_limits` (seeded by migration). TypeScript never duplicates their numbers. Auth email settings (code length 8, expiry 900 s, 15 emails/hour) live in `src/config/auth.ts` and are pushed to Supabase by `scripts/supabase-auth-config.ts`.
- Service-role (`createSupabaseAdminClient`) callers allowed after M2: dispatcher (later), public token route (later), `/api/health`, and the pre-auth rate limiter `src/server/rate-limit/ip-rate-limit.ts` (Task 6 adds it to spec §11). Nothing else may import the admin client.
- Personal-link and invite tokens: 256-bit random, base64url, shown once; only the SHA-256 hex hash is stored. Tokens never appear in query strings sent to our API (POST bodies only) and `/invite/<token>` is scrubbed from logs and Sentry like `/r/<token>`.
- Every mutating API route checks `Origin` against the request's own origin (Task 5 helper) and validates its body with a shared Zod schema from `src/shared/api/*`.
- API error body is always `{ "error": { "code": ApiErrorCode, "details"?: {...} } }`; the client translates `code` via the `ApiErrors` messages namespace. Never return raw database or provider messages.
- Emails (Supabase auth templates and invite emails) use `src/emails/*` components: palette tokens from `src/design/tokens.ts`, thick outlines, rounded cards, and the hard shadow drawn as thicker right/bottom borders (caniemail: `box-shadow` is not supported in Gmail's mobile apps for Google accounts; `border-radius` is supported in Gmail, Apple Mail and Outlook.com). System font stack (web fonts are unreliable in email). No emojis.
- Secrets: never printed. User-supplied secrets go into `~/.config/tapnshow/*.env` first; every secret added to Vercel is mirrored into `.env.local`'s backup blocks (owner rule). Fetch with scripts that do not echo values.
- Local stack: `supabase start` (API 44321, DB 44322, Studio 44323, Mailpit web 44324, Mailpit SMTP 44325). Stop any `next dev` before `bun run test:e2e` (Playwright reuses an existing server outside CI).

## Review Focus

1. **Codes pasted with spaces or dashes** — people copy "1234 5678" or "1234-5678" from the email; the code step must accept them (digits only are sent). Pinned in Task 6 (`normalizeOtpCode` unit test + login form test).
2. **Email address case and whitespace** — an invite to `Ali.Ben@Gmail.com ` must be accepted by the account `ali.ben@gmail.com`, and two invites differing only in case must not both stay open. Pinned in Task 4 (DB tests) and Task 12 (schema test).
3. **Open redirect through `next=`** — `//evil.example`, `/\evil.example`, `https://evil.example`, `/\t/evil.example` and `javascript:` must fall back to the default destination; anything accepted must stay on our site (`/%2F%2Fevil.example` is just an unknown same-site path). Pinned in Task 6 (`safeNextPath` tests) and reused by Tasks 7, 8, 12.
4. **Workspace names that are not plain ASCII** — Arabic (`نادي البرمجة`), accented French (`Club Électronique`) or emoji-only names must still produce a valid, readable-or-fallback slug, never an empty one. Pinned in Task 9 (`generateWorkspaceSlug` tests).
5. **Session expiring while a page is open** — any API 401 must send the user to `/login?next=<current path>` instead of leaving a broken screen. Pinned in Task 5 (`api-client` + query provider test) and checked in Task 13's e2e.

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge this plan (docs PR); create the agent-task issues (Tracking) | — |
| 1 | Task 1 — Auth email design + Supabase auth settings script | 0 |
| 2 | Task 2 — DB core: schema, RLS, `create_workspace`, rate limits, DB test harness, CI `db` job | 0 |
| 3 | Task 3 — DB membership functions (roles, remove, leave, transfer, delete) | 2 |
| 4 | Task 4 — DB invites | 3 |
| 5 | Task 5 — API foundations (env, errors, origin, body, auth guard, shared schemas, API client, Query provider) | 2 |
| 6 | Task 6 — Email-code sign-in (`proxy.ts`, OTP routes, IP limit, `/login`) | 1, 5 |
| 7 | Task 7 — Google sign-in (own callback) | 6 |
| 8 | Task 8 — Profile + `/welcome` routing | 6 |
| 9 | Task 9 — Create workspace (`/w/new`, slug, timezone picker) | 8 |
| 10 | Task 10 — App shell (header, switcher, user menu, bottom bar, Home, placeholders) | 9 |
| 11 | Task 11 — Settings: General, People, Danger zone (routes + UI) | 3, 10 |
| 12 | Task 12 — Invites end to end (mailer, invite email, routes, Settings UI, `/invite/[token]`) | 4, 11 |
| 13 | Task 13 — Production rollout, full e2e, manual Google check, required checks | 1–12 |

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–13 with the agent-task template, labels `type:task` + the area labels named in each task, milestone `M2 Auth & workspaces`, and add each as a sub-issue of epic #4:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/4/sub_issues -F sub_issue_id="$id"
```
- [ ] Tick "Plan written for M2" in epic #4's body.
- [ ] Ledger: `.superpowers/sdd/2026-10-05-m2-auth-and-workspaces/progress.md` (git-ignored) with one line per task and every `Ruling:`.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `src/config/auth.ts` | Auth constants (OTP length/expiry/resend, auth email rate, Google cookie) | 1 |
| `src/emails/theme.ts`, `src/emails/email-layout.tsx` | Email-safe tokens and shared Neobrutalist layout | 1 |
| `src/emails/sign-in-code-email.tsx` | Sign-in code email (Supabase template source) | 1 |
| `src/emails/translator.ts` | next-intl translator for emails (no React context) | 1 |
| `scripts/supabase-auth-config.ts`, `scripts/supabase-auth-config.test.ts` | Builds + pushes Supabase auth settings/templates; writes local template | 1 |
| `supabase/templates/sign-in-code.html` | Generated local copy of the template (committed) | 1 |
| `supabase/migrations/*_m2_core_workspaces.sql` | Schema `private`, limits, rolling-window rate limits, profiles, workspaces, roles, RLS, `create_workspace`, `list_members`, `check_ip_rate_limit` | 2 |
| `supabase/migrations/*_m2_membership.sql` | `change_role`, `remove_member`, `leave_workspace`, `transfer_ownership`, `delete_workspace` | 3 |
| `supabase/migrations/*_m2_invites.sql` | `workspace_invites` + invite functions | 4 |
| `scripts/with-local-supabase.ts` | Runs a command with env pointing at the local stack | 2 |
| `vitest.db.config.mts`, `src/test/db/*` | DB integration test config + helpers | 2 |
| `src/server/db/*.db.test.ts` | RLS / function integration tests | 2–4 |
| `src/config/env.ts`, `src/config/public-env.ts` | New env vars (SMTP, Google, Google flag) | 5 |
| `src/shared/api/*.ts` | Zod request/response schemas shared by routes and client | 5–12 |
| `src/server/http/*.ts` | `apiError`, `fromDatabaseError`, `isSameOrigin`, `parseJsonBody`, `requireUser`, `clientIp` | 5 |
| `src/lib/api-client.ts`, `src/components/providers/query-provider.tsx` | Typed fetch + 401 handling; TanStack Query | 5 |
| `src/lib/safe-next-path.ts` | Same-site `next=` validation | 6 |
| `src/server/supabase/proxy-session.ts`, `src/proxy.ts` | Session refresh + optimistic redirects | 6 |
| `src/server/rate-limit/ip-rate-limit.ts` | Pre-auth IP limit (service role) | 6 |
| `src/app/api/auth/**` | OTP send/verify, sign-out, Google start/callback | 6, 7 |
| `src/app/login/*` | Login page (email, code, Google button) | 6, 7 |
| `src/server/crypto/tokens.ts` | Random tokens, SHA-256 hex/base64url | 7 |
| `src/server/auth/google-oauth.ts` | Google authorization URL, cookie, code exchange | 7 |
| `src/server/queries/*.ts` | All supabase-js calls (profiles, workspaces, members, invites) | 8–12 |
| `src/app/api/me/route.ts`, `src/app/welcome/*` | Profile API + post-sign-in routing | 8 |
| `src/lib/slug.ts`, `src/app/api/workspaces/route.ts`, `src/app/w/new/*` | Workspace creation | 9 |
| `src/components/shell/*`, `src/app/w/[slug]/**` | Shell, Home, placeholders | 10 |
| `src/app/api/workspaces/[slug]/**`, `src/app/w/[slug]/settings/*` | Settings routes + UI | 11, 12 |
| `src/server/email/system-mailer.ts`, `src/emails/invite-email.tsx` | Invite email delivery | 12 |
| `src/app/api/invites/**`, `src/app/invite/[token]/*` | Invite preview/accept | 12 |
| `e2e/helpers/mailpit.ts`, `e2e/auth-workspace.spec.ts` | Full flow e2e | 6, 12, 13 |

---

### Task 1: Auth email design + Supabase auth settings script

**Labels:** `area:email`, `area:auth`, `area:infra`

**Files:**
- Create: `src/config/auth.ts`, `src/config/supabase-projects.ts`, `src/emails/theme.ts`, `src/emails/translator.ts`, `src/emails/email-layout.tsx`, `src/emails/sign-in-code-email.tsx`, `src/emails/sign-in-code-email.test.tsx`, `src/server/supabase/auth-config.ts`, `src/server/supabase/auth-config.test.ts`, `scripts/supabase-auth-config.ts`, `supabase/templates/sign-in-code.html` (generated)
- Modify: `messages/en.json` (namespace `Email`), `supabase/config.toml` (`[auth.email]`, `[auth.email.template.magic_link]`, `[auth.email.template.confirmation]`, `[local_smtp]`), `package.json` (script `auth:config`, dependency `react-email`)

**Interfaces:**
- Consumes: `palette`, `shape` (`src/design/tokens.ts`), `APP_NAME`, `DEFAULT_LOCALE`.
- Produces:
  - `OTP_LENGTH = 8`, `OTP_EXPIRY_SECONDS = 900`, `OTP_RESEND_SECONDS = 60`, `AUTH_EMAILS_PER_HOUR = 15` (`src/config/auth.ts`).
  - `SUPABASE_PROJECTS: Record<"prod" | "preview", { ref: string; siteUrl: string }>`.
  - `emailTheme` (email-safe tokens), `EmailLayout({ preview, heading, children })`, `getEmailTranslator()` — reused by Task 12's invite email.
  - `SignInCodeEmail({ code })`, `SUPABASE_TOKEN_PLACEHOLDER = "{{ .Token }}"`, `renderSignInCodeTemplate(): Promise<{ subject: string; html: string }>`.
  - `buildAuthConfigPatch({ siteUrl, template }): AuthConfigPatch` and `bun run auth:config <local|preview|prod|all>`.

- [ ] **Step 1: Install and verify exports**
```bash
bun add react-email@^6.11
bun -e 'import * as m from "react-email"; console.log(["Html","Head","Body","Container","Section","Text","Heading","Preview","Link","Button","render"].filter((k) => !(k in m)))'
```
Expected: `[]`. If anything is missing, read `node_modules/react-email/README.md` for the current import path and use it everywhere below (record a `Ruling:`).

- [ ] **Step 2: Config constants**

`src/config/auth.ts`:
```ts
/** Digits in emailed sign-in codes (Supabase `mailer_otp_length`). */
export const OTP_LENGTH = 8;

/** Seconds a sign-in code stays valid (Supabase `mailer_otp_exp`). */
export const OTP_EXPIRY_SECONDS = 900;

/** Seconds before "Resend code" unlocks; Supabase allows one code request per user per 60 s. */
export const OTP_RESEND_SECONDS = 60;

/** Auth emails per hour for the whole project (Supabase `rate_limit_email_sent`, spec §8 budget). */
export const AUTH_EMAILS_PER_HOUR = 15;
```
`src/config/supabase-projects.ts`:
```ts
/**
 * Hosted Supabase projects. Refs are not secret. `siteUrl` is Supabase Auth's `site_url`:
 * production uses the public app; preview is used by local development, so it points at localhost.
 */
export const SUPABASE_PROJECTS = {
  prod: { ref: "dysqhjvwabqahpctytnw", siteUrl: "https://tapnshow.vercel.app" },
  preview: { ref: "wayabcidwnhgaazgsuns", siteUrl: "http://localhost:3000" },
} as const;

/** Name of a hosted Supabase project. */
export type SupabaseProjectName = keyof typeof SUPABASE_PROJECTS;
```

- [ ] **Step 3: Messages** — add to `messages/en.json`:
```json
"Email": {
  "footer": "You got this email because this address was used on {appName}. If that wasn't you, you can ignore it.",
  "signIn": {
    "subject": "Your {appName} sign-in code",
    "preview": "Your sign-in code is inside. It works once and expires in {minutes} minutes.",
    "heading": "Your sign-in code",
    "intro": "Type this code on the {appName} sign-in screen:",
    "expiry": "It works once and expires in {minutes} minutes.",
    "ignore": "Didn't ask for a code? Ignore this email. Nobody can sign in without it."
  }
}
```

- [ ] **Step 4: Failing tests**

`src/emails/sign-in-code-email.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { OTP_EXPIRY_SECONDS } from "@/config/auth";
import { palette } from "@/design/tokens";
import { renderSignInCodeTemplate, SUPABASE_TOKEN_PLACEHOLDER } from "./sign-in-code-email";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("renderSignInCodeTemplate", () => {
  it("keeps Supabase's token placeholder and no link", async () => {
    const { html } = await renderSignInCodeTemplate();
    expect(html).toContain(SUPABASE_TOKEN_PLACEHOLDER);
    expect(html).not.toContain("ConfirmationURL");
    expect(html).not.toMatch(/<a\s/i);
  });

  it("uses the app subject and states the expiry in minutes", async () => {
    const { subject, html } = await renderSignInCodeTemplate();
    expect(subject).toBe("Your TapNShow sign-in code");
    expect(html).toContain(`expires in ${OTP_EXPIRY_SECONDS / 60} minutes`);
  });

  it("follows the Neobrutalist palette without box-shadow or emojis", async () => {
    const { html } = await renderSignInCodeTemplate();
    expect(html).toContain(palette.light.primary);
    expect(html).toContain(palette.light.outline);
    expect(html).not.toContain("box-shadow");
    expect(html).not.toMatch(EMOJI);
  });
});
```
`src/server/supabase/auth-config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { AUTH_EMAILS_PER_HOUR, OTP_EXPIRY_SECONDS, OTP_LENGTH } from "@/config/auth";
import { buildAuthConfigPatch } from "./auth-config";

describe("buildAuthConfigPatch", () => {
  const template = { subject: "Your TapNShow sign-in code", html: "<p>{{ .Token }}</p>" };

  it("sets code length, expiry, email rate and site URL from config", () => {
    const patch = buildAuthConfigPatch({ siteUrl: "https://tapnshow.vercel.app", template });
    expect(patch).toMatchObject({
      mailer_otp_length: OTP_LENGTH,
      mailer_otp_exp: OTP_EXPIRY_SECONDS,
      rate_limit_email_sent: AUTH_EMAILS_PER_HOUR,
      site_url: "https://tapnshow.vercel.app",
    });
  });

  it("uses the code template for both magic-link and sign-up confirmation emails", () => {
    const patch = buildAuthConfigPatch({ siteUrl: "http://localhost:3000", template });
    expect(patch.mailer_subjects_magic_link).toBe(template.subject);
    expect(patch.mailer_subjects_confirmation).toBe(template.subject);
    expect(patch.mailer_templates_magic_link_content).toBe(template.html);
    expect(patch.mailer_templates_confirmation_content).toBe(template.html);
  });
});
```
Run: `CI=true bun run test src/emails src/server/supabase/auth-config.test.ts` → FAIL (modules missing).

- [ ] **Step 5: Implement the email design**

`src/emails/theme.ts`:
```ts
import { palette, shape } from "@/design/tokens";

const px = (value: string): number => Number.parseFloat(value);

/**
 * Email-safe Soft Neobrutalism tokens. Light palette only: many clients ignore
 * `prefers-color-scheme` or recolor dark mode themselves. Borders are whole pixels, and
 * the hard shadow is drawn as thicker right/bottom borders because Gmail's mobile apps drop
 * `box-shadow` for Google accounts (caniemail).
 */
export const emailTheme = {
  background: palette.light.background,
  surface: palette.light.surface,
  ink: palette.light.ink,
  muted: palette.light.muted,
  outline: palette.light.outline,
  primary: palette.light.primary,
  warning: palette.light.warning,
  border: `${Math.ceil(px(shape.borderWidth))}px`,
  shadowBorder: `${Math.ceil(px(shape.borderWidth)) + px(shape.shadow)}px`,
  radiusCard: shape.radiusCard,
  radiusControl: shape.radiusControl,
  radiusSticker: shape.radiusSticker,
  fontBody: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontDisplay: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
  fontCode: "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace",
} as const;

/** Outlined block with the border-drawn hard shadow (cards, code boxes, buttons). */
export function brutalBox(fill: string, radius: string): Record<string, string> {
  return {
    backgroundColor: fill,
    border: `${emailTheme.border} solid ${emailTheme.outline}`,
    borderRightWidth: emailTheme.shadowBorder,
    borderBottomWidth: emailTheme.shadowBorder,
    borderRadius: radius,
  };
}
```
`src/emails/translator.ts`:
```ts
import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE } from "@/config/i18n";
import messages from "../../messages/en.json";

/** Translator for the `Email` namespace, usable outside React (routes, scripts). */
export function getEmailTranslator() {
  return createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: "Email" });
}
```
`src/emails/email-layout.tsx`:
```tsx
import type { ReactNode } from "react";
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { DEFAULT_LOCALE } from "@/config/i18n";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** Shared email frame: brand sticker, outlined card with hard shadow, footer. */
export function EmailLayout({ preview, heading, children }: { preview: string; heading: string; children: ReactNode }) {
  const tr = getEmailTranslator();
  return (
    <Html lang={DEFAULT_LOCALE}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: t.background, color: t.ink, fontFamily: t.fontBody, margin: 0, padding: "24px 12px" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Text
            style={{
              ...brutalBox(t.primary, t.radiusSticker),
              display: "inline-block",
              fontFamily: t.fontDisplay,
              fontSize: "16px",
              margin: "0 0 16px",
              padding: "6px 12px",
            }}
          >
            {APP_NAME}
          </Text>
          <Section style={{ ...brutalBox(t.surface, t.radiusCard), padding: "24px" }}>
            <Heading as="h1" style={{ fontFamily: t.fontDisplay, fontSize: "24px", lineHeight: "30px", margin: "0 0 12px" }}>
              {heading}
            </Heading>
            {children}
          </Section>
          <Text style={{ color: t.muted, fontSize: "13px", lineHeight: "18px", marginTop: "20px" }}>
            {tr("footer", { appName: APP_NAME })}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```
`src/emails/sign-in-code-email.tsx`:
```tsx
import { render, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { OTP_EXPIRY_SECONDS } from "@/config/auth";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** Supabase Auth replaces this with the real code when it sends the email. */
export const SUPABASE_TOKEN_PLACEHOLDER = "{{ .Token }}";

const minutes = OTP_EXPIRY_SECONDS / 60;

/** Sign-in code email: code only, no link (link scanners consume one-time links). */
export function SignInCodeEmail({ code }: { code: string }) {
  const tr = getEmailTranslator();
  return (
    <EmailLayout preview={tr("signIn.preview", { minutes })} heading={tr("signIn.heading")}>
      <Text style={{ fontSize: "16px", lineHeight: "24px", margin: "0 0 16px" }}>{tr("signIn.intro", { appName: APP_NAME })}</Text>
      <Text
        style={{
          ...brutalBox(t.warning, t.radiusControl),
          fontFamily: t.fontCode,
          fontSize: "32px",
          fontWeight: 700,
          letterSpacing: "6px",
          margin: "0 0 16px",
          padding: "14px 16px",
          textAlign: "center",
        }}
      >
        {code}
      </Text>
      <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 8px" }}>{tr("signIn.expiry", { minutes })}</Text>
      <Text style={{ color: t.muted, fontSize: "14px", lineHeight: "20px", margin: 0 }}>{tr("signIn.ignore")}</Text>
    </EmailLayout>
  );
}

/** Subject + HTML for Supabase's "Magic Link" and "Confirm signup" templates. */
export async function renderSignInCodeTemplate(): Promise<{ subject: string; html: string }> {
  const tr = getEmailTranslator();
  return {
    subject: tr("signIn.subject", { appName: APP_NAME }),
    html: await render(<SignInCodeEmail code={SUPABASE_TOKEN_PLACEHOLDER} />),
  };
}
```
`src/server/supabase/auth-config.ts`:
```ts
import { AUTH_EMAILS_PER_HOUR, OTP_EXPIRY_SECONDS, OTP_LENGTH } from "@/config/auth";

/** Fields sent to `PATCH /v1/projects/{ref}/config/auth` (Supabase Management API). */
export type AuthConfigPatch = {
  mailer_otp_length: number;
  mailer_otp_exp: number;
  rate_limit_email_sent: number;
  site_url: string;
  mailer_subjects_magic_link: string;
  mailer_templates_magic_link_content: string;
  mailer_subjects_confirmation: string;
  mailer_templates_confirmation_content: string;
};

/**
 * Auth settings shared by every hosted project. The code template goes into both the
 * "Magic Link" and "Confirm signup" templates so a first-time user always gets a code.
 */
export function buildAuthConfigPatch(input: { siteUrl: string; template: { subject: string; html: string } }): AuthConfigPatch {
  return {
    mailer_otp_length: OTP_LENGTH,
    mailer_otp_exp: OTP_EXPIRY_SECONDS,
    rate_limit_email_sent: AUTH_EMAILS_PER_HOUR,
    site_url: input.siteUrl,
    mailer_subjects_magic_link: input.template.subject,
    mailer_templates_magic_link_content: input.template.html,
    mailer_subjects_confirmation: input.template.subject,
    mailer_templates_confirmation_content: input.template.html,
  };
}
```
Run the Step 4 tests → PASS.

- [ ] **Step 6: Script**

`scripts/supabase-auth-config.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SUPABASE_PROJECTS, type SupabaseProjectName } from "../src/config/supabase-projects";
import { renderSignInCodeTemplate } from "../src/emails/sign-in-code-email";
import { buildAuthConfigPatch } from "../src/server/supabase/auth-config";

const LOCAL_TEMPLATE_PATH = "supabase/templates/sign-in-code.html";
const TARGETS = ["local", "preview", "prod", "all"] as const;
type Target = (typeof TARGETS)[number];

function readTarget(): Target {
  const value = process.argv[2] ?? "all";
  const target = TARGETS.find((candidate) => candidate === value);
  if (!target) {
    throw new Error(`Usage: bun run auth:config <${TARGETS.join("|")}>`);
  }
  return target;
}

function readAccessToken(): string {
  return process.env.SUPABASE_ACCESS_TOKEN ?? readFileSync(join(homedir(), ".supabase", "access-token"), "utf8").trim();
}

async function pushHosted(name: SupabaseProjectName, template: { subject: string; html: string }, token: string): Promise<void> {
  const project = SUPABASE_PROJECTS[name];
  const response = await fetch(`https://api.supabase.com/v1/projects/${project.ref}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildAuthConfigPatch({ siteUrl: project.siteUrl, template })),
  });
  if (!response.ok) {
    throw new Error(`${name}: Supabase answered HTTP ${response.status}: ${await response.text()}`);
  }
  process.stdout.write(`updated auth config of ${name}\n`);
}

const target = readTarget();
const template = await renderSignInCodeTemplate();
if (target === "local" || target === "all") {
  writeFileSync(LOCAL_TEMPLATE_PATH, template.html);
  process.stdout.write(`wrote ${LOCAL_TEMPLATE_PATH}\n`);
}
const hosted: SupabaseProjectName[] = target === "all" ? ["preview", "prod"] : target === "local" ? [] : [target];
if (hosted.length > 0) {
  const token = readAccessToken();
  for (const name of hosted) {
    await pushHosted(name, template, token);
  }
}
```
`package.json` scripts: `"auth:config": "bun scripts/supabase-auth-config.ts"`.

- [ ] **Step 7: Local stack config** — in `supabase/config.toml`:
  - `[auth.email]`: `otp_length = 8`, `otp_expiry = 900`.
  - Add after the commented invite template:
```toml
[auth.email.template.magic_link]
subject = "Your TapNShow sign-in code"
content_path = "./supabase/templates/sign-in-code.html"

[auth.email.template.confirmation]
subject = "Your TapNShow sign-in code"
content_path = "./supabase/templates/sign-in-code.html"
```
  - `[local_smtp]`: uncomment `smtp_port = 44325` (our `SystemMailer` sends to Mailpit locally, Task 12).
  - Add a test to `src/server/supabase/auth-config.test.ts` that keeps the local subject in sync:
```ts
import { readFileSync } from "node:fs";
import { renderSignInCodeTemplate } from "@/emails/sign-in-code-email";

it("local config.toml uses the same subject as the hosted template", async () => {
  const toml = readFileSync("supabase/config.toml", "utf8");
  const { subject } = await renderSignInCodeTemplate();
  expect(toml.match(/subject = "Your TapNShow sign-in code"/g)).toHaveLength(2);
  expect(subject).toBe("Your TapNShow sign-in code");
});
```

- [ ] **Step 8: Run locally**
```bash
bun run auth:config local
supabase stop && supabase start
```
Then request a code against the local stack and read Mailpit (no app code needed yet):
```bash
bun -e '
const s = JSON.parse(require("node:child_process").execSync("supabase status -o json").toString());
const email = `t1-${Date.now()}@example.com`;
await fetch(`${s.API_URL}/auth/v1/otp`, { method: "POST", headers: { apikey: s.PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, create_user: true }) });
await new Promise((r) => setTimeout(r, 1500));
const list = await (await fetch(`${s.MAILPIT_URL}/api/v1/messages`)).json();
const msg = list.messages.find((m) => m.To.some((t) => t.Address === email));
const full = await (await fetch(`${s.MAILPIT_URL}/api/v1/message/${msg.ID}`)).json();
console.log(msg.Subject, /\b\d{8}\b/.test(full.Text));'
```
Expected: `Your TapNShow sign-in code true`. Open Mailpit (`http://127.0.0.1:44324`) and take a screenshot of the email for the PR.

- [ ] **Step 9: Push to hosted projects** — `bun run auth:config preview`, then `bun run auth:config prod`. Verify (non-secret fields only):
```bash
bun -e '
const token = require("node:fs").readFileSync(require("node:os").homedir() + "/.supabase/access-token", "utf8").trim();
for (const ref of ["wayabcidwnhgaazgsuns", "dysqhjvwabqahpctytnw"]) {
  const j = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { Authorization: `Bearer ${token}` } })).json();
  console.log(ref, j.mailer_otp_length, j.mailer_otp_exp, j.rate_limit_email_sent, j.site_url, j.mailer_subjects_magic_link, String(j.mailer_templates_magic_link_content).includes("{{ .Token }}"));
}'
```
Expected: `8 900 15 <siteUrl> Your TapNShow sign-in code true` for both.

- [ ] **Step 10: Quality + commit + PR** — `bun run lint && bun run format:check && bun run typecheck && CI=true bun run test`; commit `feat: branded sign-in code email and Supabase auth settings script`; PR with the Mailpit screenshot.

---

### Task 2: DB core — schema, RLS, `create_workspace`, rate limits, DB test harness, CI `db` job

**Labels:** `area:db`, `area:auth`, `area:infra`

Load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills before writing SQL.

**Files:**
- Create: `supabase/migrations/<timestamp>_m2_core_workspaces.sql` (via `supabase migration new m2_core_workspaces`), `scripts/local-supabase-env.ts`, `scripts/local-supabase-env.test.ts`, `scripts/with-local-supabase.ts`, `vitest.db.config.mts`, `src/test/db/clients.ts`, `src/test/db/workspaces.ts`, `src/server/db/core.db.test.ts`
- Modify: `vitest.config.mts` (exclude `*.db.test.ts`), `package.json` (scripts `db:types`, `test:db`, `test:e2e`), `.github/workflows/ci.yml` (new `db` job; e2e moves there), `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Produces (SQL, schema `public`): enum `workspace_role ('owner','admin','viewer')`; tables `profiles`, `workspaces`, `workspace_roles` (spec §6); functions `create_workspace(p_name text, p_slug text, p_timezone text) returns workspaces`, `list_members(p_workspace uuid) returns table(user_id uuid, role workspace_role, can_check_in boolean, display_name text, avatar_url text, email text, joined_at timestamptz)`, `check_ip_rate_limit(p_action text, p_ip text) returns boolean` (service_role only).
- Produces (SQL, schema `private`): `app_limits`, `app_limit(name)`, `rate_limit_events`, `hit_rate_limit(key, limit, window)` (rolling window, per-key advisory lock), `role_of(workspace)`, `is_member(workspace, roles[])`, `set_updated_at()`, `handle_new_user()`.
- Error codes raised: `tn:unauthenticated`, `tn:forbidden`, `tn:invalid_input`, `tn:invalid_timezone`, `tn:workspace_limit`, `tn:rate_limited`.
- Produces (TS test helpers): `createTestUser(options?: { email?: string; fullName?: string }): Promise<TestUser>` with `TestUser = { id: string; email: string; client: SupabaseClient<Database> }`; `adminClient()`, `anonClient()`; `createWorkspaceAs(user: TestUser, name?: string): Promise<{ id: string; slug: string; name: string }>`; `addMember(workspaceId: string, userId: string, role: "owner" | "admin" | "viewer", canCheckIn?: boolean): Promise<void>`; `expectAppError(call: PromiseLike<{ error: { message: string } | null }>, code: string): Promise<void>`.
- Produces (scripts): `bun run test:db`, `bun run test:e2e` (both run against the local stack via `scripts/with-local-supabase.ts`).

- [ ] **Step 1: Migration** — `supabase migration new m2_core_workspaces`, then fill it:
```sql
-- M2 core (spec §6, §11): private helpers, limits, rate limits, profiles, workspaces, roles.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.workspace_role as enum ('owner', 'admin', 'viewer');

-- Single source of truth for numeric limits (spec §4, §8). TypeScript never repeats these.
create table private.app_limits (
  name text primary key,
  value integer not null check (value > 0)
);
alter table private.app_limits enable row level security;
insert into private.app_limits (name, value) values
  ('workspaces_owned_max', 10),
  ('workspace_create_per_hour', 5),
  ('otp_send_per_ip_per_hour', 20),
  ('invite_email_platform_per_day', 100),
  ('invite_email_workspace_per_day', 20),
  ('invite_expiry_days', 7);

create function private.app_limit(p_name text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value integer;
begin
  select l.value into v_value from private.app_limits l where l.name = p_name;
  if v_value is null then
    raise exception 'unknown limit %', p_name;
  end if;
  return v_value;
end;
$$;

-- Rolling-window limiter (an event log, not fixed windows): a daily email budget must hold
-- for any 24 hours, because Gmail's 500/day limit is rolling. Denied attempts are not logged.
create table private.rate_limit_events (
  key text not null,
  occurred_at timestamptz not null default now()
);
create index rate_limit_events_key_time_idx on private.rate_limit_events (key, occurred_at);
alter table private.rate_limit_events enable row level security;

create function private.hit_rate_limit(p_key text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_key));
  delete from private.rate_limit_events e where e.key = p_key and e.occurred_at <= pg_catalog.now() - p_window;
  select count(*) into v_count from private.rate_limit_events e where e.key = p_key;
  if v_count >= p_limit then
    return false;
  end if;
  insert into private.rate_limit_events (key) values (p_key);
  return true;
end;
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  timezone text not null,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.validate_workspace_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = new.timezone) then
    raise exception 'tn:invalid_timezone' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger workspaces_validate_timezone
  before insert or update of timezone on public.workspaces
  for each row execute function private.validate_workspace_timezone();
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  avatar_url text,
  locale text not null default 'en',
  last_workspace_id uuid references public.workspaces (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_last_workspace_idx on public.profiles (last_workspace_id);
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.workspace_roles (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  can_check_in boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_roles_check_in_viewers_only check (can_check_in = false or role = 'viewer')
);
create unique index workspace_roles_one_owner on public.workspace_roles (workspace_id) where role = 'owner';
create index workspace_roles_user_idx on public.workspace_roles (user_id);

-- Profile row for every auth user. Google's name/picture are copied for display only.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 80), ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.profiles (user_id) select u.id from auth.users u on conflict (user_id) do nothing;

create function private.role_of(p_workspace uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select r.role from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = (select auth.uid());
$$;

create function private.is_member(
  p_workspace uuid,
  p_roles public.workspace_role[] default array['owner', 'admin', 'viewer']::public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.role_of(p_workspace) = any (p_roles), false);
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid, public.workspace_role[]) to authenticated;
grant execute on function private.role_of(uuid) to authenticated;

-- Grants (new tables are not exposed by default) + RLS.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_roles enable row level security;
revoke all on table public.profiles, public.workspaces, public.workspace_roles from anon, authenticated;
grant select on table public.profiles, public.workspaces, public.workspace_roles to authenticated;
grant update (display_name, locale, last_workspace_id) on table public.profiles to authenticated;
grant update (name, timezone, locale) on table public.workspaces to authenticated;
grant all on table public.profiles, public.workspaces, public.workspace_roles to service_role;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (last_workspace_id is null or private.is_member(last_workspace_id))
  );

create policy workspaces_select_members on public.workspaces
  for select to authenticated
  using (private.is_member(id));
create policy workspaces_update_admins on public.workspaces
  for update to authenticated
  using (private.is_member(id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.is_member(id, array['owner', 'admin']::public.workspace_role[]));

create policy workspace_roles_select_members on public.workspace_roles
  for select to authenticated
  using (private.is_member(workspace_id));

-- Membership writes only through functions (spec §6, §11 SECURITY DEFINER exception).
create function public.create_workspace(p_name text, p_slug text, p_timezone text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace public.workspaces;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if (select count(*) from public.workspace_roles r where r.user_id = v_user and r.role = 'owner')
      >= private.app_limit('workspaces_owned_max') then
    raise exception 'tn:workspace_limit' using errcode = 'P0001';
  end if;
  if not private.hit_rate_limit('workspace_create:user:' || v_user, private.app_limit('workspace_create_per_hour'), interval '1 hour') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  insert into public.workspaces (name, slug, timezone)
  values (btrim(p_name), p_slug, p_timezone)
  returning * into v_workspace;
  insert into public.workspace_roles (workspace_id, user_id, role) values (v_workspace.id, v_user, 'owner');
  update public.profiles set last_workspace_id = v_workspace.id where user_id = v_user;
  return v_workspace;
end;
$$;

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
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return query
    select r.user_id, r.role, r.can_check_in, p.display_name, p.avatar_url, u.email::text, r.created_at
    from public.workspace_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.user_id = r.user_id
    where r.workspace_id = p_workspace
    order by r.role, coalesce(p.display_name, u.email::text);
end;
$$;

-- Pre-auth limit (OTP requests per IP). Called only by the server with the secret key.
create function public.check_ip_rate_limit(p_action text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action <> 'otp_send' or char_length(coalesce(p_ip, '')) not between 1 and 64 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit('otp_send:ip:' || p_ip, private.app_limit('otp_send_per_ip_per_hour'), interval '1 hour');
end;
$$;

revoke execute on function public.create_workspace(text, text, text) from public, anon;
revoke execute on function public.list_members(uuid) from public, anon;
revoke execute on function public.check_ip_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.check_ip_rate_limit(text, text) to service_role;
```
Apply locally and check advisors:
```bash
supabase migration up --local
supabase db advisors --local
```
Expected: no `WARN`/`ERROR` for the new objects. Fix any finding before continuing (record a `Ruling:` for anything left as INFO).

- [ ] **Step 2: Types** — change `package.json` `db:types` to generate from the local stack, then regenerate:
```json
"db:types": "supabase gen types typescript --local --schema public > src/server/db/database.types.ts"
```
```bash
bun run db:types && grep -c "create_workspace\|list_members\|workspace_role" src/server/db/database.types.ts
```
Expected: a count ≥ 3.

- [ ] **Step 3: Local-stack env (test first)**

`scripts/local-supabase-env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { localSupabaseEnv, parseLocalStatus } from "./local-supabase-env";

const status = JSON.stringify({
  API_URL: "http://127.0.0.1:44321",
  PUBLISHABLE_KEY: "sb_publishable_local",
  SECRET_KEY: "sb_secret_local",
  MAILPIT_URL: "http://127.0.0.1:44324",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:44322/postgres",
});

describe("localSupabaseEnv", () => {
  it("maps `supabase status` output to the app's env names", () => {
    expect(localSupabaseEnv(parseLocalStatus(status))).toMatchObject({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:44321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
      SUPABASE_SECRET_KEY: "sb_secret_local",
      MAILPIT_URL: "http://127.0.0.1:44324",
    });
  });

  it("rejects output without the API URL", () => {
    expect(() => parseLocalStatus(JSON.stringify({ PUBLISHABLE_KEY: "x" }))).toThrow(/API_URL/);
  });
});
```
`scripts/local-supabase-env.ts`:
```ts
import { z } from "zod";

/** App URL used by Playwright and the local e2e build. */
export const LOCAL_APP_URL = "http://localhost:3000";

const localStatusSchema = z.object({
  API_URL: z.url(),
  PUBLISHABLE_KEY: z.string().min(1),
  SECRET_KEY: z.string().min(1),
  MAILPIT_URL: z.url(),
});

/** The parts of `supabase status -o json` the app needs. */
export type LocalStatus = z.infer<typeof localStatusSchema>;

/**
 * Parses `supabase status -o json` output.
 * @throws ZodError naming the missing fields
 */
export function parseLocalStatus(json: string): LocalStatus {
  return localStatusSchema.parse(JSON.parse(json));
}

/** Environment that points the app, DB tests and e2e at the local Supabase stack. */
export function localSupabaseEnv(status: LocalStatus): Record<string, string> {
  return {
    NEXT_PUBLIC_APP_URL: LOCAL_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
    MAILPIT_URL: status.MAILPIT_URL,
  };
}
```
`scripts/with-local-supabase.ts`:
```ts
import { execFileSync, spawnSync } from "node:child_process";
import { localSupabaseEnv, parseLocalStatus } from "./local-supabase-env";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error("Usage: bun scripts/with-local-supabase.ts <command> [...args]");
}
const status = parseLocalStatus(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: { ...process.env, ...localSupabaseEnv(status) },
});
process.exit(result.status ?? 1);
```
`package.json` scripts:
```json
"test:db": "bun scripts/with-local-supabase.ts vitest run --config vitest.db.config.mts",
"test:e2e": "bun scripts/with-local-supabase.ts playwright test"
```
Run: `CI=true bun run test scripts` → PASS.

- [ ] **Step 4: DB test config + helpers**

`vitest.db.config.mts`:
```ts
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
```
In `vitest.config.mts`, import `configDefaults` from `vitest/config` and add `exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"]` to `test`.

`src/test/db/clients.ts`:
```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import type { Database } from "@/server/db/database.types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing: run DB tests with \`bun run test:db\``);
  }
  return value;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client for test setup only (bypasses RLS). */
export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), noSession);
}

/** Signed-out client (the `anon` role). */
export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    noSession,
  );
}

/** A confirmed user and a client signed in as them. */
export type TestUser = { id: string; email: string; client: SupabaseClient<Database> };

/**
 * Creates a confirmed user (password sign-in is used only by tests) and signs in.
 * @param options.fullName - stored as Google would store it, to exercise the profile trigger
 */
export async function createTestUser(options: { email?: string; fullName?: string } = {}): Promise<TestUser> {
  const email = options.email ?? `user-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID();
  const created = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: options.fullName ? { full_name: options.fullName } : {},
  });
  if (created.error) {
    throw created.error;
  }
  const client = anonClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) {
    throw signedIn.error;
  }
  return { id: created.data.user.id, email, client };
}

/** Asserts that a Supabase call failed with `tn:<code>` (our database error convention). */
export async function expectAppError(
  call: PromiseLike<{ error: { message: string } | null }>,
  code: string,
): Promise<void> {
  const { error } = await call;
  expect(error?.message).toBe(`tn:${code}`);
}
```
`src/test/db/workspaces.ts`:
```ts
import type { TestUser } from "./clients";
import { adminClient } from "./clients";

/** Workspace fields tests need. */
export type TestWorkspace = { id: string; slug: string; name: string };

/** Creates a workspace through `create_workspace`, owned by `user`. */
export async function createWorkspaceAs(user: TestUser, name = "Test Club"): Promise<TestWorkspace> {
  const slug = `test-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await user.client.rpc("create_workspace", { p_name: name, p_slug: slug, p_timezone: "Africa/Tunis" });
  if (error || !data) {
    throw error ?? new Error("create_workspace returned nothing");
  }
  return { id: data.id, slug: data.slug, name: data.name };
}

/** Adds a member directly (service role), bypassing the membership functions. */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: "owner" | "admin" | "viewer",
  canCheckIn = false,
): Promise<void> {
  const { error } = await adminClient()
    .from("workspace_roles")
    .insert({ workspace_id: workspaceId, user_id: userId, role, can_check_in: canCheckIn });
  if (error) {
    throw error;
  }
}
```

- [ ] **Step 5: Failing DB tests** — `src/server/db/core.db.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

describe("profiles", () => {
  it("are created at sign-up, with Google's name when present", async () => {
    const named = await createTestUser({ fullName: "Amira Ben Ali" });
    const anonymous = await createTestUser();
    const a = await named.client.from("profiles").select("display_name").single();
    const b = await anonymous.client.from("profiles").select("display_name").single();
    expect(a.data?.display_name).toBe("Amira Ben Ali");
    expect(b.data?.display_name).toBeNull();
  });

  it("are private to their owner", async () => {
    const owner = await createTestUser({ fullName: "Owner" });
    const other = await createTestUser();
    const { data } = await other.client.from("profiles").select("user_id").eq("user_id", owner.id);
    expect(data).toEqual([]);
  });

  it("cannot point last_workspace_id at a workspace the user is not in", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const workspace = await createWorkspaceAs(owner);
    const { error } = await stranger.client
      .from("profiles")
      .update({ last_workspace_id: workspace.id })
      .eq("user_id", stranger.id);
    expect(error?.code).toBe("42501");
  });
});

describe("create_workspace", () => {
  it("makes the caller the Owner and remembers the workspace", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "  GDG Club  ");
    expect(workspace.name).toBe("GDG Club");
    const roles = await owner.client.from("workspace_roles").select("role").eq("workspace_id", workspace.id);
    expect(roles.data).toEqual([{ role: "owner" }]);
    const profile = await owner.client.from("profiles").select("last_workspace_id").single();
    expect(profile.data?.last_workspace_id).toBe(workspace.id);
  });

  it("rejects unknown timezones and blank names", async () => {
    const owner = await createTestUser();
    await expectAppError(owner.client.rpc("create_workspace", { p_name: "X", p_slug: "x-abcd", p_timezone: "Mars/Olympus" }), "invalid_timezone");
    await expectAppError(owner.client.rpc("create_workspace", { p_name: "   ", p_slug: "y-abcd", p_timezone: "Africa/Tunis" }), "invalid_input");
  });

  it("stops at the owned-workspace limit", async () => {
    const owner = await createTestUser();
    const admin = adminClient();
    const limit = 10;
    for (let index = 0; index < limit; index += 1) {
      const { data } = await admin
        .from("workspaces")
        .insert({ name: `W${index}`, slug: `w-${crypto.randomUUID().slice(0, 8)}`, timezone: "Africa/Tunis" })
        .select("id")
        .single();
      await addMember(data!.id, owner.id, "owner");
    }
    await expectAppError(owner.client.rpc("create_workspace", { p_name: "One more", p_slug: "one-more-abcd", p_timezone: "Africa/Tunis" }), "workspace_limit");
  });

  it("rate-limits creation to 5 per hour per user", async () => {
    const owner = await createTestUser();
    for (let index = 0; index < 5; index += 1) {
      await createWorkspaceAs(owner, `Club ${index}`);
    }
    await expectAppError(owner.client.rpc("create_workspace", { p_name: "Sixth", p_slug: `sixth-${crypto.randomUUID().slice(0, 4)}`, p_timezone: "Africa/Tunis" }), "rate_limited");
  });
});

describe("workspace isolation", () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    owner = await createTestUser({ fullName: "Owner" });
    viewer = await createTestUser({ fullName: "Viewer" });
    stranger = await createTestUser();
    workspace = await createWorkspaceAs(owner);
    await addMember(workspace.id, viewer.id, "viewer");
  });

  it("members read the workspace; strangers and anon do not", async () => {
    expect((await viewer.client.from("workspaces").select("id").eq("id", workspace.id)).data).toHaveLength(1);
    expect((await stranger.client.from("workspaces").select("id").eq("id", workspace.id)).data).toEqual([]);
    expect((await anonClient().from("workspaces").select("id")).error?.code).toBe("42501");
  });

  it("Admins rename; Viewers cannot", async () => {
    const byViewer = await viewer.client.from("workspaces").update({ name: "Hacked" }).eq("id", workspace.id).select("id");
    expect(byViewer.data).toEqual([]);
    const byOwner = await owner.client.from("workspaces").update({ name: "Renamed" }).eq("id", workspace.id).select("name");
    expect(byOwner.data).toEqual([{ name: "Renamed" }]);
  });

  it("nobody writes workspace_roles directly", async () => {
    const { error } = await owner.client.from("workspace_roles").insert({ workspace_id: workspace.id, user_id: stranger.id, role: "admin" });
    expect(error?.code).toBe("42501");
  });

  it("list_members shows members with emails, only to members", async () => {
    const { data } = await viewer.client.rpc("list_members", { p_workspace: workspace.id });
    expect(data?.map((member) => member.email).sort()).toEqual([owner.email, viewer.email].sort());
    await expectAppError(stranger.client.rpc("list_members", { p_workspace: workspace.id }), "forbidden");
  });
});

describe("check_ip_rate_limit", () => {
  it("is not callable by signed-in users", async () => {
    const user = await createTestUser();
    const { error } = await user.client.rpc("check_ip_rate_limit", { p_action: "otp_send", p_ip: "203.0.113.1" });
    expect(error?.code).toBe("42501");
  });

  it("allows 20 OTP requests per IP per hour", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}-${crypto.randomUUID().slice(0, 4)}`;
    const results: boolean[] = [];
    for (let index = 0; index < 21; index += 1) {
      const { data } = await adminClient().rpc("check_ip_rate_limit", { p_action: "otp_send", p_ip: ip });
      results.push(data === true);
    }
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
  });
});
```
Run before the migration exists to see RED: `supabase db reset --local` with the migration file temporarily moved out, `bun run test:db` → FAIL; restore the file, `supabase db reset --local`, `bun run test:db` → PASS.

- [ ] **Step 6: CI `db` job** — in `.github/workflows/ci.yml`, remove the two Playwright steps from `quality` and add:
```yaml
  db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - uses: supabase/setup-cli@v3
        with:
          version: 2.119.0
      - run: bun install --frozen-lockfile
      - run: supabase start -x studio,edge-runtime,logflare,vector,imgproxy,realtime,storage-api,supavisor
      - run: supabase db advisors --local
      - run: bun run test:db
      - run: bunx playwright install --with-deps chromium
      - run: bun run test:e2e
```
(`postgres-meta` stays: `supabase db advisors` and type generation may use it.) Push; both `quality` and `db` must be green. Record the `db` job duration in the PR (the owner decides in Task 13 whether to make it a required check).

- [ ] **Step 7: Apply to hosted projects (after merge)**
```bash
supabase link --project-ref wayabcidwnhgaazgsuns && supabase db push
supabase link --project-ref dysqhjvwabqahpctytnw && supabase db push
supabase db advisors --linked
```
Expected: migration applied on both; advisors show no new WARN/ERROR.

- [ ] **Step 8: Commit** — `feat: workspaces, roles and profiles schema with RLS and DB tests`.

---

### Task 3: DB membership functions (roles, remove, leave, transfer, delete)

**Labels:** `area:db`, `area:auth`

**Files:**
- Create: `supabase/migrations/<timestamp>_m2_membership.sql`, `src/server/db/membership.db.test.ts`
- Modify: `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: Task 2 tables, `private.role_of`, test helpers.
- Produces (all `security definer`, `authenticated` only):
  - `change_role(p_workspace uuid, p_user uuid, p_role workspace_role, p_can_check_in boolean) returns void`
  - `remove_member(p_workspace uuid, p_user uuid) returns void`
  - `leave_workspace(p_workspace uuid) returns void`
  - `transfer_ownership(p_workspace uuid, p_new_owner uuid, p_confirm_name text) returns void`
  - `delete_workspace(p_workspace uuid, p_confirm_name text) returns void`
- Error codes: `tn:forbidden`, `tn:not_found`, `tn:use_transfer`, `tn:use_leave`, `tn:owner_cannot_leave`, `tn:name_mismatch`, `tn:target_not_admin`, `tn:invalid_input`.
- Rules (spec §3, §7.11): Owner-only = Admin management (invite/promote/demote/remove Admins), transfer, delete. Admins manage Viewers and `can_check_in`. Nobody changes or removes the Owner except through `transfer_ownership`. Removing yourself is `leave_workspace`.

- [ ] **Step 1: Failing tests** — `src/server/db/membership.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let workspace: TestWorkspace;

async function roleOf(user: TestUser): Promise<string | null> {
  const { data } = await owner.client
    .from("workspace_roles")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role ?? null;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  stranger = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Robotics Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("change_role", () => {
  it("lets Admins toggle a Viewer's check-in permission", async () => {
    const { error } = await admin.client.rpc("change_role", { p_workspace: workspace.id, p_user: viewer.id, p_role: "viewer", p_can_check_in: true });
    expect(error).toBeNull();
    const { data } = await owner.client.from("workspace_roles").select("can_check_in").eq("user_id", viewer.id).single();
    expect(data?.can_check_in).toBe(true);
  });

  it("lets only the Owner promote to or demote from Admin", async () => {
    await expectAppError(admin.client.rpc("change_role", { p_workspace: workspace.id, p_user: viewer.id, p_role: "admin", p_can_check_in: false }), "forbidden");
    await expectAppError(admin.client.rpc("change_role", { p_workspace: workspace.id, p_user: admin.id, p_role: "viewer", p_can_check_in: false }), "forbidden");
    await owner.client.rpc("change_role", { p_workspace: workspace.id, p_user: viewer.id, p_role: "admin", p_can_check_in: false });
    expect(await roleOf(viewer)).toBe("admin");
  });

  it("never touches the Owner or creates a second one", async () => {
    await expectAppError(owner.client.rpc("change_role", { p_workspace: workspace.id, p_user: admin.id, p_role: "owner", p_can_check_in: false }), "use_transfer");
    await expectAppError(owner.client.rpc("change_role", { p_workspace: workspace.id, p_user: owner.id, p_role: "admin", p_can_check_in: false }), "use_transfer");
  });

  it("drops check-in when someone becomes Admin", async () => {
    await admin.client.rpc("change_role", { p_workspace: workspace.id, p_user: viewer.id, p_role: "viewer", p_can_check_in: true });
    await owner.client.rpc("change_role", { p_workspace: workspace.id, p_user: viewer.id, p_role: "admin", p_can_check_in: true });
    const { data } = await owner.client.from("workspace_roles").select("role, can_check_in").eq("user_id", viewer.id).single();
    expect(data).toEqual({ role: "admin", can_check_in: false });
  });

  it("refuses Viewers and strangers", async () => {
    await expectAppError(viewer.client.rpc("change_role", { p_workspace: workspace.id, p_user: viewer.id, p_role: "viewer", p_can_check_in: true }), "forbidden");
    await expectAppError(stranger.client.rpc("change_role", { p_workspace: workspace.id, p_user: viewer.id, p_role: "viewer", p_can_check_in: true }), "forbidden");
  });
});

describe("remove_member and leave_workspace", () => {
  it("Admins remove Viewers but not Admins; the Owner removes Admins", async () => {
    await expectAppError(admin.client.rpc("remove_member", { p_workspace: workspace.id, p_user: admin.id }), "use_leave");
    const second = await createTestUser();
    await addMember(workspace.id, second.id, "admin");
    await expectAppError(admin.client.rpc("remove_member", { p_workspace: workspace.id, p_user: second.id }), "forbidden");
    expect((await admin.client.rpc("remove_member", { p_workspace: workspace.id, p_user: viewer.id })).error).toBeNull();
    expect((await owner.client.rpc("remove_member", { p_workspace: workspace.id, p_user: second.id })).error).toBeNull();
    expect(await roleOf(viewer)).toBeNull();
    expect(await roleOf(second)).toBeNull();
  });

  it("nobody removes the Owner", async () => {
    await expectAppError(admin.client.rpc("remove_member", { p_workspace: workspace.id, p_user: owner.id }), "forbidden");
  });

  it("members leave; the Owner must transfer first", async () => {
    expect((await viewer.client.rpc("leave_workspace", { p_workspace: workspace.id })).error).toBeNull();
    expect(await roleOf(viewer)).toBeNull();
    await expectAppError(owner.client.rpc("leave_workspace", { p_workspace: workspace.id }), "owner_cannot_leave");
    await expectAppError(stranger.client.rpc("leave_workspace", { p_workspace: workspace.id }), "not_found");
  });
});

describe("transfer_ownership", () => {
  it("swaps Owner and Admin atomically after the name is typed", async () => {
    await expectAppError(owner.client.rpc("transfer_ownership", { p_workspace: workspace.id, p_new_owner: admin.id, p_confirm_name: "robotics club" }), "name_mismatch");
    const { error } = await owner.client.rpc("transfer_ownership", { p_workspace: workspace.id, p_new_owner: admin.id, p_confirm_name: "Robotics Club" });
    expect(error).toBeNull();
    expect(await roleOf(admin)).toBe("owner");
    expect(await roleOf(owner)).toBe("admin");
  });

  it("only transfers to an existing Admin, and only by the Owner", async () => {
    await expectAppError(owner.client.rpc("transfer_ownership", { p_workspace: workspace.id, p_new_owner: viewer.id, p_confirm_name: "Robotics Club" }), "target_not_admin");
    await expectAppError(admin.client.rpc("transfer_ownership", { p_workspace: workspace.id, p_new_owner: admin.id, p_confirm_name: "Robotics Club" }), "forbidden");
  });
});

describe("delete_workspace", () => {
  it("only the Owner deletes, after typing the exact name", async () => {
    await expectAppError(admin.client.rpc("delete_workspace", { p_workspace: workspace.id, p_confirm_name: "Robotics Club" }), "forbidden");
    await expectAppError(owner.client.rpc("delete_workspace", { p_workspace: workspace.id, p_confirm_name: "Robotics" }), "name_mismatch");
    expect((await owner.client.rpc("delete_workspace", { p_workspace: workspace.id, p_confirm_name: "Robotics Club" })).error).toBeNull();
    expect((await owner.client.from("workspaces").select("id").eq("id", workspace.id)).data).toEqual([]);
    const profile = await owner.client.from("profiles").select("last_workspace_id").single();
    expect(profile.data?.last_workspace_id).toBeNull();
  });
});
```
Run `bun run test:db src/server/db/membership.db.test.ts` → FAIL (functions missing).

- [ ] **Step 2: Migration** — `supabase migration new m2_membership`:
```sql
-- M2 membership changes (spec §3, §7.11). Owner-only: Admin management, transfer, delete.

create function public.change_role(
  p_workspace uuid,
  p_user uuid,
  p_role public.workspace_role,
  p_can_check_in boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.workspace_role := private.role_of(p_workspace);
  v_target public.workspace_role;
begin
  if v_caller is null or v_caller = 'viewer' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select r.role into v_target from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = p_user
  for update;
  if v_target is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_role = 'owner' or v_target = 'owner' then
    raise exception 'tn:use_transfer' using errcode = 'P0001';
  end if;
  if (v_target = 'admin' or p_role = 'admin') and v_caller <> 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  update public.workspace_roles
  set role = p_role,
      can_check_in = (p_role = 'viewer' and coalesce(p_can_check_in, false))
  where workspace_id = p_workspace and user_id = p_user;
end;
$$;

create function public.remove_member(p_workspace uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.workspace_role := private.role_of(p_workspace);
  v_target public.workspace_role;
begin
  if v_caller is null or v_caller = 'viewer' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_user = auth.uid() then
    raise exception 'tn:use_leave' using errcode = 'P0001';
  end if;
  select r.role into v_target from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = p_user
  for update;
  if v_target is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_target = 'owner' or (v_target = 'admin' and v_caller <> 'owner') then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles where workspace_id = p_workspace and user_id = p_user;
  update public.profiles set last_workspace_id = null where user_id = p_user and last_workspace_id = p_workspace;
end;
$$;

create function public.leave_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.workspace_role := private.role_of(p_workspace);
begin
  if v_caller is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_caller = 'owner' then
    raise exception 'tn:owner_cannot_leave' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles where workspace_id = p_workspace and user_id = auth.uid();
  update public.profiles set last_workspace_id = null where user_id = auth.uid() and last_workspace_id = p_workspace;
end;
$$;

create function public.transfer_ownership(p_workspace uuid, p_new_owner uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_target public.workspace_role;
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select w.name into v_name from public.workspaces w where w.id = p_workspace for update;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  select r.role into v_target from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = p_new_owner
  for update;
  if v_target is distinct from 'admin' then
    raise exception 'tn:target_not_admin' using errcode = 'P0001';
  end if;
  update public.workspace_roles set role = 'admin'
  where workspace_id = p_workspace and user_id = auth.uid();
  update public.workspace_roles set role = 'owner', can_check_in = false
  where workspace_id = p_workspace and user_id = p_new_owner;
end;
$$;

create function public.delete_workspace(p_workspace uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select w.name into v_name from public.workspaces w where w.id = p_workspace for update;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  delete from public.workspaces where id = p_workspace;
end;
$$;

revoke execute on function
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text)
from public, anon;
grant execute on function
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text)
to authenticated;
```
Note on `transfer_ownership`: the old Owner is demoted **before** the new one is promoted, so the one-Owner unique index never sees two Owners inside the transaction.

- [ ] **Step 3: Apply, advise, test**
```bash
supabase migration up --local && supabase db advisors --local
bun run db:types
bun run test:db
```
Expected: all DB tests PASS; no new advisor WARN/ERROR.

- [ ] **Step 4: Commit, PR; after merge apply to preview then prod** (`supabase link … && supabase db push` for each, as in Task 2 Step 7). Commit message: `feat: membership functions with Owner-only Admin management`.

---

### Task 4: DB invites

**Labels:** `area:db`, `area:auth`

**Files:**
- Create: `supabase/migrations/<timestamp>_m2_invites.sql`, `src/server/db/invites.db.test.ts`
- Modify: `src/server/db/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: Task 2/3 schema, `private.app_limit`, `private.hit_rate_limit`, `private.role_of`, `private.is_member`.
- Produces:
  - Table `workspace_invites` (spec §6). `authenticated` may select every column **except** `token_hash` (column grant), and only for workspaces where they are Owner/Admin. Queries must list columns explicitly — `select("*")` fails by design.
  - `create_invite(p_workspace uuid, p_email text, p_role workspace_role, p_token_hash text) returns uuid` — replaces any open invite for the same normalized email.
  - `renew_invite(p_invite uuid, p_token_hash text) returns void` — new token, new 7-day expiry, same row.
  - `revoke_invite(p_invite uuid) returns void`.
  - `consume_invite_email(p_workspace uuid) returns boolean` — false when the workspace (20/24 h) or platform (100/24 h) email budget is used up.
  - `invite_preview(p_token_hash text) returns table(status text, workspace_name text, workspace_slug text, role workspace_role, masked_email text)`; `status` ∈ `not_found | revoked | already_member | used | expired | wrong_account | ready`.
  - `accept_invite(p_token_hash text) returns text` (workspace slug).
- Error codes: `tn:forbidden`, `tn:not_found`, `tn:invalid_input`, `tn:already_member`, `tn:invite_closed`, `tn:invite_revoked`, `tn:invite_already_member`, `tn:invite_used`, `tn:invite_expired`, `tn:invite_wrong_account`, `tn:unauthenticated`.

- [ ] **Step 1: Failing tests** — `src/server/db/invites.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const hash = (): string => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Debate Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

async function invite(by: TestUser, email: string, role: "admin" | "viewer" = "viewer"): Promise<{ id: string; tokenHash: string }> {
  const tokenHash = hash();
  const { data, error } = await by.client.rpc("create_invite", { p_workspace: workspace.id, p_email: email, p_role: role, p_token_hash: tokenHash });
  if (error || !data) {
    throw error ?? new Error("no invite id");
  }
  return { id: data, tokenHash };
}

async function previewStatus(user: TestUser, tokenHash: string): Promise<string | undefined> {
  const { data } = await user.client.rpc("invite_preview", { p_token_hash: tokenHash });
  return data?.[0]?.status;
}

describe("create_invite", () => {
  it("Admins invite Viewers; only the Owner invites Admins", async () => {
    await invite(admin, "new.viewer@example.test");
    await expectAppError(admin.client.rpc("create_invite", { p_workspace: workspace.id, p_email: "new.admin@example.test", p_role: "admin", p_token_hash: hash() }), "forbidden");
    await invite(owner, "new.admin@example.test", "admin");
    await expectAppError(viewer.client.rpc("create_invite", { p_workspace: workspace.id, p_email: "x@example.test", p_role: "viewer", p_token_hash: hash() }), "forbidden");
  });

  it("normalizes the email and keeps one open invite per address", async () => {
    const first = await invite(admin, "  Ali.Ben@Example.TEST ");
    const second = await invite(admin, "ali.ben@example.test");
    const { data } = await admin.client.from("workspace_invites").select("id, email, revoked_at").eq("workspace_id", workspace.id);
    expect(data?.find((row) => row.id === first.id)?.revoked_at).not.toBeNull();
    expect(data?.find((row) => row.id === second.id)).toMatchObject({ email: "ali.ben@example.test", revoked_at: null });
  });

  it("refuses existing members and malformed emails", async () => {
    await expectAppError(admin.client.rpc("create_invite", { p_workspace: workspace.id, p_email: viewer.email.toUpperCase(), p_role: "viewer", p_token_hash: hash() }), "already_member");
    await expectAppError(admin.client.rpc("create_invite", { p_workspace: workspace.id, p_email: "not-an-email", p_role: "viewer", p_token_hash: hash() }), "invalid_input");
  });

  it("an Admin cannot replace the Owner's pending Admin invite", async () => {
    await invite(owner, "future.admin@example.test", "admin");
    await expectAppError(admin.client.rpc("create_invite", { p_workspace: workspace.id, p_email: "future.admin@example.test", p_role: "viewer", p_token_hash: hash() }), "forbidden");
  });
});

describe("invite visibility", () => {
  it("Owners and Admins list invites, Viewers do not, and nobody reads token hashes", async () => {
    await invite(admin, "someone@example.test");
    expect((await admin.client.from("workspace_invites").select("id").eq("workspace_id", workspace.id)).data).toHaveLength(1);
    expect((await viewer.client.from("workspace_invites").select("id").eq("workspace_id", workspace.id)).data).toEqual([]);
    expect((await owner.client.from("workspace_invites").select("token_hash")).error?.code).toBe("42501");
  });
});

describe("invite_preview and accept_invite", () => {
  it("accepts with the invited verified email, whatever its case", async () => {
    const invitee = await createTestUser({ email: `ali.${crypto.randomUUID().slice(0, 6)}@example.test` });
    const sent = await invite(admin, `  ${invitee.email.toUpperCase()} `);
    expect(await previewStatus(invitee, sent.tokenHash)).toBe("ready");
    const { data: slug, error } = await invitee.client.rpc("accept_invite", { p_token_hash: sent.tokenHash });
    expect(error).toBeNull();
    expect(slug).toBe(workspace.slug);
    const role = await invitee.client.from("workspace_roles").select("role").eq("workspace_id", workspace.id).single();
    expect(role.data?.role).toBe("viewer");
    expect(await previewStatus(invitee, sent.tokenHash)).toBe("already_member");
  });

  it("shows a masked email to the wrong account and refuses to accept", async () => {
    const sent = await invite(admin, "amira@example.test");
    const other = await createTestUser();
    const { data } = await other.client.rpc("invite_preview", { p_token_hash: sent.tokenHash });
    expect(data?.[0]).toMatchObject({ status: "wrong_account", workspace_name: "Debate Club", masked_email: "a•••@example.test" });
    await expectAppError(other.client.rpc("accept_invite", { p_token_hash: sent.tokenHash }), "invite_wrong_account");
  });

  it("reports revoked, expired, used and unknown tokens", async () => {
    const invitee = await createTestUser();
    const revoked = await invite(admin, invitee.email);
    await admin.client.rpc("revoke_invite", { p_invite: revoked.id });
    expect(await previewStatus(invitee, revoked.tokenHash)).toBe("revoked");

    const expired = await invite(admin, invitee.email);
    await adminClient().from("workspace_invites").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", expired.id);
    expect(await previewStatus(invitee, expired.tokenHash)).toBe("expired");
    await expectAppError(invitee.client.rpc("accept_invite", { p_token_hash: expired.tokenHash }), "invite_expired");

    expect(await previewStatus(invitee, hash())).toBe("not_found");
  });

  it("marks an accepted invite as used for everyone else", async () => {
    const invitee = await createTestUser();
    const sent = await invite(admin, invitee.email);
    await invitee.client.rpc("accept_invite", { p_token_hash: sent.tokenHash });
    const other = await createTestUser();
    expect(await previewStatus(other, sent.tokenHash)).toBe("used");
  });

  it("requires sign-in", async () => {
    expect((await anonClient().rpc("invite_preview", { p_token_hash: hash() })).error?.code).toBe("42501");
  });
});

describe("renew_invite", () => {
  it("replaces the token and keeps one row", async () => {
    const invitee = await createTestUser();
    const sent = await invite(admin, invitee.email);
    const fresh = hash();
    expect((await admin.client.rpc("renew_invite", { p_invite: sent.id, p_token_hash: fresh })).error).toBeNull();
    expect(await previewStatus(invitee, sent.tokenHash)).toBe("not_found");
    expect(await previewStatus(invitee, fresh)).toBe("ready");
  });

  it("refuses closed invites", async () => {
    const sent = await invite(admin, "closed@example.test");
    await admin.client.rpc("revoke_invite", { p_invite: sent.id });
    await expectAppError(admin.client.rpc("renew_invite", { p_invite: sent.id, p_token_hash: hash() }), "invite_closed");
  });
});

describe("consume_invite_email", () => {
  it("allows 20 invite emails per workspace per 24 hours, for Owners/Admins only", async () => {
    const results: boolean[] = [];
    for (let index = 0; index < 21; index += 1) {
      const { data } = await admin.client.rpc("consume_invite_email", { p_workspace: workspace.id });
      results.push(data === true);
    }
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
    await expectAppError(viewer.client.rpc("consume_invite_email", { p_workspace: workspace.id }), "forbidden");
  });
});
```
Run → FAIL.

- [ ] **Step 2: Migration** — `supabase migration new m2_invites`:
```sql
-- M2 invites (spec §6, §7.13): email-bound, single-use, hashed tokens, 7-day expiry.

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and char_length(email) <= 254
  ),
  role public.workspace_role not null check (role in ('admin', 'viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workspace_invites_one_open on public.workspace_invites (workspace_id, email)
  where accepted_at is null and revoked_at is null;
create index workspace_invites_workspace_idx on public.workspace_invites (workspace_id);
create trigger workspace_invites_set_updated_at
  before update on public.workspace_invites
  for each row execute function private.set_updated_at();

alter table public.workspace_invites enable row level security;
revoke all on table public.workspace_invites from anon, authenticated;
grant select (id, workspace_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on table public.workspace_invites to authenticated;
grant all on table public.workspace_invites to service_role;
create policy workspace_invites_select_managers on public.workspace_invites
  for select to authenticated
  using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create function private.can_manage_invite_role(p_workspace uuid, p_role public.workspace_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.role_of(p_workspace)
    when 'owner' then true
    when 'admin' then p_role = 'viewer'
    else false
  end;
$$;

create function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2);
$$;

-- Order matters: a member revisiting their own accepted link sees "already_member", not "used".
create function private.invite_status(p_invite public.workspace_invites)
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
  if exists (
    select 1 from public.workspace_roles r
    where r.workspace_id = p_invite.workspace_id and r.user_id = auth.uid()
  ) then
    return 'already_member';
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

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid, public.workspace_role[]) to authenticated;
grant execute on function private.role_of(uuid) to authenticated;

create function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_open_role public.workspace_role;
  v_id uuid;
begin
  if p_role not in ('admin', 'viewer') then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.can_manage_invite_role(p_workspace, p_role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.workspace_roles r join auth.users u on u.id = r.user_id
    where r.workspace_id = p_workspace and lower(u.email) = v_email
  ) then
    raise exception 'tn:already_member' using errcode = 'P0001';
  end if;
  select i.role into v_open_role from public.workspace_invites i
  where i.workspace_id = p_workspace and i.email = v_email and i.accepted_at is null and i.revoked_at is null
  for update;
  if v_open_role is not null and not private.can_manage_invite_role(p_workspace, v_open_role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  update public.workspace_invites set revoked_at = pg_catalog.now()
  where workspace_id = p_workspace and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
  values (
    p_workspace, v_email, p_role, p_token_hash, auth.uid(),
    pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'))
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.renew_invite(p_invite uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
begin
  select * into v_invite from public.workspace_invites i where i.id = p_invite for update;
  if v_invite.id is null or not private.is_member(v_invite.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.can_manage_invite_role(v_invite.workspace_id, v_invite.role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_invite.accepted_at is not null or v_invite.revoked_at is not null then
    raise exception 'tn:invite_closed' using errcode = 'P0001';
  end if;
  update public.workspace_invites
  set token_hash = p_token_hash,
      invited_by = auth.uid(),
      expires_at = pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'))
  where id = p_invite;
end;
$$;

create function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
begin
  select * into v_invite from public.workspace_invites i where i.id = p_invite for update;
  if v_invite.id is null or not private.is_member(v_invite.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.can_manage_invite_role(v_invite.workspace_id, v_invite.role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  update public.workspace_invites set revoked_at = pg_catalog.now()
  where id = p_invite and accepted_at is null and revoked_at is null;
end;
$$;

create function public.consume_invite_email(p_workspace uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not private.hit_rate_limit('invite_email:workspace:' || p_workspace, private.app_limit('invite_email_workspace_per_day'), interval '24 hours') then
    return false;
  end if;
  return private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours');
end;
$$;

create function public.invite_preview(p_token_hash text)
returns table (status text, workspace_name text, workspace_slug text, role public.workspace_role, masked_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.workspace_invites i where i.token_hash = p_token_hash;
  if v_invite.id is null then
    return query select 'not_found'::text, null::text, null::text, null::public.workspace_role, null::text;
    return;
  end if;
  return query
    select private.invite_status(v_invite), w.name, w.slug, v_invite.role, private.mask_email(v_invite.email)
    from public.workspaces w where w.id = v_invite.workspace_id;
end;
$$;

create function public.accept_invite(p_token_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
  v_status text;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.workspace_invites i where i.token_hash = p_token_hash for update;
  if v_invite.id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  v_status := private.invite_status(v_invite);
  if v_status <> 'ready' then
    raise exception '%', 'tn:invite_' || v_status using errcode = 'P0001';
  end if;
  insert into public.workspace_roles (workspace_id, user_id, role) values (v_invite.workspace_id, auth.uid(), v_invite.role);
  update public.workspace_invites set accepted_at = pg_catalog.now(), accepted_by = auth.uid() where id = v_invite.id;
  update public.profiles set last_workspace_id = v_invite.workspace_id where user_id = auth.uid();
  select w.slug into v_slug from public.workspaces w where w.id = v_invite.workspace_id;
  return v_slug;
end;
$$;

revoke execute on function
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
from public, anon;
grant execute on function
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
to authenticated;
```
`token_hash` format violations surface as Postgres `23514`; Task 5 maps that to `invalid_input`.

- [ ] **Step 3: Apply, advise, regenerate types, test** — same commands as Task 3 Step 3. Expected: PASS, no new advisor WARN/ERROR. The 100/24 h platform budget is not exercised here (it would need 100 calls across ≥ 5 workspaces); it is the same `hit_rate_limit` path the per-workspace test covers.

- [ ] **Step 4: Commit, PR; after merge apply to preview then prod.** Commit message: `feat: email-bound workspace invites with hashed single-use tokens`.

---

### Task 5: API foundations

**Labels:** `area:config`, `area:auth`

**Files:**
- Create: `src/shared/api/errors.ts`, `src/shared/api/common.ts`, `src/server/http/errors.ts`, `src/server/http/errors.test.ts`, `src/server/http/request.ts`, `src/server/http/request.test.ts`, `src/server/http/require-user.ts`, `src/server/http/require-user.test.ts`, `src/lib/auth-redirect.ts`, `src/lib/api-client.ts`, `src/lib/api-client.test.ts`, `src/config/query.ts`, `src/components/providers/query-provider.tsx`
- Modify: `src/config/env.ts`, `src/config/env.test.ts`, `src/config/public-env.ts`, `src/config/public-env.test.ts`, `vitest.config.mts` (`test.env`), `.github/workflows/ci.yml` (`quality.env`), `.env.example`, `scripts/local-supabase-env.ts` (+ test), `src/app/layout.tsx`, `messages/en.json` (`ApiErrors`), `package.json`

**Interfaces:**
- Produces:
  - `ServerEnv` gains `SMTP_HOST: string`, `SMTP_PORT: number`, `SMTP_USER?: string`, `SMTP_PASS?: string`, `SMTP_FROM: string`, `SMTP_REQUIRE_TLS: boolean` (default `true`), `GOOGLE_CLIENT_ID?: string`, `GOOGLE_CLIENT_SECRET?: string` (both or neither; same for SMTP user/pass).
  - `PublicEnv` gains `NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: boolean` (default `false`; `true` only in Production and local dev).
  - `API_ERROR_CODES`, `type ApiErrorCode`, `API_ERROR_STATUS: Record<ApiErrorCode, number>`, `apiErrorBodySchema`, `okSchema = z.object({ ok: z.literal(true) })`, `emailSchema` (trimmed, lower-cased, max 254) — `src/shared/api/*`.
  - `apiError(code: ApiErrorCode, details?: Record<string, string>): NextResponse`, `fromDatabaseError(error: { code?: string; message: string }): NextResponse`, `ok(): NextResponse` — `src/server/http/errors.ts`.
  - `isSameOrigin(request: Request): boolean`, `rejectCrossOrigin(request: Request): NextResponse | null`, `parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }>`, `clientIp(request: Request): string` — `src/server/http/request.ts`.
  - `type AuthedUser = { id: string; email: string | null }`, `requireUser(client): Promise<AuthedUser | null>` — `src/server/http/require-user.ts`.
  - `loginPathFor(currentPath: string): string`, `redirectToLogin(): void` — `src/lib/auth-redirect.ts`.
  - `class ApiClientError extends Error { code; status; details }`, `apiRequest<T>(path: string, options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: object; schema: z.ZodType<T>; onUnauthenticated?: () => void }): Promise<T>` — `src/lib/api-client.ts`.
  - `QueryProvider` (wraps the app in `layout.tsx`).

- [ ] **Step 1: Dependencies** — `bun add @tanstack/react-query@^5.104 react-hook-form@^7.89 @hookform/resolvers@^5.9`.

- [ ] **Step 2: Env (test first)** — add to `src/config/env.test.ts` (and spread `smtp` into every existing `parseServerEnv` call):
```ts
const smtp = { SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_FROM: "platform@example.test" };

it("parses SMTP settings with TLS required by default", () => {
  const env = parseServerEnv({ ...supabase, ...smtp });
  expect(env.SMTP_PORT).toBe(587);
  expect(env.SMTP_REQUIRE_TLS).toBe(true);
  expect(parseServerEnv({ ...supabase, ...smtp, SMTP_REQUIRE_TLS: "false" }).SMTP_REQUIRE_TLS).toBe(false);
});

it("requires SMTP_FROM to be an email", () => {
  expect(() => parseServerEnv({ ...supabase, ...smtp, SMTP_FROM: "nope" })).toThrow(/SMTP_FROM/);
});

it("requires the Google client ID and secret together", () => {
  expect(() => parseServerEnv({ ...supabase, ...smtp, GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com" })).toThrow(/GOOGLE_CLIENT_SECRET/);
  expect(parseServerEnv({ ...supabase, ...smtp }).GOOGLE_CLIENT_ID).toBeUndefined();
});

it("requires SMTP user and password together", () => {
  expect(() => parseServerEnv({ ...supabase, ...smtp, SMTP_USER: "platform@example.test" })).toThrow(/SMTP_PASS/);
});
```
and to `src/config/public-env.test.ts`:
```ts
it("reads the Google sign-in flag as a boolean, off by default", () => {
  expect(parsePublicEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED).toBe(false);
  expect(
    parsePublicEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: "true" }).NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED,
  ).toBe(true);
});
```
Run → FAIL. Implement in `src/config/env.ts` (schema becomes an object + `superRefine`):
```ts
const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SECRET_KEY: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    SMTP_FROM: z.email(),
    SMTP_REQUIRE_TLS: z.stringbool().default(true),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    const pairs: ReadonlyArray<[keyof typeof env, keyof typeof env]> = [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["SMTP_USER", "SMTP_PASS"],
    ];
    for (const [first, second] of pairs) {
      if (Boolean(env[first]) !== Boolean(env[second])) {
        const missing = env[first] ? second : first;
        context.addIssue({ code: "custom", path: [missing], message: `${missing} is required together with ${missing === first ? second : first}` });
      }
    }
  });
```
In `src/config/public-env.ts` add `NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: z.stringbool().default(false)` to the schema and `NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED` to the literal object. Add dummy values: `vitest.config.mts` `test.env` and CI `quality.env` get `SMTP_HOST: localhost`, `SMTP_PORT: "1025"`, `SMTP_FROM: no-reply@example.test`. `.env.example` gets the new names (empty). `scripts/local-supabase-env.ts` adds (with a test assertion for each):
```ts
/** Mailpit's SMTP port in the local stack (`[local_smtp] smtp_port` in supabase/config.toml). */
export const LOCAL_SMTP_PORT = "44325";
// inside localSupabaseEnv(...)
SMTP_HOST: "127.0.0.1",
SMTP_PORT: LOCAL_SMTP_PORT,
SMTP_FROM: "no-reply@tapnshow.test",
SMTP_REQUIRE_TLS: "false",
NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: "false",
```
Run → PASS.

- [ ] **Step 3: Shared API contracts** — `src/shared/api/errors.ts`:
```ts
import { z } from "zod";

/** Every error code an API route may return. The client translates them (`ApiErrors`). */
export const API_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid_input",
  "invalid_origin",
  "conflict",
  "rate_limited",
  "internal",
  "invalid_timezone",
  "workspace_limit",
  "use_transfer",
  "use_leave",
  "owner_cannot_leave",
  "name_mismatch",
  "target_not_admin",
  "already_member",
  "invite_closed",
  "invite_revoked",
  "invite_already_member",
  "invite_used",
  "invite_expired",
  "invite_wrong_account",
  "invite_email_limit",
  "email_failed",
  "invalid_code",
  "send_failed",
  "google_unavailable",
] as const;

/** An API error code. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** HTTP status for each error code. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  invalid_origin: 403,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
  invalid_timezone: 400,
  workspace_limit: 409,
  use_transfer: 409,
  use_leave: 409,
  owner_cannot_leave: 409,
  name_mismatch: 400,
  target_not_admin: 409,
  already_member: 409,
  invite_closed: 409,
  invite_revoked: 410,
  invite_already_member: 409,
  invite_used: 410,
  invite_expired: 410,
  invite_wrong_account: 403,
  invite_email_limit: 429,
  email_failed: 502,
  invalid_code: 400,
  send_failed: 502,
  google_unavailable: 404,
};

/** Body of every non-2xx API response. */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    details: z.record(z.string(), z.string()).optional(),
  }),
});
```
`src/shared/api/common.ts`:
```ts
import { z } from "zod";

/** Body of mutations that return nothing else. */
export const okSchema = z.object({ ok: z.literal(true) });

/** Email as stored everywhere: trimmed and lower-cased (spec §6). */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
```
Add `ApiErrors` messages (one per code; keep them short and actionable), e.g.:
```json
"ApiErrors": {
  "unauthenticated": "Please sign in again.",
  "forbidden": "You don't have permission to do that.",
  "not_found": "We couldn't find that.",
  "invalid_input": "Something in the form isn't valid.",
  "invalid_origin": "This request was blocked. Reload the page and try again.",
  "conflict": "That already exists. Try again.",
  "rate_limited": "Too many attempts. Wait a bit and try again.",
  "internal": "Something went wrong on our side. Try again.",
  "invalid_timezone": "Pick a timezone from the list.",
  "workspace_limit": "You already own the maximum number of workspaces.",
  "use_transfer": "Use \"Transfer ownership\" to change the Owner.",
  "use_leave": "Use \"Leave workspace\" to remove yourself.",
  "owner_cannot_leave": "Transfer ownership before leaving.",
  "name_mismatch": "The name you typed doesn't match.",
  "target_not_admin": "Ownership can only go to an Admin.",
  "already_member": "This person is already in the workspace.",
  "invite_closed": "This invite is no longer open.",
  "invite_revoked": "This invite was cancelled.",
  "invite_already_member": "You're already in this workspace.",
  "invite_used": "This invite was already used.",
  "invite_expired": "This invite has expired. Ask for a new one.",
  "invite_wrong_account": "This invite is for a different email address.",
  "invite_email_limit": "Email limit reached for today. Copy the link instead.",
  "email_failed": "The email couldn't be sent. Copy the link instead.",
  "invalid_code": "That code is wrong or has expired. Check the email or send a new code.",
  "send_failed": "We couldn't send the email. Try again in a minute.",
  "google_unavailable": "Google sign-in isn't available here. Use an email code."
}
```
A unit test asserts every `API_ERROR_CODES` entry has an `ApiErrors` message:
```ts
// src/shared/api/errors.test.ts
import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { API_ERROR_CODES } from "./errors";

describe("ApiErrors messages", () => {
  it("translate every error code", () => {
    expect(API_ERROR_CODES.filter((code) => !(code in messages.ApiErrors))).toEqual([]);
  });
});
```

- [ ] **Step 4: Server HTTP helpers (test first)**

`src/server/http/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { apiError, fromDatabaseError } from "./errors";

describe("fromDatabaseError", () => {
  it("maps tn:<code> to the API code and status", async () => {
    const response = fromDatabaseError({ code: "P0001", message: "tn:name_mismatch" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "name_mismatch" } });
  });

  it("maps Postgres classes without leaking messages", async () => {
    expect(fromDatabaseError({ code: "42501", message: "permission denied for table x" }).status).toBe(403);
    expect(fromDatabaseError({ code: "23514", message: "violates check constraint" }).status).toBe(400);
    expect(fromDatabaseError({ code: "23505", message: "duplicate key" }).status).toBe(409);
    const unknown = fromDatabaseError({ code: "XX000", message: "secret internals at 10.0.0.1" });
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await unknown.json())).not.toContain("10.0.0.1");
  });

  it("ignores unknown tn codes", () => {
    expect(fromDatabaseError({ code: "P0001", message: "tn:made_up" }).status).toBe(500);
  });
});

describe("apiError", () => {
  it("adds details only when given", async () => {
    expect(await apiError("invite_email_limit", { inviteId: "i1" }).json()).toEqual({ error: { code: "invite_email_limit", details: { inviteId: "i1" } } });
  });
});
```
`src/server/http/errors.ts`:
```ts
import "server-only";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { API_ERROR_CODES, API_ERROR_STATUS, type ApiErrorCode } from "@/shared/api/errors";

/** JSON error response in the shared `{ error: { code, details? } }` shape. */
export function apiError(code: ApiErrorCode, details?: Record<string, string>): NextResponse {
  return NextResponse.json({ error: details ? { code, details } : { code } }, { status: API_ERROR_STATUS[code] });
}

/** `{ ok: true }` for mutations without a richer result. */
export function ok(): NextResponse {
  return NextResponse.json({ ok: true });
}

const POSTGRES_CODES: Record<string, ApiErrorCode> = {
  "42501": "forbidden",
  "23514": "invalid_input",
  "23502": "invalid_input",
  "22P02": "invalid_input",
  "23505": "conflict",
};

function isApiErrorCode(value: string): value is ApiErrorCode {
  return API_ERROR_CODES.some((code) => code === value);
}

/**
 * Converts a Supabase/PostgREST error into an API error. `tn:<code>` messages come from our
 * database functions; anything unexpected is logged and returned as `internal`.
 */
export function fromDatabaseError(error: { code?: string; message: string }): NextResponse {
  const appCode = /^tn:([a-z_]+)$/.exec(error.message)?.[1];
  if (appCode && isApiErrorCode(appCode)) {
    return apiError(appCode);
  }
  const mapped = error.code ? POSTGRES_CODES[error.code] : undefined;
  if (mapped) {
    return apiError(mapped);
  }
  logger.error({ err: error }, "unexpected database error");
  return apiError("internal");
}
```
`src/server/http/request.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clientIp, isSameOrigin, parseJsonBody } from "./request";

const url = "https://tapnshow.vercel.app/api/x";

describe("isSameOrigin", () => {
  it("accepts the request's own origin only", () => {
    expect(isSameOrigin(new Request(url, { method: "POST", headers: { origin: "https://tapnshow.vercel.app" } }))).toBe(true);
    expect(isSameOrigin(new Request(url, { method: "POST", headers: { origin: "https://evil.example" } }))).toBe(false);
  });

  it("falls back to Sec-Fetch-Site when Origin is absent", () => {
    expect(isSameOrigin(new Request(url, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }))).toBe(true);
    expect(isSameOrigin(new Request(url, { method: "POST" }))).toBe(false);
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns typed data", async () => {
    const result = await parseJsonBody(new Request(url, { method: "POST", body: JSON.stringify({ name: "A" }) }), schema);
    expect(result).toEqual({ ok: true, data: { name: "A" } });
  });

  it("answers 400 invalid_input for malformed JSON or schema failures", async () => {
    for (const body of ["{", JSON.stringify({ name: "" })]) {
      const result = await parseJsonBody(new Request(url, { method: "POST", body }), schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
      }
    }
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIp(new Request(url, { headers: { "x-real-ip": "203.0.113.9" } }))).toBe("203.0.113.9");
    expect(clientIp(new Request(url, { headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" } }))).toBe("198.51.100.7");
    expect(clientIp(new Request(url))).toBe("unknown");
  });
});
```
`src/server/http/request.ts`:
```ts
import "server-only";
import type { NextResponse } from "next/server";
import type { z } from "zod";
import { apiError } from "./errors";

/**
 * CSRF guard for mutations (Server Actions' built-in check is not used): the Origin header
 * must equal the request's own origin; without Origin, `Sec-Fetch-Site: same-origin` is required.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === new URL(request.url).origin;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** Returns a 403 response for cross-origin mutations, or null when the request may continue. */
export function rejectCrossOrigin(request: Request): NextResponse | null {
  return isSameOrigin(request) ? null : apiError("invalid_origin");
}

/** Parses and validates a JSON body; malformed or invalid bodies become `400 invalid_input`. */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: apiError("invalid_input") };
  } catch {
    return { ok: false, response: apiError("invalid_input") };
  }
}

/** Client IP as set by Vercel (which overwrites client-supplied forwarding headers). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}
```
`src/server/http/require-user.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { requireUser, type ClaimsClient } from "./require-user";

function clientWith(result: Awaited<ReturnType<ClaimsClient["auth"]["getClaims"]>>): ClaimsClient {
  return { auth: { getClaims: async () => result } };
}

describe("requireUser", () => {
  it("returns the verified user id and email", async () => {
    const user = await requireUser(clientWith({ data: { claims: { sub: "u1", email: "a@example.test" } }, error: null }));
    expect(user).toEqual({ id: "u1", email: "a@example.test" });
  });

  it("returns null without valid claims", async () => {
    expect(await requireUser(clientWith({ data: null, error: { message: "invalid JWT" } }))).toBeNull();
  });
});
```
`src/server/http/require-user.ts`:
```ts
import "server-only";

/** The slice of the Supabase client `requireUser` needs (structural, so tests pass doubles). */
export type ClaimsClient = {
  auth: {
    getClaims: () => PromiseLike<{
      data: { claims: { sub: string; email?: string } } | null;
      error: { message: string } | null;
    }>;
  };
};

/** Signed-in user as verified from the JWT signature (`getClaims`, never `getSession`). */
export type AuthedUser = { id: string; email: string | null };

/** Returns the verified user, or null when the request has no valid session. */
export async function requireUser(client: ClaimsClient): Promise<AuthedUser | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) {
    return null;
  }
  return { id: data.claims.sub, email: data.claims.email ?? null };
}
```
If `SupabaseClient<Database>` is not structurally assignable to `ClaimsClient` (typecheck will say), pass `{ auth: { getClaims: () => supabase.auth.getClaims() } }` at the call sites through a one-line adapter `claimsOf(supabase)` exported from this file; record the `Ruling:`.

- [ ] **Step 5: Client API layer (test first)** — `src/lib/api-client.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClientError, apiRequest } from "./api-client";
import { loginPathFor } from "./auth-redirect";

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: object): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
}

describe("apiRequest", () => {
  const schema = z.object({ name: z.string() });

  it("validates successful responses", async () => {
    respond(200, { name: "Club" });
    await expect(apiRequest("/api/x", { schema })).resolves.toEqual({ name: "Club" });
  });

  it("throws ApiClientError with the server's code", async () => {
    respond(409, { error: { code: "workspace_limit" } });
    await expect(apiRequest("/api/x", { schema, method: "POST", body: {} })).rejects.toMatchObject({ code: "workspace_limit", status: 409 });
  });

  it("sends the user to sign-in on 401", async () => {
    respond(401, { error: { code: "unauthenticated" } });
    const onUnauthenticated = vi.fn();
    await expect(apiRequest("/api/x", { schema, onUnauthenticated })).rejects.toBeInstanceOf(ApiClientError);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("treats unreadable error bodies as internal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    await expect(apiRequest("/api/x", { schema })).rejects.toMatchObject({ code: "internal", status: 502 });
  });
});

describe("loginPathFor", () => {
  it("keeps the current path as next", () => {
    expect(loginPathFor("/w/club-ab12/settings?tab=people")).toBe("/login?next=%2Fw%2Fclub-ab12%2Fsettings%3Ftab%3Dpeople");
  });
});
```
`src/lib/auth-redirect.ts`:
```ts
/** Sign-in URL that returns to `currentPath` afterwards. */
export function loginPathFor(currentPath: string): string {
  return `/login?next=${encodeURIComponent(currentPath)}`;
}

/** Full navigation to sign-in (clears client state), keeping the current location as `next`. */
export function redirectToLogin(): void {
  window.location.assign(loginPathFor(`${window.location.pathname}${window.location.search}`));
}
```
`src/lib/api-client.ts`:
```ts
import type { z } from "zod";
import { apiErrorBodySchema, type ApiErrorCode } from "@/shared/api/errors";
import { redirectToLogin } from "./auth-redirect";

/** Error thrown for every non-2xx API response. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly details?: Record<string, string>,
  ) {
    super(code);
    this.name = "ApiClientError";
  }
}

/**
 * Calls one of our API routes and validates the JSON response with `schema`.
 * A 401 triggers `onUnauthenticated` (default: go to sign-in with `next`).
 * @throws ApiClientError for every non-2xx response
 */
export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: object;
    schema: z.ZodType<T>;
    onUnauthenticated?: () => void;
  },
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.ok) {
    return options.schema.parse(await response.json());
  }
  if (response.status === 401) {
    (options.onUnauthenticated ?? redirectToLogin)();
  }
  const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => null));
  throw parsed.success
    ? new ApiClientError(parsed.data.error.code, response.status, parsed.data.error.details)
    : new ApiClientError("internal", response.status);
}
```
`src/config/query.ts`:
```ts
/** How long fetched data counts as fresh before TanStack Query refetches it. */
export const QUERY_STALE_TIME_MS = 30_000;

/** Retries for failed queries (server errors and network failures only). */
export const QUERY_MAX_RETRIES = 2;
```
`src/components/providers/query-provider.tsx`:
```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { QUERY_MAX_RETRIES, QUERY_STALE_TIME_MS } from "@/config/query";
import { ApiClientError } from "@/lib/api-client";

/** TanStack Query for all client data. 4xx errors are never retried. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: QUERY_STALE_TIME_MS,
            retry: (failureCount, error) =>
              !(error instanceof ApiClientError && error.status < 500) && failureCount < QUERY_MAX_RETRIES,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```
Wrap `<MotionProvider>{children}</MotionProvider>` in `src/app/layout.tsx` with `<QueryProvider>`; do the same in `src/test/render.tsx` so component tests can use queries.

- [ ] **Step 6: Vercel + `.env.local` (before merging — `getServerEnv()` now requires SMTP)** — values come from `~/.config/tapnshow/platform-gmail.env` (strip the spaces from the app password; that form was verified against Gmail). Never print them. For **Production** and **Preview**:
  - `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_FROM=tapnshow.app@gmail.com` (plain).
  - `SMTP_USER`, `SMTP_PASS` (`--sensitive`, piped through stdin; wrap Preview adds in `timeout 60 … </dev/null` as learned in M1).
  - Mirror all five into both blocks of `.env.local`'s `VERCEL BACKUP`, and add active local values (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=44325`, `SMTP_FROM=no-reply@tapnshow.test`, `SMTP_REQUIRE_TLS=false`) so `next dev` sends invite emails to local Mailpit, never to real inboxes. Remove the SMTP lines from the `OTHER SECRETS BACKUP` block (they now live in the Vercel block).
  - Check: `bunx vercel@latest env ls --scope dalychouikhs-projects | grep SMTP_` lists 5 names × 2 environments.

- [ ] **Step 7: Verify + commit** — `bun run lint && bun run format:check && bun run typecheck && CI=true bun run test && bun run build`; after the preview deploy, `GET <preview>/api/health` must still return `ok`. Commit `feat: API error contract, request guards, typed API client and query provider`.

---

### Task 6: Email-code sign-in (`proxy.ts`, OTP routes, IP limit, `/login`)

**Labels:** `area:auth`

**Files:**
- Create: `src/lib/safe-next-path.ts`, `src/lib/safe-next-path.test.ts`, `src/shared/api/auth.ts`, `src/shared/api/auth.test.ts`, `src/server/supabase/proxy-session.ts`, `src/server/supabase/proxy-session.test.ts`, `src/proxy.ts`, `src/server/rate-limit/ip-rate-limit.ts`, `src/server/rate-limit/ip-rate-limit.test.ts`, `src/app/api/auth/otp/send/route.ts`, `src/app/api/auth/otp/send/route.test.ts`, `src/app/api/auth/otp/verify/route.ts`, `src/app/api/auth/otp/verify/route.test.ts`, `src/app/api/auth/signout/route.ts`, `src/app/login/page.tsx`, `src/app/login/login-screen.tsx`, `src/app/login/login-screen.test.tsx`, `e2e/helpers/mailpit.ts`, `e2e/auth.spec.ts`
- Modify: `messages/en.json` (`Auth`), `docs/superpowers/specs/2026-10-04-tapnshow-design.md` §11 (service-role callers)

**Interfaces:**
- Consumes: Task 1 (`OTP_LENGTH`, `OTP_RESEND_SECONDS`), Task 2 (`check_ip_rate_limit`), Task 5 (`apiError`, `ok`, `rejectCrossOrigin`, `parseJsonBody`, `clientIp`, `emailSchema`, `okSchema`, `apiRequest`).
- Produces:
  - `safeNextPath(value: string | null | undefined): string | null` — reused by Tasks 7, 8, 12.
  - `normalizeOtpCode(raw: string): string`, `otpSendBodySchema`, `otpVerifyBodySchema` (`{ email, code }`).
  - `requiresSession(pathname: string): boolean`, `updateSession(request: NextRequest): Promise<NextResponse>`; `src/proxy.ts` exports `proxy` + `config`.
  - `allowOtpRequest(ip: string): Promise<boolean>` (service role; the only new admin-client caller).
  - `POST /api/auth/otp/send` `{ email }` → `200 { ok: true }` | `429 rate_limited` | `502 send_failed`.
  - `POST /api/auth/otp/verify` `{ email, code }` → `200 { ok: true }` (session cookies set) | `400 invalid_code` | `429 rate_limited`.
  - `POST /api/auth/signout` → `200 { ok: true }`.
  - `/login?next=…` page; on success navigates to `/welcome?next=…` (Task 8 builds `/welcome`).
  - `latestSignInCode(email: string): Promise<string>` (e2e helper, polls Mailpit).

- [ ] **Step 1: `safeNextPath` (test first)** — `src/lib/safe-next-path.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("keeps same-site paths with query and hash", () => {
    expect(safeNextPath("/w/club-ab12/settings?tab=people#invites")).toBe("/w/club-ab12/settings?tab=people#invites");
    expect(safeNextPath("/invite/abcDEF_123")).toBe("/invite/abcDEF_123");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example/w",
    "javascript:alert(1)",
    "/\t/evil.example",
    "w/club",
    "",
    null,
    undefined,
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("never returns something that leaves the site", () => {
    const result = safeNextPath("/%2F%2Fevil.example");
    expect(result?.startsWith("/")).toBe(true);
    expect(result?.startsWith("//")).toBe(false);
  });
});
```
`src/lib/safe-next-path.ts`:
```ts
const PROBE_ORIGIN = "https://tapnshow.invalid";

/**
 * Returns `value` as a same-site path (pathname + search + hash), or null when it could
 * leave the site (absolute URLs, protocol-relative `//`, backslash tricks, control
 * characters that URL parsing strips).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  try {
    const url = new URL(value, PROBE_ORIGIN);
    return url.origin === PROBE_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Auth schemas (test first)** — `src/shared/api/auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { normalizeOtpCode, otpSendBodySchema, otpVerifyBodySchema } from "./auth";

describe("normalizeOtpCode", () => {
  it.each(["12345678", "1234 5678", "1234-5678", " 1234 5678 \n"])("accepts %j", (raw) => {
    expect(normalizeOtpCode(raw)).toBe("12345678");
  });
});

describe("otpVerifyBodySchema", () => {
  it("normalizes email and code", () => {
    expect(otpVerifyBodySchema.parse({ email: " Ali@Example.TEST ", code: "1234 5678" })).toEqual({ email: "ali@example.test", code: "12345678" });
  });

  it("rejects codes with the wrong length or letters", () => {
    for (const code of ["1234567", "123456789", "1234abcd"]) {
      expect(otpVerifyBodySchema.safeParse({ email: "a@example.test", code }).success).toBe(false);
    }
  });
});

describe("otpSendBodySchema", () => {
  it("rejects invalid emails", () => {
    expect(otpSendBodySchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
```
`src/shared/api/auth.ts`:
```ts
import { z } from "zod";
import { OTP_LENGTH } from "@/config/auth";
import { emailSchema } from "./common";

/** Removes the spaces and dashes people paste along with the code. */
export function normalizeOtpCode(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

const otpCodeSchema = z
  .string()
  .transform(normalizeOtpCode)
  .pipe(z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)));

/** `POST /api/auth/otp/send` body. */
export const otpSendBodySchema = z.object({ email: emailSchema });

/** `POST /api/auth/otp/verify` body. */
export const otpVerifyBodySchema = z.object({ email: emailSchema, code: otpCodeSchema });
```

- [ ] **Step 3: Session proxy (test first)** — read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` (matcher, cookies) and Supabase's current SSR guide (`https://supabase.com/docs/guides/auth/server-side/nextjs.md`) for the `setAll` signature in `@supabase/ssr` 0.12.7.

`src/server/supabase/proxy-session.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { requiresSession } from "./proxy-session";

describe("requiresSession", () => {
  it.each([["/welcome", true], ["/w/new", true], ["/w/club-ab12/settings", true], ["/login", false], ["/invite/abc", false], ["/", false], ["/design", false], ["/api/me", false], ["/wiki", false]])(
    "%s → %s",
    (path, expected) => {
      expect(requiresSession(path)).toBe(expected);
    },
  );
});
```
`src/server/supabase/proxy-session.ts`:
```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import { loginPathFor } from "@/lib/auth-redirect";
import type { Database } from "@/server/db/database.types";

/** Pages that need a session. API routes check sessions themselves (401). */
export function requiresSession(pathname: string): boolean {
  return pathname === "/welcome" || pathname === "/w" || pathname.startsWith("/w/");
}

/**
 * Refreshes the Supabase session cookies on every request (`getClaims` verifies the JWT),
 * and sends signed-out visitors of protected pages to `/login?next=…`. This is an optimistic
 * check only (Next docs): every API route re-checks the session.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers?: Record<string, string>) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const { pathname, search } = request.nextUrl;
  if (!data?.claims && requiresSession(pathname)) {
    const redirect = NextResponse.redirect(new URL(loginPathFor(`${pathname}${search}`), request.url));
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }
  return response;
}
```
`src/proxy.ts`:
```ts
import type { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/server/supabase/proxy-session";

/** Next 16 proxy (formerly middleware): keeps Supabase sessions fresh. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
```

- [ ] **Step 4: IP limiter (test first)** — `src/server/rate-limit/ip-rate-limit.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/server/supabase/admin-client", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));

describe("allowOtpRequest", () => {
  it("passes the IP to check_ip_rate_limit", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const { allowOtpRequest } = await import("./ip-rate-limit");
    await expect(allowOtpRequest("203.0.113.5")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_ip_rate_limit", { p_action: "otp_send", p_ip: "203.0.113.5" });
  });

  it("throws on database errors (the route answers 500)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    const { allowOtpRequest } = await import("./ip-rate-limit");
    await expect(allowOtpRequest("203.0.113.5")).rejects.toThrow("down");
  });
});
```
`src/server/rate-limit/ip-rate-limit.ts`:
```ts
import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/**
 * Per-IP limit on sign-in code requests (limit in `private.app_limits`). Uses the secret key
 * because the caller is not signed in yet; `check_ip_rate_limit` is executable by
 * `service_role` only. Allowed admin-client caller per spec §11.
 * @throws Error when the database call fails
 */
export async function allowOtpRequest(ip: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().rpc("check_ip_rate_limit", { p_action: "otp_send", p_ip: ip });
  if (error) {
    throw new Error(error.message);
  }
  return data === true;
}
```
Update spec §11's service-role sentence to: "The service-role key is used only by the dispatcher, the public token route, `GET /api/health`, and the pre-auth rate limiter (`check_ip_rate_limit` for sign-in code requests), each in an isolated server-only module."

- [ ] **Step 5: OTP routes (test first)** — `src/app/api/auth/otp/send/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowOtpRequest: vi.fn(async (): Promise<boolean> => true),
  signInWithOtp: vi.fn(async () => ({ error: null as { status?: number; message: string } | null })),
}));
vi.mock("@/server/rate-limit/ip-rate-limit", () => ({ allowOtpRequest: mocks.allowOtpRequest }));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithOtp: mocks.signInWithOtp } }),
}));

const url = "http://localhost:3000/api/auth/otp/send";
const post = (body: object, origin = "http://localhost:3000") =>
  new Request(url, { method: "POST", headers: { origin, "x-real-ip": "203.0.113.5" }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/otp/send", () => {
  it("sends a code to the normalized email and creates new users", async () => {
    const { POST } = await import("./route");
    const response = await POST(post({ email: " Ali@Example.TEST " }));
    expect(response.status).toBe(200);
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({ email: "ali@example.test", options: { shouldCreateUser: true } });
  });

  it("refuses cross-origin requests before doing anything", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ email: "a@example.test" }, "https://evil.example"))).status).toBe(403);
    expect(mocks.allowOtpRequest).not.toHaveBeenCalled();
  });

  it("answers 429 when the IP is over its limit or Supabase rate-limits", async () => {
    const { POST } = await import("./route");
    mocks.allowOtpRequest.mockResolvedValueOnce(false);
    expect((await POST(post({ email: "a@example.test" }))).status).toBe(429);
    mocks.signInWithOtp.mockResolvedValueOnce({ error: { status: 429, message: "over_email_send_rate_limit" } });
    expect((await POST(post({ email: "a@example.test" }))).status).toBe(429);
  });

  it("answers 502 send_failed for other provider errors", async () => {
    const { POST } = await import("./route");
    mocks.signInWithOtp.mockResolvedValueOnce({ error: { status: 500, message: "smtp down" } });
    const response = await POST(post({ email: "a@example.test" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "send_failed" } });
  });
});
```
`src/app/api/auth/otp/send/route.ts`:
```ts
import type { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { apiError, ok } from "@/server/http/errors";
import { clientIp, parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { allowOtpRequest } from "@/server/rate-limit/ip-rate-limit";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { otpSendBodySchema } from "@/shared/api/auth";

/** Emails a sign-in code. Never reveals whether the address already has an account. */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const body = await parseJsonBody(request, otpSendBodySchema);
  if (!body.ok) {
    return body.response;
  }
  try {
    if (!(await allowOtpRequest(clientIp(request)))) {
      return apiError("rate_limited");
    }
  } catch (error) {
    logger.error({ err: error }, "otp ip rate limit failed");
    return apiError("internal");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ email: body.data.email, options: { shouldCreateUser: true } });
  if (error) {
    if (error.status === 429) {
      return apiError("rate_limited");
    }
    logger.error({ err: error }, "signInWithOtp failed");
    return apiError("send_failed");
  }
  return ok();
}
```
`src/app/api/auth/otp/verify/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(async () => ({ error: null as { status?: number; message: string } | null })),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}));

const post = (body: object) =>
  new Request("http://localhost:3000/api/auth/otp/verify", { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/otp/verify", () => {
  it("verifies the normalized code as an email OTP", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ email: "A@example.test", code: "1234 5678" }))).status).toBe(200);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "a@example.test", token: "12345678", type: "email" });
  });

  it("answers invalid_code for wrong or expired codes, rate_limited for 429", async () => {
    const { POST } = await import("./route");
    mocks.verifyOtp.mockResolvedValueOnce({ error: { status: 403, message: "Token has expired or is invalid" } });
    expect(await (await POST(post({ email: "a@example.test", code: "12345678" }))).json()).toEqual({ error: { code: "invalid_code" } });
    mocks.verifyOtp.mockResolvedValueOnce({ error: { status: 429, message: "too many" } });
    expect((await POST(post({ email: "a@example.test", code: "12345678" }))).status).toBe(429);
  });
});
```
`src/app/api/auth/otp/verify/route.ts`:
```ts
import type { NextResponse } from "next/server";
import { apiError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { otpVerifyBodySchema } from "@/shared/api/auth";

/** Exchanges an emailed code for a session (cookies are set by the server client). */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const body = await parseJsonBody(request, otpVerifyBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email: body.data.email, token: body.data.code, type: "email" });
  if (error) {
    return apiError(error.status === 429 ? "rate_limited" : "invalid_code");
  }
  return ok();
}
```
`src/app/api/auth/signout/route.ts`:
```ts
import type { NextResponse } from "next/server";
import { ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** Ends the session on this device. */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  return ok();
}
```
Run route tests → PASS.

- [ ] **Step 6: Login screen (test first)** — messages:
```json
"Auth": {
  "title": "Sign in to {appName}",
  "subtitle": "We'll email you a code. No password needed.",
  "emailLabel": "Email",
  "emailPlaceholder": "you@example.com",
  "sendCode": "Email me a code",
  "codeTitle": "Check your email",
  "codeSent": "We sent a {length}-digit code to {email}.",
  "codeLabel": "Sign-in code",
  "codeHint": "Paste or type the digits. Spaces are fine.",
  "verify": "Sign in",
  "resendIn": "Resend code in {seconds} s",
  "resend": "Resend code",
  "differentEmail": "Use a different email",
  "or": "or",
  "google": "Continue with Google",
  "googleFailed": "Google sign-in didn't finish. Try again or use an email code.",
  "invalidEmail": "Enter a valid email address.",
  "invalidCodeFormat": "Enter the {length} digits from the email."
}
```
`src/app/login/login-screen.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LoginScreen } from "./login-screen";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams("next=%2Fw%2Fclub-ab12") }));

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

function stubFetch(...responses: Array<{ status: number; body: object }>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const { status, body } of responses) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("LoginScreen", () => {
  it("sends a code, accepts a pasted code with spaces, and continues to /welcome with next", async () => {
    const fetchMock = stubFetch({ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } });
    const user = userEvent.setup();
    renderWithProviders(<LoginScreen />);
    await user.type(screen.getByLabelText("Email"), "ali@example.test");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Sign-in code"), "1234 5678");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/welcome?next=%2Fw%2Fclub-ab12"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ email: "ali@example.test", code: "1234 5678" });
  });

  it("shows the translated server error for a wrong code", async () => {
    stubFetch({ status: 200, body: { ok: true } }, { status: 400, body: { error: { code: "invalid_code" } } });
    const user = userEvent.setup();
    renderWithProviders(<LoginScreen />);
    await user.type(screen.getByLabelText("Email"), "ali@example.test");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Sign-in code"), "00000000");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("That code is wrong or has expired. Check the email or send a new code.")).toBeInTheDocument();
  });

  it("keeps Resend disabled during the countdown", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const user = userEvent.setup();
    renderWithProviders(<LoginScreen />);
    await user.type(screen.getByLabelText("Email"), "ali@example.test");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(await screen.findByRole("button", { name: /Resend code in/ })).toBeDisabled();
  });
});
```
`src/app/login/login-screen.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EnvelopeSimple, Password } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sticker } from "@/components/ui/sticker";
import { APP_NAME } from "@/config/app";
import { OTP_LENGTH, OTP_RESEND_SECONDS } from "@/config/auth";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { safeNextPath } from "@/lib/safe-next-path";
import { otpSendBodySchema, otpVerifyBodySchema } from "@/shared/api/auth";
import { okSchema } from "@/shared/api/common";

type EmailForm = z.input<typeof otpSendBodySchema>;
type CodeForm = { code: string };

/** Email → code sign-in. The Google button is added in Task 7. */
export function LoginScreen() {
  const t = useTranslations("Auth");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const [email, setEmail] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const emailForm = useForm<EmailForm>({ resolver: zodResolver(otpSendBodySchema) });
  const codeForm = useForm<CodeForm>({ resolver: zodResolver(otpVerifyBodySchema.pick({ code: true })) });

  const sendCode = useMutation({
    mutationFn: (target: string) => apiRequest("/api/auth/otp/send", { method: "POST", body: { email: target }, schema: okSchema }),
    onSuccess: (_result, target) => {
      setEmail(target);
      setSecondsLeft(OTP_RESEND_SECONDS);
    },
  });
  const verify = useMutation({
    mutationFn: (code: string) => apiRequest("/api/auth/otp/verify", { method: "POST", body: { email, code }, schema: okSchema }),
    onSuccess: () => router.replace(next ? `/welcome?next=${encodeURIComponent(next)}` : "/welcome"),
  });

  const errorText = (error: Error | null): string | undefined =>
    error ? tErrors(error instanceof ApiClientError ? error.code : "internal") : undefined;

  if (!email) {
    return (
      <Card as="section" className="flex flex-col gap-4">
        <Sticker tone="primary"><EnvelopeSimple weight="bold" /></Sticker>
        <h1 className="font-display text-3xl">{t("title", { appName: APP_NAME })}</h1>
        <p className="text-muted-ink">{t("subtitle")}</p>
        <form className="flex flex-col gap-4" onSubmit={emailForm.handleSubmit((values) => sendCode.mutate(values.email))} noValidate>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            label={t("emailLabel")}
            placeholder={t("emailPlaceholder")}
            error={emailForm.formState.errors.email ? t("invalidEmail") : errorText(sendCode.error)}
            {...emailForm.register("email")}
          />
          <Button type="submit" tone="primary" size="lg" disabled={sendCode.isPending}>{t("sendCode")}</Button>
        </form>
      </Card>
    );
  }

  return (
    <Card as="section" className="flex flex-col gap-4">
      <Sticker tone="warning"><Password weight="bold" /></Sticker>
      <h1 className="font-display text-3xl">{t("codeTitle")}</h1>
      <p className="text-muted-ink">{t("codeSent", { length: OTP_LENGTH, email })}</p>
      <form className="flex flex-col gap-4" onSubmit={codeForm.handleSubmit((values) => verify.mutate(values.code))} noValidate>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          label={t("codeLabel")}
          hint={t("codeHint")}
          error={codeForm.formState.errors.code ? t("invalidCodeFormat", { length: OTP_LENGTH }) : errorText(verify.error)}
          {...codeForm.register("code")}
        />
        <Button type="submit" tone="primary" size="lg" disabled={verify.isPending}>{t("verify")}</Button>
      </form>
      <div className="flex flex-wrap gap-3">
        <Button disabled={secondsLeft > 0 || sendCode.isPending} onClick={() => sendCode.mutate(email)}>
          {secondsLeft > 0 ? t("resendIn", { seconds: secondsLeft }) : t("resend")}
        </Button>
        <Button onClick={() => { setEmail(null); verify.reset(); codeForm.reset(); }}>{t("differentEmail")}</Button>
      </div>
    </Card>
  );
}
```
The `Input` component must forward `ref` for `register` (React 19 passes `ref` as a prop; confirm `{...props}` reaches `<input>` — it does, since `ref` is in `InputHTMLAttributes` spread under React 19). If typecheck complains about `ref`, add `ref?: Ref<HTMLInputElement>` to `InputProps` and pass it through; add an `Input` test that `register` sets values.

`src/app/login/page.tsx`:
```tsx
import { Suspense } from "react";
import { LoginScreen } from "./login-screen";

/** `/login` — `useSearchParams` needs a Suspense boundary for static rendering. */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <Suspense>
        <LoginScreen />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 7: e2e** — `e2e/helpers/mailpit.ts`:
```ts
import { z } from "zod";

const listSchema = z.object({ messages: z.array(z.object({ ID: z.string(), To: z.array(z.object({ Address: z.string() })) })) });
const messageSchema = z.object({ Text: z.string() });

function mailpitUrl(): string {
  const url = process.env.MAILPIT_URL;
  if (!url) {
    throw new Error("MAILPIT_URL missing: run e2e with `bun run test:e2e`");
  }
  return url;
}

/** Polls the local Mailpit inbox for the newest email to `email` and returns its text. */
export async function latestEmailText(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = listSchema.parse(await (await fetch(`${mailpitUrl()}/api/v1/messages`)).json());
    const found = list.messages.find((message) => message.To.some((to) => to.Address === email));
    if (found) {
      return messageSchema.parse(await (await fetch(`${mailpitUrl()}/api/v1/message/${found.ID}`)).json()).Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no email for ${email} within ${timeoutMs} ms`);
}

/** The 8-digit sign-in code from the newest sign-in email. */
export async function latestSignInCode(email: string): Promise<string> {
  const code = /\b(\d{8})\b/.exec(await latestEmailText(email))?.[1];
  if (!code) {
    throw new Error(`no sign-in code in the email to ${email}`);
  }
  return code;
}
```
`e2e/auth.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { latestSignInCode } from "./helpers/mailpit";

test("signs in with an emailed code and keeps next", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto("/w/some-club-ab12");
  await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fsome-club-ab12$/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = await latestSignInCode(email);
  await page.getByLabel("Sign-in code").fill(`${code.slice(0, 4)} ${code.slice(4)}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/welcome\?next=%2Fw%2Fsome-club-ab12$/);
});

test("rejects a wrong code", async ({ page }) => {
  const email = `e2e-wrong-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await latestSignInCode(email);
  await page.getByLabel("Sign-in code").fill("00000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That code is wrong or has expired.", { exact: false })).toBeVisible();
});
```
Run: `supabase start` (if not running), stop any `next dev`, `bun run test:e2e`. Expected: all e2e pass (existing smoke/design + new auth). Playwright UI check of `/login` on both projects (phone, small-phone) with a screenshot in the PR.

- [ ] **Step 8: Preview check** — after the preview deploy: request a code for the owner's address on the preview URL, confirm the branded email arrives from `tapnshow.app@gmail.com`, sign in, and confirm the redirect to `/welcome` (404 is expected until Task 8). This also proves `isSameOrigin` works behind Vercel.

- [ ] **Step 9: Commit** — `feat: email-code sign-in with session proxy and per-IP limit`.

---

### Task 7: Google sign-in (own callback + `signInWithIdToken`)

**Labels:** `area:auth`

**Files:**
- Create: `src/server/crypto/tokens.ts`, `src/server/crypto/tokens.test.ts`, `src/server/auth/google-oauth.ts`, `src/server/auth/google-oauth.test.ts`, `src/app/api/auth/google/start/route.ts`, `src/app/api/auth/google/start/route.test.ts`, `src/app/api/auth/google/callback/route.ts`, `src/app/api/auth/google/callback/route.test.ts`, `src/components/auth/google-button.tsx`, `src/components/auth/google-button.test.tsx`, `public/brand/google-g.svg` (official asset)
- Modify: `src/config/auth.ts`, `src/app/login/login-screen.tsx` (+ test), `messages/en.json`, `src/lib/observability/scrub.ts` (+ test: OAuth `code`/`state` query values)

**Interfaces:**
- Consumes: `safeNextPath`, `getServerEnv` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), `publicEnv` (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED`), `createSupabaseServerClient`.
- Produces:
  - `generateToken(bytes?: number): string` (base64url, default 32 bytes), `sha256Hex(value: string): string`, `sha256Base64Url(value: string): string`, `tokensEqual(a: string, b: string): boolean` (constant time) — reused by Task 12 for invite tokens.
  - `GOOGLE_OAUTH_COOKIE`, `GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS = 600`, `GOOGLE_AUTHORIZATION_ENDPOINT`, `GOOGLE_TOKEN_ENDPOINT`, `GOOGLE_SCOPES = "openid email profile"`, `GOOGLE_CALLBACK_PATH = "/api/auth/google/callback"` (`src/config/auth.ts`; endpoints verified from `https://accounts.google.com/.well-known/openid-configuration`).
  - `createGoogleAuthorization({ clientId, redirectUri, next }): { url: string; state: GoogleOAuthState }`, `encodeOAuthCookie(state): string`, `decodeOAuthCookie(value?: string): GoogleOAuthState | null`, `exchangeGoogleCode({ code, verifier, clientId, clientSecret, redirectUri }, fetchImpl?): Promise<string>` (returns the ID token).
  - `GET /api/auth/google/start?next=…` → 302 to Google (or `/login?error=google_unavailable`).
  - `GET /api/auth/google/callback` → 302 to `/welcome?next=…` or `/login?error=google_failed`.
  - `<GoogleButton href>` following Google's branding guidelines.

Verified facts this task relies on: Google gets `nonce = sha256Hex(rawNonce)`, `signInWithIdToken` gets the raw nonce (Supabase Google guide); PKCE `S256` is supported (Google discovery document); Supabase's Google provider on both projects holds the `tapnshow-web` client ID (set 2026-10-05). **Still to verify here:** that `signInWithIdToken` succeeds with only the client ID configured (Step 8). If it fails, add the secret to both projects with the Management API (`external_google_secret`) piped from `~/.config/tapnshow/google-oauth.env`, and record a `Ruling:`.

- [ ] **Step 1: Tokens (test first)** — `src/server/crypto/tokens.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateToken, sha256Base64Url, sha256Hex, tokensEqual } from "./tokens";

describe("tokens", () => {
  it("generates 256-bit base64url tokens", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });

  it("hashes with SHA-256 (RFC 7636 test vector for base64url)", () => {
    expect(sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("compares in constant time and handles different lengths", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "abcd")).toBe(false);
  });
});
```
`src/server/crypto/tokens.ts`:
```ts
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Random URL-safe token (default 32 bytes = 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 as lowercase hex (stored token hashes, Google nonce). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** SHA-256 as base64url (PKCE `code_challenge`). */
export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Constant-time string comparison. */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
```

- [ ] **Step 2: Config** — append to `src/config/auth.ts`:
```ts
/** httpOnly cookie that carries OAuth state, PKCE verifier and nonce between start and callback. */
export const GOOGLE_OAUTH_COOKIE = "tn_google_oauth";

/** The Google round trip must finish within this many seconds. */
export const GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

/** From https://accounts.google.com/.well-known/openid-configuration (checked 2026-10-05). */
export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** From the same discovery document. */
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Basic sign-in scopes only (spec §9). */
export const GOOGLE_SCOPES = "openid email profile";

/** Registered redirect path of OAuth client `tapnshow-web`. */
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
```

- [ ] **Step 3: OAuth helpers (test first)** — `src/server/auth/google-oauth.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { sha256Base64Url, sha256Hex } from "@/server/crypto/tokens";
import { createGoogleAuthorization, decodeOAuthCookie, encodeOAuthCookie, exchangeGoogleCode } from "./google-oauth";

describe("createGoogleAuthorization", () => {
  it("builds a PKCE + nonce authorization URL", () => {
    const { url, state } = createGoogleAuthorization({ clientId: "cid", redirectUri: "http://localhost:3000/api/auth/google/callback", next: "/w/a-ab12" });
    const params = new URL(url).searchParams;
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid email profile");
    expect(params.get("state")).toBe(state.state);
    expect(params.get("code_challenge")).toBe(sha256Base64Url(state.verifier));
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("nonce")).toBe(sha256Hex(state.nonce));
    expect(state.next).toBe("/w/a-ab12");
  });
});

describe("OAuth cookie", () => {
  it("round-trips and rejects tampering", () => {
    const { state } = createGoogleAuthorization({ clientId: "c", redirectUri: "http://x/cb", next: null });
    expect(decodeOAuthCookie(encodeOAuthCookie(state))).toEqual(state);
    expect(decodeOAuthCookie("not-base64-json")).toBeNull();
    expect(decodeOAuthCookie(undefined)).toBeNull();
  });
});

describe("exchangeGoogleCode", () => {
  it("posts the code with PKCE and returns the ID token", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id_token: "eyJ.a.b", access_token: "ya29.x" }), { status: 200 }),
    );
    const token = await exchangeGoogleCode({ code: "c1", verifier: "v1", clientId: "cid", clientSecret: "sec", redirectUri: "http://x/cb" }, fetchImpl);
    expect(token).toBe("eyJ.a.b");
    const body = new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code: "c1", code_verifier: "v1", client_id: "cid", client_secret: "sec", redirect_uri: "http://x/cb" });
  });

  it("throws without leaking the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(exchangeGoogleCode({ code: "c", verifier: "v", clientId: "i", clientSecret: "s", redirectUri: "r" }, fetchImpl)).rejects.toThrow("Google token exchange failed with HTTP 400");
  });
});
```

`src/server/auth/google-oauth.ts`:
```ts
import "server-only";
import { z } from "zod";
import { GOOGLE_AUTHORIZATION_ENDPOINT, GOOGLE_SCOPES, GOOGLE_TOKEN_ENDPOINT } from "@/config/auth";
import { generateToken, sha256Base64Url, sha256Hex } from "@/server/crypto/tokens";

const oauthStateSchema = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  nonce: z.string().min(1),
  next: z.string().nullable(),
});

/** What the start route remembers (in an httpOnly cookie) for the callback. */
export type GoogleOAuthState = z.infer<typeof oauthStateSchema>;

/** Builds Google's authorization URL with state, PKCE (S256) and a hashed nonce. */
export function createGoogleAuthorization(input: { clientId: string; redirectUri: string; next: string | null }): {
  url: string;
  state: GoogleOAuthState;
} {
  const state: GoogleOAuthState = { state: generateToken(), verifier: generateToken(), nonce: generateToken(), next: input.next };
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state: state.state,
    code_challenge: sha256Base64Url(state.verifier),
    code_challenge_method: "S256",
    nonce: sha256Hex(state.nonce),
    prompt: "select_account",
  });
  return { url: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`, state };
}

/** Cookie-safe encoding (base64url JSON). */
export function encodeOAuthCookie(state: GoogleOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/** Decodes the cookie; null when missing or malformed. */
export function decodeOAuthCookie(value: string | undefined): GoogleOAuthState | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = oauthStateSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

/**
 * Exchanges the authorization code (with the PKCE verifier and client secret) for Google's ID token.
 * @throws Error naming only the HTTP status (Google's body may echo the code)
 */
export async function exchangeGoogleCode(
  input: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed with HTTP ${response.status}`);
  }
  return tokenResponseSchema.parse(await response.json()).id_token;
}
```

- [ ] **Step 4: Routes (test first)** — `src/app/api/auth/google/start/route.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    get NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED() {
      return flags.enabled;
    },
  },
}));
vi.mock("@/config/env", () => ({ getServerEnv: () => ({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" }) }));

describe("GET /api/auth/google/start", () => {
  it("redirects to Google and sets a short-lived httpOnly cookie scoped to the callback", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost:3000/api/auth/google/start?next=%2Fw%2Fa-ab12"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/tn_google_oauth=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it("drops an unsafe next and sends people back to /login when Google is disabled", async () => {
    const { GET } = await import("./route");
    flags.enabled = false;
    const response = await GET(new Request("http://localhost:3000/api/auth/google/start?next=%2F%2Fevil.example"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=google_unavailable");
    flags.enabled = true;
  });
});
```
`src/app/api/auth/google/start/route.ts`:
```ts
import { NextResponse } from "next/server";
import { GOOGLE_CALLBACK_PATH, GOOGLE_OAUTH_COOKIE, GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS } from "@/config/auth";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { safeNextPath } from "@/lib/safe-next-path";
import { createGoogleAuthorization, encodeOAuthCookie } from "@/server/auth/google-oauth";

/** Starts Google sign-in. Disabled (back to /login) where the client has no redirect URI, e.g. previews. */
export async function GET(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  if (!publicEnv.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED || !env.GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(new URL("/login?error=google_unavailable", request.url));
  }
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  const { url, state } = createGoogleAuthorization({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GOOGLE_CALLBACK_PATH}`,
    next,
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_OAUTH_COOKIE, encodeOAuthCookie(state), {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
```
`src/app/api/auth/google/callback/route.test.ts`:
```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeOAuthCookie } from "@/server/auth/google-oauth";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(async (): Promise<string> => "id-token"),
  signInWithIdToken: vi.fn(async () => ({ error: null as { message: string } | null })),
}));
vi.mock("@/config/public-env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "http://localhost:3000", NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: true } }));
vi.mock("@/config/env", () => ({ getServerEnv: () => ({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" }) }));
vi.mock("@/server/auth/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/google-oauth")>()),
  exchangeGoogleCode: mocks.exchange,
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithIdToken: mocks.signInWithIdToken } }),
}));

const stored = { state: "s1", verifier: "v1", nonce: "n1", next: "/w/a-ab12" };
const callback = (query: string, cookie = encodeOAuthCookie(stored)) =>
  new NextRequest(`http://localhost:3000/api/auth/google/callback?${query}`, { headers: { cookie: `tn_google_oauth=${cookie}` } });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/auth/google/callback", () => {
  it("signs in with the raw nonce and continues to /welcome with next", async () => {
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1"));
    expect(mocks.exchange).toHaveBeenCalledWith(expect.objectContaining({ code: "c1", verifier: "v1", redirectUri: "http://localhost:3000/api/auth/google/callback" }));
    expect(mocks.signInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: "id-token", nonce: "n1" });
    expect(response.headers.get("location")).toBe("http://localhost:3000/welcome?next=%2Fw%2Fa-ab12");
    expect(response.headers.get("set-cookie")).toMatch(/tn_google_oauth=;/);
  });

  it.each([["code=c1&state=wrong"], ["error=access_denied&state=s1"], ["state=s1"]])("fails closed for %s", async (query) => {
    const { GET } = await import("./route");
    const response = await GET(callback(query));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=google_failed&next=%2Fw%2Fa-ab12");
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("fails closed without the cookie and when Supabase rejects the token", async () => {
    const { GET } = await import("./route");
    expect((await GET(callback("code=c1&state=s1", "garbage"))).headers.get("location")).toBe("http://localhost:3000/login?error=google_failed");
    mocks.signInWithIdToken.mockResolvedValueOnce({ error: { message: "nonce mismatch" } });
    expect((await GET(callback("code=c1&state=s1"))).headers.get("location")).toMatch(/\/login\?error=google_failed/);
  });
});
```
`src/app/api/auth/google/callback/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_CALLBACK_PATH, GOOGLE_OAUTH_COOKIE } from "@/config/auth";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { logger } from "@/lib/logger";
import { decodeOAuthCookie, exchangeGoogleCode } from "@/server/auth/google-oauth";
import { tokensEqual } from "@/server/crypto/tokens";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

function withNext(path: string, next: string | null): string {
  if (!next) {
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}

function redirectClearingCookie(path: string, request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.delete({ name: GOOGLE_OAUTH_COOKIE, path: "/api/auth/google" });
  return response;
}

/** Finishes Google sign-in: verify state, exchange the code, sign in to Supabase with the ID token. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const stored = decodeOAuthCookie(request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value);
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const fail = (next: string | null) => redirectClearingCookie(withNext("/login?error=google_failed", next), request);

  if (!stored || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return fail(null);
  }
  if (!code || !state || params.get("error") || !tokensEqual(state, stored.state)) {
    return fail(stored.next);
  }
  try {
    const idToken = await exchangeGoogleCode({
      code,
      verifier: stored.verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GOOGLE_CALLBACK_PATH}`,
    });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken, nonce: stored.nonce });
    if (error) {
      logger.warn({ err: error }, "signInWithIdToken rejected the Google token");
      return fail(stored.next);
    }
  } catch (error) {
    logger.error({ err: error }, "Google sign-in failed");
    return fail(stored.next);
  }
  return redirectClearingCookie(withNext("/welcome", stored.next), request);
}
```
Session cookies set by `createSupabaseServerClient()` (through `next/headers` `cookies()`) are applied by Next to the returned response; Step 8 confirms it on localhost. Also extend `scrubUrl` so `code=` and `state=` query values on `/api/auth/google/callback` are redacted (test: `scrubUrl("/api/auth/google/callback?code=4/0Ab&state=xyz")` → `"/api/auth/google/callback?code=[REDACTED]&state=[REDACTED]"`).

- [ ] **Step 5: Google button** — download Google's official sign-in assets (linked from `https://developers.google.com/identity/branding-guidelines`), copy the standard-color "G" SVG to `public/brand/google-g.svg` unchanged. Font: the guidelines specify **Google Sans Medium 14/20**; check whether it is available through `next/font/google` (`node_modules/next/dist/compiled/@next/font/dist/google/font-data.json` contains `"Google Sans"`?). If yes, load it with `next/font/google` (weight 500) only for this button; if not, use `Roboto` 500 and record a `Ruling:`.

`src/components/auth/google-button.tsx`:
```tsx
import Image from "next/image";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { googleSans } from "@/app/fonts";

/**
 * "Continue with Google" per Google's branding guidelines: light = #FFFFFF fill, 1px #747775
 * stroke, #1F1F1F text; dark = #131314 fill, 1px #8E918F stroke, #E3E3E3 text; 14/20 medium;
 * padding 12px / 10px after the logo / 12px; official "G" logo unchanged on white.
 * This is the only Google-styled element in the app (spec §4). A plain link: the start route redirects.
 */
export function GoogleButton({ href, className }: { href: string; className?: string }) {
  const t = useTranslations("Auth");
  return (
    <a
      href={href}
      className={cn(
        googleSans.className,
        "inline-flex min-h-11 items-center justify-center rounded-full border border-[#747775] bg-[#FFFFFF] py-[10px] pr-[12px] pl-[12px] text-[14px] leading-[20px] font-medium text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]",
        className,
      )}
    >
      <span className="mr-[10px] inline-flex rounded-full bg-[#FFFFFF] p-[2px]">
        <Image src="/brand/google-g.svg" alt="" width={18} height={18} />
      </span>
      {t("google")}
    </a>
  );
}
```
These hex values are Google's mandated brand colors, not app tokens — the "no hardcoded values" rule does not apply to a third party's required styling; keep them only in this file. Add `googleSans` (or `roboto`) to `src/app/fonts.ts`.

`src/components/auth/google-button.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { GoogleButton } from "./google-button";

describe("GoogleButton", () => {
  it("is a link with Google's approved wording and a decorative logo", () => {
    renderWithProviders(<GoogleButton href="/api/auth/google/start" />);
    const link = screen.getByRole("link", { name: "Continue with Google" });
    expect(link).toHaveAttribute("href", "/api/auth/google/start");
    expect(link.querySelector("img")).toHaveAttribute("alt", "");
  });
});
```

- [ ] **Step 6: Login integration** — in `LoginScreen` (email step), under the form: an "or" divider and `<GoogleButton href={`/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`} />`, rendered only when `publicEnv.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED`. Read `error` from the search params: `google_failed` → show `t("googleFailed")`; `google_unavailable` → `tErrors("google_unavailable")`, both in a `role="alert"` paragraph above the card. Tests:
```tsx
it("shows the Google option only when enabled, carrying next", async () => {
  // mock @/config/public-env with NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: true
  renderWithProviders(<LoginScreen />);
  expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/api/auth/google/start?next=%2Fw%2Fclub-ab12");
});

it("explains a failed Google round trip", async () => {
  // useSearchParams → "error=google_failed"
  renderWithProviders(<LoginScreen />);
  expect(screen.getByRole("alert")).toHaveTextContent("Google sign-in didn't finish.");
});
```

- [ ] **Step 7: Environment** — `NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED`: Production `true`, Preview unset (`false`), `.env.local` active `true`. `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`: **Production only** (`--sensitive` for the secret, values piped from `~/.config/tapnshow/google-oauth.env`) and `.env.local` active values; mirror into `.env.local`'s `VERCEL BACKUP` Production block and remove them from `OTHER SECRETS BACKUP`. `NEXT_PUBLIC_*` adds need `--type config --value … --yes` (M1 lesson).

- [ ] **Step 8: Manual check on localhost (preview Supabase)** — `bun run dev` (`.env.local` points at the preview project, whose Google provider holds the client ID). Click "Continue with Google", pick an account, and expect `/welcome` (404 until Task 8) with session cookies set. If Supabase answers an error mentioning the secret, apply the fallback from the top of this task. Record the outcome as a `Ruling:` (this closes the open item from spec §9).

- [ ] **Step 9: Commit** — `feat: Google sign-in through our own OAuth callback`.

---

### Task 8: Profile API + `/welcome` routing

**Labels:** `area:auth`

**Files:**
- Create: `src/shared/api/me.ts`, `src/server/queries/profile.ts`, `src/server/queries/profile.db.test.ts`, `src/app/api/me/route.ts`, `src/app/api/me/route.test.ts`, `src/lib/post-sign-in.ts`, `src/lib/post-sign-in.test.ts`, `src/components/ui/skeleton.tsx`, `src/components/ui/skeleton.test.tsx`, `src/hooks/use-me.ts`, `src/app/welcome/page.tsx`, `src/app/welcome/welcome-flow.tsx`, `src/app/welcome/welcome-flow.test.tsx`
- Modify: `messages/en.json` (`Welcome`, `Common`), `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `requireUser`, `apiError`, `fromDatabaseError`, `parseJsonBody`, `rejectCrossOrigin`, `apiRequest`, `safeNextPath`.
- Produces:
  - `workspaceRoleSchema = z.enum(["owner", "admin", "viewer"])`, `type WorkspaceRole`, `meResponseSchema`, `type MeResponse = { userId: string; profile: { displayName: string | null; avatarUrl: string | null; email: string | null }; workspaces: Array<{ id: string; slug: string; name: string; role: WorkspaceRole }>; lastWorkspaceSlug: string | null }`, `displayNameSchema`, `mePatchBodySchema` (`{ displayName?, lastWorkspaceId? }`, at least one).
  - `getMe(client: SupabaseClient<Database>, user: AuthedUser): Promise<MeResponse>`, `updateProfile(client, userId: string, patch: { displayName?: string; lastWorkspaceId?: string }): Promise<{ error: { code?: string; message: string } | null }>`.
  - `GET /api/me` → `200 MeResponse` | 401; `PATCH /api/me` → `200 { ok: true }` | 400 | 401 | 403.
  - `resolvePostSignInPath(me, next: string | null): string`.
  - `useMe()` (TanStack Query, key `["me"]`) — reused by the shell.
  - `<Skeleton className>` — style-B loading block reused by every page.

- [ ] **Step 1: Shared schemas** — `src/shared/api/me.ts`:
```ts
import { z } from "zod";

/** Workspace role names (mirror of Postgres enum `workspace_role`). */
export const workspaceRoleSchema = z.enum(["owner", "admin", "viewer"]);

/** A workspace role. */
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** Display name rules shared with the database check (1–80 characters after trimming). */
export const displayNameSchema = z.string().trim().min(1).max(80);

/** `GET /api/me` response. */
export const meResponseSchema = z.object({
  userId: z.uuid(),
  profile: z.object({ displayName: z.string().nullable(), avatarUrl: z.string().nullable(), email: z.string().nullable() }),
  workspaces: z.array(z.object({ id: z.uuid(), slug: z.string(), name: z.string(), role: workspaceRoleSchema })),
  lastWorkspaceSlug: z.string().nullable(),
});

/** Signed-in user's profile and memberships. */
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `PATCH /api/me` body. */
export const mePatchBodySchema = z
  .object({ displayName: displayNameSchema.optional(), lastWorkspaceId: z.uuid().optional() })
  .refine((body) => body.displayName !== undefined || body.lastWorkspaceId !== undefined);
```

- [ ] **Step 2: Queries (DB test first)** — `src/server/queries/profile.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { addMember, createWorkspaceAs } from "@/test/db/workspaces";
import { getMe, updateProfile } from "./profile";

describe("getMe", () => {
  it("returns profile, memberships sorted by name, and the last workspace slug", async () => {
    const user = await createTestUser({ fullName: "Sami" });
    const other = await createTestUser();
    const zeta = await createWorkspaceAs(user, "Zeta Club");
    const alpha = await createWorkspaceAs(other, "Alpha Club");
    await addMember(alpha.id, user.id, "viewer");
    const me = await getMe(user.client, { id: user.id, email: user.email });
    expect(me.userId).toBe(user.id);
    expect(me.profile).toEqual({ displayName: "Sami", avatarUrl: null, email: user.email });
    expect(me.workspaces.map((workspace) => [workspace.name, workspace.role])).toEqual([["Alpha Club", "viewer"], ["Zeta Club", "owner"]]);
    expect(me.lastWorkspaceSlug).toBe(zeta.slug);
  });
});

describe("updateProfile", () => {
  it("trims the name and refuses foreign workspaces", async () => {
    const user = await createTestUser();
    const stranger = await createTestUser();
    const foreign = await createWorkspaceAs(stranger);
    expect((await updateProfile(user.client, user.id, { displayName: "Lina" })).error).toBeNull();
    expect((await getMe(user.client, { id: user.id, email: user.email })).profile.displayName).toBe("Lina");
    expect((await updateProfile(user.client, user.id, { lastWorkspaceId: foreign.id })).error?.code).toBe("42501");
  });
});
```
`src/server/queries/profile.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { AuthedUser } from "@/server/http/require-user";
import type { MeResponse } from "@/shared/api/me";

type Client = SupabaseClient<Database>;

/**
 * Profile and memberships of the signed-in user (RLS: own profile, own roles, member workspaces).
 * @throws Error when either read fails
 */
export async function getMe(client: Client, user: AuthedUser): Promise<MeResponse> {
  const [profile, roles] = await Promise.all([
    client.from("profiles").select("display_name, avatar_url, last_workspace_id").eq("user_id", user.id).single(),
    client.from("workspace_roles").select("role, workspaces (id, slug, name)").eq("user_id", user.id),
  ]);
  if (profile.error) {
    throw new Error(profile.error.message);
  }
  if (roles.error) {
    throw new Error(roles.error.message);
  }
  const workspaces = roles.data
    .flatMap((row) => (row.workspaces ? [{ ...row.workspaces, role: row.role }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    userId: user.id,
    profile: { displayName: profile.data.display_name, avatarUrl: profile.data.avatar_url, email: user.email },
    workspaces,
    lastWorkspaceSlug: workspaces.find((workspace) => workspace.id === profile.data.last_workspace_id)?.slug ?? null,
  };
}

/** Updates the caller's own profile; RLS rejects foreign `lastWorkspaceId` with 42501. */
export async function updateProfile(
  client: Client,
  userId: string,
  patch: { displayName?: string; lastWorkspaceId?: string },
): Promise<{ error: { code?: string; message: string } | null }> {
  const { error } = await client
    .from("profiles")
    .update({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.lastWorkspaceId !== undefined ? { last_workspace_id: patch.lastWorkspaceId } : {}),
    })
    .eq("user_id", userId);
  return { error };
}
```

- [ ] **Step 3: Route (test first)** — `src/app/api/me/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as { id: string; email: string } | null,
  getMe: vi.fn(),
  updateProfile: vi.fn(async () => ({ error: null as { code?: string; message: string } | null })),
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/server/queries/profile", () => ({ getMe: mocks.getMe, updateProfile: mocks.updateProfile }));

const patch = (body: object) =>
  new Request("http://localhost:3000/api/me", { method: "PATCH", headers: { origin: "http://localhost:3000" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("/api/me", () => {
  it("GET returns 401 without a session", async () => {
    mocks.user = null;
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(401);
  });

  it("GET returns the profile", async () => {
    mocks.getMe.mockResolvedValueOnce({ userId: "u1", profile: { displayName: "A", avatarUrl: null, email: "a@example.test" }, workspaces: [], lastWorkspaceSlug: null });
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toMatchObject({ profile: { displayName: "A" } });
  });

  it("PATCH trims the name and maps RLS refusals to 403", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(patch({ displayName: "  Lina  " }))).status).toBe(200);
    expect(mocks.updateProfile).toHaveBeenCalledWith({}, "u1", { displayName: "Lina" });
    mocks.updateProfile.mockResolvedValueOnce({ error: { code: "42501", message: "new row violates row-level security policy" } });
    expect((await PATCH(patch({ lastWorkspaceId: crypto.randomUUID() }))).status).toBe(403);
  });

  it("PATCH rejects empty bodies", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(patch({}))).status).toBe(400);
  });
});
```
`src/app/api/me/route.ts`:
```ts
import { NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { getMe, updateProfile } from "@/server/queries/profile";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { mePatchBodySchema } from "@/shared/api/me";

/** Signed-in user's profile and workspaces. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  return NextResponse.json(await getMe(supabase, user));
}

/** Updates the display name and/or the remembered workspace. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, mePatchBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await updateProfile(supabase, user.id, body.data);
  return error ? fromDatabaseError(error) : ok();
}
```

- [ ] **Step 4: Post-sign-in routing (test first)** — `src/lib/post-sign-in.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolvePostSignInPath } from "./post-sign-in";

const workspace = (slug: string) => ({ id: crypto.randomUUID(), slug, name: slug, role: "owner" as const });

describe("resolvePostSignInPath", () => {
  it("prefers a safe next path", () => {
    expect(resolvePostSignInPath({ workspaces: [workspace("a-ab12")], lastWorkspaceSlug: "a-ab12" }, "/invite/tok")).toBe("/invite/tok");
  });

  it("then the last workspace, then the first one, then creation", () => {
    expect(resolvePostSignInPath({ workspaces: [workspace("a-ab12"), workspace("b-cd34")], lastWorkspaceSlug: "b-cd34" }, null)).toBe("/w/b-cd34");
    expect(resolvePostSignInPath({ workspaces: [workspace("a-ab12")], lastWorkspaceSlug: null }, null)).toBe("/w/a-ab12");
    expect(resolvePostSignInPath({ workspaces: [], lastWorkspaceSlug: null }, null)).toBe("/w/new");
  });
});
```
`src/lib/post-sign-in.ts`:
```ts
import type { MeResponse } from "@/shared/api/me";

/** Where to go after sign-in (spec §7.1): safe `next`, else last workspace, else first, else create one. */
export function resolvePostSignInPath(me: Pick<MeResponse, "workspaces" | "lastWorkspaceSlug">, next: string | null): string {
  if (next) {
    return next;
  }
  const slug = me.lastWorkspaceSlug ?? me.workspaces[0]?.slug;
  return slug ? `/w/${slug}` : "/w/new";
}
```

- [ ] **Step 5: Skeleton + hook** — `src/components/ui/skeleton.tsx`:
```tsx
import { cn } from "@/lib/utils";

/** Style-B loading block: outlined, muted fill, gentle pulse (none for reduced motion). Hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-neutral animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}
```
Test: renders with `aria-hidden="true"` and the `motion-reduce:animate-none` class.

`src/hooks/use-me.ts`:
```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { meResponseSchema } from "@/shared/api/me";

/** Query key of the signed-in user's profile and workspaces. */
export const ME_QUERY_KEY = ["me"] as const;

/** Signed-in user's profile and memberships (`GET /api/me`). */
export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiRequest("/api/me", { schema: meResponseSchema }) });
}
```

- [ ] **Step 6: `/welcome` (test first)** — messages:
```json
"Common": { "loading": "Loading", "save": "Save", "cancel": "Cancel", "continue": "Continue" },
"Welcome": {
  "title": "What should we call you?",
  "hint": "Organizers and teammates see this name in TapNShow.",
  "nameLabel": "Your name",
  "invalidName": "Enter a name between 1 and 80 characters."
}
```
`src/app/welcome/welcome-flow.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { WelcomeFlow } from "./welcome-flow";

const replace = vi.fn();
const search = { value: "" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams(search.value) }));

const me = (displayName: string | null) => ({
  userId: "3c9e2a71-8f4b-4d2e-9a6c-1b5d7e0f2a34",
  profile: { displayName, avatarUrl: null, email: "a@example.test" },
  workspaces: [{ id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11", slug: "club-ab12", name: "Club", role: "owner" }],
  lastWorkspaceSlug: "club-ab12",
});

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
  search.value = "";
});

describe("WelcomeFlow", () => {
  it("goes straight to the last workspace when the name is known", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(me("Sami")))));
    renderWithProviders(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/w/club-ab12"));
  });

  it("asks for a name once, saves it, then honours a safe next", async () => {
    search.value = "next=%2Finvite%2Ftok123";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(me(null))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify(me("Lina"))));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<WelcomeFlow />);
    await user.type(await screen.findByLabelText("Your name"), "Lina");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/invite/tok123"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ displayName: "Lina" });
  });

  it("ignores an unsafe next", async () => {
    search.value = "next=%2F%2Fevil.example";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(me("Sami")))));
    renderWithProviders(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/w/club-ab12"));
  });
});
```
`src/app/welcome/welcome-flow.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserCircle } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { ME_QUERY_KEY, useMe } from "@/hooks/use-me";
import { apiRequest } from "@/lib/api-client";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { safeNextPath } from "@/lib/safe-next-path";
import { okSchema } from "@/shared/api/common";
import { displayNameSchema } from "@/shared/api/me";

const nameFormSchema = z.object({ displayName: displayNameSchema });
type NameForm = z.input<typeof nameFormSchema>;

/** After sign-in: ask for a name once (spec §7.1), then go to `next`, the last workspace, or `/w/new`. */
export function WelcomeFlow() {
  const t = useTranslations("Welcome");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const queryClient = useQueryClient();
  const me = useMe();
  const form = useForm<NameForm>({ resolver: zodResolver(nameFormSchema) });
  const save = useMutation({
    mutationFn: (values: NameForm) => apiRequest("/api/me", { method: "PATCH", body: values, schema: okSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });

  const ready = me.data?.profile.displayName ? me.data : null;
  useEffect(() => {
    if (ready) {
      router.replace(resolvePostSignInPath(ready, next));
    }
  }, [ready, next, router]);

  if (!me.data || ready) {
    return <Skeleton className="h-48 w-full" />;
  }
  return (
    <Card as="section" className="flex flex-col gap-4">
      <Sticker tone="info"><UserCircle weight="bold" /></Sticker>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
        <Input
          id="display-name"
          autoComplete="name"
          label={t("nameLabel")}
          hint={t("hint")}
          error={form.formState.errors.displayName ? t("invalidName") : undefined}
          {...form.register("displayName")}
        />
        <Button type="submit" tone="primary" size="lg" disabled={save.isPending}>{tCommon("continue")}</Button>
      </form>
    </Card>
  );
}
```
`src/app/welcome/page.tsx`: same `<main>` + `<Suspense>` wrapper as `/login`, rendering `<WelcomeFlow />`.

- [ ] **Step 7: e2e** — extend `e2e/auth.spec.ts` first test: after `/welcome?next=…`, fill "Your name" with `E2E Owner`, press Continue, and expect the URL `/w/some-club-ab12` (the shell does not exist yet; only the URL is asserted). Add a test: a second sign-in with the same email skips the name step and goes to `/w/new`.

- [ ] **Step 8: Verify + commit** — unit, DB, e2e, lint, typecheck, build; Playwright screenshots of `/welcome` (light/dark, phone sizes). Commit `feat: profile API and post-sign-in routing`.

---

### Task 9: Create workspace (`/w/new`, slug, timezone picker)

**Labels:** `area:auth`, `area:design-system`

**Files:**
- Create: `src/lib/slug.ts`, `src/lib/slug.test.ts`, `src/shared/api/workspaces.ts`, `src/server/queries/workspaces.ts`, `src/server/queries/workspaces.db.test.ts`, `src/app/api/workspaces/route.ts`, `src/app/api/workspaces/route.test.ts`, `src/app/api/workspaces/[slug]/route.ts`, `src/app/api/workspaces/[slug]/route.test.ts`, `src/components/ui/popover.tsx`, `src/components/ui/command.tsx` (shadcn), `src/components/forms/timezone-picker.tsx`, `src/components/forms/timezone-picker.test.tsx`, `src/lib/timezones.ts`, `src/lib/timezones.test.ts`, `src/hooks/use-workspace.ts`, `src/app/w/new/page.tsx`, `src/app/w/new/create-workspace-form.tsx`, `src/app/w/new/create-workspace-form.test.tsx`
- Modify: `vitest.setup.ts` (ResizeObserver / scrollIntoView stubs for Radix + cmdk), `messages/en.json` (`CreateWorkspace`, `TimezonePicker`), `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `create_workspace` (Task 2), `requireUser`, `fromDatabaseError`, `useMe`/`ME_QUERY_KEY`.
- Produces:
  - `slugBase(name: string): string`, `generateWorkspaceSlug(name: string, randomBytes?: (length: number) => Uint8Array): string` (`<base>-<4 chars>`; base falls back to `workspace`).
  - `workspaceNameSchema`, `createWorkspaceBodySchema` (`{ name, timezone }`), `workspaceDetailsSchema` / `type WorkspaceDetails = { id; slug; name; timezone; myRole: WorkspaceRole; canCheckIn: boolean }`, `createWorkspaceResponseSchema = z.object({ slug: z.string() })`.
  - `createWorkspace(client, input: { name; slug; timezone })`, `getWorkspaceBySlug(client, userId, slug): Promise<WorkspaceDetails | null>`.
  - `POST /api/workspaces` → `201 { slug }` | 400 | 401 | 409 `workspace_limit`/`conflict` | 429; `GET /api/workspaces/[slug]` → `200 WorkspaceDetails` | 401 | 404.
  - `listTimezones(): string[]`, `browserTimezone(): string`, `<TimezonePicker id label value onChange error?>`.
  - `useWorkspace(slug)` (key `["workspace", slug]`).

- [ ] **Step 1: Slugs (test first)** — `src/lib/slug.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateWorkspaceSlug, slugBase } from "./slug";

const fixedBytes = () => new Uint8Array([0, 1, 2, 3]);

describe("slugBase", () => {
  it.each([
    ["GDG on Campus ISSAT Sousse", "gdg-on-campus-issat-sousse"],
    ["Club Électronique", "club-electronique"],
    ["  Débat & Co.  ", "debat-co"],
    ["نادي البرمجة", "workspace"],
    ["🎉🎉", "workspace"],
    ["a".repeat(100), "a".repeat(40)],
  ])("%s → %s", (name, expected) => {
    expect(slugBase(name)).toBe(expected);
  });
});

describe("generateWorkspaceSlug", () => {
  it("appends a 4-character suffix from an unambiguous alphabet", () => {
    expect(generateWorkspaceSlug("Robotics", fixedBytes)).toBe("robotics-abcd");
    expect(generateWorkspaceSlug("نادي")).toMatch(/^workspace-[a-km-np-z2-9]{4}$/);
  });

  it("always matches the database slug check", () => {
    for (const name of ["x", "Ünïcödé Ñame", "--a--", "A-B_C.D"]) {
      expect(generateWorkspaceSlug(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
```
`src/lib/slug.ts`:
```ts
/** Suffix alphabet without look-alikes (l, o, 0, 1); 32 symbols, so one byte maps without bias. */
const SUFFIX_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Random characters appended to every workspace slug (spec §4). */
export const SLUG_SUFFIX_LENGTH = 4;

/** Longest readable part of a slug. */
export const SLUG_BASE_MAX_LENGTH = 40;

/** Used when a name has no Latin letters or digits (e.g. Arabic or emoji-only names). */
export const SLUG_FALLBACK_BASE = "workspace";

/** Readable part of a slug: accents removed, lower-case ASCII words joined by dashes. */
export function slugBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_MAX_LENGTH)
    .replace(/-+$/g, "");
  return base || SLUG_FALLBACK_BASE;
}

/** `<base>-<suffix>`; fixed at creation, never changes when the workspace is renamed. */
export function generateWorkspaceSlug(
  name: string,
  randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  const suffix = Array.from(randomBytes(SLUG_SUFFIX_LENGTH), (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length]).join("");
  return `${slugBase(name)}-${suffix}`;
}
```

- [ ] **Step 2: Contracts + queries (DB test first)** — `src/shared/api/workspaces.ts`:
```ts
import { z } from "zod";
import { workspaceRoleSchema } from "./me";

/** Workspace name rules (match the database check). */
export const workspaceNameSchema = z.string().trim().min(1).max(80);

/** IANA timezone name; the database validates it against `pg_timezone_names`. */
export const timezoneSchema = z.string().min(1).max(64);

/** `POST /api/workspaces` body. */
export const createWorkspaceBodySchema = z.object({ name: workspaceNameSchema, timezone: timezoneSchema });

/** `POST /api/workspaces` response. */
export const createWorkspaceResponseSchema = z.object({ slug: z.string() });

/** `GET /api/workspaces/[slug]` response. */
export const workspaceDetailsSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  myRole: workspaceRoleSchema,
  canCheckIn: z.boolean(),
});

/** A workspace as seen by one of its members. */
export type WorkspaceDetails = z.infer<typeof workspaceDetailsSchema>;
```
`src/server/queries/workspaces.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { addMember } from "@/test/db/workspaces";
import { createWorkspace, getWorkspaceBySlug } from "./workspaces";

describe("workspace queries", () => {
  it("creates, then reads by slug with the caller's role; strangers get null", async () => {
    const owner = await createTestUser();
    const viewer = await createTestUser();
    const stranger = await createTestUser();
    const slug = `club-${crypto.randomUUID().slice(0, 4)}`;
    const created = await createWorkspace(owner.client, { name: "Club", slug, timezone: "Africa/Tunis" });
    expect(created.error).toBeNull();
    await addMember(created.data!.id, viewer.id, "viewer", true);
    expect(await getWorkspaceBySlug(owner.client, owner.id, slug)).toMatchObject({ slug, myRole: "owner", canCheckIn: false });
    expect(await getWorkspaceBySlug(viewer.client, viewer.id, slug)).toMatchObject({ myRole: "viewer", canCheckIn: true });
    expect(await getWorkspaceBySlug(stranger.client, stranger.id, slug)).toBeNull();
  });
});
```
`src/server/queries/workspaces.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type Client = SupabaseClient<Database>;

/** Calls `create_workspace` (caller becomes Owner). */
export function createWorkspace(client: Client, input: { name: string; slug: string; timezone: string }) {
  return client.rpc("create_workspace", { p_name: input.name, p_slug: input.slug, p_timezone: input.timezone });
}

/**
 * Workspace + the caller's role, or null when it doesn't exist or the caller isn't a member (RLS).
 * @throws Error on database failures
 */
export async function getWorkspaceBySlug(client: Client, userId: string, slug: string): Promise<WorkspaceDetails | null> {
  const workspace = await client.from("workspaces").select("id, slug, name, timezone").eq("slug", slug).maybeSingle();
  if (workspace.error) {
    throw new Error(workspace.error.message);
  }
  if (!workspace.data) {
    return null;
  }
  const role = await client
    .from("workspace_roles")
    .select("role, can_check_in")
    .eq("workspace_id", workspace.data.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (role.error) {
    throw new Error(role.error.message);
  }
  return role.data ? { ...workspace.data, myRole: role.data.role, canCheckIn: role.data.can_check_in } : null;
}
```

- [ ] **Step 3: Routes (test first)** — `src/app/api/workspaces/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => ({ id: "u1", email: "a@example.test" }) }));
vi.mock("@/server/queries/workspaces", () => ({ createWorkspace: mocks.createWorkspace }));

const post = (body: object) =>
  new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces", () => {
  it("creates with a generated slug and answers 201", async () => {
    mocks.createWorkspace.mockImplementationOnce(async (_client: object, input: { slug: string }) => ({ data: { slug: input.slug }, error: null }));
    const { POST } = await import("./route");
    const response = await POST(post({ name: "Robotics Club", timezone: "Africa/Tunis" }));
    expect(response.status).toBe(201);
    expect((await response.json()).slug).toMatch(/^robotics-club-[a-z0-9]{4}$/);
  });

  it("retries a slug collision with a new suffix", async () => {
    mocks.createWorkspace
      .mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } })
      .mockImplementationOnce(async (_client: object, input: { slug: string }) => ({ data: { slug: input.slug }, error: null }));
    const { POST } = await import("./route");
    expect((await POST(post({ name: "Club", timezone: "Africa/Tunis" }))).status).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(2);
  });

  it("passes database refusals through", async () => {
    mocks.createWorkspace.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "tn:workspace_limit" } });
    const { POST } = await import("./route");
    const response = await POST(post({ name: "Club", timezone: "Africa/Tunis" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "workspace_limit" } });
  });
});
```
`src/app/api/workspaces/route.ts`:
```ts
import { NextResponse } from "next/server";
import { generateWorkspaceSlug } from "@/lib/slug";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { createWorkspace } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { createWorkspaceBodySchema } from "@/shared/api/workspaces";

/** Slug collisions are rare (32^4 suffixes per name); retry this many times. */
const SLUG_ATTEMPTS = 3;

/** Creates a workspace owned by the caller. */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, createWorkspaceBodySchema);
  if (!body.ok) {
    return body.response;
  }
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const { data, error } = await createWorkspace(supabase, { ...body.data, slug: generateWorkspaceSlug(body.data.name) });
    if (!error && data) {
      return NextResponse.json({ slug: data.slug }, { status: 201 });
    }
    if (error?.code !== "23505") {
      return fromDatabaseError(error ?? { message: "create_workspace returned nothing" });
    }
  }
  return apiError("conflict");
}
```
`src/app/api/workspaces/[slug]/route.ts` (test: 401 without user, 404 when the query returns null, 200 with details):
```ts
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/server/http/errors";
import { requireUser } from "@/server/http/require-user";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** A workspace the caller belongs to, with their role. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/workspaces/[slug]">): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const workspace = await getWorkspaceBySlug(supabase, user.id, slug);
  return workspace ? NextResponse.json(workspace) : apiError("not_found");
}
```

- [ ] **Step 4: Timezone picker (test first)** — `bunx shadcn@4.21.1 add popover command`, then restyle both to the tokens (outline border width var, `rounded-card`, `shadow-brutal`, `bg-surface`, `text-ink`, focus ring as in `Button`). Add to `vitest.setup.ts`:
```ts
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};
```
`src/lib/timezones.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { browserTimezone, listTimezones } from "./timezones";

describe("timezones", () => {
  it("lists IANA names including Africa/Tunis, sorted", () => {
    const zones = listTimezones();
    expect(zones).toContain("Africa/Tunis");
    expect([...zones].sort()).toEqual(zones);
  });

  it("detects the browser timezone", () => {
    expect(browserTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
```
`src/lib/timezones.ts`:
```ts
/** IANA timezones known to this browser, sorted (`Intl.supportedValuesOf`, all supported browsers). */
export function listTimezones(): string[] {
  return [...Intl.supportedValuesOf("timeZone")].sort();
}

/** The device's timezone, used to pre-fill new workspaces (spec §7.1). */
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
```
`src/components/forms/timezone-picker.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { TimezonePicker } from "./timezone-picker";

describe("TimezonePicker", () => {
  it("is labelled, searchable, and reports the chosen zone", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TimezonePicker id="tz" label="Timezone" value="Europe/Paris" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Timezone" });
    expect(trigger).toHaveTextContent("Europe/Paris");
    await user.click(trigger);
    await user.type(screen.getByPlaceholderText("Search timezones"), "Tunis");
    await user.click(screen.getByRole("option", { name: "Africa/Tunis" }));
    expect(onChange).toHaveBeenCalledWith("Africa/Tunis");
  });
});
```
`src/components/forms/timezone-picker.tsx`:
```tsx
"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listTimezones } from "@/lib/timezones";

/** Searchable IANA timezone combobox (spec §10). */
export function TimezonePicker({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (timezone: string) => void;
  error?: string;
}) {
  const t = useTranslations("TimezonePicker");
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => listTimezones(), []);
  const labelId = `${id}-label`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-bold text-ink">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={labelId}
            aria-describedby={errorId}
            aria-invalid={error ? true : undefined}
            className="flex min-h-11 items-center justify-between rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-left text-base text-ink shadow-brutal-sm"
          >
            {value}
            <CaretDown weight="bold" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0">
          <Command>
            <CommandInput placeholder={t("search")} />
            <CommandList>
              <CommandEmpty>{t("empty")}</CommandEmpty>
              {zones.map((zone) => (
                <CommandItem key={zone} value={zone} onSelect={() => { onChange(zone); setOpen(false); }}>
                  {zone}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? <p id={errorId} className="text-sm font-bold text-ink">{error}</p> : null}
    </div>
  );
}
```
Messages: `"TimezonePicker": { "search": "Search timezones", "empty": "No timezone matches." }`.

- [ ] **Step 5: `/w/new` (test first)** — messages:
```json
"CreateWorkspace": {
  "title": "Create your workspace",
  "intro": "A workspace holds your group's members, meetings and organizers.",
  "nameLabel": "Workspace name",
  "namePlaceholder": "e.g. Robotics Club",
  "invalidName": "Enter a name between 1 and 80 characters.",
  "timezoneLabel": "Timezone",
  "timezoneHint": "Meeting times are shown in this timezone.",
  "submit": "Create workspace"
}
```
`src/app/w/new/create-workspace-form.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { CreateWorkspaceForm } from "./create-workspace-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/timezones", () => ({ browserTimezone: () => "Africa/Tunis", listTimezones: () => ["Africa/Tunis", "Europe/Paris"] }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("CreateWorkspaceForm", () => {
  it("pre-fills the browser timezone, creates, and opens the new workspace", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ slug: "robotics-club-ab12" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<CreateWorkspaceForm />);
    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveTextContent("Africa/Tunis");
    await user.type(screen.getByLabelText("Workspace name"), "Robotics Club");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/w/robotics-club-ab12"));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: "Robotics Club", timezone: "Africa/Tunis" });
  });

  it("explains the owned-workspace limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "workspace_limit" } }), { status: 409 })));
    const user = userEvent.setup();
    renderWithProviders(<CreateWorkspaceForm />);
    await user.type(screen.getByLabelText("Workspace name"), "Eleventh");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByText("You already own the maximum number of workspaces.")).toBeInTheDocument();
  });
});
```
`src/app/w/new/create-workspace-form.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UsersThree } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { TimezonePicker } from "@/components/forms/timezone-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sticker } from "@/components/ui/sticker";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { browserTimezone } from "@/lib/timezones";
import { createWorkspaceBodySchema, createWorkspaceResponseSchema } from "@/shared/api/workspaces";

type FormValues = z.input<typeof createWorkspaceBodySchema>;

/** `/w/new`: name + timezone (pre-filled from the device). */
export function CreateWorkspaceForm() {
  const t = useTranslations("CreateWorkspace");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(createWorkspaceBodySchema),
    defaultValues: { name: "", timezone: browserTimezone() },
  });
  const create = useMutation({
    mutationFn: (values: FormValues) => apiRequest("/api/workspaces", { method: "POST", body: values, schema: createWorkspaceResponseSchema }),
    onSuccess: async ({ slug }) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.push(`/w/${slug}`);
    },
  });
  const serverError = create.error ? tErrors(create.error instanceof ApiClientError ? create.error.code : "internal") : undefined;

  return (
    <Card as="section" className="flex flex-col gap-4">
      <Sticker tone="success"><UsersThree weight="bold" /></Sticker>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-muted-ink">{t("intro")}</p>
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate>
        <Input
          id="workspace-name"
          label={t("nameLabel")}
          placeholder={t("namePlaceholder")}
          error={form.formState.errors.name ? t("invalidName") : undefined}
          {...form.register("name")}
        />
        <Controller
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <TimezonePicker id="workspace-timezone" label={t("timezoneLabel")} value={field.value} onChange={field.onChange} />
          )}
        />
        <p className="text-sm text-muted-ink">{t("timezoneHint")}</p>
        {serverError ? <p role="alert" className="text-sm font-bold text-ink">{serverError}</p> : null}
        <Button type="submit" tone="primary" size="lg" disabled={create.isPending}>{t("submit")}</Button>
      </form>
    </Card>
  );
}
```
`src/app/w/new/page.tsx`: `<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4"><CreateWorkspaceForm /></main>`.

`src/hooks/use-workspace.ts`:
```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { workspaceDetailsSchema } from "@/shared/api/workspaces";

/** Query key of one workspace. */
export const workspaceQueryKey = (slug: string) => ["workspace", slug] as const;

/** The workspace at `/w/[slug]` with the caller's role. */
export function useWorkspace(slug: string) {
  return useQuery({
    queryKey: workspaceQueryKey(slug),
    queryFn: () => apiRequest(`/api/workspaces/${encodeURIComponent(slug)}`, { schema: workspaceDetailsSchema }),
  });
}
```

- [ ] **Step 6: e2e + verify + commit** — extend the sign-in e2e: after the name step on `/w/new`, create "E2E Club" and expect `/w/e2e-club-[a-z0-9]{4}`. Playwright screenshots of `/w/new` with the picker open (phone sizes, light/dark). Commit `feat: create a workspace with a generated slug and timezone picker`.

---

### Task 10: App shell (header, switcher, user menu, bottom bar, Home, placeholders)

**Labels:** `area:design-system`

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/sonner.tsx` (shadcn, restyled), `src/components/ui/avatar.tsx` (+ test), `src/components/shell/nav-items.ts` (+ test), `src/components/shell/bottom-bar.tsx` (+ test), `src/components/shell/workspace-switcher.tsx` (+ test), `src/components/shell/user-menu.tsx` (+ test), `src/components/shell/profile-dialog.tsx`, `src/components/shell/workspace-shell.tsx` (+ test), `src/components/shell/role-badge.tsx`, `src/components/shell/coming-soon.tsx`, `src/test/fixtures/me.ts`, `src/test/fetch.ts`, `src/app/w/[slug]/layout.tsx`, `src/app/w/[slug]/page.tsx`, `src/app/w/[slug]/home-checklist.tsx` (+ test), `src/app/w/[slug]/meetings/page.tsx`, `src/app/w/[slug]/lists/page.tsx`, `src/app/w/[slug]/settings/page.tsx` (heading only; Task 11 fills it), `e2e/shell.spec.ts`
- Modify: `src/app/layout.tsx` (`<Toaster />`), `messages/en.json` (`Shell`, `Home`, `ComingSoon`, `Profile`)

**Interfaces:**
- Consumes: `useMe`, `useWorkspace`, `apiRequest`, `okSchema`, `WorkspaceRole`, `Sticker`, `Button`, `Card`, `Skeleton`. No `Stagger` in M2 (its SSR issue is tracked in #51).
- Produces:
  - `type NavItem = { key: "home" | "meetings" | "new" | "lists" | "settings"; href: string; enabled: boolean }`, `navItemsFor(role: WorkspaceRole, slug: string): NavItem[]` (Viewers get no `new`).
  - `<WorkspaceShell slug>{children}</WorkspaceShell>` (loading skeleton, not-found state, remembers the workspace via `PATCH /api/me`).
  - `<ComingSoon titleKey>` empty state; `<Avatar name email size?>` initials avatar.
  - Role chip labels in `Shell.roles.{owner|admin|viewer}` — reused by Settings.

- [ ] **Step 1: shadcn components** — `bunx shadcn@4.21.1 add dropdown-menu dialog sonner`; restyle each to the tokens (outline width var, `rounded-card`/`rounded-control`, `shadow-brutal`, `bg-surface`, `text-ink`, menu items ≥ 44 px tall, visible focus ring, entrance animations off under `motion-reduce`). Mount `<Toaster />` from `src/components/ui/sonner.tsx` inside `QueryProvider` in `src/app/layout.tsx`. Each restyled wrapper gets one render test (e.g. Dialog: opens from a trigger, has `role="dialog"` and an accessible title).

- [ ] **Step 2: Navigation model (test first)** — `src/components/shell/nav-items.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { navItemsFor } from "./nav-items";

describe("navItemsFor", () => {
  it("gives Owners and Admins all five slots with + disabled until M4", () => {
    expect(navItemsFor("admin", "club-ab12")).toEqual([
      { key: "home", href: "/w/club-ab12", enabled: true },
      { key: "meetings", href: "/w/club-ab12/meetings", enabled: true },
      { key: "new", href: "/w/club-ab12/meetings/new", enabled: false },
      { key: "lists", href: "/w/club-ab12/lists", enabled: true },
      { key: "settings", href: "/w/club-ab12/settings", enabled: true },
    ]);
  });

  it("hides + from Viewers", () => {
    expect(navItemsFor("viewer", "club-ab12").map((item) => item.key)).toEqual(["home", "meetings", "lists", "settings"]);
  });
});
```
`src/components/shell/nav-items.ts`:
```ts
import type { WorkspaceRole } from "@/shared/api/me";

/** One bottom-bar slot. */
export type NavItem = { key: "home" | "meetings" | "new" | "lists" | "settings"; href: string; enabled: boolean };

/**
 * Bottom bar (spec §4 "Hub + center +"). "+" (new meeting) arrives in M4, so it is shown but
 * disabled; Viewers never see it.
 */
export function navItemsFor(role: WorkspaceRole, slug: string): NavItem[] {
  const base = `/w/${slug}`;
  const items: NavItem[] = [
    { key: "home", href: base, enabled: true },
    { key: "meetings", href: `${base}/meetings`, enabled: true },
    { key: "new", href: `${base}/meetings/new`, enabled: false },
    { key: "lists", href: `${base}/lists`, enabled: true },
    { key: "settings", href: `${base}/settings`, enabled: true },
  ];
  return role === "viewer" ? items.filter((item) => item.key !== "new") : items;
}
```

- [ ] **Step 3: Bottom bar (test first)** — messages `Shell.nav`: `{ "home": "Home", "meetings": "Meetings", "new": "New meeting", "lists": "Lists", "settings": "Settings", "soon": "Coming soon" }`. `src/components/shell/bottom-bar.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { BottomBar } from "./bottom-bar";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/club-ab12/lists" }));

describe("BottomBar", () => {
  it("marks the current section and shows + as disabled with a reason", () => {
    renderWithProviders(<BottomBar role="owner" slug="club-ab12" />);
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lists" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    const plus = screen.getByRole("button", { name: "New meeting" });
    expect(plus).toHaveAttribute("aria-disabled", "true");
    expect(plus).toHaveAccessibleDescription("Coming soon");
  });

  it("has no + for Viewers", () => {
    renderWithProviders(<BottomBar role="viewer" slug="club-ab12" />);
    expect(screen.queryByRole("button", { name: "New meeting" })).toBeNull();
  });
});
```

`src/components/shell/bottom-bar.tsx`:
```tsx
"use client";

import { CalendarDots, GearSix, House, ListBullets, Plus, type Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";
import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "@/shared/api/me";
import { navItemsFor, type NavItem } from "./nav-items";

const ICONS: Record<NavItem["key"], Icon> = {
  home: House,
  meetings: CalendarDots,
  new: Plus,
  lists: ListBullets,
  settings: GearSix,
};

/** Fixed bottom navigation with the center "+" (spec §4). */
export function BottomBar({ role, slug }: { role: WorkspaceRole; slug: string }) {
  const t = useTranslations("Shell.nav");
  const pathname = usePathname();
  const items = navItemsFor(role, slug);
  const isActive = (item: NavItem) => (item.key === "home" ? pathname === item.href : pathname.startsWith(item.href));

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t-[length:var(--tn-border-width)] border-outline bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md items-end justify-around px-2 pt-2 pb-2">
        {items.map((item) => {
          const Glyph = ICONS[item.key];
          if (item.key === "new") {
            return (
              <li key={item.key} className="-mt-6">
                <button type="button" aria-disabled="true" aria-describedby="new-soon" className="flex flex-col items-center gap-1 opacity-60">
                  <Sticker tone="primary" className="size-14 rounded-full [&_svg]:size-7"><Glyph weight="bold" /></Sticker>
                  <span className="sr-only">{t("new")}</span>
                  <span id="new-soon" className="sr-only">{t("soon")}</span>
                </button>
              </li>
            );
          }
          const active = isActive(item);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-11 min-w-14 flex-col items-center gap-0.5 rounded-control px-2 py-1 text-xs font-bold", active ? "bg-fill-primary text-on-fill" : "text-ink")}
              >
                <Glyph weight="bold" aria-hidden className="size-6" />
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```
Add `"label": "Workspace"` to `Shell.nav`.

- [ ] **Step 4: Avatar, switcher, user menu, profile dialog (test first)** — messages:
```json
"Shell": {
  "roles": { "owner": "Owner", "admin": "Admin", "viewer": "Viewer" },
  "switcherLabel": "Switch workspace",
  "createWorkspace": "Create workspace",
  "userMenuLabel": "Account",
  "yourName": "Your name",
  "signOut": "Sign out",
  "notFoundTitle": "Workspace not found",
  "notFoundBody": "It doesn't exist or you're not a member.",
  "backHome": "Go to my workspaces"
},
"Profile": { "title": "Your name", "nameLabel": "Name", "saved": "Name saved." }
```
Shared fixtures for shell tests — `src/test/fixtures/me.ts`:
```ts
import type { MeResponse } from "@/shared/api/me";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** A signed-in Owner with two workspaces. */
export const meFixture: MeResponse = {
  userId: "0a0a0a0a-0000-4000-8000-000000000001",
  profile: { displayName: "Amira Ben Ali", avatarUrl: null, email: "amira@example.test" },
  workspaces: [
    { id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", slug: "chess-ab12", name: "Chess Club", role: "viewer" },
    { id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11", slug: "robotics-cd34", name: "Robotics Club", role: "owner" },
  ],
  lastWorkspaceSlug: "robotics-cd34",
};

/** Robotics Club as seen by its Owner. */
export const workspaceFixture: WorkspaceDetails = {
  id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
  slug: "robotics-cd34",
  name: "Robotics Club",
  timezone: "Africa/Tunis",
  myRole: "owner",
  canCheckIn: false,
};
```
`src/components/ui/avatar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, initialsFor } from "./avatar";

describe("Avatar", () => {
  it("uses up to two initials, else the email's first letter", () => {
    expect(initialsFor("Amira Ben Ali", null)).toBe("AB");
    expect(initialsFor(null, "sami@example.test")).toBe("S");
  });

  it("is decorative", () => {
    render(<Avatar name="Amira" email={null} />);
    expect(screen.getByText("A")).toHaveAttribute("aria-hidden", "true");
  });
});
```
`src/components/shell/workspace-switcher.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meFixture, workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { WorkspaceSwitcher } from "./workspace-switcher";

describe("WorkspaceSwitcher", () => {
  it("shows the current workspace and role, and lists all workspaces plus Create", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceSwitcher me={meFixture} current={workspaceFixture} />);
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger).toHaveTextContent("Robotics Club");
    expect(trigger).toHaveTextContent("Owner");
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: /Chess Club/ })).toHaveAttribute("href", "/w/chess-ab12");
    expect(screen.getByRole("menuitem", { name: /Robotics Club/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("menuitem", { name: "Create workspace" })).toHaveAttribute("href", "/w/new");
  });
});
```
`src/components/shell/user-menu.test.tsx`:
```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { UserMenu } from "./user-menu";

afterEach(() => vi.unstubAllGlobals());

describe("UserMenu", () => {
  it("signs out through the API, then leaves", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const onSignedOut = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} onSignedOut={onSignedOut} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/signout", expect.objectContaining({ method: "POST" }));
  });

  it("edits the display name in a dialog", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Your name" }));
    const field = within(screen.getByRole("dialog", { name: "Your name" })).getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "Amira B.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ displayName: "Amira B." }));
  });
});
```

`src/components/shell/role-badge.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "@/shared/api/me";

const ROLE_FILL: Record<WorkspaceRole, string> = {
  owner: "bg-fill-warning",
  admin: "bg-fill-primary",
  viewer: "bg-fill-info",
};

/** Static role label (Chip is a toggle; this is not interactive). */
export function RoleBadge({ role }: { role: WorkspaceRole }) {
  const t = useTranslations("Shell.roles");
  return (
    <span className={cn("inline-flex shrink-0 rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill", ROLE_FILL[role])}>
      {t(role)}
    </span>
  );
}
```

`src/components/ui/avatar.tsx`:
```tsx
import { cn } from "@/lib/utils";

/** First letters of the first two words of the name, else the email's first letter. */
export function initialsFor(name: string | null, email: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 0 ? words.slice(0, 2).map((word) => word[0]) : [(email ?? "?")[0]];
  return letters.join("").toUpperCase();
}

/** Initials avatar in a sticker-like tile (decorative; the name is always shown next to it). */
export function Avatar({ name, email, className }: { name: string | null; email: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-outline bg-fill-info text-sm font-bold text-on-fill shadow-brutal-sm",
        className,
      )}
    >
      {initialsFor(name, email)}
    </span>
  );
}
```
`src/components/shell/workspace-switcher.tsx`:
```tsx
"use client";

import { CaretDown, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MeResponse } from "@/shared/api/me";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { RoleBadge } from "./role-badge";

/** Header switcher: current workspace + role; menu of all workspaces and "Create workspace". */
export function WorkspaceSwitcher({ me, current }: { me: MeResponse; current: WorkspaceDetails }) {
  const t = useTranslations("Shell");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t("switcherLabel")} className="flex min-h-11 min-w-0 items-center gap-2 rounded-control px-2 text-left">
        <span className="truncate font-display text-lg">{current.name}</span>
        <RoleBadge role={current.myRole} />
        <CaretDown weight="bold" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {me.workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} asChild>
            <Link href={`/w/${workspace.slug}`} aria-current={workspace.slug === current.slug ? "page" : undefined}>
              <span className="flex-1 truncate">{workspace.name}</span>
              <RoleBadge role={workspace.role} />
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/w/new">
            <Plus weight="bold" aria-hidden />
            {t("createWorkspace")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```
`src/components/shell/user-menu.tsx`:
```tsx
"use client";

import { SignOut, UserCircle } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import type { MeResponse } from "@/shared/api/me";
import { ProfileDialog } from "./profile-dialog";

/** Account menu: edit name, sign out (full navigation clears all client state). */
export function UserMenu({ me, onSignedOut }: { me: MeResponse; onSignedOut?: () => void }) {
  const t = useTranslations("Shell");
  const [profileOpen, setProfileOpen] = useState(false);
  const signOut = useMutation({
    mutationFn: () => apiRequest("/api/auth/signout", { method: "POST", schema: okSchema }),
    onSuccess: () => (onSignedOut ?? (() => window.location.assign("/login")))(),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={t("userMenuLabel")} className="rounded-full">
          <Avatar name={me.profile.displayName} email={me.profile.email} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="truncate">{me.profile.displayName ?? me.profile.email}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserCircle weight="bold" aria-hidden />
            {t("yourName")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => signOut.mutate()}>
            <SignOut weight="bold" aria-hidden />
            {t("signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} currentName={me.profile.displayName} />
    </>
  );
}
```
`src/components/shell/profile-dialog.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { displayNameSchema } from "@/shared/api/me";

const schema = z.object({ displayName: displayNameSchema });
type Values = z.input<typeof schema>;

/** Edit your display name (shown to organizers and teammates). */
export function ProfileDialog({
  open,
  onOpenChange,
  currentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string | null;
}) {
  const t = useTranslations("Profile");
  const tCommon = useTranslations("Common");
  const tWelcome = useTranslations("Welcome");
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { displayName: currentName ?? "" } });
  const save = useMutation({
    mutationFn: (values: Values) => apiRequest("/api/me", { method: "PATCH", body: values, schema: okSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      toast(t("saved"));
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
          <Input
            id="profile-name"
            autoComplete="name"
            label={t("nameLabel")}
            error={form.formState.errors.displayName ? tWelcome("invalidName") : undefined}
            {...form.register("displayName")}
          />
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
            <Button type="submit" tone="primary" disabled={save.isPending}>{tCommon("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Shell (test first)** — shared helper `src/test/fetch.ts` (used by every component test that talks to the API from here on):
```ts
import { vi } from "vitest";

/** Handler for one `"METHOD /path"` key; receives the request init (body etc.). */
export type FetchRoute = (init?: RequestInit) => Response;

/** Stubs global `fetch` by `"METHOD /path"`; unknown calls fail loudly. */
export function routeFetch(routes: Record<string, FetchRoute>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const handler = routes[key];
    if (!handler) {
      throw new Error(`unexpected ${key}`);
    }
    return handler(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** JSON response factory for `routeFetch`. */
export const json = (body: object, status = 200): FetchRoute => () => new Response(JSON.stringify(body), { status });
```
`src/components/shell/workspace-shell.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { meFixture, workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { WorkspaceShell } from "./workspace-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/chess-ab12" }));

afterEach(() => vi.unstubAllGlobals());

describe("WorkspaceShell", () => {
  it("shows a not-found state for unknown or foreign workspaces", async () => {
    routeFetch({ "GET /api/me": json(meFixture), "GET /api/workspaces/nope-zzzz": json({ error: { code: "not_found" } }, 404) });
    renderWithProviders(<WorkspaceShell slug="nope-zzzz">content</WorkspaceShell>);
    expect(await screen.findByRole("heading", { name: "Workspace not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to my workspaces" })).toHaveAttribute("href", "/welcome");
  });

  it("renders a Viewer shell without + and remembers the workspace once", async () => {
    const viewerWorkspace = { ...workspaceFixture, id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", slug: "chess-ab12", name: "Chess Club", myRole: "viewer" };
    const fetchMock = routeFetch({
      "GET /api/me": json(meFixture),
      "GET /api/workspaces/chess-ab12": json(viewerWorkspace),
      "PATCH /api/me": json({ ok: true }),
    });
    renderWithProviders(<WorkspaceShell slug="chess-ab12">content</WorkspaceShell>);
    expect(await screen.findByText("content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch workspace" })).toHaveTextContent("Viewer");
    expect(screen.queryByRole("button", { name: "New meeting" })).toBeNull();
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
      expect(patches).toHaveLength(1);
      expect(JSON.parse(String(patches[0][1]?.body))).toEqual({ lastWorkspaceId: viewerWorkspace.id });
    });
  });
});
```

`src/components/shell/workspace-shell.tsx`:
```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ME_QUERY_KEY, useMe } from "@/hooks/use-me";
import { useWorkspace } from "@/hooks/use-workspace";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { BottomBar } from "./bottom-bar";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** Organizer shell for `/w/[slug]/*`: header, content, bottom bar (spec §4, §10). */
export function WorkspaceShell({ slug, children }: { slug: string; children: ReactNode }) {
  const t = useTranslations("Shell");
  const queryClient = useQueryClient();
  const me = useMe();
  const workspace = useWorkspace(slug);
  const remember = useMutation({
    mutationFn: (lastWorkspaceId: string) => apiRequest("/api/me", { method: "PATCH", body: { lastWorkspaceId }, schema: okSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
  const workspaceId = workspace.data?.id;
  const shouldRemember = Boolean(workspaceId && me.data && me.data.lastWorkspaceSlug !== slug);
  useEffect(() => {
    if (shouldRemember && workspaceId && remember.isIdle) {
      remember.mutate(workspaceId);
    }
  }, [shouldRemember, workspaceId, remember]);

  if (workspace.error instanceof ApiClientError && workspace.error.status === 404) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
        <Card as="section" className="flex flex-col gap-3">
          <h1 className="font-display text-2xl">{t("notFoundTitle")}</h1>
          <p className="text-muted-ink">{t("notFoundBody")}</p>
          <Button asChild tone="primary"><Link href="/welcome">{t("backHome")}</Link></Button>
        </Card>
      </main>
    );
  }
  if (!workspace.data || !me.data) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }
  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b-[length:var(--tn-border-width)] border-outline bg-background px-4 py-3">
        <WorkspaceSwitcher me={me.data} current={workspace.data} />
        <UserMenu me={me.data} />
      </header>
      <main className="mx-auto max-w-md p-4">{children}</main>
      <BottomBar role={workspace.data.myRole} slug={slug} />
    </div>
  );
}
```
`src/app/w/[slug]/layout.tsx`:
```tsx
"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

/** Every `/w/[slug]` page renders inside the workspace shell. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  return <WorkspaceShell slug={slug}>{children}</WorkspaceShell>;
}
```
Check `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` for whether a client layout may omit `params` in Next 16.3 and whether `LayoutProps<'/w/[slug]'>` is required; follow the docs and record a `Ruling:` if you deviate.

- [ ] **Step 6: Home, placeholders (test first)** — messages:
```json
"Home": {
  "title": "Welcome to {workspace}",
  "checklistTitle": "Get set up",
  "inviteCommittee": "Invite your committee as Viewers",
  "inviteCommitteeAction": "Invite",
  "importMembers": "Import your members",
  "connectGmail": "Connect Gmail to send invites",
  "connectSheets": "Sync responses to Google Sheets",
  "soon": "Coming soon",
  "viewerTitle": "You're a Viewer in {workspace}",
  "viewerBody": "You'll see meetings, answers and reasons here once organizers start sending invites."
},
"ComingSoon": {
  "meetingsTitle": "Meetings arrive soon",
  "meetingsBody": "Creating and sending meetings is the next big step.",
  "listsTitle": "Member lists arrive soon",
  "listsBody": "Soon you'll import your members from a spreadsheet here."
}
```
`src/app/w/[slug]/home-checklist.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { HomeChecklist } from "./home-checklist";

describe("HomeChecklist", () => {
  it("offers the Viewer invite now and marks later steps as coming soon", () => {
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    expect(screen.getByRole("heading", { name: "Welcome to Robotics Club" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invite" })).toHaveAttribute("href", "/w/robotics-cd34/settings#people");
    expect(screen.getAllByText("Coming soon")).toHaveLength(3);
  });

  it("shows Viewers a read-only welcome instead", () => {
    renderWithProviders(<HomeChecklist workspace={{ ...workspaceFixture, myRole: "viewer" }} />);
    expect(screen.getByRole("heading", { name: "You're a Viewer in Robotics Club" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Invite" })).toBeNull();
  });
});
```
`src/app/w/[slug]/home-checklist.tsx`:
```tsx
"use client";

import { EnvelopeSimple, Eye, Table, UploadSimple, UserPlus, type Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

const STEPS: ReadonlyArray<{ key: "inviteCommittee" | "importMembers" | "connectGmail" | "connectSheets"; icon: Icon; available: boolean }> = [
  { key: "inviteCommittee", icon: UserPlus, available: true },
  { key: "importMembers", icon: UploadSimple, available: false },
  { key: "connectGmail", icon: EnvelopeSimple, available: false },
  { key: "connectSheets", icon: Table, available: false },
];

/** Home (spec §7.1): onboarding checklist for Owners/Admins, a short welcome for Viewers. */
export function HomeChecklist({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("Home");
  if (workspace.myRole === "viewer") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="info"><Eye weight="bold" /></Sticker>
        <h1 className="font-display text-2xl">{t("viewerTitle", { workspace: workspace.name })}</h1>
        <p className="text-muted-ink">{t("viewerBody")}</p>
      </Card>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title", { workspace: workspace.name })}</h1>
      <Card as="section">
        <h2 className="font-display text-xl">{t("checklistTitle")}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {STEPS.map(({ key, icon: Glyph, available }) => (
            <li key={key} className="flex items-center gap-3">
              <Sticker tone={available ? "primary" : "neutral"}><Glyph weight="bold" /></Sticker>
              <span className="flex-1 font-bold">{t(key)}</span>
              {available ? (
                <Button asChild tone="primary">
                  <Link href={`/w/${workspace.slug}/settings#people`}>{t("inviteCommitteeAction")}</Link>
                </Button>
              ) : (
                <span className="rounded-full border-2 border-outline bg-fill-neutral px-2 text-xs font-bold text-on-fill">{t("soon")}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
```
No entrance animation here (the `Stagger` SSR issue in #51 stays out of the shell). `src/app/w/[slug]/page.tsx`:
```tsx
"use client";

import { useParams } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { HomeChecklist } from "./home-checklist";

/** Workspace Home. The shell already handles loading and not-found. */
export default function WorkspaceHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  return workspace.data ? <HomeChecklist workspace={workspace.data} /> : null;
}
```

`src/components/shell/coming-soon.tsx`:
```tsx
"use client";

import { Hourglass } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";

/** Styled empty state for destinations of later milestones (spec §4 Navigation). */
export function ComingSoon({ area }: { area: "meetings" | "lists" }) {
  const t = useTranslations("ComingSoon");
  return (
    <Card as="section" className="flex flex-col items-start gap-3">
      <Sticker tone="warning"><Hourglass weight="bold" /></Sticker>
      <h1 className="font-display text-2xl">{t(`${area}Title`)}</h1>
      <p className="text-muted-ink">{t(`${area}Body`)}</p>
    </Card>
  );
}
```
`meetings/page.tsx` and `lists/page.tsx` render `<ComingSoon area="meetings" />` / `"lists"`; `settings/page.tsx` renders `<h1>` "Settings" only (Task 11).

- [ ] **Step 7: e2e + visual check** — `e2e/shell.spec.ts`: sign in (helper extracted from `auth.spec.ts` into `e2e/helpers/sign-in.ts`: `signInWithCode(page, email, name?)`), create a workspace, assert the header shows the name + "Owner", the bottom bar has 5 items with "Home" current, tapping Meetings shows "Meetings arrive soon", and `/w/unknown-zzzz` shows "Workspace not found". Run the existing axe check pattern from `e2e/design-system.spec.ts` on Home. Playwright MCP screenshots (390×844, 320×568; light/dark; menus open).

- [ ] **Step 8: Commit** — `feat: workspace shell with switcher, user menu, bottom bar and Home`.

---

### Task 11: Settings — General, People, Danger zone

**Labels:** `area:auth`, `area:design-system`

**Files:**
- Create: `src/shared/api/members.ts`, `src/server/http/workspace-context.ts` (+ test), `src/server/queries/members.ts`, `src/server/queries/members.db.test.ts`, `src/app/api/workspaces/[slug]/members/route.ts` (+ test), `src/app/api/workspaces/[slug]/members/[userId]/route.ts` (+ test), `src/app/api/workspaces/[slug]/transfer/route.ts` (+ test), `src/lib/member-actions.ts` (+ test), `src/hooks/use-members.ts`, `src/components/forms/confirm-name-dialog.tsx` (+ test), `src/app/w/[slug]/settings/general-section.tsx` (+ test), `src/app/w/[slug]/settings/people-section.tsx` (+ test), `src/app/w/[slug]/settings/danger-zone.tsx` (+ test), `src/test/fixtures/members.ts`, `e2e/settings.spec.ts`
- Modify: `src/app/api/workspaces/[slug]/route.ts` (+ `PATCH`, `DELETE`), `src/server/queries/workspaces.ts` (`updateWorkspace`), `src/shared/api/workspaces.ts`, `src/app/w/[slug]/settings/page.tsx`, `messages/en.json` (`Settings`)

**Interfaces:**
- Consumes: Task 3 functions, `getWorkspaceBySlug`, `fromDatabaseError`, `RoleBadge`, `Avatar`, `TimezonePicker`, `Dialog`, `DropdownMenu`.
- Produces:
  - `memberSchema` / `type Member = { userId; role: WorkspaceRole; canCheckIn: boolean; displayName: string | null; avatarUrl: string | null; email: string; joinedAt: string }`, `membersResponseSchema = z.array(memberSchema)`, `changeRoleBodySchema = { role: "admin" | "viewer"; canCheckIn: boolean }`, `confirmNameBodySchema = { confirmName: string }`, `transferBodySchema = { userId: uuid; confirmName: string }`, `updateWorkspaceBodySchema = { name?; timezone? }` (≥ 1 field).
  - `loadWorkspaceContext(slug: string): Promise<{ ok: true; supabase; user: AuthedUser; workspace: WorkspaceDetails } | { ok: false; response: NextResponse }>` (401/404 handled once) — reused by Task 12.
  - Queries: `updateWorkspace(client, id, patch)`, `listMembers(client, workspaceId)`, `changeRole(client, input)`, `removeMember(client, workspaceId, userId)`, `leaveWorkspace(client, workspaceId)`, `transferOwnership(client, input)`, `deleteWorkspace(client, workspaceId, confirmName)`.
  - Routes: `PATCH|DELETE /api/workspaces/[slug]`, `GET …/members`, `PATCH|DELETE …/members/[userId]` (DELETE of yourself = leave), `POST …/transfer`.
  - `type MemberAction = "makeAdmin" | "makeViewer" | "toggleCheckIn" | "remove"`, `memberActions(myRole: WorkspaceRole, myId: string, member: Member): MemberAction[]`.
  - `useMembers(slug)` (key `["members", slug]`), `<ConfirmNameDialog>`.

- [ ] **Step 1: Contracts** — `src/shared/api/members.ts`:
```ts
import { z } from "zod";
import { workspaceRoleSchema } from "./me";

/** One row of `GET /api/workspaces/[slug]/members`. */
export const memberSchema = z.object({
  userId: z.uuid(),
  role: workspaceRoleSchema,
  canCheckIn: z.boolean(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  email: z.string(),
  joinedAt: z.string(),
});

/** A workspace member as shown in Settings > People. */
export type Member = z.infer<typeof memberSchema>;

/** `GET …/members` response. */
export const membersResponseSchema = z.array(memberSchema);

/** `PATCH …/members/[userId]` body. The Owner role only changes through transfer. */
export const changeRoleBodySchema = z.object({ role: z.enum(["admin", "viewer"]), canCheckIn: z.boolean() });

/** Body of destructive actions confirmed by typing the workspace name. */
export const confirmNameBodySchema = z.object({ confirmName: z.string().max(80) });

/** `POST …/transfer` body. */
export const transferBodySchema = z.object({ userId: z.uuid(), confirmName: z.string().max(80) });
```
Append to `src/shared/api/workspaces.ts`:
```ts
/** `PATCH /api/workspaces/[slug]` body (Owner/Admin). */
export const updateWorkspaceBodySchema = z
  .object({ name: workspaceNameSchema.optional(), timezone: timezoneSchema.optional() })
  .refine((body) => body.name !== undefined || body.timezone !== undefined);
```

- [ ] **Step 2: Workspace context (test first)** — `src/server/http/workspace-context.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "u1", email: "a@example.test" } as { id: string; email: string } | null, workspace: null as object | null }));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/server/queries/workspaces", () => ({ getWorkspaceBySlug: async () => mocks.workspace }));

describe("loadWorkspaceContext", () => {
  it("answers 401 without a session and 404 for unknown or foreign workspaces", async () => {
    const { loadWorkspaceContext } = await import("./workspace-context");
    mocks.user = null;
    const noUser = await loadWorkspaceContext("x-ab12");
    expect(noUser.ok ? 200 : noUser.response.status).toBe(401);
    mocks.user = { id: "u1", email: "a@example.test" };
    const missing = await loadWorkspaceContext("x-ab12");
    expect(missing.ok ? 200 : missing.response.status).toBe(404);
  });

  it("returns client, user and workspace", async () => {
    mocks.workspace = { id: "w1", slug: "x-ab12", myRole: "admin" };
    const { loadWorkspaceContext } = await import("./workspace-context");
    const result = await loadWorkspaceContext("x-ab12");
    expect(result.ok && result.workspace).toMatchObject({ id: "w1", myRole: "admin" });
  });
});
```
`src/server/http/workspace-context.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database } from "@/server/db/database.types";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { apiError } from "./errors";
import { requireUser, type AuthedUser } from "./require-user";

/** Everything a `/api/workspaces/[slug]/**` handler needs, or the error response to return. */
export type WorkspaceContext =
  | { ok: true; supabase: SupabaseClient<Database>; user: AuthedUser; workspace: WorkspaceDetails }
  | { ok: false; response: NextResponse };

/** Resolves session + membership once per request (401 / 404). Role rules stay in Postgres. */
export async function loadWorkspaceContext(slug: string): Promise<WorkspaceContext> {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return { ok: false, response: apiError("unauthenticated") };
  }
  const workspace = await getWorkspaceBySlug(supabase, user.id, slug);
  return workspace ? { ok: true, supabase, user, workspace } : { ok: false, response: apiError("not_found") };
}
```

- [ ] **Step 3: Queries (DB test first)** — `src/server/queries/members.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { addMember, createWorkspaceAs } from "@/test/db/workspaces";
import { changeRole, deleteWorkspace, leaveWorkspace, listMembers, removeMember, transferOwnership } from "./members";
import { updateWorkspace } from "./workspaces";

describe("member queries", () => {
  it("lists members in camelCase and applies role changes", async () => {
    const owner = await createTestUser({ fullName: "Owner" });
    const viewer = await createTestUser({ fullName: "Viewer" });
    const workspace = await createWorkspaceAs(owner, "Photo Club");
    await addMember(workspace.id, viewer.id, "viewer");
    const members = await listMembers(owner.client, workspace.id);
    expect(members.map((member) => [member.displayName, member.role])).toEqual([["Owner", "owner"], ["Viewer", "viewer"]]);
    expect((await changeRole(owner.client, { workspaceId: workspace.id, userId: viewer.id, role: "viewer", canCheckIn: true })).error).toBeNull();
    expect((await listMembers(owner.client, workspace.id)).find((member) => member.userId === viewer.id)?.canCheckIn).toBe(true);
  });

  it("updates, transfers, removes, leaves and deletes through the database rules", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const viewer = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Film Club");
    await addMember(workspace.id, admin.id, "admin");
    await addMember(workspace.id, viewer.id, "viewer");
    expect((await updateWorkspace(owner.client, workspace.id, { name: "Cinema Club" })).error).toBeNull();
    expect((await updateWorkspace(viewer.client, workspace.id, { name: "Nope" })).error?.message).toBe("tn:forbidden");
    expect((await transferOwnership(owner.client, { workspaceId: workspace.id, userId: admin.id, confirmName: "Cinema Club" })).error).toBeNull();
    expect((await removeMember(admin.client, workspace.id, viewer.id)).error).toBeNull();
    expect((await leaveWorkspace(owner.client, workspace.id)).error).toBeNull();
    expect((await deleteWorkspace(admin.client, workspace.id, "Cinema Club")).error).toBeNull();
  });
});
```
`src/server/queries/members.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { Member } from "@/shared/api/members";

type Client = SupabaseClient<Database>;

/**
 * Members with names and emails (`list_members`, members only).
 * @throws Error with the database message (`tn:forbidden` for non-members)
 */
export async function listMembers(client: Client, workspaceId: string): Promise<Member[]> {
  const { data, error } = await client.rpc("list_members", { p_workspace: workspaceId });
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => ({
    userId: row.user_id,
    role: row.role,
    canCheckIn: row.can_check_in,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    email: row.email,
    joinedAt: row.joined_at,
  }));
}

/** `change_role` (Owner-only for Admin changes). */
export function changeRole(client: Client, input: { workspaceId: string; userId: string; role: "admin" | "viewer"; canCheckIn: boolean }) {
  return client.rpc("change_role", { p_workspace: input.workspaceId, p_user: input.userId, p_role: input.role, p_can_check_in: input.canCheckIn });
}

/** `remove_member` (never the Owner, never yourself). */
export function removeMember(client: Client, workspaceId: string, userId: string) {
  return client.rpc("remove_member", { p_workspace: workspaceId, p_user: userId });
}

/** `leave_workspace` (the Owner must transfer first). */
export function leaveWorkspace(client: Client, workspaceId: string) {
  return client.rpc("leave_workspace", { p_workspace: workspaceId });
}

/** `transfer_ownership` to an existing Admin after typing the name. */
export function transferOwnership(client: Client, input: { workspaceId: string; userId: string; confirmName: string }) {
  return client.rpc("transfer_ownership", { p_workspace: input.workspaceId, p_new_owner: input.userId, p_confirm_name: input.confirmName });
}

/** `delete_workspace` (Owner only, typed name). */
export function deleteWorkspace(client: Client, workspaceId: string, confirmName: string) {
  return client.rpc("delete_workspace", { p_workspace: workspaceId, p_confirm_name: confirmName });
}
```
Append to `src/server/queries/workspaces.ts`:
```ts
/**
 * Renames / changes the timezone (RLS: Owner/Admin). Zero updated rows means the caller may
 * not edit it, reported as `tn:forbidden` so routes map it like database refusals.
 */
export async function updateWorkspace(
  client: Client,
  workspaceId: string,
  patch: { name?: string; timezone?: string },
): Promise<{ error: { code?: string; message: string } | null }> {
  const { data, error } = await client.from("workspaces").update(patch).eq("id", workspaceId).select("id");
  if (error) {
    return { error };
  }
  return { error: data.length === 0 ? { code: "P0001", message: "tn:forbidden" } : null };
}
```

- [ ] **Step 4: Routes (tests first)** — each route test mocks `@/server/http/workspace-context` (`loadWorkspaceContext` → `{ ok: true, supabase: {}, user: { id: "me" }, workspace: { id: "w1", slug: "club-ab12", myRole: "owner", … } }`) and the query module, and asserts: cross-origin → 403; invalid body → 400; query called with the right arguments; a `{ error: { message: "tn:forbidden" } }` result → 403; success → 200 `{ ok: true }`. Example for the member route — `src/app/api/workspaces/[slug]/members/[userId]/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changeRole: vi.fn(async () => ({ error: null as { message: string } | null })),
  removeMember: vi.fn(async () => ({ error: null as { message: string } | null })),
  leaveWorkspace: vi.fn(async () => ({ error: null as { message: string } | null })),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => ({ ok: true, supabase: {}, user: { id: "me", email: null }, workspace: { id: "w1", slug: "club-ab12", myRole: "owner" } }),
}));
vi.mock("@/server/queries/members", () => mocks);

const ctx = (userId: string) => ({ params: Promise.resolve({ slug: "club-ab12", userId }) });
const request = (method: string, body?: object) =>
  new Request("http://localhost:3000/api/workspaces/club-ab12/members/x", { method, headers: { origin: "http://localhost:3000" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => vi.clearAllMocks());

describe("/api/workspaces/[slug]/members/[userId]", () => {
  it("PATCH changes a role", async () => {
    const { PATCH } = await import("./route");
    const target = crypto.randomUUID();
    expect((await PATCH(request("PATCH", { role: "admin", canCheckIn: false }), ctx(target))).status).toBe(200);
    expect(mocks.changeRole).toHaveBeenCalledWith({}, { workspaceId: "w1", userId: target, role: "admin", canCheckIn: false });
  });

  it("PATCH maps database refusals", async () => {
    mocks.changeRole.mockResolvedValueOnce({ error: { message: "tn:use_transfer" } });
    const { PATCH } = await import("./route");
    const response = await PATCH(request("PATCH", { role: "viewer", canCheckIn: false }), ctx(crypto.randomUUID()));
    expect(response.status).toBe(409);
  });

  it("DELETE of yourself means leaving", async () => {
    const { DELETE } = await import("./route");
    await DELETE(request("DELETE"), ctx("me"));
    expect(mocks.leaveWorkspace).toHaveBeenCalledWith({}, "w1");
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it("DELETE of someone else removes them", async () => {
    const { DELETE } = await import("./route");
    const target = crypto.randomUUID();
    await DELETE(request("DELETE"), ctx(target));
    expect(mocks.removeMember).toHaveBeenCalledWith({}, "w1", target);
  });
});
```
`src/app/api/workspaces/[slug]/members/[userId]/route.ts`:
```ts
import type { NextRequest, NextResponse } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { changeRole, leaveWorkspace, removeMember } from "@/server/queries/members";
import { changeRoleBodySchema } from "@/shared/api/members";

type Ctx = RouteContext<"/api/workspaces/[slug]/members/[userId]">;

/** Changes a member's role / check-in permission (rules enforced by `change_role`). */
export async function PATCH(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, userId } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, changeRoleBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await changeRole(context.supabase, { workspaceId: context.workspace.id, userId, ...body.data });
  return error ? fromDatabaseError(error) : ok();
}

/** Removes a member, or leaves the workspace when the target is the caller. */
export async function DELETE(request: NextRequest | Request, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, userId } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { error } =
    userId === context.user.id
      ? await leaveWorkspace(context.supabase, context.workspace.id)
      : await removeMember(context.supabase, context.workspace.id, userId);
  return error ? fromDatabaseError(error) : ok();
}
```
`src/app/api/workspaces/[slug]/members/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { listMembers } from "@/server/queries/members";

/** Members of the workspace (any member may read). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/workspaces/[slug]/members">): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  return NextResponse.json(await listMembers(context.supabase, context.workspace.id));
}
```
`src/app/api/workspaces/[slug]/route.ts` gains (keep the Task 9 `GET`):
```ts
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deleteWorkspace } from "@/server/queries/members";
import { updateWorkspace } from "@/server/queries/workspaces";
import { confirmNameBodySchema } from "@/shared/api/members";
import { updateWorkspaceBodySchema } from "@/shared/api/workspaces";

type Ctx = RouteContext<"/api/workspaces/[slug]">;

/** Renames the workspace and/or changes its timezone (Owner/Admin via RLS). */
export async function PATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, updateWorkspaceBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await updateWorkspace(context.supabase, context.workspace.id, body.data);
  return error ? fromDatabaseError(error) : ok();
}

/** Deletes the workspace after the typed name (Owner only, `delete_workspace`). */
export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, confirmNameBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await deleteWorkspace(context.supabase, context.workspace.id, body.data.confirmName);
  return error ? fromDatabaseError(error) : ok();
}
```
`src/app/api/workspaces/[slug]/transfer/route.ts`:
```ts
import type { NextRequest, NextResponse } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { transferOwnership } from "@/server/queries/members";
import { transferBodySchema } from "@/shared/api/members";

/** Transfers ownership to an existing Admin (Owner only, typed name). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workspaces/[slug]/transfer">): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, transferBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { error } = await transferOwnership(context.supabase, { workspaceId: context.workspace.id, ...body.data });
  return error ? fromDatabaseError(error) : ok();
}
```
Tests for these three files — shared context mock in `src/test/workspace-context-mock.ts`:
```ts
/** `loadWorkspaceContext` result for route tests: Owner "me" in workspace "w1". */
export const okContext = {
  ok: true as const,
  supabase: {},
  user: { id: "me", email: null },
  workspace: { id: "w1", slug: "club-ab12", name: "Robotics Club", timezone: "Africa/Tunis", myRole: "owner" as const, canCheckIn: false },
};

/** A same-origin JSON request for route tests. */
export function jsonRequest(method: string, body?: object): Request {
  return new Request("http://localhost:3000/api/x", {
    method,
    headers: { origin: "http://localhost:3000" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
```
`src/app/api/workspaces/[slug]/route.test.ts` (add to the Task 9 file):
```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  updateWorkspace: vi.fn(async () => ({ error: null as { message: string } | null })),
  deleteWorkspace: vi.fn(async () => ({ error: null as { message: string } | null })),
}));
vi.mock("@/server/http/workspace-context", () => ({ loadWorkspaceContext: async () => okContext }));
vi.mock("@/server/queries/workspaces", () => ({ updateWorkspace: mocks.updateWorkspace, getWorkspaceBySlug: vi.fn() }));
vi.mock("@/server/queries/members", () => ({ deleteWorkspace: mocks.deleteWorkspace }));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const asNext = (request: Request) => new NextRequest(request);

beforeEach(() => vi.clearAllMocks());

describe("PATCH/DELETE /api/workspaces/[slug]", () => {
  it("PATCH maps tn:invalid_timezone to 400 and tn:forbidden to 403", async () => {
    const { PATCH } = await import("./route");
    mocks.updateWorkspace.mockResolvedValueOnce({ error: { message: "tn:invalid_timezone" } });
    expect((await PATCH(asNext(jsonRequest("PATCH", { timezone: "Mars/Olympus" })), ctx)).status).toBe(400);
    mocks.updateWorkspace.mockResolvedValueOnce({ error: { message: "tn:forbidden" } });
    expect((await PATCH(asNext(jsonRequest("PATCH", { name: "X" })), ctx)).status).toBe(403);
  });

  it("DELETE sends the typed name and maps tn:name_mismatch to 400", async () => {
    const { DELETE } = await import("./route");
    expect((await DELETE(asNext(jsonRequest("DELETE", { confirmName: "Robotics Club" })), ctx)).status).toBe(200);
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith({}, "w1", "Robotics Club");
    mocks.deleteWorkspace.mockResolvedValueOnce({ error: { message: "tn:name_mismatch" } });
    expect((await DELETE(asNext(jsonRequest("DELETE", { confirmName: "nope" })), ctx)).status).toBe(400);
  });
});
```
`src/app/api/workspaces/[slug]/transfer/route.test.ts`:
```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ transferOwnership: vi.fn(async () => ({ error: null as { message: string } | null })) }));
vi.mock("@/server/http/workspace-context", () => ({ loadWorkspaceContext: async () => okContext }));
vi.mock("@/server/queries/members", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces/[slug]/transfer", () => {
  it("rejects a non-uuid userId before calling the database", async () => {
    const { POST } = await import("./route");
    expect((await POST(new NextRequest(jsonRequest("POST", { userId: "x", confirmName: "A" })), ctx)).status).toBe(400);
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });

  it("maps tn:target_not_admin to 409", async () => {
    mocks.transferOwnership.mockResolvedValueOnce({ error: { message: "tn:target_not_admin" } });
    const { POST } = await import("./route");
    const response = await POST(new NextRequest(jsonRequest("POST", { userId: crypto.randomUUID(), confirmName: "Robotics Club" })), ctx);
    expect(response.status).toBe(409);
  });
});
```
`src/app/api/workspaces/[slug]/members/route.test.ts`:
```ts
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { membersFixture } from "@/test/fixtures/members";
import { okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({ loadWorkspaceContext: async () => okContext }));
vi.mock("@/server/queries/members", () => ({ listMembers: async () => membersFixture }));

describe("GET /api/workspaces/[slug]/members", () => {
  it("returns the members list", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost:3000/api/workspaces/club-ab12/members"), { params: Promise.resolve({ slug: "club-ab12" }) });
    expect(await response.json()).toEqual(membersFixture);
  });
});
```

- [ ] **Step 5: Member actions (test first)** — `src/lib/member-actions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Member } from "@/shared/api/members";
import { memberActions } from "./member-actions";

const member = (userId: string, role: Member["role"]): Member => ({
  userId,
  role,
  canCheckIn: false,
  displayName: userId,
  avatarUrl: null,
  email: `${userId}@example.test`,
  joinedAt: "2026-10-05T00:00:00Z",
});

describe("memberActions", () => {
  it("Owner manages Admins and Viewers, never the Owner row or themselves", () => {
    expect(memberActions("owner", "me", member("a", "admin"))).toEqual(["makeViewer", "remove"]);
    expect(memberActions("owner", "me", member("v", "viewer"))).toEqual(["makeAdmin", "toggleCheckIn", "remove"]);
    expect(memberActions("owner", "me", member("me", "owner"))).toEqual([]);
  });

  it("Admins manage Viewers only", () => {
    expect(memberActions("admin", "me", member("a", "admin"))).toEqual([]);
    expect(memberActions("admin", "me", member("v", "viewer"))).toEqual(["toggleCheckIn", "remove"]);
    expect(memberActions("admin", "me", member("o", "owner"))).toEqual([]);
  });

  it("Viewers manage nobody", () => {
    expect(memberActions("viewer", "me", member("v", "viewer"))).toEqual([]);
  });
});
```
`src/lib/member-actions.ts`:
```ts
import type { Member } from "@/shared/api/members";
import type { WorkspaceRole } from "@/shared/api/me";

/** Row action in Settings > People. */
export type MemberAction = "makeAdmin" | "makeViewer" | "toggleCheckIn" | "remove";

/**
 * Actions the UI offers (mirrors the database rules, spec §3; the database still decides).
 * Yourself and the Owner have no row actions: use Leave / Transfer in the Danger zone.
 */
export function memberActions(myRole: WorkspaceRole, myId: string, member: Member): MemberAction[] {
  if (myRole === "viewer" || member.role === "owner" || member.userId === myId) {
    return [];
  }
  if (member.role === "admin") {
    return myRole === "owner" ? ["makeViewer", "remove"] : [];
  }
  return myRole === "owner" ? ["makeAdmin", "toggleCheckIn", "remove"] : ["toggleCheckIn", "remove"];
}
```
`myId` comes from `GET /api/me` (`userId`, Task 8).

- [ ] **Step 6: UI (tests first)** — messages:
```json
"Settings": {
  "title": "Settings",
  "general": { "title": "General", "nameLabel": "Workspace name", "timezoneLabel": "Timezone", "save": "Save changes", "saved": "Saved.", "readOnly": "Only Owners and Admins can change these." },
  "people": {
    "title": "People",
    "you": "You",
    "checkIn": "Can check in",
    "actionsFor": "Actions for {name}",
    "makeAdmin": "Make Admin",
    "makeViewer": "Make Viewer",
    "allowCheckIn": "Allow check-in",
    "disallowCheckIn": "Remove check-in",
    "remove": "Remove from workspace",
    "removeConfirm": "Remove {name} from {workspace}?",
    "updated": "Updated."
  },
  "danger": {
    "title": "Danger zone",
    "leave": "Leave workspace",
    "leaveConfirm": "Leave {workspace}? You'll need a new invite to come back.",
    "transfer": "Transfer ownership",
    "transferBody": "Pick an Admin to become the Owner. You'll stay as an Admin.",
    "transferTo": "New Owner",
    "noAdmins": "Make someone an Admin first.",
    "delete": "Delete workspace",
    "deleteBody": "This permanently deletes {workspace} and everything in it.",
    "typeName": "Type {workspace} to confirm",
    "confirm": "Confirm"
  }
}
```
Add `"choose": "Choose an Admin"` to `Settings.danger`.

Fixtures — `src/test/fixtures/members.ts`:
```ts
import type { Member } from "@/shared/api/members";

/** Ids shared by settings tests (the Owner is `meFixture.userId`). */
export const ownerId = "0a0a0a0a-0000-4000-8000-000000000001";
export const adminId = "0a0a0a0a-0000-4000-8000-000000000002";
export const viewerId = "0a0a0a0a-0000-4000-8000-000000000003";

const member = (userId: string, role: Member["role"], displayName: string): Member => ({
  userId,
  role,
  canCheckIn: false,
  displayName,
  avatarUrl: null,
  email: `${displayName.split(" ")[0].toLowerCase()}@example.test`,
  joinedAt: "2026-10-05T00:00:00Z",
});

/** Owner (me), one Admin, one Viewer. */
export const membersFixture: Member[] = [
  member(ownerId, "owner", "Owner Person"),
  member(adminId, "admin", "Admin Person"),
  member(viewerId, "viewer", "Viewer Person"),
];
```
`src/hooks/use-members.ts`:
```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { membersResponseSchema } from "@/shared/api/members";

/** Query key of a workspace's members. */
export const membersQueryKey = (slug: string) => ["members", slug] as const;

/** Members of `/w/[slug]` (`GET /api/workspaces/[slug]/members`). */
export function useMembers(slug: string) {
  return useQuery({
    queryKey: membersQueryKey(slug),
    queryFn: () => apiRequest(`/api/workspaces/${encodeURIComponent(slug)}/members`, { schema: membersResponseSchema }),
  });
}
```

`src/components/forms/confirm-name-dialog.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ConfirmNameDialog } from "./confirm-name-dialog";

describe("ConfirmNameDialog", () => {
  it("enables Confirm only for the exact (trimmed) name", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ConfirmNameDialog open onOpenChange={() => {}} title="Delete workspace" body="Gone forever." name="Robotics Club" confirmLabel="Confirm" onConfirm={onConfirm} />,
    );
    const confirm = screen.getByRole("button", { name: "Confirm" });
    const field = screen.getByLabelText("Type Robotics Club to confirm");
    await user.type(field, "robotics club");
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, "  Robotics Club ");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("Robotics Club");
  });
});
```
`src/components/forms/confirm-name-dialog.tsx`:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Destructive confirmation by typing the workspace name (spec §7.11). Case-sensitive, trimmed. */
export function ConfirmNameDialog({
  open,
  onOpenChange,
  title,
  body,
  name,
  confirmLabel,
  onConfirm,
  pending = false,
  error,
  canConfirm = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  name: string;
  confirmLabel: string;
  onConfirm: (typedName: string) => void;
  pending?: boolean;
  error?: string;
  canConfirm?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations("Settings.danger");
  const tCommon = useTranslations("Common");
  const [typed, setTyped] = useState("");
  const close = (next: boolean) => {
    if (!next) {
      setTyped("");
    }
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {children}
        <Input
          id="confirm-name"
          autoComplete="off"
          label={t("typeName", { workspace: name })}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          error={error}
        />
        <DialogFooter>
          <Button onClick={() => close(false)}>{tCommon("cancel")}</Button>
          <Button tone="danger" disabled={!canConfirm || pending || typed.trim() !== name} onClick={() => onConfirm(typed.trim())}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/app/w/[slug]/settings/general-section.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { GeneralSection } from "./general-section";

vi.mock("@/lib/timezones", () => ({ listTimezones: () => ["Africa/Tunis", "Europe/Paris"], browserTimezone: () => "Africa/Tunis" }));
afterEach(() => vi.unstubAllGlobals());

describe("GeneralSection", () => {
  it("lets Owners/Admins rename", async () => {
    const fetchMock = routeFetch({ "PATCH /api/workspaces/robotics-cd34": json({ ok: true }) });
    const user = userEvent.setup();
    renderWithProviders(<GeneralSection workspace={workspaceFixture} />);
    const name = screen.getByLabelText("Workspace name");
    await user.clear(name);
    await user.type(name, "Robotics & AI");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: "Robotics & AI", timezone: "Africa/Tunis" }),
    );
  });

  it("is read-only for Viewers", () => {
    renderWithProviders(<GeneralSection workspace={{ ...workspaceFixture, myRole: "viewer" }} />);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByText("Only Owners and Admins can change these.")).toBeInTheDocument();
    expect(screen.getByText("Africa/Tunis")).toBeInTheDocument();
  });
});
```
`src/app/w/[slug]/settings/general-section.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { TimezonePicker } from "@/components/forms/timezone-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { workspaceQueryKey } from "@/hooks/use-workspace";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { timezoneSchema, workspaceNameSchema, type WorkspaceDetails } from "@/shared/api/workspaces";

const schema = z.object({ name: workspaceNameSchema, timezone: timezoneSchema });
type Values = z.input<typeof schema>;

/** Settings > General: name and timezone (Owner/Admin), read-only for Viewers. */
export function GeneralSection({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("Settings.general");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { name: workspace.name, timezone: workspace.timezone } });
  const save = useMutation({
    mutationFn: (values: Values) => apiRequest(`/api/workspaces/${workspace.slug}`, { method: "PATCH", body: values, schema: okSchema }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey(workspace.slug) }),
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      ]);
      toast(t("saved"));
    },
    onError: (error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal")),
  });

  return (
    <Card as="section" aria-labelledby="general-title" className="flex flex-col gap-4">
      <h2 id="general-title" className="font-display text-xl">{t("title")}</h2>
      {workspace.myRole === "viewer" ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="font-bold">{t("nameLabel")}</dt>
            <dd>{workspace.name}</dd>
            <dt className="font-bold">{t("timezoneLabel")}</dt>
            <dd>{workspace.timezone}</dd>
          </dl>
          <p className="text-sm text-muted-ink">{t("readOnly")}</p>
        </>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
          <Input id="settings-name" label={t("nameLabel")} {...form.register("name")} />
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => <TimezonePicker id="settings-timezone" label={t("timezoneLabel")} value={field.value} onChange={field.onChange} />}
          />
          <Button type="submit" tone="primary" disabled={save.isPending}>{t("save")}</Button>
        </form>
      )}
    </Card>
  );
}
```

`src/app/w/[slug]/settings/people-section.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { membersFixture, ownerId, viewerId } from "@/test/fixtures/members";
import { renderWithProviders } from "@/test/render";
import { PeopleSection } from "./people-section";

afterEach(() => vi.unstubAllGlobals());
const membersUrl = "/api/workspaces/robotics-cd34/members";

describe("PeopleSection", () => {
  it("lists members and offers only the allowed actions", async () => {
    routeFetch({ [`GET ${membersUrl}`]: json(membersFixture) });
    const user = userEvent.setup();
    renderWithProviders(<PeopleSection workspace={workspaceFixture} myId={ownerId} />);
    expect(await screen.findByText("Admin Person")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for You" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Actions for Viewer Person" }));
    expect(screen.getByRole("menuitem", { name: "Make Admin" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Allow check-in" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Remove from workspace" })).toBeInTheDocument();
  });

  it("promotes through the API and refreshes", async () => {
    const fetchMock = routeFetch({
      [`GET ${membersUrl}`]: json(membersFixture),
      [`PATCH ${membersUrl}/${viewerId}`]: json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(<PeopleSection workspace={workspaceFixture} myId={ownerId} />);
    await user.click(await screen.findByRole("button", { name: "Actions for Viewer Person" }));
    await user.click(screen.getByRole("menuitem", { name: "Make Admin" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ role: "admin", canCheckIn: false });
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === membersUrl)).toHaveLength(2));
  });
});
```
`src/app/w/[slug]/settings/people-section.tsx`:
```tsx
"use client";

import { DotsThreeVertical } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RoleBadge } from "@/components/shell/role-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { membersQueryKey, useMembers } from "@/hooks/use-members";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { memberActions, type MemberAction } from "@/lib/member-actions";
import { okSchema } from "@/shared/api/common";
import type { Member } from "@/shared/api/members";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Settings > People: members, role badges, allowed row actions. Task 12 adds invites as `children`. */
export function PeopleSection({ workspace, myId, children }: { workspace: WorkspaceDetails; myId: string; children?: ReactNode }) {
  const t = useTranslations("Settings.people");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const members = useMembers(workspace.slug);
  const [removing, setRemoving] = useState<Member | null>(null);
  const base = `/api/workspaces/${workspace.slug}/members`;
  const onError = (error: Error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal"));
  const refresh = () => queryClient.invalidateQueries({ queryKey: membersQueryKey(workspace.slug) });

  const update = useMutation({
    mutationFn: (input: { member: Member; role: "admin" | "viewer"; canCheckIn: boolean }) =>
      apiRequest(`${base}/${input.member.userId}`, { method: "PATCH", body: { role: input.role, canCheckIn: input.canCheckIn }, schema: okSchema }),
    onSuccess: async () => {
      await refresh();
      toast(t("updated"));
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (member: Member) => apiRequest(`${base}/${member.userId}`, { method: "DELETE", schema: okSchema }),
    onSuccess: async () => {
      setRemoving(null);
      await refresh();
    },
    onError,
  });

  const run = (action: MemberAction, member: Member) => {
    if (action === "makeAdmin") {
      update.mutate({ member, role: "admin", canCheckIn: false });
    } else if (action === "makeViewer") {
      update.mutate({ member, role: "viewer", canCheckIn: false });
    } else if (action === "toggleCheckIn") {
      update.mutate({ member, role: "viewer", canCheckIn: !member.canCheckIn });
    } else {
      setRemoving(member);
    }
  };
  const actionLabel = (action: MemberAction, member: Member) =>
    action === "toggleCheckIn" ? t(member.canCheckIn ? "disallowCheckIn" : "allowCheckIn") : t(action);

  return (
    <Card as="section" id="people" aria-labelledby="people-title" className="flex scroll-mt-24 flex-col gap-4">
      <h2 id="people-title" className="font-display text-xl">{t("title")}</h2>
      {members.data ? (
        <ul className="flex flex-col gap-3">
          {members.data.map((member) => {
            const name = member.userId === myId ? t("you") : (member.displayName ?? member.email);
            const actions = memberActions(workspace.myRole, myId, member);
            return (
              <li key={member.userId} className="flex items-center gap-3">
                <Avatar name={member.displayName} email={member.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{name}</p>
                  <p className="truncate text-sm text-muted-ink">{member.email}</p>
                  {member.canCheckIn ? <p className="text-xs font-bold">{t("checkIn")}</p> : null}
                </div>
                <RoleBadge role={member.role} />
                {actions.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={t("actionsFor", { name })} className="inline-flex size-11 items-center justify-center rounded-control">
                      <DotsThreeVertical weight="bold" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {actions.map((action) => (
                        <DropdownMenuItem key={action} onSelect={() => run(action, member)}>
                          {actionLabel(action, member)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
      {children}
      <Dialog open={removing !== null} onOpenChange={(open) => (open ? undefined : setRemoving(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {removing ? t("removeConfirm", { name: removing.displayName ?? removing.email, workspace: workspace.name }) : null}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setRemoving(null)}>{tCommon("cancel")}</Button>
            <Button tone="danger" disabled={remove.isPending} onClick={() => (removing ? remove.mutate(removing) : undefined)}>
              {t("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

`src/app/w/[slug]/settings/danger-zone.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { adminId, membersFixture, ownerId } from "@/test/fixtures/members";
import { renderWithProviders } from "@/test/render";
import { DangerZone } from "./danger-zone";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe("DangerZone", () => {
  it("shows Transfer and Delete to the Owner, Leave to everyone else", () => {
    const { unmount } = renderWithProviders(<DangerZone workspace={workspaceFixture} myId={ownerId} members={membersFixture} />);
    expect(screen.getByRole("button", { name: "Transfer ownership" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave workspace" })).toBeNull();
    unmount();
    renderWithProviders(<DangerZone workspace={{ ...workspaceFixture, myRole: "admin" }} myId={adminId} members={membersFixture} />);
    expect(screen.getByRole("button", { name: "Leave workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();
  });

  it("deletes after the exact name and goes to /welcome", async () => {
    const fetchMock = routeFetch({ "DELETE /api/workspaces/robotics-cd34": json({ ok: true }) });
    const user = userEvent.setup();
    renderWithProviders(<DangerZone workspace={workspaceFixture} myId={ownerId} members={membersFixture} />);
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    await user.type(screen.getByLabelText("Type Robotics Club to confirm"), "Robotics Club");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/welcome"));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ confirmName: "Robotics Club" });
  });

  it("transfers only to an Admin and explains when there is none", async () => {
    const fetchMock = routeFetch({ "POST /api/workspaces/robotics-cd34/transfer": json({ ok: true }) });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<DangerZone workspace={workspaceFixture} myId={ownerId} members={membersFixture} />);
    await user.click(screen.getByRole("button", { name: "Transfer ownership" }));
    const select = screen.getByRole("combobox", { name: "New Owner" });
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(["Choose an Admin", "Admin Person"]);
    await user.selectOptions(select, adminId);
    await user.type(screen.getByLabelText("Type Robotics Club to confirm"), "Robotics Club");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ userId: adminId, confirmName: "Robotics Club" }));
    unmount();
    renderWithProviders(<DangerZone workspace={workspaceFixture} myId={ownerId} members={membersFixture.filter((member) => member.role !== "admin")} />);
    await user.click(screen.getByRole("button", { name: "Transfer ownership" }));
    expect(screen.getByText("Make someone an Admin first.")).toBeInTheDocument();
  });
});
```
`src/app/w/[slug]/settings/danger-zone.tsx`:
```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmNameDialog } from "@/components/forms/confirm-name-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { membersQueryKey } from "@/hooks/use-members";
import { workspaceQueryKey } from "@/hooks/use-workspace";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import type { Member } from "@/shared/api/members";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type Open = "leave" | "transfer" | "delete" | null;

/** Settings > Danger zone (spec §7.11): Owner transfers or deletes; everyone else can leave. */
export function DangerZone({ workspace, myId, members }: { workspace: WorkspaceDetails; myId: string; members: Member[] }) {
  const t = useTranslations("Settings.danger");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const [newOwner, setNewOwner] = useState("");
  const base = `/api/workspaces/${workspace.slug}`;
  const admins = members.filter((member) => member.role === "admin");
  const errorText = (error: Error | null) => (error ? tErrors(error instanceof ApiClientError ? error.code : "internal") : undefined);
  const leaveWorkspace = async () => {
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    router.replace("/welcome");
  };

  const leave = useMutation({ mutationFn: () => apiRequest(`${base}/members/${myId}`, { method: "DELETE", schema: okSchema }), onSuccess: leaveWorkspace });
  const remove = useMutation({
    mutationFn: (confirmName: string) => apiRequest(base, { method: "DELETE", body: { confirmName }, schema: okSchema }),
    onSuccess: leaveWorkspace,
  });
  const transfer = useMutation({
    mutationFn: (confirmName: string) => apiRequest(`${base}/transfer`, { method: "POST", body: { userId: newOwner, confirmName }, schema: okSchema }),
    onSuccess: async () => {
      setOpen(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey(workspace.slug) }),
        queryClient.invalidateQueries({ queryKey: membersQueryKey(workspace.slug) }),
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      ]);
    },
  });

  return (
    <Card as="section" aria-labelledby="danger-title" className="flex flex-col gap-3">
      <h2 id="danger-title" className="font-display text-xl">{t("title")}</h2>
      {workspace.myRole === "owner" ? (
        <>
          <Button tone="warning" onClick={() => setOpen("transfer")}>{t("transfer")}</Button>
          <Button tone="danger" onClick={() => setOpen("delete")}>{t("delete")}</Button>
        </>
      ) : (
        <Button tone="danger" onClick={() => setOpen("leave")}>{t("leave")}</Button>
      )}

      <Dialog open={open === "leave"} onOpenChange={(next) => setOpen(next ? "leave" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leaveConfirm", { workspace: workspace.name })}</DialogTitle>
          </DialogHeader>
          {leave.error ? <p role="alert" className="text-sm font-bold">{errorText(leave.error)}</p> : null}
          <DialogFooter>
            <Button onClick={() => setOpen(null)}>{tCommon("cancel")}</Button>
            <Button tone="danger" disabled={leave.isPending} onClick={() => leave.mutate()}>{t("leave")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmNameDialog
        open={open === "transfer"}
        onOpenChange={(next) => setOpen(next ? "transfer" : null)}
        title={t("transfer")}
        body={t("transferBody")}
        name={workspace.name}
        confirmLabel={t("confirm")}
        pending={transfer.isPending}
        error={errorText(transfer.error)}
        canConfirm={newOwner !== ""}
        onConfirm={(typed) => transfer.mutate(typed)}
      >
        {admins.length === 0 ? (
          <p className="font-bold">{t("noAdmins")}</p>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            {t("transferTo")}
            <select
              value={newOwner}
              onChange={(event) => setNewOwner(event.target.value)}
              className="min-h-11 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-base font-normal"
            >
              <option value="" disabled>{t("choose")}</option>
              {admins.map((admin) => (
                <option key={admin.userId} value={admin.userId}>{admin.displayName ?? admin.email}</option>
              ))}
            </select>
          </label>
        )}
      </ConfirmNameDialog>

      <ConfirmNameDialog
        open={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={t("delete")}
        body={t("deleteBody", { workspace: workspace.name })}
        name={workspace.name}
        confirmLabel={t("confirm")}
        pending={remove.isPending}
        error={errorText(remove.error)}
        onConfirm={(typed) => remove.mutate(typed)}
      />
    </Card>
  );
}
```
`src/app/w/[slug]/settings/page.tsx`:
```tsx
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useWorkspace } from "@/hooks/use-workspace";
import { DangerZone } from "./danger-zone";
import { GeneralSection } from "./general-section";
import { PeopleSection } from "./people-section";

/** `/w/[slug]/settings` (spec §10): General, People, Danger zone. */
export default function SettingsPage() {
  const t = useTranslations("Settings");
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  const me = useMe();
  const members = useMembers(slug);
  if (!workspace.data || !me.data) {
    return <Skeleton className="h-64 w-full" />;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <GeneralSection workspace={workspace.data} />
      <PeopleSection workspace={workspace.data} myId={me.data.userId} />
      {members.data ? <DangerZone workspace={workspace.data} myId={me.data.userId} members={members.data} /> : null}
    </div>
  );
}
```

- [ ] **Step 7: e2e** — `e2e/settings.spec.ts`: as Owner, rename the workspace (header updates), change timezone, then delete it by typing the name and land on `/welcome` → `/w/new`. A second test seeds an Admin + Viewer through the service role (helper `e2e/helpers/seed.ts` using `@supabase/supabase-js` with `SUPABASE_SECRET_KEY` from the env set by `with-local-supabase.ts`), then: Owner makes the Viewer an Admin, transfers ownership to the original Admin (typing the name), and sees "Admin" on their own badge. Playwright MCP screenshots of Settings in both themes at both phone sizes, dialogs open.

- [ ] **Step 8: Commit** — `feat: workspace settings with people management, transfer and deletion`.

---

### Task 12: Invites end to end (mailer, invite email, routes, Settings UI, `/invite/[token]`)

**Labels:** `area:auth`, `area:email`

**Files:**
- Create: `src/shared/api/invites.ts` (+ test), `src/server/queries/invites.ts`, `src/server/queries/invites.db.test.ts`, `src/server/email/system-mailer.ts` (+ test), `src/emails/invite-email.tsx` (+ test), `src/server/invites/deliver-invite.ts` (+ test), `src/app/api/workspaces/[slug]/invites/route.ts` (+ test), `src/app/api/workspaces/[slug]/invites/[id]/route.ts` (+ test), `src/app/api/workspaces/[slug]/invites/[id]/renew/route.ts` (+ test), `src/app/api/invites/preview/route.ts` (+ test), `src/app/api/invites/accept/route.ts` (+ test), `src/hooks/use-invites.ts`, `src/app/w/[slug]/settings/invites-panel.tsx` (+ test), `src/app/w/[slug]/settings/invite-dialog.tsx` (+ test), `src/app/invite/[token]/page.tsx`, `src/app/invite/[token]/invite-acceptance.tsx` (+ test), `e2e/invites.spec.ts`
- Modify: `src/lib/observability/scrub.ts` (+ test), `src/server/queries/profile.ts` (`getDisplayName`), `src/app/w/[slug]/settings/page.tsx` (pass `<InvitesPanel>` into `PeopleSection`), `messages/en.json` (`Email.invite`, `Invites`, `InvitePage`), `package.json` (`nodemailer`, `date-fns` if missing)

**Interfaces:**
- Consumes: Task 4 functions, `loadWorkspaceContext`, `generateToken`, `sha256Hex`, `EmailLayout`, `brutalBox`, `emailTheme`, `getEmailTranslator`, `safeNextPath`, `PeopleSection` (children slot), `RoleBadge`.
- Produces:
  - Contracts: `inviteDeliverySchema = z.enum(["email", "link"])`, `createInviteBodySchema = { email, role: "admin" | "viewer", delivery }`, `renewInviteBodySchema = { delivery }`, `inviteSchema = { id; email; role; status: "pending" | "expired"; expiresAt; createdAt }`, `invitesResponseSchema`, `inviteDeliveredSchema` (`{ id, delivery: "email" }` | `{ id, delivery: "link", link }`), `inviteTokenBodySchema = { token }` (43-char base64url), `invitePreviewSchema = { status; workspaceName; workspaceSlug; role; maskedEmail }`, `acceptInviteResponseSchema = { slug }`.
  - Queries: `listOpenInvites`, `getInvite`, `createInvite`, `renewInvite`, `revokeInvite`, `consumeInviteEmail`, `previewInvite`, `acceptInvite`; `getDisplayName(client, user)`.
  - `type SystemEmail = { to: string; subject: string; html: string; text: string }`, `createSystemMailer(transport?): { send(email: SystemEmail): Promise<void> }`.
  - `renderInviteEmail({ workspaceName, inviterName, role, link, expiresInDays }): Promise<SystemEmail without "to">`.
  - `deliverInvite({ supabase, workspaceId, inviteId, token, delivery, origin, inviterName, workspaceName, mailer? }): Promise<NextResponse>` — shared by create and renew.
  - Routes: `GET|POST /api/workspaces/[slug]/invites`, `DELETE /api/workspaces/[slug]/invites/[id]`, `POST /api/workspaces/[slug]/invites/[id]/renew`, `POST /api/invites/preview`, `POST /api/invites/accept`.
  - Pages: Settings invites panel + dialog; `/invite/[token]`.

- [ ] **Step 1: Scrub invite tokens (test first)** — add to `src/lib/observability/scrub.test.ts`:
```ts
it("scrubs invite tokens like personal links", () => {
  expect(scrubUrl("https://tapnshow.vercel.app/invite/Abc_123-xyz?next=1")).toBe("https://tapnshow.vercel.app/invite/[REDACTED]?next=1");
  expect(scrubUrl("/invite/[token]")).toBe("/invite/[token]");
});
```
In `scrub.ts` change the pattern and replacement:
```ts
/**
 * `/r/<token>` personal links and `/invite/<token>` invite links, including percent-encoded
 * slashes and any letter case. Route patterns such as `/r/[token]` are left alone.
 */
const TOKEN_LINK = /(?:\/|%2f)(r|invite)(?:\/|%2f)(?!\[|%5b)[^/?#&\s"'\\]+/gi;

export function scrubUrl(url: string): string {
  return url.replace(TOKEN_LINK, (_match, segment: string) => `/${segment.toLowerCase()}/[REDACTED]`);
}
```
Run the whole observability suite (logger + Sentry options rely on it) → PASS.

- [ ] **Step 2: Contracts (test first)** — `src/shared/api/invites.ts`:
```ts
import { z } from "zod";
import { emailSchema } from "./common";
import { workspaceRoleSchema } from "./me";

/** How an invite reaches the person: platform email or a link the Admin copies. */
export const inviteDeliverySchema = z.enum(["email", "link"]);

/** Roles that can be invited (the Owner role only changes by transfer). */
export const invitableRoleSchema = z.enum(["admin", "viewer"]);

/** `POST /api/workspaces/[slug]/invites` body. */
export const createInviteBodySchema = z.object({ email: emailSchema, role: invitableRoleSchema, delivery: inviteDeliverySchema });

/** `POST …/invites/[id]/renew` body. */
export const renewInviteBodySchema = z.object({ delivery: inviteDeliverySchema });

/** One open invite in Settings. */
export const inviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: invitableRoleSchema,
  status: z.enum(["pending", "expired"]),
  expiresAt: z.string(),
  createdAt: z.string(),
});

/** An open invite. */
export type Invite = z.infer<typeof inviteSchema>;

/** `GET …/invites` response. */
export const invitesResponseSchema = z.array(inviteSchema);

/** Result of create / renew. The link (and its token) is returned only for "link" delivery. */
export const inviteDeliveredSchema = z.discriminatedUnion("delivery", [
  z.object({ id: z.uuid(), delivery: z.literal("email") }),
  z.object({ id: z.uuid(), delivery: z.literal("link"), link: z.url() }),
]);

/** Body carrying an invite token (POST only: tokens never go in query strings). */
export const inviteTokenBodySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/** `POST /api/invites/preview` response. */
export const invitePreviewSchema = z.object({
  status: z.enum(["not_found", "revoked", "already_member", "used", "expired", "wrong_account", "ready"]),
  workspaceName: z.string().nullable(),
  workspaceSlug: z.string().nullable(),
  role: workspaceRoleSchema.nullable(),
  maskedEmail: z.string().nullable(),
});

/** Invite preview shown on `/invite/[token]`. */
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** `POST /api/invites/accept` response. */
export const acceptInviteResponseSchema = z.object({ slug: z.string() });
```
`src/shared/api/invites.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createInviteBodySchema, inviteTokenBodySchema } from "./invites";

describe("invite contracts", () => {
  it("normalizes the invited email and refuses the owner role", () => {
    expect(createInviteBodySchema.parse({ email: " Ali.Ben@Gmail.COM ", role: "viewer", delivery: "link" }).email).toBe("ali.ben@gmail.com");
    expect(createInviteBodySchema.safeParse({ email: "a@example.test", role: "owner", delivery: "link" }).success).toBe(false);
  });

  it("accepts only 256-bit base64url tokens", () => {
    expect(inviteTokenBodySchema.safeParse({ token: "A".repeat(43) }).success).toBe(true);
    expect(inviteTokenBodySchema.safeParse({ token: "short" }).success).toBe(false);
    expect(inviteTokenBodySchema.safeParse({ token: `${"A".repeat(42)}/` }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Queries (DB test first)** — `src/server/queries/invites.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { createWorkspaceAs } from "@/test/db/workspaces";
import { acceptInvite, createInvite, getInvite, listOpenInvites, previewInvite, renewInvite, revokeInvite } from "./invites";

const hash = (): string => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

describe("invite queries", () => {
  it("create → list → preview → accept, in camelCase", async () => {
    const owner = await createTestUser();
    const invitee = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Math Club");
    const tokenHash = hash();
    const { data: id } = await createInvite(owner.client, { workspaceId: workspace.id, email: invitee.email, role: "viewer", tokenHash });
    const invites = await listOpenInvites(owner.client, workspace.id);
    expect(invites).toEqual([expect.objectContaining({ id, email: invitee.email, role: "viewer", status: "pending" })]);
    expect(await getInvite(owner.client, id!)).toMatchObject({ email: invitee.email, role: "viewer" });
    expect(await previewInvite(invitee.client, tokenHash)).toMatchObject({ status: "ready", workspaceName: "Math Club", role: "viewer" });
    expect((await acceptInvite(invitee.client, tokenHash)).data).toBe(workspace.slug);
    expect(await listOpenInvites(owner.client, workspace.id)).toEqual([]);
  });

  it("renews and revokes", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner);
    const { data: id } = await createInvite(owner.client, { workspaceId: workspace.id, email: "x@example.test", role: "viewer", tokenHash: hash() });
    expect((await renewInvite(owner.client, id!, hash())).error).toBeNull();
    expect((await revokeInvite(owner.client, id!)).error).toBeNull();
    expect(await listOpenInvites(owner.client, workspace.id)).toEqual([]);
  });
});
```
`src/server/queries/invites.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAfter, parseISO } from "date-fns";
import type { Database } from "@/server/db/database.types";
import type { Invite, InvitePreview } from "@/shared/api/invites";

type Client = SupabaseClient<Database>;
const INVITE_COLUMNS = "id, email, role, expires_at, created_at";

function toInvite(row: { id: string; email: string; role: "owner" | "admin" | "viewer"; expires_at: string; created_at: string }, now: Date): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role === "admin" ? "admin" : "viewer",
    status: isAfter(parseISO(row.expires_at), now) ? "pending" : "expired",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Open (not accepted, not revoked) invites of a workspace, newest first. Columns are listed:
 * `token_hash` is not readable by `authenticated`.
 * @throws Error on database failures
 */
export async function listOpenInvites(client: Client, workspaceId: string, now: Date = new Date()): Promise<Invite[]> {
  const { data, error } = await client
    .from("workspace_invites")
    .select(INVITE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => toInvite(row, now));
}

/** One invite visible to the caller (Owner/Admin), or null. */
export async function getInvite(client: Client, inviteId: string): Promise<Invite | null> {
  const { data, error } = await client.from("workspace_invites").select(INVITE_COLUMNS).eq("id", inviteId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? toInvite(data, new Date()) : null;
}

/** `create_invite`; returns the new invite id. */
export function createInvite(client: Client, input: { workspaceId: string; email: string; role: "admin" | "viewer"; tokenHash: string }) {
  return client.rpc("create_invite", { p_workspace: input.workspaceId, p_email: input.email, p_role: input.role, p_token_hash: input.tokenHash });
}

/** `renew_invite`: new token hash + new expiry on the same row. */
export function renewInvite(client: Client, inviteId: string, tokenHash: string) {
  return client.rpc("renew_invite", { p_invite: inviteId, p_token_hash: tokenHash });
}

/** `revoke_invite`. */
export function revokeInvite(client: Client, inviteId: string) {
  return client.rpc("revoke_invite", { p_invite: inviteId });
}

/** `consume_invite_email`: true while the workspace and platform budgets allow another email. */
export function consumeInviteEmail(client: Client, workspaceId: string) {
  return client.rpc("consume_invite_email", { p_workspace: workspaceId });
}

/**
 * `invite_preview` for the signed-in caller.
 * @throws Error on database failures
 */
export async function previewInvite(client: Client, tokenHash: string): Promise<InvitePreview> {
  const { data, error } = await client.rpc("invite_preview", { p_token_hash: tokenHash });
  if (error) {
    throw new Error(error.message);
  }
  const row = data[0];
  return {
    status: row.status as InvitePreview["status"],
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    role: row.role,
    maskedEmail: row.masked_email,
  };
}

/** `accept_invite`; returns the workspace slug. */
export function acceptInvite(client: Client, tokenHash: string) {
  return client.rpc("accept_invite", { p_token_hash: tokenHash });
}
```
`row.status as InvitePreview["status"]` narrows a Postgres `text`; replace it with `invitePreviewSchema.shape.status.parse(row.status)` if the reviewer prefers runtime validation over a cast (record the choice).

Append to `src/server/queries/profile.ts`:
```ts
/** Name shown as the inviter in emails: display name, else email, else the app name. */
export async function getDisplayName(client: Client, user: AuthedUser): Promise<string | null> {
  const { data } = await client.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
  return data?.display_name ?? user.email;
}
```

- [ ] **Step 4: Mailer + invite email (test first)** — `bun add nodemailer@^10` (ships its own types; do not add `@types/nodemailer`). Check `date-fns` is a dependency (`bun add date-fns @date-fns/tz` if missing).

`src/server/email/system-mailer.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { createSystemMailer } from "./system-mailer";

describe("SystemMailer", () => {
  it("sends from the platform sender named after the app", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "m1" }));
    await createSystemMailer({ sendMail }).send({ to: "a@example.test", subject: "S", html: "<p>H</p>", text: "H" });
    expect(sendMail).toHaveBeenCalledWith({ from: { name: "TapNShow", address: "no-reply@example.test" }, to: "a@example.test", subject: "S", html: "<p>H</p>", text: "H" });
  });
});
```
(`vitest.config.mts` already sets `SMTP_FROM=no-reply@example.test` from Task 5.)

`src/server/email/system-mailer.ts`:
```ts
import "server-only";
import nodemailer from "nodemailer";
import { APP_NAME } from "@/config/app";
import { getServerEnv } from "@/config/env";

/** A system email (sign-in codes are sent by Supabase; this covers invite emails). */
export type SystemEmail = { to: string; subject: string; html: string; text: string };

/** The part of a nodemailer transport the mailer needs (tests pass a double). */
export type MailTransport = {
  sendMail: (message: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<object>;
};

function createSmtpTransport(): MailTransport {
  const env = getServerEnv();
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    requireTLS: env.SMTP_REQUIRE_TLS,
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

/** Sends system emails through the platform SMTP account (spec §8: platform Gmail now, Resend later). */
export function createSystemMailer(transport: MailTransport = createSmtpTransport()) {
  return {
    async send(email: SystemEmail): Promise<void> {
      await transport.sendMail({ from: { name: APP_NAME, address: getServerEnv().SMTP_FROM }, ...email });
    },
  };
}
```
`secure: false` + `requireTLS` = STARTTLS on 587 (verified working with the app password on 2026-10-05). If nodemailer 10's `createTransport` return type is not assignable to `MailTransport`, wrap it: `{ sendMail: (message) => transporter.sendMail(message) }`.

Messages:
```json
"Email": {
  "invite": {
    "subject": "{inviter} invited you to {workspace} on {appName}",
    "preview": "Join {workspace} as {role}. The link expires in {days} days.",
    "heading": "You're invited to {workspace}",
    "body": "{inviter} invited you to join {workspace} on {appName} as {role}.",
    "roleViewer": "a Viewer: you'll see meetings, answers and reasons",
    "roleAdmin": "an Admin: you'll help run meetings",
    "button": "Accept invite",
    "expiry": "The link works once and expires in {days} days. Sign in with this email address to accept.",
    "fallback": "If the button doesn't work, copy this link:"
  }
}
```
`src/emails/invite-email.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { renderInviteEmail } from "./invite-email";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("renderInviteEmail", () => {
  it("names the inviter, workspace and role, links the invite, and has a text part", async () => {
    const email = await renderInviteEmail({ workspaceName: "Robotics Club", inviterName: "Amira", role: "viewer", link: "https://tapnshow.vercel.app/invite/abc", expiresInDays: 7 });
    expect(email.subject).toBe("Amira invited you to Robotics Club on TapNShow");
    expect(email.html).toContain('href="https://tapnshow.vercel.app/invite/abc"');
    expect(email.html).toContain("a Viewer");
    expect(email.text).toContain("https://tapnshow.vercel.app/invite/abc");
    expect(email.text).toContain("expires in 7 days");
    expect(email.html).not.toContain("box-shadow");
    expect(email.html).not.toMatch(EMOJI);
  });

  it("escapes names that contain HTML", async () => {
    const email = await renderInviteEmail({ workspaceName: "<b>Club</b>", inviterName: "A & B", role: "admin", link: "https://x.test/invite/t", expiresInDays: 7 });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });
});
```
`src/emails/invite-email.tsx`:
```tsx
import { Button, render, Text } from "react-email";
import { APP_NAME } from "@/config/app";
import { EmailLayout } from "./email-layout";
import { brutalBox, emailTheme as t } from "./theme";
import { getEmailTranslator } from "./translator";

/** What the invite email needs. */
export type InviteEmailProps = {
  workspaceName: string;
  inviterName: string;
  role: "admin" | "viewer";
  link: string;
  expiresInDays: number;
};

/** Viewer/Admin invitation (spec §7.13), sent by the platform sender. */
export function InviteEmail({ workspaceName, inviterName, role, link, expiresInDays }: InviteEmailProps) {
  const tr = getEmailTranslator();
  const roleText = tr(role === "admin" ? "invite.roleAdmin" : "invite.roleViewer");
  return (
    <EmailLayout preview={tr("invite.preview", { workspace: workspaceName, role: roleText, days: expiresInDays })} heading={tr("invite.heading", { workspace: workspaceName })}>
      <Text style={{ fontSize: "16px", lineHeight: "24px", margin: "0 0 20px" }}>
        {tr("invite.body", { inviter: inviterName, workspace: workspaceName, appName: APP_NAME, role: roleText })}
      </Text>
      <Button
        href={link}
        style={{ ...brutalBox(t.primary, t.radiusControl), color: t.ink, display: "inline-block", fontFamily: t.fontDisplay, fontSize: "16px", padding: "14px 22px", textDecoration: "none" }}
      >
        {tr("invite.button")}
      </Button>
      <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "20px 0 8px" }}>{tr("invite.expiry", { days: expiresInDays })}</Text>
      <Text style={{ color: t.muted, fontSize: "13px", lineHeight: "18px", margin: 0, wordBreak: "break-all" }}>
        {tr("invite.fallback")} {link}
      </Text>
    </EmailLayout>
  );
}

/** Subject + HTML + plain text for one invite. */
export async function renderInviteEmail(props: InviteEmailProps): Promise<{ subject: string; html: string; text: string }> {
  const tr = getEmailTranslator();
  const element = <InviteEmail {...props} />;
  return {
    subject: tr("invite.subject", { inviter: props.inviterName, workspace: props.workspaceName, appName: APP_NAME }),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
```

- [ ] **Step 5: Delivery (test first)** — `src/server/invites/deliver-invite.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeInviteEmail: vi.fn(async () => ({ data: true as boolean | null, error: null as { message: string } | null })),
  getInvite: vi.fn(async () => ({ id: "i1", email: "v@example.test", role: "viewer", status: "pending", expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), createdAt: "" })),
  send: vi.fn(async () => undefined),
}));
vi.mock("@/server/queries/invites", () => ({ consumeInviteEmail: mocks.consumeInviteEmail, getInvite: mocks.getInvite }));

const base = { supabase: {}, workspaceId: "w1", inviteId: "i1", token: "T".repeat(43), origin: "https://tapnshow.vercel.app", inviterName: "Amira", workspaceName: "Robotics Club" };

beforeEach(() => vi.clearAllMocks());

describe("deliverInvite", () => {
  it("returns the link for copy delivery without sending or consuming budget", async () => {
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({ ...base, delivery: "link", mailer: { send: mocks.send } });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "i1", delivery: "link", link: `https://tapnshow.vercel.app/invite/${"T".repeat(43)}` });
    expect(mocks.consumeInviteEmail).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("emails the invite with the request origin's link", async () => {
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({ ...base, delivery: "email", mailer: { send: mocks.send } });
    expect(await response.json()).toEqual({ id: "i1", delivery: "email" });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "v@example.test", subject: "Amira invited you to Robotics Club on TapNShow" }));
  });

  it("answers invite_email_limit with the invite id when the budget is used up", async () => {
    mocks.consumeInviteEmail.mockResolvedValueOnce({ data: false, error: null });
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({ ...base, delivery: "email", mailer: { send: mocks.send } });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "invite_email_limit", details: { inviteId: "i1" } } });
  });

  it("answers email_failed with the invite id when SMTP fails", async () => {
    mocks.send.mockRejectedValueOnce(new Error("535 auth failed"));
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({ ...base, delivery: "email", mailer: { send: mocks.send } });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "email_failed", details: { inviteId: "i1" } } });
  });
});
```
`src/server/invites/deliver-invite.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { NextResponse } from "next/server";
import { renderInviteEmail } from "@/emails/invite-email";
import { logger } from "@/lib/logger";
import type { Database } from "@/server/db/database.types";
import { createSystemMailer, type SystemEmail } from "@/server/email/system-mailer";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { consumeInviteEmail, getInvite } from "@/server/queries/invites";

/**
 * Hands a freshly (re)issued invite token to the person: returns the link for "link"
 * delivery, or spends email budget and emails it. On budget or SMTP failure the invite stays
 * valid and the error carries `inviteId` so the UI can offer "Copy link instead".
 */
export async function deliverInvite(input: {
  supabase: SupabaseClient<Database> | object;
  workspaceId: string;
  inviteId: string;
  token: string;
  delivery: "email" | "link";
  origin: string;
  inviterName: string;
  workspaceName: string;
  mailer?: { send: (email: SystemEmail) => Promise<void> };
}): Promise<NextResponse> {
  const link = `${input.origin}/invite/${input.token}`;
  if (input.delivery === "link") {
    return NextResponse.json({ id: input.inviteId, delivery: "link", link }, { status: 201 });
  }
  const supabase = input.supabase as SupabaseClient<Database>;
  const budget = await consumeInviteEmail(supabase, input.workspaceId);
  if (budget.error) {
    return fromDatabaseError(budget.error);
  }
  if (budget.data !== true) {
    return apiError("invite_email_limit", { inviteId: input.inviteId });
  }
  const invite = await getInvite(supabase, input.inviteId);
  if (!invite) {
    return apiError("not_found");
  }
  try {
    const content = await renderInviteEmail({
      workspaceName: input.workspaceName,
      inviterName: input.inviterName,
      role: invite.role,
      link,
      expiresInDays: differenceInCalendarDays(parseISO(invite.expiresAt), new Date()),
    });
    await (input.mailer ?? createSystemMailer()).send({ to: invite.email, ...content });
  } catch (error) {
    logger.error({ err: error }, "invite email failed");
    return apiError("email_failed", { inviteId: input.inviteId });
  }
  return NextResponse.json({ id: input.inviteId, delivery: "email" }, { status: 201 });
}
```
Remove the `| object` + cast if the tests can pass a typed double instead (preferred: type `supabase` as `SupabaseClient<Database>` and pass `{} as never`-free doubles by mocking the query module, which these tests already do — then the parameter needs no widening). Record the `Ruling:`.

- [ ] **Step 6: Routes (tests first)** — tests reuse `okContext` / `jsonRequest` from `src/test/workspace-context-mock.ts` and mock `@/server/queries/invites`, `@/server/invites/deliver-invite`, `@/server/queries/profile`.

`src/app/api/workspaces/[slug]/invites/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { generateToken, sha256Hex } from "@/server/crypto/tokens";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deliverInvite } from "@/server/invites/deliver-invite";
import { createInvite, listOpenInvites } from "@/server/queries/invites";
import { getDisplayName } from "@/server/queries/profile";
import { createInviteBodySchema } from "@/shared/api/invites";

type Ctx = RouteContext<"/api/workspaces/[slug]/invites">;

/** Open invites (Owner/Admin; RLS returns none to Viewers). */
export async function GET(_request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  return NextResponse.json(await listOpenInvites(context.supabase, context.workspace.id));
}

/** Creates an email-bound invite and delivers it by email or as a copyable link. */
export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const context = await loadWorkspaceContext((await ctx.params).slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, createInviteBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const token = generateToken();
  const { data: inviteId, error } = await createInvite(context.supabase, {
    workspaceId: context.workspace.id,
    email: body.data.email,
    role: body.data.role,
    tokenHash: sha256Hex(token),
  });
  if (error || !inviteId) {
    return fromDatabaseError(error ?? { message: "create_invite returned nothing" });
  }
  return deliverInvite({
    supabase: context.supabase,
    workspaceId: context.workspace.id,
    inviteId,
    token,
    delivery: body.data.delivery,
    origin: request.nextUrl.origin,
    inviterName: (await getDisplayName(context.supabase, context.user)) ?? context.workspace.name,
    workspaceName: context.workspace.name,
  });
}
```
Invite links use the **request's origin**, not `NEXT_PUBLIC_APP_URL` (which is the production URL on previews too).

`src/app/api/workspaces/[slug]/invites/[id]/renew/route.ts`:
```ts
import type { NextRequest, NextResponse } from "next/server";
import { generateToken, sha256Hex } from "@/server/crypto/tokens";
import { fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { deliverInvite } from "@/server/invites/deliver-invite";
import { renewInvite } from "@/server/queries/invites";
import { getDisplayName } from "@/server/queries/profile";
import { renewInviteBodySchema } from "@/shared/api/invites";

/** Issues a new token for an open invite (old link stops working) and delivers it again. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workspaces/[slug]/invites/[id]/renew">): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const body = await parseJsonBody(request, renewInviteBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const token = generateToken();
  const { error } = await renewInvite(context.supabase, id, sha256Hex(token));
  if (error) {
    return fromDatabaseError(error);
  }
  return deliverInvite({
    supabase: context.supabase,
    workspaceId: context.workspace.id,
    inviteId: id,
    token,
    delivery: body.data.delivery,
    origin: request.nextUrl.origin,
    inviterName: (await getDisplayName(context.supabase, context.user)) ?? context.workspace.name,
    workspaceName: context.workspace.name,
  });
}
```

`src/app/api/workspaces/[slug]/invites/[id]/route.ts`:
```ts
import type { NextRequest, NextResponse } from "next/server";
import { fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import { revokeInvite } from "@/server/queries/invites";

/** Revokes an open invite. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/workspaces/[slug]/invites/[id]">): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const { error } = await revokeInvite(context.supabase, id);
  return error ? fromDatabaseError(error) : ok();
}
```
`src/app/api/invites/preview/route.ts` and `accept/route.ts`:
```ts
// preview
import { NextResponse } from "next/server";
import { sha256Hex } from "@/server/crypto/tokens";
import { apiError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { previewInvite } from "@/server/queries/invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { inviteTokenBodySchema } from "@/shared/api/invites";

/** What `/invite/[token]` shows to the signed-in user. POST keeps the token out of URLs and logs. */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, inviteTokenBodySchema);
  if (!body.ok) {
    return body.response;
  }
  return NextResponse.json(await previewInvite(supabase, sha256Hex(body.data.token)));
}
```
```ts
// accept
import { NextResponse } from "next/server";
import { sha256Hex } from "@/server/crypto/tokens";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { acceptInvite } from "@/server/queries/invites";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { inviteTokenBodySchema } from "@/shared/api/invites";

/** Accepts the invite for the signed-in, matching, verified email (`accept_invite`). */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return apiError("unauthenticated");
  }
  const body = await parseJsonBody(request, inviteTokenBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { data: slug, error } = await acceptInvite(supabase, sha256Hex(body.data.token));
  return error || !slug ? fromDatabaseError(error ?? { message: "accept_invite returned nothing" }) : NextResponse.json({ slug });
}
```
`src/app/api/workspaces/[slug]/invites/route.test.ts`:
```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(async (_client: object, _input: { email: string; tokenHash: string }) => ({
    data: "7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5e" as string | null,
    error: null as { message: string } | null,
  })),
  listOpenInvites: vi.fn(async () => []),
  deliverInvite: vi.fn(async (_input: { token: string; origin: string; inviterName: string }) => new Response(null, { status: 201 })),
}));
vi.mock("@/server/http/workspace-context", () => ({ loadWorkspaceContext: async () => okContext }));
vi.mock("@/server/queries/invites", () => ({ createInvite: mocks.createInvite, listOpenInvites: mocks.listOpenInvites }));
vi.mock("@/server/invites/deliver-invite", () => ({ deliverInvite: mocks.deliverInvite }));
vi.mock("@/server/queries/profile", () => ({ getDisplayName: async () => "Amira" }));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const post = (body: object, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/workspaces/club-ab12/invites", { method: "POST", headers: { origin }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("/api/workspaces/[slug]/invites", () => {
  it("POST stores only the hash of the token it delivers, with the request origin", async () => {
    const { POST } = await import("./route");
    await POST(post({ email: "V@Example.test", role: "viewer", delivery: "email" }), ctx);
    const created = mocks.createInvite.mock.calls[0][1];
    const delivered = mocks.deliverInvite.mock.calls[0][0];
    expect(created.email).toBe("v@example.test");
    expect(delivered.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.tokenHash).toBe(sha256Hex(delivered.token));
    expect(delivered).toMatchObject({ origin: "http://localhost:3000", inviterName: "Amira" });
  });

  it("POST refuses cross-origin calls and maps tn:already_member to 409", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ email: "v@example.test", role: "viewer", delivery: "link" }, "https://evil.example"), ctx)).status).toBe(403);
    mocks.createInvite.mockResolvedValueOnce({ data: null, error: { message: "tn:already_member" } });
    expect((await POST(post({ email: "v@example.test", role: "viewer", delivery: "link" }), ctx)).status).toBe(409);
    expect(mocks.deliverInvite).not.toHaveBeenCalled();
  });

  it("GET lists open invites", async () => {
    const { GET } = await import("./route");
    expect((await GET(new NextRequest(jsonRequest("GET")), ctx)).status).toBe(200);
    expect(mocks.listOpenInvites).toHaveBeenCalledWith({}, "w1");
  });
});
```

`src/app/api/invites/accept/route.test.ts` (the preview route test mirrors it with `previewInvite`):
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "v@example.test" } as { id: string; email: string } | null,
  acceptInvite: vi.fn(async () => ({ data: "club-ab12" as string | null, error: null as { message: string } | null })),
}));
vi.mock("@/server/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/http/require-user", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/server/queries/invites", () => ({ acceptInvite: mocks.acceptInvite }));

const token = "T".repeat(43);
const post = (body: object) =>
  new Request("http://localhost:3000/api/invites/accept", { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "v@example.test" };
});

describe("POST /api/invites/accept", () => {
  it("accepts by token hash and returns the slug", async () => {
    const { POST } = await import("./route");
    const response = await POST(post({ token }));
    expect(await response.json()).toEqual({ slug: "club-ab12" });
    expect(mocks.acceptInvite).toHaveBeenCalledWith({}, sha256Hex(token));
  });

  it("needs a session and a well-formed token", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ token: "bad" }))).status).toBe(400);
    mocks.user = null;
    expect((await POST(post({ token }))).status).toBe(401);
    expect(mocks.acceptInvite).not.toHaveBeenCalled();
  });

  it("maps tn:invite_wrong_account to 403", async () => {
    mocks.acceptInvite.mockResolvedValueOnce({ data: null, error: { message: "tn:invite_wrong_account" } });
    const { POST } = await import("./route");
    expect((await POST(post({ token }))).status).toBe(403);
  });
});
```

- [ ] **Step 7: Settings UI (tests first)** — messages:
```json
"Invites": {
  "title": "Invites",
  "invite": "Invite someone",
  "empty": "No pending invites.",
  "pending": "Pending",
  "expired": "Expired",
  "expires": "Expires {date}",
  "copyLink": "Copy link",
  "resend": "Email again",
  "revoke": "Cancel invite",
  "actionsFor": "Invite actions for {email}",
  "copied": "Link copied. It works once, for {email} only.",
  "sent": "Invite sent to {email}.",
  "revoked": "Invite cancelled.",
  "dialogTitle": "Invite to {workspace}",
  "emailLabel": "Email address",
  "roleLabel": "Role",
  "roleViewer": "Viewer: sees meetings, answers and reasons",
  "roleAdmin": "Admin: helps run the workspace",
  "deliveryLabel": "How should they get it?",
  "deliveryEmail": "Email it from TapNShow",
  "deliveryLink": "Give me a link to share",
  "submit": "Create invite",
  "linkLabel": "Invite link",
  "linkHint": "Works once, only for {email}, for 7 days.",
  "copyInstead": "Copy link instead",
  "done": "Done"
}
```
`src/hooks/use-invites.ts`:
```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { invitesResponseSchema } from "@/shared/api/invites";

/** Query key of a workspace's open invites. */
export const invitesQueryKey = (slug: string) => ["invites", slug] as const;

/** Open invites (`GET /api/workspaces/[slug]/invites`); disabled for Viewers. */
export function useInvites(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: invitesQueryKey(slug),
    queryFn: () => apiRequest(`/api/workspaces/${encodeURIComponent(slug)}/invites`, { schema: invitesResponseSchema }),
    enabled,
  });
}
```
`src/app/w/[slug]/settings/invite-dialog.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { InviteDialog } from "./invite-dialog";

const inviteId = "7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5e";
const invitesUrl = "/api/workspaces/robotics-cd34/invites";
afterEach(() => vi.unstubAllGlobals());

describe("InviteDialog", () => {
  it("only the Owner can choose Admin", () => {
    renderWithProviders(<InviteDialog open onOpenChange={() => {}} workspace={{ ...workspaceFixture, myRole: "admin" }} />);
    expect(screen.queryByRole("radio", { name: /^Admin:/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /^Viewer:/ })).toBeChecked();
  });

  it("creates a link invite and shows the link to copy", async () => {
    routeFetch({ [`POST ${invitesUrl}`]: json({ id: inviteId, delivery: "link", link: "http://localhost:3000/invite/tok" }, 201) });
    const user = userEvent.setup();
    renderWithProviders(<InviteDialog open onOpenChange={() => {}} workspace={workspaceFixture} />);
    await user.type(screen.getByLabelText("Email address"), "new@example.test");
    await user.click(screen.getByRole("radio", { name: "Give me a link to share" }));
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(await screen.findByLabelText("Invite link")).toHaveValue("http://localhost:3000/invite/tok");
  });

  it("offers Copy link instead when the email budget is used up", async () => {
    routeFetch({
      [`POST ${invitesUrl}`]: json({ error: { code: "invite_email_limit", details: { inviteId } } }, 429),
      [`POST ${invitesUrl}/${inviteId}/renew`]: json({ id: inviteId, delivery: "link", link: "http://localhost:3000/invite/tok2" }, 201),
    });
    const user = userEvent.setup();
    renderWithProviders(<InviteDialog open onOpenChange={() => {}} workspace={workspaceFixture} />);
    await user.type(screen.getByLabelText("Email address"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(await screen.findByText("Email limit reached for today. Copy the link instead.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy link instead" }));
    expect(await screen.findByLabelText("Invite link")).toHaveValue("http://localhost:3000/invite/tok2");
  });
});
```
`src/app/w/[slug]/settings/invite-dialog.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { invitesQueryKey } from "@/hooks/use-invites";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { createInviteBodySchema, inviteDeliveredSchema } from "@/shared/api/invites";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type Values = z.input<typeof createInviteBodySchema>;

/** Invite someone by email or copied link (spec §7.13). Admin role is offered to the Owner only. */
export function InviteDialog({ open, onOpenChange, workspace }: { open: boolean; onOpenChange: (open: boolean) => void; workspace: WorkspaceDetails }) {
  const t = useTranslations("Invites");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(createInviteBodySchema), defaultValues: { email: "", role: "viewer", delivery: "email" } });
  const base = `/api/workspaces/${workspace.slug}/invites`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: invitesQueryKey(workspace.slug) });

  const create = useMutation({
    mutationFn: (values: Values) => apiRequest(base, { method: "POST", body: values, schema: inviteDeliveredSchema }),
    onSuccess: async (result, values) => {
      await refresh();
      if (result.delivery === "link") {
        setLink({ url: result.link, email: values.email.trim().toLowerCase() });
      } else {
        toast(t("sent", { email: values.email.trim().toLowerCase() }));
        close(false);
      }
    },
  });
  const copyInstead = useMutation({
    mutationFn: (inviteId: string) => apiRequest(`${base}/${inviteId}/renew`, { method: "POST", body: { delivery: "link" }, schema: inviteDeliveredSchema }),
    onSuccess: async (result) => {
      await refresh();
      if (result.delivery === "link") {
        setLink({ url: result.link, email: form.getValues("email").trim().toLowerCase() });
      }
    },
  });

  function close(next: boolean) {
    if (!next) {
      setLink(null);
      form.reset();
      create.reset();
      copyInstead.reset();
    }
    onOpenChange(next);
  }

  const failure = create.error instanceof ApiClientError ? create.error : null;
  const fallbackInviteId = failure?.details?.inviteId;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle", { workspace: workspace.name })}</DialogTitle>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-3">
            <Input id="invite-link" label={t("linkLabel")} hint={t("linkHint", { email: link.email })} value={link.url} readOnly onFocus={(event) => event.target.select()} />
            <DialogFooter>
              <Button
                tone="primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(link.url);
                  toast(t("copied", { email: link.email }));
                }}
              >
                {t("copyLink")}
              </Button>
              <Button onClick={() => close(false)}>{t("done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate>
            <Input id="invite-email" type="email" autoComplete="off" label={t("emailLabel")} {...form.register("email")} />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-bold">{t("roleLabel")}</legend>
              <label className="flex min-h-11 items-center gap-2"><input type="radio" value="viewer" {...form.register("role")} />{t("roleViewer")}</label>
              {workspace.myRole === "owner" ? (
                <label className="flex min-h-11 items-center gap-2"><input type="radio" value="admin" {...form.register("role")} />{t("roleAdmin")}</label>
              ) : null}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-bold">{t("deliveryLabel")}</legend>
              <label className="flex min-h-11 items-center gap-2"><input type="radio" value="email" {...form.register("delivery")} />{t("deliveryEmail")}</label>
              <label className="flex min-h-11 items-center gap-2"><input type="radio" value="link" {...form.register("delivery")} />{t("deliveryLink")}</label>
            </fieldset>
            {create.error ? <p role="alert" className="text-sm font-bold">{tErrors(failure ? failure.code : "internal")}</p> : null}
            <DialogFooter>
              {fallbackInviteId ? (
                <Button tone="warning" disabled={copyInstead.isPending} onClick={() => copyInstead.mutate(fallbackInviteId)}>{t("copyInstead")}</Button>
              ) : null}
              <Button type="submit" tone="primary" disabled={create.isPending}>{t("submit")}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```
`src/app/w/[slug]/settings/invites-panel.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { InvitesPanel } from "./invites-panel";

const invitesUrl = "/api/workspaces/robotics-cd34/invites";
const pending = { id: "7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5e", email: "v@example.test", role: "viewer", status: "pending", expiresAt: "2026-10-12T10:00:00Z", createdAt: "2026-10-05T10:00:00Z" };
const expired = { ...pending, id: "8d2f5c3b-0e4a-4f7b-9c6d-1a2b3c4d5e6f", email: "old@example.test", status: "expired", expiresAt: "2026-09-30T10:00:00Z" };
afterEach(() => vi.unstubAllGlobals());

describe("InvitesPanel", () => {
  it("lists open invites with status and expiry", async () => {
    routeFetch({ [`GET ${invitesUrl}`]: json([pending, expired]) });
    renderWithProviders(<InvitesPanel workspace={workspaceFixture} />);
    expect(await screen.findByText("v@example.test")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/^Expires Oct 12, 2026$/)).toBeInTheDocument();
  });

  it("Copy link renews the invite and copies the new link", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    routeFetch({
      [`GET ${invitesUrl}`]: json([pending]),
      [`POST ${invitesUrl}/${pending.id}/renew`]: json({ id: pending.id, delivery: "link", link: "http://localhost:3000/invite/new" }, 201),
    });
    const user = userEvent.setup();
    renderWithProviders(<InvitesPanel workspace={workspaceFixture} />);
    await user.click(await screen.findByRole("button", { name: "Invite actions for v@example.test" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/invite/new"));
  });

  it("Cancel invite sends DELETE", async () => {
    const fetchMock = routeFetch({ [`GET ${invitesUrl}`]: json([pending]), [`DELETE ${invitesUrl}/${pending.id}`]: json({ ok: true }) });
    const user = userEvent.setup();
    renderWithProviders(<InvitesPanel workspace={workspaceFixture} />);
    await user.click(await screen.findByRole("button", { name: "Invite actions for v@example.test" }));
    await user.click(screen.getByRole("menuitem", { name: "Cancel invite" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
  });

  it("renders nothing for Viewers", () => {
    const { container } = renderWithProviders(<InvitesPanel workspace={{ ...workspaceFixture, myRole: "viewer" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```
`src/app/w/[slug]/settings/invites-panel.tsx`:
```tsx
"use client";

import { DotsThreeVertical, UserPlus } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { RoleBadge } from "@/components/shell/role-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { invitesQueryKey, useInvites } from "@/hooks/use-invites";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { okSchema } from "@/shared/api/common";
import { inviteDeliveredSchema, type Invite } from "@/shared/api/invites";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { InviteDialog } from "./invite-dialog";

/** Settings > People > Invites (Owner/Admin only). */
export function InvitesPanel({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("Invites");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const canManage = workspace.myRole !== "viewer";
  const invites = useInvites(workspace.slug, canManage);
  const [dialogOpen, setDialogOpen] = useState(false);
  const base = `/api/workspaces/${workspace.slug}/invites`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: invitesQueryKey(workspace.slug) });
  const onError = (error: Error) => toast.error(tErrors(error instanceof ApiClientError ? error.code : "internal"));

  const renew = useMutation({
    mutationFn: (input: { invite: Invite; delivery: "email" | "link" }) =>
      apiRequest(`${base}/${input.invite.id}/renew`, { method: "POST", body: { delivery: input.delivery }, schema: inviteDeliveredSchema }),
    onSuccess: async (result, { invite }) => {
      await refresh();
      if (result.delivery === "link") {
        await navigator.clipboard.writeText(result.link);
        toast(t("copied", { email: invite.email }));
      } else {
        toast(t("sent", { email: invite.email }));
      }
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (invite: Invite) => apiRequest(`${base}/${invite.id}`, { method: "DELETE", schema: okSchema }),
    onSuccess: async () => {
      await refresh();
      toast(t("revoked"));
    },
    onError,
  });

  if (!canManage) {
    return null;
  }
  return (
    <section aria-labelledby="invites-title" className="flex flex-col gap-3 border-t-[length:var(--tn-border-width)] border-outline pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="invites-title" className="font-display text-lg">{t("title")}</h3>
        <Button tone="primary" onClick={() => setDialogOpen(true)}>
          <UserPlus weight="bold" aria-hidden />
          {t("invite")}
        </Button>
      </div>
      {!invites.data ? (
        <Skeleton className="h-16 w-full" />
      ) : invites.data.length === 0 ? (
        <p className="text-sm text-muted-ink">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invites.data.map((invite) => (
            <li key={invite.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{invite.email}</p>
                <p className="text-sm text-muted-ink">{t("expires", { date: format(parseISO(invite.expiresAt), "PP") })}</p>
              </div>
              <RoleBadge role={invite.role} />
              <span className={cn("rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill", invite.status === "pending" ? "bg-fill-success" : "bg-fill-neutral")}>
                {t(invite.status)}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger aria-label={t("actionsFor", { email: invite.email })} className="inline-flex size-11 items-center justify-center rounded-control">
                  <DotsThreeVertical weight="bold" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => renew.mutate({ invite, delivery: "link" })}>{t("copyLink")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => renew.mutate({ invite, delivery: "email" })}>{t("resend")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => revoke.mutate(invite)}>{t("revoke")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <InviteDialog open={dialogOpen} onOpenChange={setDialogOpen} workspace={workspace} />
    </section>
  );
}
```
`settings/page.tsx`: render `<PeopleSection workspace={workspace.data} myId={me.data.userId}><InvitesPanel workspace={workspace.data} /></PeopleSection>`. Clipboard writes need a secure context (localhost and HTTPS both qualify); `format(…, "PP")` uses date-fns' default `en-US` locale, which matches the English-only launch.

- [ ] **Step 8: `/invite/[token]` (test first)** — messages:
```json
"InvitePage": {
  "signInTitle": "Sign in to see your invitation",
  "signInBody": "Use the email address the invite was sent to.",
  "signIn": "Sign in",
  "readyTitle": "Join {workspace}",
  "readyBody": "You're invited as {role}.",
  "accept": "Accept invite",
  "wrongTitle": "This invite is for {email}",
  "wrongBody": "You're signed in with another address. Switch accounts to accept it.",
  "switchAccount": "Switch account",
  "expired": "This invite has expired. Ask the organizer for a new one.",
  "revoked": "This invite was cancelled.",
  "used": "This invite was already used.",
  "notFound": "This invite link isn't valid. Check that you copied all of it.",
  "alreadyMember": "You're already in {workspace}.",
  "open": "Open workspace"
}
```
`invite-acceptance.test.tsx` cases (`routeFetch`; mock `next/navigation` `useParams` → `{ token: "T".repeat(43) }` and `useRouter` → `{ push }`):
```tsx
it("asks signed-out visitors to sign in, keeping the invite as next", async () => {
  routeFetch({ "POST /api/invites/preview": json({ error: { code: "unauthenticated" } }, 401) });
  renderWithProviders(<InviteAcceptance />);
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=%2Finvite%2F${"T".repeat(43)}`);
});

it("accepts a ready invite and opens the workspace", async () => {
  routeFetch({
    "POST /api/invites/preview": json({ status: "ready", workspaceName: "Robotics Club", workspaceSlug: "robotics-cd34", role: "viewer", maskedEmail: "a•••@example.test" }),
    "POST /api/invites/accept": json({ slug: "robotics-cd34" }),
  });
  renderWithProviders(<InviteAcceptance />);
  await user.click(await screen.findByRole("button", { name: "Accept invite" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/w/robotics-cd34"));
});

it("explains a wrong account with the masked email and offers Switch account", async () => {
  routeFetch({ "POST /api/invites/preview": json({ status: "wrong_account", workspaceName: "Robotics Club", workspaceSlug: "robotics-cd34", role: "viewer", maskedEmail: "a•••@example.test" }) });
  renderWithProviders(<InviteAcceptance />);
  expect(await screen.findByRole("heading", { name: "This invite is for a•••@example.test" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch account" })).toBeInTheDocument();
});

it.each([["expired", "This invite has expired."], ["revoked", "This invite was cancelled."], ["used", "This invite was already used."], ["not_found", "This invite link isn't valid."]])(
  "shows %s",
  async (status, text) => {
    routeFetch({ "POST /api/invites/preview": json({ status, workspaceName: null, workspaceSlug: null, role: null, maskedEmail: null }) });
    renderWithProviders(<InviteAcceptance />);
    expect(await screen.findByText(text, { exact: false })).toBeInTheDocument();
  },
);
```
`src/app/invite/[token]/invite-acceptance.tsx`:
```tsx
"use client";

import { EnvelopeOpen, WarningCircle } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { loginPathFor } from "@/lib/auth-redirect";
import { okSchema } from "@/shared/api/common";
import { acceptInviteResponseSchema, invitePreviewSchema } from "@/shared/api/invites";

/** `/invite/[token]` (spec §7.13): sign in first, then accept with the invited email. */
export function InviteAcceptance() {
  const t = useTranslations("InvitePage");
  const tRoles = useTranslations("Shell.roles");
  const tErrors = useTranslations("ApiErrors");
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const loginHref = loginPathFor(`/invite/${token}`);

  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => apiRequest("/api/invites/preview", { method: "POST", body: { token }, schema: invitePreviewSchema, onUnauthenticated: () => setSignedOut(true) }),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => apiRequest("/api/invites/accept", { method: "POST", body: { token }, schema: acceptInviteResponseSchema }),
    onSuccess: async ({ slug }) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.push(`/w/${slug}`);
    },
  });
  const switchAccount = useMutation({
    mutationFn: () => apiRequest("/api/auth/signout", { method: "POST", schema: okSchema }),
    onSuccess: () => window.location.assign(loginHref),
  });

  if (signedOut) {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="primary"><EnvelopeOpen weight="bold" /></Sticker>
        <h1 className="font-display text-2xl">{t("signInTitle")}</h1>
        <p className="text-muted-ink">{t("signInBody")}</p>
        <Button asChild tone="primary" size="lg"><Link href={loginHref}>{t("signIn")}</Link></Button>
      </Card>
    );
  }
  if (!preview.data) {
    return <Skeleton className="h-48 w-full" />;
  }
  const { status, workspaceName, workspaceSlug, role, maskedEmail } = preview.data;

  if (status === "ready") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="success"><EnvelopeOpen weight="bold" /></Sticker>
        <h1 className="font-display text-2xl">{t("readyTitle", { workspace: workspaceName ?? "" })}</h1>
        <p>{t("readyBody", { role: role ? tRoles(role) : "" })}</p>
        {accept.error ? (
          <p role="alert" className="font-bold">{tErrors(accept.error instanceof ApiClientError ? accept.error.code : "internal")}</p>
        ) : null}
        <Button tone="primary" size="lg" disabled={accept.isPending} onClick={() => accept.mutate()}>{t("accept")}</Button>
      </Card>
    );
  }
  if (status === "wrong_account") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="warning"><WarningCircle weight="bold" /></Sticker>
        <h1 className="font-display text-2xl">{t("wrongTitle", { email: maskedEmail ?? "" })}</h1>
        <p>{t("wrongBody")}</p>
        <Button tone="primary" disabled={switchAccount.isPending} onClick={() => switchAccount.mutate()}>{t("switchAccount")}</Button>
      </Card>
    );
  }
  if (status === "already_member" && workspaceSlug) {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">{t("alreadyMember", { workspace: workspaceName ?? "" })}</h1>
        <Button asChild tone="primary"><Link href={`/w/${workspaceSlug}`}>{t("open")}</Link></Button>
      </Card>
    );
  }
  const message = { expired: t("expired"), revoked: t("revoked"), used: t("used"), not_found: t("notFound"), already_member: t("notFound") }[status];
  return (
    <Card as="section" className="flex flex-col gap-3">
      <Sticker tone="neutral"><WarningCircle weight="bold" /></Sticker>
      <p className="font-bold">{message}</p>
    </Card>
  );
}
```
`src/app/invite/[token]/page.tsx`: `<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4"><InviteAcceptance /></main>`.

- [ ] **Step 9: e2e** — `e2e/invites.spec.ts`:
  1. **Email delivery:** Owner signs in (`signInWithCode`), creates "Invite Club", opens Settings, invites `viewer-<ts>@example.test` with "Email it from TapNShow"; `latestEmailText(viewerEmail)` contains `/invite/`; extract the link with `/(http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43})/`; sign out; open the link → "Sign in to see your invitation" → sign in as the viewer (name step) → back on the invite → "Accept invite" → `/w/invite-club-xxxx` with the "Viewer" badge and no "New meeting".
  2. **Copy link:** Owner creates a link invite; read the link from the "Invite link" field; in a new browser context, sign in as a **different** email and open it → "This invite is for v•••@example.test".
  3. **Revoke:** cancel an invite, then opening its link (as the right user) shows "This invite was cancelled."

- [ ] **Step 10: Verify + preview check + commit** — full unit, DB and e2e suites; Playwright MCP screenshots (Settings with invites + dialog in both delivery modes; `/invite/[token]` states). On the preview deploy, invite the owner's personal address by email and confirm that the branded invite arrives from `tapnshow.app@gmail.com` and that its link points at the preview URL. Commit `feat: email-bound workspace invites with email or copied-link delivery`.

---

### Task 13: Production rollout, full e2e, manual Google check, required checks, final review

**Labels:** `area:infra`, `area:auth`

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§9 verification items resolved, §14 M2 marked done, §15), `.env.local` (backup blocks only), `e2e/auth-workspace.spec.ts` (the full happy path in one file, reusing the helpers)

**Interfaces:**
- Consumes: everything above.
- Produces: M2 shipped on `https://tapnshow.vercel.app`; epic #4 and milestone M2 closed; final review findings fixed or deferred with issues.

- [ ] **Step 1: One end-to-end story** — `e2e/auth-workspace.spec.ts` runs the epic's completion criteria as a single test on the phone project: Owner signs in with a code → name → creates "Launch Club" → Settings → invites `viewer-<ts>@example.test` by email → Viewer opens the emailed link → signs in with a code → accepts → lands on Viewer Home without "+". It also checks Review Focus 5: with the Owner's page open, clear the auth cookies (`context.clearCookies()`), click "Settings", and expect `/login?next=%2Fw%2Flaunch-club-xxxx%2Fsettings`. Run `bun run test:e2e` → PASS.

- [ ] **Step 2: Hosted database** — for both projects:
```bash
supabase link --project-ref wayabcidwnhgaazgsuns && supabase migration list --linked && supabase db advisors --linked
supabase link --project-ref dysqhjvwabqahpctytnw && supabase migration list --linked && supabase db advisors --linked
```
Expected: the three M2 migrations listed as applied remotely; no WARN/ERROR advisors. Re-link to prod at the end (the repo's default link).

- [ ] **Step 3: Environment audit (names only, never values)** — `bunx vercel@latest env ls --scope dalychouikhs-projects`:
  - Production: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED`, plus the M1 vars.
  - Preview: the five `SMTP_*` plus the M1 vars; no `GOOGLE_*`, no Google flag.
  - `.env.local`: every one of these mirrored in `VERCEL BACKUP` (Production / Preview blocks); `OTHER SECRETS BACKUP` keeps only the Supabase DB passwords. Check with a script that prints variable **names** per block and compares them to the `vercel env ls` names.

- [ ] **Step 4: Supabase auth audit** — re-run the Task 1 Step 9 check on both projects (code length 8, expiry 900, 15/hour, subjects, `{{ .Token }}` in both templates, custom SMTP host `smtp.gmail.com`). Expected values unchanged.

- [ ] **Step 5: Production smoke test with the owner (manual, both on phones)** — on `https://tapnshow.vercel.app`:
  1. Owner: email-code sign-in with their personal address. The code email arrives from "TapNShow <tapnshow.app@gmail.com>", rendered in the Neobrutalist design in the Gmail app.
  2. Owner: sign out, then sign in with "Continue with Google". Google's screen shows `tapnshow.vercel.app` (not `*.supabase.co`), and the same account is used because the email is the same (Q2).
  3. Owner: create the club's real workspace, invite a second address as Viewer by email, accept it from that inbox on another device, and check that the Viewer sees no "+" and has read-only Settings.
  4. Owner: rename the workspace, then copy an invite link and open it while signed in with the wrong account; expect the masked-email screen.
  Record each result (pass/fail + screenshot path, emails redacted) in the ledger and in the PR.

- [ ] **Step 6: Monitoring** — Sentry (org `dev-daly`, project `tapnshow`): search issues from the last 24 h with the Sentry MCP; expected none from M2 routes. Spot-check one Vercel runtime log line from `/api/auth/otp/send` and confirm no email, token or code appears (scrubber).

- [ ] **Step 7: Required checks (ask the owner first)** — ask: "Make the `db` CI job a required check on `main` (recommended: it holds the RLS and e2e tests)?" On yes:
```bash
gh api -X PATCH repos/DalyChouikh/TapNShow/branches/main/protection/required_status_checks \
  -f strict=true -f 'checks[][context]=quality' -f 'checks[][context]=db'
gh api repos/DalyChouikh/TapNShow/branches/main/protection/required_status_checks --jq '.checks[].context'
```
Expected output: `quality` and `db`.

- [ ] **Step 8: Spec + tracking** — in the spec: turn §9's "To verify in the first M2 tasks" bullet into the recorded outcomes (each with its `Ruling:` source), set the §14 M2 row's "Done when" to done (date), and remove anything in §15 that M2 settled. Close epic #4 and milestone `M2 Auth & workspaces` after the final review below.

- [ ] **Step 9: Final review** — use superpowers:requesting-code-review with a **fresh reviewer on the most capable model** over the whole M2 range (`git log` from the merge of this plan to `HEAD`), with this plan, the spec and the Review Focus list as the brief. Grade findings Critical / Important / Minor. Fix Critical + Important in one `fix/` PR under a new `[task] M2 final review fixes` issue (test first for each); file Minor ones as one issue under the next epic, as was done for #51. Record `Final:` lines in the ledger.

- [ ] **Step 10: Commit** — `docs: M2 rollout results and resolved verification items`.

---

## Self-review notes (plan author)

- **Spec coverage:** §3 roles → Tasks 2–4, 11; §4 sign-in, tenancy, invites, navigation → Tasks 6–12; §6 data model + access pattern → Tasks 2–4; §7.1 → Tasks 8–10; §7.11 → Tasks 3, 11; §7.13 → Tasks 4, 12; §8 platform budget → Tasks 1, 4, 12; §9 sign-in + auth emails as code → Tasks 1, 6, 7; §10 routes → Tasks 6–12; §11 grants, SECURITY DEFINER exception, rate limits, secrets backup, email design → Tasks 1, 2, 4, 5, 6, 12; §12 RLS matrix, CI `db` job, e2e via mail catcher → Tasks 2, 6, 12, 13. `platform_admins` is deliberately deferred to M9 (spec §6).
- **Out of scope (spec, later milestones):** contacts/lists (M3), Gmail connection + meeting sending (M4), `/r/[token]` (M5), account deletion (M8: it must transfer or delete owned workspaces first, because `workspace_roles` cascades on user deletion), Google brand verification and privacy policy (M9).
- **Known follow-ups:** stale `private.rate_limit_events` rows for keys never hit again are cleaned up by the M4 daily job; until then they are a few bytes per OTP request.
