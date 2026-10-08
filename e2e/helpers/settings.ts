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
