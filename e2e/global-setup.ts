import { execFileSync } from "node:child_process";
import { z } from "zod";

/** Code requests one local e2e run may make from the shared "unknown" IP. */
const E2E_OTP_REQUESTS_PER_HOUR = 1000;

function localSql(sql: string): string {
  return execFileSync(
    "supabase",
    ["db", "query", "--local", "--output-format", "json", sql],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

const limitRowsSchema = z.object({
  rows: z.array(z.object({ value: z.number() })).length(1),
});

/**
 * Locally every request has the IP "unknown", so a whole e2e run shares one per-IP bucket for
 * sign-in code requests. Raise that limit for the run (and clear old counters), then restore the
 * original value so DB tests keep checking the real limit. CI starts from a fresh stack anyway.
 */
export default function globalSetup(): () => void {
  const original = limitRowsSchema.parse(
    JSON.parse(
      localSql(
        "select value from private.app_limits where name = 'otp_send_per_ip_per_hour'",
      ),
    ),
  ).rows[0].value;
  localSql("delete from private.rate_limit_events");
  localSql(
    `update private.app_limits set value = ${E2E_OTP_REQUESTS_PER_HOUR} where name = 'otp_send_per_ip_per_hour'`,
  );
  return () => {
    localSql(
      `update private.app_limits set value = ${original} where name = 'otp_send_per_ip_per_hour'`,
    );
  };
}
