import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  SUPABASE_PROJECTS,
  type SupabaseProjectName,
} from "../src/config/supabase-projects";
import { renderSignInCodeTemplate } from "../src/emails/sign-in-code-email";
import { buildAuthConfigPatch } from "../src/server/supabase/auth-config";

const LOCAL_TEMPLATE_PATH = "supabase/templates/sign-in-code.html";
const TARGETS = ["local", "preview", "prod", "all"] as const;
type Target = (typeof TARGETS)[number];

function readTarget(): Target {
  const value = process.argv[2] ?? "all";
  const target = TARGETS.find((candidate) => candidate === value);
  if (!target) {
    throw new Error(`Usage: bun run auth:config <${TARGETS.join("|")}>`);
  }
  return target;
}

function readAccessToken(): string {
  return (
    process.env.SUPABASE_ACCESS_TOKEN ??
    readFileSync(join(homedir(), ".supabase", "access-token"), "utf8").trim()
  );
}

async function pushHosted(
  name: SupabaseProjectName,
  template: { subject: string; html: string },
  token: string,
): Promise<void> {
  const project = SUPABASE_PROJECTS[name];
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project.ref}/config/auth`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildAuthConfigPatch({ siteUrl: project.siteUrl, template }),
      ),
    },
  );
  if (!response.ok) {
    throw new Error(
      `${name}: Supabase answered HTTP ${response.status}: ${await response.text()}`,
    );
  }
  process.stdout.write(`updated auth config of ${name}\n`);
}

const target = readTarget();
const template = await renderSignInCodeTemplate();
if (target === "local" || target === "all") {
  writeFileSync(LOCAL_TEMPLATE_PATH, template.html);
  process.stdout.write(`wrote ${LOCAL_TEMPLATE_PATH}\n`);
}
const hosted: SupabaseProjectName[] =
  target === "all" ? ["preview", "prod"] : target === "local" ? [] : [target];
if (hosted.length > 0) {
  const token = readAccessToken();
  for (const name of hosted) {
    await pushHosted(name, template, token);
  }
}
