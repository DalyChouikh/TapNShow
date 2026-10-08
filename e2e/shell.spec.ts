import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

test("the workspace shell: header, bottom bar, Home, placeholders, not found", async ({
  page,
}) => {
  await signInWithCode(page, uniqueEmail("e2e-shell"), {
    startPath: "/login",
    name: "Shell Owner",
  });
  await page.getByLabel("Workspace name").fill("Shell Club");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/shell-club-[a-z0-9]{4}$/);

  const switcher = page.getByRole("button", { name: "Switch workspace" });
  await expect(switcher).toContainText("Shell Club");
  await expect(switcher).toContainText("Owner");

  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link")).toHaveCount(5);
  await expect(nav.getByRole("link", { name: "New meeting" })).toHaveAttribute(
    "href",
    /\/meetings\/new$/,
  );
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { name: "Welcome to Shell Club" }),
  ).toBeVisible();

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations).toEqual([]);

  await nav.getByRole("link", { name: "Meetings" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Meetings" }),
  ).toBeVisible();

  await page.goto("/w/unknown-zzzz");
  await expect(
    page.getByRole("heading", { name: "Workspace not found" }),
  ).toBeVisible();
});
