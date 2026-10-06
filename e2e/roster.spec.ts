import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { seedRoster } from "./helpers/seed";
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
