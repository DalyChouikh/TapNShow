import { expect, test } from "./helpers/test";

for (const [path, title] of [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
] as const) {
  test(`${path} is public, jump links work, footer links are there`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    const jump = page
      .getByRole("navigation", { name: "On this page" })
      .getByRole("link")
      .last();
    await jump.click();
    await expect(page).toHaveURL(/#contact$/);
    const footer = page.getByRole("navigation", { name: "TapNShow links" });
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    await expect(footer.getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      /^mailto:/,
    );
  });
}

test("robots.txt and the sitemap list only the public pages", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap.match(/<loc>/g)).toHaveLength(3);
});
