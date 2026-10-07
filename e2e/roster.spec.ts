import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { seedMember, seedRoster } from "./helpers/seed";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

const LONG_NAME = "Mohamed Ali Ben Abdallah El Kefi";
const LONG_EMAIL = "mohamedali.benabdallah.elkefi@etudiant-issatso.u-sousse.tn";

async function createWorkspace(page: Page, name: string): Promise<string> {
  await signInWithCode(page, uniqueEmail("e2e-roster"), {
    startPath: "/login",
    name: "Roster Owner",
  });
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+-[a-z0-9]{4}$/);
  return new URL(page.url()).pathname.split("/")[2];
}

test("the roster lists, searches and filters people without sideways scrolling", async ({
  page,
}) => {
  const slug = await createWorkspace(page, "Roster Club");
  await seedRoster(slug, [
    {
      fullName: "Inès Ben Salah",
      email: "ines@example.test",
      lists: ["Dev", "Events"],
    },
    {
      fullName: "Youssef Trabelsi",
      email: "youssef@example.test",
      lists: ["Design"],
    },
    { fullName: LONG_NAME, email: LONG_EMAIL, lists: ["Dev"] },
  ]);
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Lists" })
    .click();
  await expect(page.getByText("3 people")).toBeVisible();
  await expect(page.getByText(LONG_EMAIL)).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("searchbox", { name: "Search people" }).fill("ines");
  await expect(
    page.getByRole("list", { name: "People" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search people" }).fill("");
  await page.getByRole("button", { name: "Design 1" }).click();
  await expect(
    page.getByRole("list", { name: "People" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("list", { name: "People" }).getByRole("listitem"),
  ).toContainText("Youssef Trabelsi");
});

test("a large roster renders only the visible cards", async ({ page }) => {
  const slug = await createWorkspace(page, "Big Club");
  await seedRoster(
    slug,
    Array.from({ length: 300 }, (_, i) => ({
      fullName: `Member ${String(i).padStart(3, "0")}`,
      email: `m${i}@example.test`,
    })),
  );
  await page.goto(`/w/${slug}/lists`);
  await expect(page.getByText("300 people")).toBeVisible();
  expect(
    await page
      .getByRole("list", { name: "People" })
      .getByRole("listitem")
      .count(),
  ).toBeLessThan(60);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(page.getByText("Member 299")).toBeVisible();
});

test("an organizer edits a person, adds one, and deletes with Undo", async ({
  page,
}) => {
  const slug = await createWorkspace(page, "Edit Club");
  await seedRoster(slug, [
    {
      fullName: "Youssef Trabelsi",
      email: "youssef@example.test",
      lists: ["Design"],
    },
  ]);
  await page.goto(`/w/${slug}/lists`);

  await page.getByRole("button", { name: /Youssef Trabelsi/ }).click();
  await page.getByLabel("Full name").fill("Youssef T.");
  await page.getByLabel("Full name").blur();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByText("Youssef T.")).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Full name").fill("Amira Haddad");
  await page.getByLabel("Email").fill("amira@example.test");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText("Amira Haddad added.")).toBeVisible();
  await expect(page.getByText("2 people")).toBeVisible();

  await page.getByRole("button", { name: /Amira Haddad/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("1 person")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("2 people")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("bulk actions on phones", async ({ page }) => {
  const slug = await createWorkspace(page, "Bulk Club");
  await seedRoster(slug, [
    { fullName: "Inès Ben Salah", email: "ines@example.test" },
    { fullName: "Sarra Khelifi", email: "sarra@example.test" },
    { fullName: "Youssef Trabelsi", email: "youssef@example.test" },
  ]);
  await page.goto(`/w/${slug}/lists`);
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByRole("checkbox", { name: "Select Inès Ben Salah" }).click();
  await page.getByRole("checkbox", { name: "Select Sarra Khelifi" }).click();
  await page.getByRole("button", { name: "Add to list" }).click();
  await page.getByPlaceholder("Search or create a list").fill("Alumni");
  await page.getByRole("option", { name: 'Create list "Alumni"' }).click();
  await expect(page.getByText("2 people added to Alumni.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Alumni 2" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test.describe("wide screens", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("the import dialog is centered and fully on screen", async ({
    page,
  }) => {
    const slug = await createWorkspace(page, "Dialog Club");
    await page.goto(`/w/${slug}/lists`);
    await page.getByRole("button", { name: "Import" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Import people" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport).toBeTruthy();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(
        4,
      );
    }
  });

  test("the grid edits a name in place", async ({ page }) => {
    const slug = await createWorkspace(page, "Grid Club");
    await seedRoster(slug, [
      { fullName: "Youssef Trabelsi", email: "youssef@example.test" },
    ]);
    await page.goto(`/w/${slug}/lists`);
    await page
      .getByRole("button", { name: "Full name of Youssef Trabelsi" })
      .click();
    await page
      .getByRole("textbox", { name: "Full name of Youssef Trabelsi" })
      .fill("Youssef T.");
    await page.keyboard.press("Enter");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Full name of Youssef T." }),
    ).toBeVisible();
  });
});

test("imports a CSV with a preview, and re-importing reports 0 new", async ({
  page,
}) => {
  await createWorkspace(page, "Import Club");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Lists" })
    .click();
  const importOnce = async () => {
    await page.getByRole("button", { name: "Import" }).first().click();
    await page
      .getByLabel("Choose a .csv or .xlsx")
      .setInputFiles(path.join(__dirname, "fixtures", "roster.csv"));
    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByRole("combobox", { name: "What is Équipe?" }),
    ).toHaveText(/Lists/);
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("Step 3 of 3")).toBeVisible();
    await expectNoHorizontalScroll(page);
  };

  await importOnce();
  await expect(page.getByRole("button", { name: "4 New" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1 Merged duplicates" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1 Invalid, skipped" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import 4 people" }).click();
  await expect(
    page.getByText("4 added, 0 updated, 4 lists created."),
  ).toBeVisible();
  await expect(page.getByText("4 people")).toBeVisible();
  await expect(page.getByRole("button", { name: "Dev 2" })).toBeVisible();

  await importOnce();
  await expect(page.getByRole("button", { name: "0 New" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nothing to import" }),
  ).toBeDisabled();
});

test("a Viewer sees the roster read-only", async ({
  page,
  browser,
}, testInfo) => {
  const slug = await createWorkspace(page, "Viewer Club");
  await seedRoster(slug, [
    { fullName: "Inès Ben Salah", email: "ines@example.test", lists: ["Dev"] },
  ]);
  const viewer = await seedMember(slug, "viewer", "Vic Viewer");

  const context = await browser.newContext({ ...testInfo.project.use });
  const viewerPage = await context.newPage();
  await signInWithCode(viewerPage, viewer.email, { startPath: "/login" });
  await viewerPage.goto(`/w/${slug}/lists`);
  await expect(viewerPage.getByText("1 person")).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "Import" })).toHaveCount(
    0,
  );
  await expect(
    viewerPage.getByRole("button", { name: "Add", exact: true }),
  ).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "Select" })).toHaveCount(
    0,
  );
  await viewerPage.getByRole("button", { name: /Inès Ben Salah/ }).click();
  await expect(
    viewerPage.getByText("Only Owners and Admins can edit the roster."),
  ).toBeVisible();
  await context.close();
});
