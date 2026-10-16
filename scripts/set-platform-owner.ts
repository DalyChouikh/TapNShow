import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { z } from "zod";
import { SUPABASE_PROJECTS } from "../src/config/supabase-projects";
import { maskEmail } from "../src/lib/mask-email";
import { MANAGEMENT_API, readAccessToken, tnCode } from "./supabase-management";

const PROJECTS = ["local", "preview", "production"] as const;
type Project = (typeof PROJECTS)[number];

/** The one row `set_platform_owner` returns: `set` or `unchanged`. */
const resultRows = z.array(z.object({ result: z.string() })).length(1);

/** The script's arguments (spec §7.19): the address is validated before it reaches any SQL. */
export function parseOwnerArgs(argv: string[]): {
  email: string;
  project: Project;
  replace: boolean;
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: "string" },
      project: { type: "string" },
      replace: { type: "boolean", default: false },
    },
  });
  const email = z.email().safeParse((values.email ?? "").trim().toLowerCase());
  if (!email.success || email.data.includes("$")) {
    throw new Error("--email must be a valid address");
  }
  const project = PROJECTS.find((candidate) => candidate === values.project);
  if (!project) {
    throw new Error(`--project must be one of ${PROJECTS.join(", ")}`);
  }
  return { email: email.data, project, replace: values.replace ?? false };
}

/** The one statement the script runs (the address is dollar-quoted; `$` is refused above). */
export function ownerSql(email: string, replace: boolean): string {
  return `select private.set_platform_owner($tn$${email}$tn$, ${replace}) as result`;
}

/** Runs the statement as `postgres` on a hosted project (Management API, the `auth:config` token). */
async function runHosted(ref: string, sql: string): Promise<string> {
  const response = await fetch(
    `${MANAGEMENT_API}/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(tnCode(text) ?? `HTTP ${response.status}`);
  }
  return resultRows.parse(JSON.parse(text))[0].result;
}

/** Runs the statement as `postgres` on the local stack (the CLI prints a failure on stdout). */
function runLocal(sql: string): string {
  try {
    const output = execFileSync(
      "supabase",
      [
        "db",
        "query",
        "--local",
        "--output-format",
        "json",
        "--agent",
        "no",
        sql,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return resultRows.parse(JSON.parse(output))[0].result;
  } catch (error) {
    const stdout =
      error instanceof Error &&
      "stdout" in error &&
      typeof error.stdout === "string"
        ? error.stdout
        : "";
    throw new Error(
      tnCode(stdout) ??
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

const MESSAGES: Record<string, string> = {
  "tn:not_found":
    "No verified account has that address. Sign in to TapNShow with it once, then run this again.",
  "tn:conflict":
    "There is already a platform owner. Run again with --replace to hand the role over (the old owner stays an admin).",
};

if (import.meta.main) {
  const { email, project, replace } = parseOwnerArgs(process.argv.slice(2));
  const sql = ownerSql(email, replace);
  try {
    const result =
      project === "local"
        ? runLocal(sql)
        : await runHosted(
            SUPABASE_PROJECTS[project === "production" ? "prod" : "preview"]
              .ref,
            sql,
          );
    process.stdout.write(
      result === "unchanged"
        ? `${maskEmail(email)} is already the platform owner (${project}).\n`
        : `Platform owner set: ${maskEmail(email)} (${project}).\n`,
    );
  } catch (error) {
    const code =
      error instanceof Error
        ? (tnCode(error.message) ?? error.message)
        : String(error);
    process.stderr.write(`${MESSAGES[code] ?? `Failed: ${code}`}\n`);
    process.exit(1);
  }
}
