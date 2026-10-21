import { expect, type Page } from "@playwright/test";

/** Settings sections start folded (except General): open one by its heading. */
export async function openSettingsSection(
  page: Page,
  name: string,
): Promise<void> {
  const toggle = page.getByRole("button", { name, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/**
 * The Owner connects the workspace's Google Sheet from Settings, through Google's consent screen
 * (the fake agrees at once), and waits until the result banner has cleared from the URL.
 */
export async function connectGoogleSheet(
  page: Page,
  slug: string,
): Promise<void> {
  await page.goto(`/w/${slug}/settings`);
  await openSettingsSection(page, "Google Sheets");
  await page.getByRole("button", { name: "Connect Google Sheets" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue to Google" })
    .click();
  await expect(
    page.getByText("Google Sheet connected. It fills in within a minute."),
  ).toBeVisible();
  // The banner then clears the result from the URL; a reload or click before that would race it.
  await expect(page).toHaveURL(/\/settings#sheets$/);
}
