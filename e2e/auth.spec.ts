import { expect, test } from "./helpers/test";
import { latestSignInCode } from "./helpers/mailpit";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

test.describe(() => {
  // The next address is a workspace that doesn't exist; the browser logs its 404.
  test.use({ allowConsole: /status of 404 \(Not Found\)/ });

  test("signs in with an emailed code and keeps next", async ({ page }) => {
    const email = uniqueEmail("e2e");
    await page.goto("/w/some-club-ab12");
    await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fsome-club-ab12$/);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    const code = await latestSignInCode(email);
    await page
      .getByLabel("Digit 1 of 8")
      .fill(`${code.slice(0, 4)} ${code.slice(4)}`);
    await expect(page).toHaveURL(/\/welcome\?next=%2Fw%2Fsome-club-ab12$/);
    await page.getByLabel("Your name").fill("E2E Owner");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/w\/some-club-ab12$/);
  });
});

test("skips the name step on the next sign-in and lands a member on My invites", async ({
  page,
  context,
}) => {
  const email = uniqueEmail("e2e-again");
  await signInWithCode(page, email, { startPath: "/login", name: "Again" });
  await expect(page).toHaveURL(/\/invites$/);
  await context.clearCookies();
  await signInWithCode(page, email, { startPath: "/login" });
  await expect(page).toHaveURL(/\/invites$/);
});

test.describe(() => {
  // The wrong code is refused with a 400, which the browser logs.
  test.use({ allowConsole: /status of 400 \(Bad Request\)/ });

  test("rejects a wrong code", async ({ page }) => {
    const email = uniqueEmail("e2e-wrong");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await latestSignInCode(email);
    await page.getByLabel("Digit 1 of 8").fill("00000000");
    await expect(
      page.getByText("That code is wrong or has expired.", { exact: false }),
    ).toBeVisible();
  });
});
