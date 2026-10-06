import { expect, test, type Page } from "@playwright/test";
import { seedMember } from "./helpers/seed";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

async function createWorkspace(page: Page, name: string): Promise<string> {
  await signInWithCode(page, uniqueEmail("e2e-settings"), {
    startPath: "/login",
    name: "Settings Owner",
  });
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+-[a-z0-9]{4}$/);
  return new URL(page.url()).pathname.split("/")[2];
}

test("the Owner renames, changes the timezone, then deletes the workspace", async ({
  page,
}) => {
  const slug = await createWorkspace(page, "Rename Club");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Settings" })
    .click();
  const name = page.getByLabel("Workspace name");
  await name.fill("Renamed Club");
  await page.getByRole("combobox", { name: "Timezone" }).click();
  await page.getByPlaceholder("Search timezones").fill("Paris");
  await page.getByRole("option", { name: "Europe/Paris" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("button", { name: "Switch workspace" }),
  ).toContainText("Renamed Club");

  await page.getByRole("button", { name: "Delete workspace" }).click();
  await page.getByLabel("Type Renamed Club to confirm").fill("Renamed Club");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/w\/new$/);
  await page.goto(`/w/${slug}`);
  await expect(
    page.getByRole("heading", { name: "Workspace not found" }),
  ).toBeVisible();
});

test("the Owner promotes a Viewer and transfers ownership to an Admin", async ({
  page,
}) => {
  const slug = await createWorkspace(page, "Transfer Club");
  await seedMember(slug, "admin", "Ada Admin");
  await seedMember(slug, "viewer", "Vic Viewer");
  await page.goto(`/w/${slug}/settings`);

  await page.getByRole("button", { name: "Actions for Vic Viewer" }).click();
  await page.getByRole("menuitem", { name: "Make Admin" }).click();
  await expect(page.getByText("Updated.")).toBeVisible();

  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await page
    .getByRole("combobox", { name: "New Owner" })
    .selectOption({ label: "Ada Admin" });
  await page.getByLabel("Type Transfer Club to confirm").fill("Transfer Club");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(
    page.getByRole("button", { name: "Switch workspace" }),
  ).toContainText("Admin");
  await expect(
    page.getByRole("button", { name: "Delete workspace" }),
  ).toHaveCount(0);
});
