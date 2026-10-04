import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Waits until entrance animations have settled so audits see the final colors. */
async function waitForEntrance(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("main *")).every(
      (el) => getComputedStyle(el).opacity === "1",
    ),
  );
}

test.describe("/design", () => {
  test("has no WCAG 2.2 AA violations in light and dark", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/design");
      await waitForEntrance(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    }
  });

  test("no horizontal scroll and every button is at least 44px tall", async ({
    page,
  }) => {
    await page.goto("/design");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("dark-mode users get the dark background on first paint (no flash)", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/design", { waitUntil: "commit" });
    await page.waitForSelector("body");
    const bg = await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    expect(bg).toBe("rgb(22, 19, 31)");
    await context.close();
  });

  test("theme toggle switches data-theme", async ({ page }) => {
    await page.goto("/design");
    await page.getByRole("button", { name: /color theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: /color theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("reduced motion: stamp appears instantly without confetti", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/design");
    await page.getByRole("button", { name: /I'll be there/ }).click();
    await expect(page.getByText("CONFIRMED")).toBeVisible({ timeout: 100 });
    await expect(page.getByTestId("confetti-piece")).toHaveCount(0);
    await context.close();
  });
});
