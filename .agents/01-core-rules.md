# Core Development Rules

## NEVER Violate

1. **NEVER create files** unless absolutely necessary - always edit existing files
2. **NEVER use `any` or `unknown` types** - provide explicit, strong typing
3. **NEVER skip quality checks**: `bun run lint`, `bun run format`, and `bun run test` must pass before merging
4. **NEVER use `console.log`** - use proper logging utilities instead
5. **ALWAYS test UI changes with Playwright MCP** - verify all visual/interactive changes work
6. **ALWAYS examine existing code** before implementing - follow established patterns
7. **ALWAYS place imports at top** - never import conditionally or mid-function
8. **ALWAYS use date-fns** for date operations
9. **NEVER use inline unuseful comments** - comments must add value and explain "why", not "what"
10. **NEVER ignore TypeScript errors** - fix them immediately, do not suppress
11. **ALWAYS use JSDoc comments** - document all public functions and classes
12. **ALWAYS write unit tests** for new code and bug fixes - ensure coverage
14. **ALWAYS review code** before merging - ensure quality and consistency
15. **NEVER use SQL queries in routes/pages** - use dedicated queries files and import them
16. **ALWAYS use DRY principles** - avoid code duplication, extract reusable logic into functions or modules
17. **NEVER hardcode values** - use constants or configuration files instead
18. **ALWAYS use bun instead of npm** - ensure consistency in package management and scripts