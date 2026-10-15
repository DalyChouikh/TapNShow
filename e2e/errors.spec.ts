import { expect, test } from "./helpers/test";

test.describe("error pages", () => {
  // The browser logs the 404 of the page it was asked for.
  test.use({ allowConsole: /status of 404 \(Not Found\)/ });

  for (const scheme of ["light", "dark"] as const) {
    test(`an unknown address shows the not-found page (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const response = await page.goto("/this-page-does-not-exist");
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { name: "We can't find that page" }),
      ).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      await page.getByRole("link", { name: "Go to the home page" }).click();
      await expect(page).toHaveURL("/");
    });
  }

  test("an unknown API address answers JSON", async ({ request }) => {
    const response = await request.post("/api/nothing-here", { data: {} });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });
});
