import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/test";
import { signUpWithWorkspace } from "./helpers/sign-in";

test.describe(() => {
  // The unknown workspace's 404 is logged by the browser.
  test.use({ allowConsole: /status of 404 \(Not Found\)/ });

  test("the workspace shell: header, bottom bar, Home, placeholders, not found", async ({
    page,
  }) => {
    const slug = await signUpWithWorkspace(page, "Shell Club", {
      prefix: "e2e-shell",
      ownerName: "Shell Owner",
    });
    expect(slug).toMatch(/^shell-club-[a-z0-9]{4}$/);

    const switcher = page.getByRole("button", { name: "Switch workspace" });
    await expect(switcher).toContainText("Shell Club");
    await expect(switcher).toContainText("Owner");

    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByRole("link")).toHaveCount(5);
    await expect(
      nav.getByRole("link", { name: "New meeting" }),
    ).toHaveAttribute("href", /\/meetings\/new$/);
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("heading", { name: "Welcome to Shell Club" }),
    ).toBeVisible();

    // The page's <title> lands just after a client navigation: check once it has.
    await expect(page).toHaveTitle(/\S/);
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
});
