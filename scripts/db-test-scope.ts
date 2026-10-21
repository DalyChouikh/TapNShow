import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Paths every database test depends on without importing them: the schema and the local stack
 * (`supabase/`), the toolchain and its versions, the tests' config and path aliases, the local
 * Supabase wrapper, and the workflows (#426). Matched from the repository root.
 */
const WHOLE_SUITE = [
  /^supabase\//,
  /^package\.json$/,
  /^bun\.lock$/,
  /^vitest\.db\.config\.mts$/,
  /^tsconfig\.json$/,
  /^scripts\/(with-local-supabase|local-supabase-env)\.ts$/,
  /^\.github\/workflows\//,
];

/** Which database tests a change needs. */
export type DbTestPlan =
  { kind: "all" } | { kind: "related"; files: string[] } | { kind: "none" };

/**
 * The database tests a change can reach (#426). Everything when the change can't be read or is
 * empty, or touches a whole-suite path (deletions included). Otherwise the tests whose imports
 * reach a changed file that still exists (Vitest's `related` follows static imports, `@/` aliases
 * and JSON included); none when only deleted files are left, since a test importing one would have
 * changed too.
 */
export function dbTestPlan(
  changed: readonly string[] | null,
  exists: (file: string) => boolean,
): DbTestPlan {
  if (changed === null || changed.length === 0) {
    return { kind: "all" };
  }
  if (changed.some((file) => WHOLE_SUITE.some((path) => path.test(file)))) {
    return { kind: "all" };
  }
  const files = changed.filter(exists);
  return files.length > 0 ? { kind: "related", files } : { kind: "none" };
}

/**
 * The files changed between two commits (both paths of a rename), or null when git can't tell:
 * an empty or unknown base.
 */
function changedFiles(base: string, head: string): string[] | null {
  if (!base || !head) {
    return null;
  }
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      base,
      head,
      "--",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.split("\0").filter((file) => file.length > 0);
}

/**
 * Runs the plan's database tests on the local stack and returns their exit status. Arguments go
 * to the process as they are (no shell), so paths with brackets and parentheses stay intact. The
 * related run uses `test:db`'s config (package.json).
 */
function run(plan: DbTestPlan): number {
  if (plan.kind === "none") {
    return 0;
  }
  const args =
    plan.kind === "all"
      ? ["run", "test:db"]
      : [
          "scripts/with-local-supabase.ts",
          "bunx",
          "vitest",
          "related",
          ...plan.files,
          "--run",
          "--config",
          "vitest.db.config.mts",
          "--passWithNoTests",
        ];
  return spawnSync("bun", args, { stdio: "inherit" }).status ?? 1;
}

if (import.meta.main) {
  const [base = "", head = "", flag] = process.argv.slice(2);
  const changed = changedFiles(base, head);
  const plan = dbTestPlan(changed, existsSync);
  process.stderr.write(
    `db-test-scope: ${changed === null ? "change unknown" : `${changed.length} changed`}; ` +
      `${plan.kind === "related" ? `tests related to ${plan.files.length} files` : plan.kind}\n`,
  );
  if (flag === "--print") {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  } else {
    process.exit(run(plan));
  }
}
