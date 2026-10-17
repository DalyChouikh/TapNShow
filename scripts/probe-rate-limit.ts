type Fetch = (input: string) => Promise<Response>;

/**
 * Fires `total` GETs at `url`, `concurrency` at a time, and tallies the answers (spec §11, the
 * firewall's rate-limit check). Run against a preview deployment only, never production.
 */
export async function probeRateLimit(input: {
  url: string;
  total: number;
  concurrency: number;
  fetch?: Fetch;
}): Promise<{ statuses: Record<number, number>; retryAfter: string | null }> {
  const send = input.fetch ?? ((url: string) => fetch(url));
  const statuses: Record<number, number> = {};
  let retryAfter: string | null = null;
  let started = 0;
  const worker = async () => {
    // Claiming a slot and awaiting are separate steps, so no worker sends past `total`.
    while (started < input.total) {
      started += 1;
      const response = await send(input.url);
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      retryAfter ??= response.headers.get("retry-after");
    }
  };
  await Promise.all(Array.from({ length: input.concurrency }, worker));
  return { statuses, retryAfter };
}

if (import.meta.main) {
  const [url, total = "1000"] = process.argv.slice(2);
  if (!url) {
    process.stderr.write(
      "usage: VERCEL_OIDC_TOKEN=… bun scripts/probe-rate-limit.ts <preview url>/api/me [total]\n",
    );
    process.exit(2);
  }
  // Previews are behind Vercel's login: the project's development OIDC token passes it (Trusted
  // Sources). Redirects aren't followed, so a login redirect shows as 302, not as a page.
  const token = process.env.VERCEL_OIDC_TOKEN;
  const send: Fetch = (target) =>
    fetch(target, {
      redirect: "manual",
      headers: token ? { "x-vercel-trusted-oidc-idp-token": token } : {},
    });
  process.stdout.write(
    `${JSON.stringify(await probeRateLimit({ url, total: Number(total), concurrency: 20, fetch: send }))}\n`,
  );
}
