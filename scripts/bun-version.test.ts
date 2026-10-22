import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const WORKFLOWS = ".github/workflows";
// The first Bun whose bundled Brotli decoder has the CVE-2026-111497 fix (brotli 1.2.1).
const BROTLI_FIX = "1.4.4";

const packageManager = z
  .object({ packageManager: z.string() })
  .parse(JSON.parse(readFileSync("package.json", "utf8"))).packageManager;

type Step = { workflow: string; job: string; lines: string[] };

/**
 * Every step of every workflow, as its own lines. The workflows use two-space YAML: jobs at
 * 2 spaces, their steps as "- " items at 6, a step's keys deeper.
 */
function workflowSteps(): Step[] {
  const steps: Step[] = [];
  for (const workflow of readdirSync(WORKFLOWS).filter((name) =>
    name.endsWith(".yml"),
  )) {
    let inJobs = false;
    let job = "";
    let step: Step | null = null;
    for (const line of readFileSync(`${WORKFLOWS}/${workflow}`, "utf8").split(
      "\n",
    )) {
      const indent = line.length - line.trimStart().length;
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
      } else if (inJobs && /^ {2}[\w-]+:\s*$/.test(line)) {
        job = line.trim().slice(0, -1);
      }
      if (inJobs && /^ {6}- /.test(line)) {
        step = { workflow, job, lines: [line] };
        steps.push(step);
      } else if (step && (line.trim() === "" || indent > 6)) {
        step.lines.push(line);
      } else {
        step = null;
      }
    }
  }
  return steps;
}

const steps = workflowSteps();
const usesAction = (step: Step, action: string) =>
  step.lines.some((line) => line.includes(`uses: ${action}@`));
const setupBunSteps = steps.filter((step) =>
  usesAction(step, "oven-sh/setup-bun"),
);

describe("Bun version", () => {
  it(`is pinned once, exactly, in package.json, at ${BROTLI_FIX} or newer (the Brotli decoder fix)`, () => {
    const version = /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1] ?? "";
    expect(version, `packageManager is "${packageManager}"`).not.toBe("");
    // A numeric collation compares each dotted part as a number, so 1.10.0 sorts after 1.4.4.
    expect(
      version.localeCompare(BROTLI_FIX, "en", { numeric: true }),
    ).toBeGreaterThanOrEqual(0);
  });

  it("is read from package.json by every setup-bun step, never named in a workflow", () => {
    expect(setupBunSteps.length).toBeGreaterThan(0);
    for (const step of setupBunSteps) {
      const where = `${step.workflow} → ${step.job}`;
      expect(step.lines, where).toContainEqual(
        expect.stringMatching(/^\s+bun-version-file: package\.json\s*$/),
      );
      expect(step.lines, where).not.toContainEqual(
        expect.stringMatching(/^\s+bun-version:/),
      );
    }
  });

  it("is read after the checkout that brings package.json, in the same job", () => {
    for (const step of setupBunSteps) {
      const job = steps.filter(
        (other) => other.workflow === step.workflow && other.job === step.job,
      );
      const checkout = job.findIndex((other) =>
        usesAction(other, "actions/checkout"),
      );
      const where = `${step.workflow} → ${step.job}`;
      expect(checkout, where).toBeGreaterThanOrEqual(0);
      expect(checkout, where).toBeLessThan(job.indexOf(step));
    }
  });
});
