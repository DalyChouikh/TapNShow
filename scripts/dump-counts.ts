import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The key `scripts/backup-counts.sql` gives our triggers on Supabase's auth tables. */
const AUTH_TRIGGERS_KEY = "auth.triggers (ours)";

const COPY_HEADER = /^COPY "([^"]+)"\."([^"]+)" .* FROM stdin;$/;

/** Rows per table in a pg_dump `--use-copy` file: data lines between each COPY header and `\.`. */
function copyRowCounts(sql: string): Map<string, number> {
  const counts = new Map<string, number>();
  let table: string | null = null;
  for (const line of sql.split("\n")) {
    if (table === null) {
      const header = COPY_HEADER.exec(line);
      if (header) {
        table = `${header[1]}.${header[2]}`;
        counts.set(table, 0);
      }
    } else if (line === "\\.") {
      table = null;
    } else {
      // COPY's text format escapes newlines inside values, so one line is one row.
      counts.set(table, (counts.get(table) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The row counts the dump itself holds, for `keys` (the lines of `scripts/backup-counts.sql`), in
 * its "key|count" format. pg_dump reads one snapshot, so these are what a restore must give back;
 * counting production separately would race the writes made during the dump (spec §5 backups).
 */
export function dumpCounts(
  files: { data: string; history: string; authTriggers: string },
  keys: readonly string[],
): string {
  const rows = new Map([
    ...copyRowCounts(files.data),
    ...copyRowCounts(files.history),
  ]);
  rows.set(
    AUTH_TRIGGERS_KEY,
    files.authTriggers
      .split("\n")
      .filter((line) => line.startsWith("CREATE TRIGGER")).length,
  );
  return keys.map((key) => `${key}|${rows.get(key) ?? "missing"}\n`).join("");
}

if (import.meta.main) {
  const [dumpDir, restoredPath] = process.argv.slice(2);
  if (!dumpDir || !restoredPath) {
    process.stderr.write(
      "usage: bun scripts/dump-counts.ts <dump dir> <restored counts file>\n",
    );
    process.exit(2);
  }
  const read = (name: string) => readFileSync(join(dumpDir, name), "utf8");
  const keys = readFileSync(restoredPath, "utf8")
    .split("\n")
    .map((line) => line.split("|")[0].trim())
    .filter(Boolean);
  process.stdout.write(
    dumpCounts(
      {
        data: read("data.sql"),
        history: read("history_data.sql"),
        authTriggers: read("auth-triggers.sql"),
      },
      keys,
    ),
  );
}
