import { format } from "node:util";

type ConsoleTarget = {
  error: (...args: never[]) => void;
  warn: (...args: never[]) => void;
};

/** Collects console.error / console.warn calls so a test fails on any it didn't expect. */
export type ConsoleGuard = {
  /** The messages since the last call (then forgets them and the test's expectations). */
  take: () => string[];
  /** One expected message for the current test (matched once). */
  allow: (pattern: RegExp) => void;
};

/**
 * Replaces `target.error` and `target.warn` (the global console in `vitest.setup.ts`) with
 * collectors. React warnings, act() warnings and jsdom errors all arrive through these two.
 */
export function createConsoleGuard(target: ConsoleTarget): ConsoleGuard {
  const seen: string[] = [];
  const expected: RegExp[] = [];
  for (const method of ["error", "warn"] as const) {
    target[method] = ((...args: Parameters<typeof format>) => {
      const text = format(...args);
      const index = expected.findIndex((pattern) => pattern.test(text));
      if (index >= 0) {
        expected.splice(index, 1);
        return;
      }
      seen.push(`console.${method}: ${text}`);
    }) as ConsoleTarget[typeof method];
  }
  return {
    take: () => {
      expected.length = 0;
      return seen.splice(0, seen.length);
    },
    allow: (pattern) => {
      expected.push(pattern);
    },
  };
}

let current: ConsoleGuard | null = null;

/** Installs the guard on the global console (once, from `vitest.setup.ts`). */
export function installConsoleGuard(): ConsoleGuard {
  current ??= createConsoleGuard(console);
  return current;
}

/** A test that provokes a console message on purpose declares it first. */
export function allowConsole(pattern: RegExp): void {
  installConsoleGuard().allow(pattern);
}
