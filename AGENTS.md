<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TapNShow project rules

- Product/architecture spec: `docs/superpowers/specs/2026-10-04-tapnshow-design.md`
- Current plan: `docs/superpowers/plans/2026-10-05-m0-m1-spikes-and-foundation.md`
- Coding rules: `.agents/01-core-rules.md` (bun, strict types, JSDoc, tests, no console.log)
- Never use Server Actions; all reads/writes go through `src/app/api/**/route.ts`.
- Never use emojis in the product; use Phosphor Bold icons inside `<Sticker>`.
