import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createGitRepo, type GitRepo } from "@/test/git-repo";

const DOCS_ONLY = resolve("scripts/docs-only.sh");
const VERCEL_IGNORE = resolve("scripts/vercel-ignore-build.sh");
const UNKNOWN_SHA = "0000000000000000000000000000000000000000";
// Exit codes: 0 means documentation only (skip), anything else means run everything.
const SKIP = 0;
const RUN = 1;

let repo: GitRepo;
const git = (...args: string[]) => repo.git(...args);
const commit = (files: Record<string, string | null>) => repo.commit(files);

function docsOnly(base: string, head: string): number | null {
  return spawnSync("sh", [DOCS_ONLY, base, head], {
    cwd: repo.path,
    env: repo.env(),
  }).status;
}

function vercelIgnore(vars: Record<string, string>): number | null {
  return spawnSync("sh", [VERCEL_IGNORE], {
    cwd: repo.path,
    env: repo.env(vars),
  }).status;
}

beforeEach(() => {
  repo = createGitRepo("docs-only-");
});

afterEach(() => {
  repo.remove();
});

describe("docs-only.sh", () => {
  let base = "";
  beforeEach(() => {
    base = commit({
      "src/a.ts": "export const a = 1;\n",
      "docs/guide.md": "# Guide\n",
      "README.md": "# Readme\n",
    });
  });

  it("skips when only files under docs/ change, deletions included", () => {
    const head = commit({ "docs/guide.md": null, "docs/new.md": "# New\n" });
    expect(docsOnly(base, head)).toBe(SKIP);
  });

  it("skips when only *.md files change, at the root or nested", () => {
    const head = commit({
      "README.md": "# Readme, edited\n",
      ".github/pull_request_template.md": "## Linked issue\n",
    });
    expect(docsOnly(base, head)).toBe(SKIP);
  });

  it("skips a documentation file whose name has accented letters", () => {
    const head = commit({ "docs/café.md": "# Café\n" });
    expect(docsOnly(base, head)).toBe(SKIP);
  });

  it("runs for a code change", () => {
    const head = commit({ "src/a.ts": "export const a = 2;\n" });
    expect(docsOnly(base, head)).toBe(RUN);
  });

  it("runs when documentation and code change together", () => {
    const head = commit({
      "docs/guide.md": "# Guide, edited\n",
      "src/a.ts": "export const a = 2;\n",
    });
    expect(docsOnly(base, head)).toBe(RUN);
  });

  it("runs when code moves into docs/: both paths of a rename count", () => {
    git("mv", "src/a.ts", "docs/a.md");
    git("commit", "-q", "-m", "move");
    expect(docsOnly(base, git("rev-parse", "HEAD"))).toBe(RUN);
  });

  it("runs when nothing changed", () => {
    expect(docsOnly(base, base)).toBe(RUN);
  });

  it("runs when the base is unknown or empty", () => {
    const head = commit({ "docs/guide.md": "# Guide, edited\n" });
    expect(docsOnly(UNKNOWN_SHA, head)).toBe(RUN);
    expect(docsOnly("", head)).toBe(RUN);
  });
});

describe("vercel-ignore-build.sh", () => {
  let deployed = "";
  beforeEach(() => {
    deployed = commit({
      "src/a.ts": "export const a = 1;\n",
      "docs/guide.md": "# Guide\n",
    });
  });

  it("skips when only documentation changed since the last successful deployment", () => {
    commit({ "docs/guide.md": "# Guide, edited\n" });
    commit({ "README.md": "# Readme\n" });
    expect(vercelIgnore({ VERCEL_GIT_PREVIOUS_SHA: deployed })).toBe(SKIP);
  });

  it("builds when code changed since the last successful deployment", () => {
    commit({ "src/a.ts": "export const a = 2;\n" });
    commit({ "docs/guide.md": "# Guide, edited\n" });
    expect(vercelIgnore({ VERCEL_GIT_PREVIOUS_SHA: deployed })).toBe(RUN);
  });

  it("builds when the last deployment's commit is not in the shallow clone", () => {
    commit({ "docs/guide.md": "# Guide, edited\n" });
    expect(vercelIgnore({ VERCEL_GIT_PREVIOUS_SHA: UNKNOWN_SHA })).toBe(RUN);
  });

  it("builds on a branch's first deployment when the repository is unknown", () => {
    commit({ "docs/guide.md": "# Guide, edited\n" });
    expect(vercelIgnore({})).toBe(RUN);
  });
});

describe("wiring", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  /** The steps of one job, split on the "      - " step markers. */
  function steps(job: string): string[] {
    const start = ci.indexOf(`\n  ${job}:\n`);
    const end = ci.slice(start + 1).search(/\n {2}\w[\w-]*:\n/);
    const block = ci.slice(start, end === -1 ? undefined : start + 1 + end);
    return block.split("\n      - ").slice(1);
  }

  const GATE = "if: steps.scope.outputs.docs_only != 'true'";

  it("runs the database tests a pull request can reach, and all of them on main (#426)", () => {
    const tests = steps("db").filter((step) => step.includes("db-test-scope"));
    expect(tests).toHaveLength(1);
    expect(tests[0]).toContain('bun scripts/db-test-scope.ts "$BASE" HEAD');
    expect(tests[0]).toContain(
      "BASE: ${{ github.event_name == 'pull_request' && 'HEAD^1' || '' }}",
    );
    expect(ci).not.toContain("run: bun run test:db");
  });

  it("has no path filter: a skipped required workflow leaves its checks pending", () => {
    const triggers = ci.slice(ci.indexOf("\non:"), ci.indexOf("\njobs:"));
    expect(triggers).not.toMatch(/paths/);
  });

  it.each(["quality", "db"])(
    "%s decides with the shared rule, then gates every heavy step",
    (job) => {
      const all = steps(job);
      const scope = all.findIndex((step) => step.includes("id: scope"));
      expect(scope).toBeGreaterThan(0);
      expect(all[scope]).toContain("sh scripts/docs-only.sh");
      expect(all[scope - 1]).toContain("fetch-depth: 2");
      const kept =
        job === "quality" ? ["setup-bun", "bun install", "format:check"] : [];
      for (const step of all.slice(scope + 1)) {
        const keep = kept.some((name) => step.includes(name));
        expect(step.includes(GATE), step).toBe(!keep);
      }
    },
  );

  it("points Vercel's Ignored Build Step at the wrapper", () => {
    const vercel = z
      .object({ ignoreCommand: z.string().optional() })
      .parse(JSON.parse(readFileSync("vercel.json", "utf8")));
    expect(vercel.ignoreCommand).toBe("sh scripts/vercel-ignore-build.sh");
  });

  it("compares a first deployment with the branch CI treats as production", () => {
    const wrapper = readFileSync(VERCEL_IGNORE, "utf8");
    const branch = /^production_branch=(\S+)$/m.exec(wrapper)?.[1];
    expect(branch).toBeDefined();
    expect(ci).toContain(`branches: [${branch}]`);
  });
});
