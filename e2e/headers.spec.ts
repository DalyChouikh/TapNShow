import { expect, test } from "./helpers/test";

const CSP = "content-security-policy-report-only";

test("pages carry a fresh nonce CSP and the static headers", async ({
  request,
  page,
}) => {
  const first = await request.get("/login");
  const second = await request.get("/login");
  const nonceOf = (policy: string | undefined) =>
    /'nonce-([^']+)'/.exec(policy ?? "")?.[1];
  expect(nonceOf(first.headers()[CSP])).toBeTruthy();
  expect(nonceOf(first.headers()[CSP])).not.toBe(
    nonceOf(second.headers()[CSP]),
  );
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  expect(first.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(first.headers()["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=()",
  );
  expect(first.headers()["x-robots-tag"]).toBeUndefined();

  await page.goto("/login");
  const nonces = await page
    .locator("script[src]")
    .evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce),
    );
  expect(nonces.length).toBeGreaterThan(0);
  expect(nonces.every((nonce) => (nonce ?? "").length > 0)).toBe(true);
});

test("token pages send no referrer and are never indexed", async ({
  request,
}) => {
  const response = await request.get("/u/not-a-real-token");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const api = await request.get("/api/health");
  expect(api.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the service worker has its own same-origin policy", async ({
  request,
}) => {
  const response = await request.get("/serwist/sw.js");
  expect(response.headers()[CSP]).toBe(
    "default-src 'self'; script-src 'self'; connect-src 'self'",
  );
});

test("the manifest is fetched with credentials (deployment URLs are behind Vercel's login)", async ({
  page,
}) => {
  await page.goto("/");
  const manifest = page.locator('link[rel="manifest"]');
  await expect(manifest).toHaveCount(1);
  await expect(manifest).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(manifest).toHaveAttribute("crossorigin", "use-credentials");
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.headers()["content-type"]).toBe("application/manifest+json");
  expect((await response.json()).start_url).toBe("/invites");
});
