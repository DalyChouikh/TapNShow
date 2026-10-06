import { execFileSync } from "node:child_process";

/**
 * Runs SQL as the local `postgres` superuser through the Supabase CLI. Test setup only: used for
 * rows no API can create, such as a Google identity in `auth.identities`.
 */
export function runLocalSql(sql: string): void {
  execFileSync("supabase", ["db", "query", "--local", "--agent", "no", sql], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Simulates Supabase Auth recording a Google identity for `userId`. */
export function addGoogleIdentity(
  userId: string,
  identityData: { full_name?: string; picture?: string },
): void {
  const data = JSON.stringify({ sub: crypto.randomUUID(), ...identityData });
  runLocalSql(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ('${crypto.randomUUID()}', '${userId}', $json$${data}$json$::jsonb, 'google', now(), now(), now())`,
  );
}
