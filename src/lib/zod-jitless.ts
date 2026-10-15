import { z } from "zod";

// Zod compiles fast object parsers with `new Function` after probing for it; the CSP (no
// 'unsafe-eval') reports that probe even though Zod catches it. Browser code parses without it
// (the server keeps the fast path). Import this module first, before anything that parses at
// import time (`@/config/public-env` does).
z.config({ jitless: true });
