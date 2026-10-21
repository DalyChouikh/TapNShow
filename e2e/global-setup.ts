import { execFileSync } from "node:child_process";
import { z } from "zod";
import { startFakeGoogle } from "./helpers/fake-google";
import { removeFakePushCertificate, startFakePush } from "./helpers/fake-push";

/**
 * Sign-in limits (`private.check_ip_rate_limit`) one local e2e run shares from its single IP and
 * its single platform, each raised to this for the run: every story signs in, so a full run makes
 * hundreds of code requests and checks.
 */
const E2E_IP_LIMITS = [
  "otp_send_per_ip_per_hour",
  "otp_send_platform_per_day",
  "otp_verify_per_ip_per_hour",
  "google_signin_per_ip_per_hour",
] as const;
const E2E_REQUESTS_PER_IP_PER_HOUR = 1000;

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

/** Reads, or sets, the switch for sharing the Google Sheet with the team (#413). */
function sheetTeamSharing(enabled?: boolean): boolean {
  if (enabled !== undefined) {
    localSql(
      `update private.app_flags set enabled = ${enabled} where name = 'sheet_team_sharing'`,
    );
  }
  return z
    .array(z.object({ enabled: z.boolean() }))
    .length(1)
    .parse(
      JSON.parse(
        localSql(
          "select enabled from private.app_flags where name = 'sheet_team_sharing'",
        ),
      ),
    )[0].enabled;
}

/**
 * Locally every request has the IP "unknown", so a whole e2e run shares one per-IP bucket for each
 * pre-sign-in route. Raise those limits for the run (and clear old counters), then restore the
 * original values so DB tests keep checking the real limits. CI starts from a fresh stack anyway.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const originals = E2E_IP_LIMITS.map(
    (name) => [name, appLimit(name)] as const,
  );
  const calendarDelay = appLimit("calendar_confirm_delay_seconds");
  const sharing = sheetTeamSharing();
  const restore = () => {
    for (const [name, value] of originals) {
      setAppLimit(name, value);
    }
    setAppLimit("calendar_confirm_delay_seconds", calendarDelay);
    sheetTeamSharing(sharing);
  };
  try {
    localSql("delete from private.rate_limit_events");
    for (const name of E2E_IP_LIMITS) {
      setAppLimit(name, E2E_REQUESTS_PER_IP_PER_HOUR);
    }
    // The responses story waits for calendar emails: make them due after 1 s (the lowest value the
    // limits table allows), then the story runs the dispatcher itself, as cron would. Set once for
    // the whole run (parallel workers would race a per-file before/after).
    setAppLimit("calendar_confirm_delay_seconds", 1);
    // Every story runs with the Google Sheet shared with the team (#413), switched on once for the
    // whole run for the same reason; the flag-off screens are pinned by unit and database tests.
    sheetTeamSharing(true);
    // Fake Google (token, revoke, Gmail, Drive, Sheets): no e2e call reaches Google.
    const fakeGoogle = await startFakeGoogle();
    // Fake push service (HTTPS, like every real one): no e2e push reaches a browser vendor.
    const fakePush = await startFakePush();
    return async () => {
      restore();
      await new Promise<void>((resolve) => fakeGoogle.close(() => resolve()));
      await new Promise<void>((resolve) => fakePush.close(() => resolve()));
      removeFakePushCertificate();
    };
  } catch (error) {
    // A crash here (e.g. the fake Google port is taken) must not leave the raised limits behind.
    restore();
    throw error;
  }
}
