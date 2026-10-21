import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createGitRepo, type GitRepo } from "@/test/git-repo";
import { type DbTestPlan, dbTestPlan } from "./db-test-scope";

const SCRIPT = resolve("scripts/db-test-scope.ts");
const ALL: DbTestPlan = { kind: "all" };
const NONE: DbTestPlan = { kind: "none" };
const related = (...files: string[]): DbTestPlan => ({
  kind: "related",
  files,
});
const everyFileExists = () => true;

describe("dbTestPlan (#426)", () => {
  it.each([
    ["the change can't be read", null],
    ["nothing changed", []],
    ["a migration changes", ["supabase/migrations/20261021_x.sql"]],
    ["the local Supabase config changes", ["supabase/config.toml"]],
    ["a dependency changes", ["package.json"]],
    ["the lockfile changes", ["bun.lock"]],
    ["the database tests' config changes", ["vitest.db.config.mts"]],
    ["the path aliases change", ["tsconfig.json"]],
    ["the local Supabase wrapper changes", ["scripts/with-local-supabase.ts"]],
    ["the local Supabase env changes", ["scripts/local-supabase-env.ts"]],
    ["a workflow changes", [".github/workflows/ci.yml"]],
    [
      "a screen changes along with a migration",
      ["src/app/(app)/w/[slug]/page.tsx", "supabase/migrations/x.sql"],
    ],
  ] as const)("runs everything when %s", (_name, changed) => {
    expect(dbTestPlan(changed, everyFileExists)).toEqual(ALL);
  });

  it("runs everything when a migration is deleted", () => {
    expect(dbTestPlan(["supabase/migrations/x.sql"], () => false)).toEqual(ALL);
  });

  it("runs the tests related to the changed files otherwise", () => {
    expect(
      dbTestPlan(
        ["src/app/(app)/w/[slug]/page.tsx", "src/server/queries/results.ts"],
        everyFileExists,
      ),
    ).toEqual(
      related(
        "src/app/(app)/w/[slug]/page.tsx",
        "src/server/queries/results.ts",
      ),
    );
  });

  it("leaves out deleted files, and runs none when only deletions are left", () => {
    const kept = (file: string) => file !== "src/lib/gone.ts";
    expect(dbTestPlan(["src/lib/gone.ts", "src/lib/kept.ts"], kept)).toEqual(
      related("src/lib/kept.ts"),
    );
    expect(dbTestPlan(["src/lib/gone.ts"], kept)).toEqual(NONE);
  });

  it("matches the whole-suite paths from the root only", () => {
    expect(
      dbTestPlan(
        ["docs/supabase/notes.ts", "src/package.json"],
        everyFileExists,
      ),
    ).toEqual(related("docs/supabase/notes.ts", "src/package.json"));
  });
});

describe("db-test-scope.ts reading a change (#426)", () => {
  const planSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("related"), files: z.array(z.string()) }),
  ]);
  let repo: GitRepo;
  let base = "";

  /** The plan the script prints for base..head (`--print` decides without running anything). */
  function planFor(...args: string[]): DbTestPlan {
    const result = spawnSync("bun", [SCRIPT, ...args, "--print"], {
      cwd: repo.path,
      env: repo.env(),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return planSchema.parse(JSON.parse(result.stdout));
  }

  beforeEach(() => {
    repo = createGitRepo("db-test-scope-");
    base = repo.commit({
      "src/a.ts": "export const a = 1;\n",
      "src/app/(app)/w/[slug]/page.tsx": "export default 1;\n",
    });
  });

  afterEach(() => {
    repo.remove();
  });

  it("lists the changed files, brackets and parentheses as they are", () => {
    const head = repo.commit({
      "src/app/(app)/w/[slug]/page.tsx": "export default 2;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    expect(planFor(base, head)).toEqual(
      related("src/app/(app)/w/[slug]/page.tsx", "src/b.ts"),
    );
  });

  it("follows a rename to its new path", () => {
    repo.git("mv", "src/a.ts", "src/renamed.ts");
    repo.git("commit", "-q", "-m", "rename");
    expect(planFor(base, repo.git("rev-parse", "HEAD"))).toEqual(
      related("src/renamed.ts"),
    );
    expect(existsSync(join(repo.path, "src/a.ts"))).toBe(false);
  });

  it("runs everything for a migration, and when the base is empty or unknown", () => {
    const head = repo.commit({ "supabase/migrations/x.sql": "select 1;\n" });
    expect(planFor(base, head)).toEqual(ALL);
    expect(planFor("", head)).toEqual(ALL);
    expect(planFor("0000000000000000000000000000000000000000", head)).toEqual(
      ALL,
    );
  });
});
