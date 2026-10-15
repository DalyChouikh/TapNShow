import { readFileSync } from "node:fs";

const WARNING = /\bwarn(?:ing|ings)?\b|⚠/i;

/**
 * Notices about the machine, not the build: a CI runner whose cache is cold (first run, or evicted
 * after 7 days unused) prints this even though `.next/cache` is cached between runs.
 */
const RUNNER_NOTICES = [/No build cache found/];

/** Lines of a `next build` log that report a warning (spec §12: the build has none). */
export function buildWarnings(log: string): string[] {
  return log
    .split("\n")
    .filter(
      (line) =>
        WARNING.test(line) &&
        !RUNNER_NOTICES.some((notice) => notice.test(line)),
    );
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("usage: bun scripts/check-build-log.ts <build.log>\n");
    process.exit(2);
  }
  const warnings = buildWarnings(readFileSync(path, "utf8"));
  if (warnings.length > 0) {
    process.stderr.write(`Build warnings:\n${warnings.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("No build warnings.\n");
}
