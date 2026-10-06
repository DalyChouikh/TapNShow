import { expect, test } from "@playwright/test";
import { latestSignInCode } from "./helpers/mailpit";

test("signs in with an emailed code and keeps next", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto("/w/some-club-ab12");
  await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fsome-club-ab12$/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = await latestSignInCode(email);
  await page
    .getByLabel("Sign-in code")
    .fill(`${code.slice(0, 4)} ${code.slice(4)}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/welcome\?next=%2Fw%2Fsome-club-ab12$/);
});

test("rejects a wrong code", async ({ page }) => {
  const email = `e2e-wrong-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await latestSignInCode(email);
  await page.getByLabel("Sign-in code").fill("00000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("That code is wrong or has expired.", { exact: false }),
  ).toBeVisible();
});
