import { discordMessage } from "../src/lib/discord/embed";
import { postToDiscord } from "../src/lib/discord/send";

type Project = { name: string; url: string; key: string };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** One signed-out call to `public.keep_alive()` (spec §5: keeps a free project from pausing). */
export async function pingProject(
  project: Project,
  send: Fetch = fetch,
): Promise<{ name: string; ok: boolean; status: number }> {
  try {
    const response = await send(`${project.url}/rest/v1/rpc/keep_alive`, {
      method: "POST",
      headers: { apikey: project.key, "Content-Type": "application/json" },
      body: "{}",
    });
    return { name: project.name, ok: response.ok, status: response.status };
  } catch {
    return { name: project.name, ok: false, status: 0 };
  }
}

/** The weekly "still alive" post goes with Monday's morning run (UTC, before noon). */
export function weeklyReport(now: Date): boolean {
  return now.getUTCDay() === 1 && now.getUTCHours() < 12;
}

if (import.meta.main) {
  const projects: Project[] = [
    {
      name: "Production",
      url: process.env.SUPABASE_PROD_URL ?? "",
      key: process.env.SUPABASE_PROD_PUBLISHABLE_KEY ?? "",
    },
    {
      name: "Preview",
      url: process.env.SUPABASE_PREVIEW_URL ?? "",
      key: process.env.SUPABASE_PREVIEW_PUBLISHABLE_KEY ?? "",
    },
  ];
  const results = await Promise.all(
    projects.map((project) => pingProject(project)),
  );
  const failed = results.filter((result) => !result.ok);
  const webhook = process.env.DISCORD_UPTIME_WEBHOOK;
  const now = new Date();
  if (webhook && (failed.length > 0 || weeklyReport(now))) {
    await postToDiscord(
      webhook,
      discordMessage({
        tone: failed.length > 0 ? "failure" : "info",
        title:
          failed.length > 0
            ? "Keep-alive: a database did not answer"
            : "Weekly check: everything answered",
        ...(process.env.RUN_URL ? { url: process.env.RUN_URL } : {}),
        fields: results.map((result) => ({
          name: `${result.name} database`,
          value: result.ok ? "OK" : `No answer (${result.status})`,
        })),
        source: "keep-alive",
        at: now,
      }),
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
