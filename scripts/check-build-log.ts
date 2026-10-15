import { readFileSync } from "node:fs";

const WARNING = /\bwarn(?:ing|ings)?\b|⚠/i;

/** Lines of a `next build` log that report a warning (spec §12: the build has none). */
export function buildWarnings(log: string): string[] {
  return log.split("\n").filter((line) => WARNING.test(line));
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
