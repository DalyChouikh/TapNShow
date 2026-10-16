import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/backup.yml", "utf8");

describe("backup workflow", () => {
  it("keeps row data out of the public run log when a restore fails", () => {
    const restores = workflow
      .split("\n")
      .filter((line) => line.includes('psql "$LOCAL"'));
    expect(restores.length).toBeGreaterThan(0);
    for (const line of restores) {
      expect(line).toContain("-v VERBOSITY=terse");
      expect(line).toContain("-v SHOW_CONTEXT=never");
    }
  });

  it("checks the restore against the dump's own rows, not a later count of production", () => {
    expect(workflow).not.toMatch(/psql "\$DB_URL"[^\n]*backup-counts\.sql/);
    expect(workflow).toContain(
      "bun scripts/dump-counts.ts dump dump/restored.txt",
    );
  });
});
