import { spawnSync } from "node:child_process";

/** Local DB as `supabase_admin` (auto_explain needs it; the local password is "postgres"). */
const ADMIN_URL =
  "postgresql://supabase_admin:postgres@127.0.0.1:44322/postgres";

/**
 * Runs `select <call>` as `userId` (role `authenticated`, JWT claims set) inside a rolled-back
 * transaction with auto_explain logging every nested statement, and returns psql's output with the
 * plans (auto_explain prints them as NOTICEs on stderr). Test assertions only.
 */
export function explainCall(call: string, userId: string): string {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const sql = [
    "begin;",
    "load 'auto_explain';",
    "set local auto_explain.log_min_duration = 0;",
    "set local auto_explain.log_nested_statements = on;",
    "set local auto_explain.log_level = notice;",
    "set local client_min_messages = notice;",
    `select set_config('request.jwt.claims', '${claims}', true);`,
    "set local role authenticated;",
    `select ${call};`,
    "rollback;",
  ].join("\n");
  const result = spawnSync(
    "psql",
    [ADMIN_URL, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

/** True when the plan text scans `index` (index, index-only or bitmap index scan). */
export function planUsesIndex(plan: string, index: string): boolean {
  return new RegExp(
    `(Index Scan|Index Only Scan)( Backward)? using ${index}\\b|Bitmap Index Scan on ${index}\\b`,
  ).test(plan);
}
