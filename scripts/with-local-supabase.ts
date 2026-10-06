import { execFileSync, spawnSync } from "node:child_process";
import { localSupabaseEnv, parseLocalStatus } from "./local-supabase-env";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error(
    "Usage: bun scripts/with-local-supabase.ts <command> [...args]",
  );
}
const status = parseLocalStatus(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
);
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: { ...process.env, ...localSupabaseEnv(status) },
});
process.exit(result.status ?? 1);
