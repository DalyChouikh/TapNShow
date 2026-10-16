// Zod compiles fast object parsers with `new Function` after probing for it; the CSP (no
// 'unsafe-eval') reports that probe even though Zod catches it. Browser code parses without it
// (the server keeps the fast path). Zod keeps its settings on this global object and adopts one
// that already exists, so the flag is set without importing Zod: pages that never parse don't load
// it. Import this module first, before anything that parses at import time.
declare global {
  var __zod_globalConfig: { jitless?: boolean } | undefined;
}

globalThis.__zod_globalConfig ??= {};
globalThis.__zod_globalConfig.jitless = true;

export {};
