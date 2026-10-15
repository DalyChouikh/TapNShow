import { readFileSync } from "node:fs";

function parse(text: string): Map<string, string> {
  return new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [table, count] = line.split("|");
        return [table, count] as const;
      }),
  );
}

/** Differences between the counts taken at dump time and after the restore (spec §5 backups). */
export function compareCounts(before: string, after: string): string[] {
  const expected = parse(before);
  if (expected.size === 0) {
    return ["no tables counted"];
  }
  const actual = parse(after);
  const problems: string[] = [];
  for (const [table, count] of expected) {
    const restored = actual.get(table);
    if (restored !== count) {
      problems.push(
        `${table}: ${count} before, ${restored === undefined ? "missing" : restored} after`,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const [beforePath, afterPath] = process.argv.slice(2);
  const problems = compareCounts(
    readFileSync(beforePath, "utf8"),
    readFileSync(afterPath, "utf8"),
  );
  if (problems.length > 0) {
    process.stderr.write(`Restore check failed:\n${problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("Restore check passed.\n");
}
