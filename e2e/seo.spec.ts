import { expect, test } from "./helpers/test";

/** The old production host; its pages move to the app address (here, the local server). */
const LEGACY_HOST = "tapnshow.vercel.app";

test("the old address's pages move to the app address for good, path and query kept", async ({
  request,
  baseURL,
}) => {
  const moved = await request.get("/privacy?from=old", {
    headers: { host: LEGACY_HOST },
    maxRedirects: 0,
  });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toBe(`${baseURL}/privacy?from=old`);

  const home = await request.get("/", {
    headers: { host: LEGACY_HOST },
    maxRedirects: 0,
  });
  expect(home.status()).toBe(308);
  expect(home.headers().location).toBe(`${baseURL}/`);

  const deep = await request.get("/r/some-token", {
    headers: { host: LEGACY_HOST },
    maxRedirects: 0,
  });
  expect(deep.headers().location).toBe(`${baseURL}/r/some-token`);
});

test("the old address keeps answering its API and service worker itself", async ({
  request,
}) => {
  for (const path of ["/api/health", "/serwist/sw.js"]) {
    const response = await request.get(path, {
      headers: { host: LEGACY_HOST },
      maxRedirects: 0,
    });
    expect(response.status(), path).toBe(200);
  }
});

test("the app's own address is never redirected", async ({ request }) => {
  const response = await request.get("/privacy", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
});

test("crawlers may fetch pages and assets; only the public pages may be indexed", async ({
  page,
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /\n");
  expect(robots).toContain("Disallow: /api/\n");
  expect(robots).toContain("Disallow: /monitoring\n");

  for (const path of ["/", "/privacy", "/terms"]) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]'), path).toHaveCount(0);
  }
  await page.goto("/login");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
});

test("the public pages have a complete share card and the home page names the site", async ({
  page,
  baseURL,
}) => {
  await page.goto("/privacy");
  const og = (property: string) =>
    page.locator(`meta[property="og:${property}"]`);
  await expect(og("url")).toHaveAttribute("content", `${baseURL}/privacy`);
  await expect(og("type")).toHaveAttribute("content", "website");
  await expect(og("site_name")).toHaveAttribute("content", "TapNShow");
  await expect(og("locale")).toHaveAttribute("content", "en_US");
  await expect(og("image")).toHaveAttribute(
    "content",
    `${baseURL}/opengraph-image`,
  );
  await expect(page.locator('meta[name="twitter:image"]')).toHaveCount(1);

  await page.goto("/");
  const data = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  expect(JSON.parse(data ?? "")).toEqual({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "TapNShow",
    url: `${baseURL}/`,
  });
  await expect(
    page.locator('link[rel="icon"][href="/favicon.ico"]'),
  ).toHaveCount(1);
});

test("/favicon.ico is an icon file with the 16, 32 and 48 px images", async ({
  request,
}) => {
  const response = await request.get("/favicon.ico");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/x-icon");
  const bytes = await response.body();
  // ICONDIR: reserved 0, type 1, three images; each entry's first byte is its width.
  expect([
    bytes.readUInt16LE(0),
    bytes.readUInt16LE(2),
    bytes.readUInt16LE(4),
  ]).toEqual([0, 1, 3]);
  expect([bytes[6], bytes[22], bytes[38]]).toEqual([16, 32, 48]);
  // Each image is a PNG (signature 89 50 4E 47).
  const firstImage = bytes.readUInt32LE(6 + 12);
  expect(bytes.subarray(firstImage, firstImage + 4).toString("hex")).toBe(
    "89504e47",
  );
});

test("the Google Cloud logo is a 120 px square PNG under 1 MB", async ({
  request,
}) => {
  const response = await request.get("/icons/logo-120.png");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  const bytes = await response.body();
  expect(bytes.subarray(0, 4).toString("hex")).toBe("89504e47");
  // IHDR: width and height right after the signature and the chunk header.
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([120, 120]);
  // Google Cloud Help 15549049: at most 1 MB.
  expect(bytes.length).toBeLessThan(1024 * 1024);
});
