import { expect, type Page } from "@playwright/test";
import { latestSignInCode } from "./mailpit";

/** A unique address per test and Playwright project. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.test`;
}

/**
 * Signs in on `/login` (already open or at `startPath`) with an emailed code, and answers the
 * name step when `name` is given. Leaves the page wherever the app redirects next.
 */
export async function signInWithCode(
  page: Page,
  email: string,
  options: { startPath?: string; name?: string } = {},
): Promise<void> {
  if (options.startPath) {
    await page.goto(options.startPath);
  }
  const requestedAt = new Date(Date.now() - 1000);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = await latestSignInCode(email, requestedAt);
  await page.getByLabel("Digit 1 of 8").fill(code);
  if (options.name) {
    await page.getByLabel("Your name").fill(options.name);
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

/** From `/invites`, where an account without a workspace lands (spec §7.4), opens the new-workspace form. */
export async function openNewWorkspace(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/invites$/);
  await page.getByRole("link", { name: "Create a workspace" }).click();
  await expect(page).toHaveURL(/\/w\/new$/);
}

/** Signs up a new organizer and creates a workspace through `/invites`. Returns its slug. */
export async function signUpWithWorkspace(
  page: Page,
  workspaceName: string,
  options: { prefix?: string; ownerName?: string } = {},
): Promise<string> {
  await signInWithCode(page, uniqueEmail(options.prefix ?? "e2e-owner"), {
    startPath: "/login",
    name: options.ownerName ?? "Owner",
  });
  await openNewWorkspace(page);
  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+-[a-z0-9]{4}$/);
  return new URL(page.url()).pathname.split("/")[2];
}
