import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Supabase's Management API (hosted projects' settings and SQL). */
export const MANAGEMENT_API = "https://api.supabase.com/v1";

/** The Supabase access token: `SUPABASE_ACCESS_TOKEN`, or the one `supabase login` saved. */
export function readAccessToken(): string {
  return (
    process.env.SUPABASE_ACCESS_TOKEN ??
    readFileSync(join(homedir(), ".supabase", "access-token"), "utf8").trim()
  );
}

/** The `tn:` error code in a database error's text, if there is one. */
export function tnCode(text: string): string | undefined {
  return /tn:[a-z_]+/.exec(text)?.[0];
}
