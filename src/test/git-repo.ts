import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A throwaway git repository, for the scripts that read a change (test setup only). */
export type GitRepo = {
  path: string;
  /** A clean environment for git and the scripts: no user or system config leaks in. */
  env: (extra?: Record<string, string>) => NodeJS.ProcessEnv;
  /** Runs git in the repository; returns its trimmed output, or throws its error. */
  git: (...args: string[]) => string;
  /** Writes the files (null deletes one), commits, and returns the new commit. */
  commit: (files: Record<string, string | null>) => string;
  remove: () => void;
};

/** Creates an empty repository on `main` in a new temporary folder named after `prefix`. */
export function createGitRepo(prefix: string): GitRepo {
  const path = mkdtempSync(join(tmpdir(), prefix));
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "",
    HOME: path,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.test",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.test",
    ...extra,
  });
  const git = (...args: string[]): string => {
    const result = spawnSync("git", args, {
      cwd: path,
      env: env(),
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const commit = (files: Record<string, string | null>): string => {
    for (const [file, content] of Object.entries(files)) {
      if (content === null) {
        git("rm", "-q", file);
      } else {
        mkdirSync(dirname(join(path, file)), { recursive: true });
        writeFileSync(join(path, file), content);
        git("add", file);
      }
    }
    git("commit", "-q", "-m", "change");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  return {
    path,
    env,
    git,
    commit,
    remove: () => rmSync(path, { recursive: true, force: true }),
  };
}
