import AxeBuilder from "@axe-core/playwright";
import { type Browser, type Page } from "@playwright/test";
import { expect, test } from "./helpers/test";

/**
 * Waits until entrance animations have settled so audits see the final colors. File inputs are
 * transparent on purpose (they cover their drop zone), so they never reach opacity 1.
 */
async function waitForEntrance(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("main *")).every(
      (el) =>
        el.matches('input[type="file"]') ||
        getComputedStyle(el).opacity === "1",
    ),
  );
}

/** The page background of each theme (the `--color-background` tokens). */
const BACKGROUND = { light: "rgb(243, 238, 255)", dark: "rgb(22, 19, 31)" };

/**
 * Opens /design with the OS in `os` and an optional stored choice, and checks first paint shows
 * `theme`. The theme is decided by next-themes' inline script, which sets `data-theme` on <html>
 * before <body> is parsed: read it once (no retry) as soon as <body> exists, so a late set fails.
 * The background is then polled, because under load the stylesheet can apply after <body>.
 */
async function expectFirstPaint(
  browser: Browser,
  os: "light" | "dark",
  stored: "light" | "dark" | null,
  theme: "light" | "dark",
): Promise<void> {
  const context = await browser.newContext({ colorScheme: os });
  if (stored) {
    // Init scripts also run in the context's first about:blank page, which has no storage.
    await context.addInitScript((value) => {
      if (window.location.origin !== "null") {
        window.localStorage.setItem("theme", value);
      }
    }, stored);
  }
  const page = await context.newPage();
  await page.goto("/design", { waitUntil: "commit" });
  await page.waitForSelector("body");
  expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
    )
    .toBe(BACKGROUND[theme]);
  await context.close();
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
    await expectFirstPaint(browser, "dark", null, "dark");
  });

  test("a stored light preference wins over a dark OS on first paint", async ({
    browser,
  }) => {
    await expectFirstPaint(browser, "dark", "light", "light");
  });

  test("a stored dark preference wins over a light OS on first paint", async ({
    browser,
  }) => {
    await expectFirstPaint(browser, "light", "dark", "dark");
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
    const stamp = page.getByText("CONFIRMED");
    await expect(stamp).toBeVisible({ timeout: 100 });
    // toBeVisible accepts opacity:0, so assert the real computed state immediately.
    expect(await stamp.evaluate((el) => getComputedStyle(el).opacity)).toBe(
      "1",
    );
    const status = page.getByRole("status");
    expect(await status.evaluate((el) => getComputedStyle(el).transform)).toBe(
      "none",
    );
    await expect(page.getByTestId("confetti-piece")).toHaveCount(0);
    await context.close();
  });
});
