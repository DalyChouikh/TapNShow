import { execFileSync } from "node:child_process";
import { z } from "zod";
import { startFakeGmail } from "./helpers/fake-gmail";

/** Code requests one local e2e run may make from the shared "unknown" IP. */
const E2E_OTP_REQUESTS_PER_HOUR = 1000;

function localSql(sql: string): string {
  return execFileSync(
    "supabase",
    ["db", "query", "--local", "--output-format", "json", "--agent", "no", sql],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

// `--agent no` keeps the output a plain JSON array of rows on every machine: the CLI wraps
// results differently when it detects an AI agent.
const limitRowsSchema = z.array(z.object({ value: z.number() })).length(1);

/** Reads one `private.app_limits` value. */
function appLimit(name: string): number {
  return limitRowsSchema.parse(
    JSON.parse(
      localSql(`select value from private.app_limits where name = '${name}'`),
    ),
  )[0].value;
}

/** Sets one `private.app_limits` value. */
function setAppLimit(name: string, value: number): void {
  localSql(
    `update private.app_limits set value = ${value} where name = '${name}'`,
  );
}

/**
 * Locally every request has the IP "unknown", so a whole e2e run shares one per-IP bucket for
 * sign-in code requests. Raise that limit for the run (and clear old counters), then restore the
 * original value so DB tests keep checking the real limit. CI starts from a fresh stack anyway.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const original = appLimit("otp_send_per_ip_per_hour");
  const calendarDelay = appLimit("calendar_confirm_delay_seconds");
  localSql("delete from private.rate_limit_events");
  setAppLimit("otp_send_per_ip_per_hour", E2E_OTP_REQUESTS_PER_HOUR);
  // The responses story waits for calendar emails: make them due after 1 s (the lowest value the
  // limits table allows), then the story runs the dispatcher itself, as cron would. Set once for
  // the whole run (parallel workers would race a per-file before/after).
  setAppLimit("calendar_confirm_delay_seconds", 1);
  // Fake Google token endpoint + Gmail API for the meetings story (no real email leaves e2e).
  const fakeGmail = await startFakeGmail();
  return async () => {
    setAppLimit("otp_send_per_ip_per_hour", original);
    setAppLimit("calendar_confirm_delay_seconds", calendarDelay);
    await new Promise<void>((resolve) => fakeGmail.close(() => resolve()));
  };
}
