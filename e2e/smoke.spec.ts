import { expect, test } from "./helpers/test";

test("the home page shows the product and its promise without horizontal scroll", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "TapNShow home" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Know who's coming before the meeting starts.",
  );
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
