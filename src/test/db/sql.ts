import { execFileSync, spawn } from "node:child_process";
import { z } from "zod";

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

/**
 * Runs SQL as the local `postgres` superuser and parses the rows (test assertions only).
 * `--agent no` keeps the CLI output a plain JSON array on every machine.
 */
export function queryLocalSql<T>(sql: string, schema: z.ZodType<T>): T {
  let output: string;
  try {
    output = execFileSync(
      "supabase",
      [
        "db",
        "query",
        "--local",
        "--output-format",
        "json",
        "--agent",
        "no",
        sql,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(cliErrorMessage(error instanceof Error ? error : null), {
      cause: error,
    });
  }
  return schema.parse(JSON.parse(output));
}

/** The CLI's JSON error on stdout: `{"error":{"message":"failed to execute query: error: tn:…"}}`. */
const cliErrorSchema = z.object({ error: z.object({ message: z.string() }) });

/**
 * The database's own message for a failed `supabase db query` (the CLI prints it on stdout, which
 * the child-process error leaves out), so tests can assert `tn:` codes.
 */
function cliErrorMessage(error: Error | null): string {
  const stdout =
    error && "stdout" in error && typeof error.stdout === "string"
      ? error.stdout
      : "";
  try {
    return cliErrorSchema.parse(JSON.parse(stdout)).error.message;
  } catch {
    return error?.message ?? "supabase db query failed";
  }
}

/** The local stack's database as `postgres` (Supabase CLI ports 44320–44329). */
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:44322/postgres";

/**
 * Runs `sql` as `postgres` in a transaction that stays open for `holdSeconds` before committing,
 * and resolves once that session is asleep inside it (its locks held, its rows not yet visible to
 * others). `released` settles at commit. For race tests that must overlap two writers for sure,
 * which two API calls fired together cannot promise. Test setup only.
 */
export async function holdLocalTransaction(
  sql: string,
  holdSeconds: number,
): Promise<{ released: Promise<void> }> {
  const marker = `tn-hold-${crypto.randomUUID()}`;
  const child = spawn(
    "psql",
    [
      LOCAL_DB_URL,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `begin; ${sql}; select pg_sleep(${holdSeconds}) as "${marker}"; commit;`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const released = new Promise<void>((resolve, reject) => {
    child.on("exit", (status) =>
      status === 0
        ? resolve()
        : reject(new Error(`held transaction failed: ${stderr}`)),
    );
  });
  const asleep = z.array(z.object({ asleep: z.boolean() })).length(1);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [row] = queryLocalSql(
      `select exists (select 1 from pg_stat_activity
         where query like '%${marker}%' and wait_event = 'PgSleep'
           and pid <> pg_backend_pid()) as asleep`,
      asleep,
    );
    if (row.asleep) {
      return { released };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`held transaction never started: ${stderr}`);
}
