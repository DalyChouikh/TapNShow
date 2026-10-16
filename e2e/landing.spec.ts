import { expect, test } from "./helpers/test";

test("the landing sells, answers questions and leads to sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Know who's coming",
  );
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Is it free?" }).click();
  await expect(
    page.getByText(/Gmail's own daily sending limits/),
  ).toBeVisible();
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(
    page.getByRole("heading", { name: "How it works" }),
  ).toBeInViewport();
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});
