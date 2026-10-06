import { execFileSync } from "node:child_process";

/**
 * Local runs share one rate-limit bucket ("unknown" IP, one platform email budget), so earlier runs
 * can exhaust it. Reset the counters of the local stack before the suite. CI starts fresh anyway.
 */
export default function globalSetup(): void {
  execFileSync(
    "supabase",
    ["db", "query", "--local", "delete from private.rate_limit_events"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
