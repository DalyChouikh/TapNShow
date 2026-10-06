import { expect, test } from "@playwright/test";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

test("a new user creates a workspace with the browser's timezone", async ({
  page,
}) => {
  await signInWithCode(page, uniqueEmail("e2e-create"), {
    startPath: "/login",
    name: "Creator",
  });
  await expect(page).toHaveURL(/\/w\/new$/);
  await expect(page.getByRole("combobox", { name: "Timezone" })).not.toHaveText(
    "",
  );
  await page.getByLabel("Workspace name").fill("E2E Club");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/e2e-club-[a-z0-9]{4}$/);
});

test("the timezone picker searches and selects", async ({ page }) => {
  await signInWithCode(page, uniqueEmail("e2e-tz"), {
    startPath: "/login",
    name: "Zoner",
  });
  await page.getByRole("combobox", { name: "Timezone" }).click();
  await page.getByPlaceholder("Search timezones").fill("Tunis");
  await page.getByRole("option", { name: "Africa/Tunis" }).click();
  await expect(page.getByRole("combobox", { name: "Timezone" })).toHaveText(
    "Africa/Tunis",
  );
});
