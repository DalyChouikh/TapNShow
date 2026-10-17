import { expect, test } from "./helpers/test";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { createWorkspace, sendMeetingThroughUi } from "./helpers/meetings";
import { seedRoster } from "./helpers/seed";
import {
  openNewWorkspace,
  signInWithCode,
  uniqueEmail,
} from "./helpers/sign-in";

test("a new user lands on My invites and creates a workspace with the browser's timezone", async ({
  page,
}) => {
  await signInWithCode(page, uniqueEmail("e2e-create"), {
    startPath: "/login",
    name: "Creator",
  });
  await openNewWorkspace(page);
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
  await openNewWorkspace(page);
  await page.getByRole("combobox", { name: "Timezone" }).click();
  await page.getByPlaceholder("Search timezones").fill("Tunis");
  await page.getByRole("option", { name: "Africa/Tunis" }).click();
  await expect(page.getByRole("combobox", { name: "Timezone" })).toHaveText(
    "Africa/Tunis",
  );
});

test.describe("Home", () => {
  test.describe.configure({ timeout: 180_000 });
  // The workspace takes the browser's time zone; pin it so the meeting's 18:00 is the same everywhere.
  test.use({ timezoneId: "Africa/Tunis" });

  test("Home shows the next meeting with its answers and reminds who hasn't answered", async ({
    page,
  }) => {
    const slug = await createWorkspace(page, "Home Club");
    const stamp = crypto.randomUUID().slice(0, 8);

    // A new workspace leads with Get set up; each step shows Done once it is.
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome to Home Club" }),
    ).toBeVisible();
    await expect(page.getByText("0 of 2 needed")).toBeVisible();
    await seedRoster(slug, [
      {
        fullName: "Lina Gharbi",
        email: `lina-${stamp}@example.test`,
        lists: ["Committee"],
      },
    ]);
    await page.reload();
    await expect(page.getByText("1 of 2 needed")).toBeVisible();
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "Import your members" })
        .getByText("Done"),
    ).toBeVisible();
    await expect(page.getByText("No meeting coming up.")).toBeVisible();

    // Gmail connected and a meeting sent: the next meeting leads, setup is gone.
    await sendMeetingThroughUi(page, slug, {
      stamp,
      title: "Home sync",
      daysAhead: 2,
      people: [
        { fullName: "Amira Ben Ali", email: `amira-${stamp}@example.test` },
        { fullName: "Bilel Trabelsi", email: `bilel-${stamp}@example.test` },
      ],
    });
    await page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name: "Home" })
      .click();
    await expect(page.getByRole("link", { name: "Home sync" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get set up" })).toHaveCount(
      0,
    );
    await expect(page.getByText(/^in \d+ days?$/)).toBeVisible();
    await expect(page.getByRole("group", { name: "Answers" })).toContainText(
      "No reply2",
    );
    await expect(page.getByText("0 of 2 answered")).toBeVisible();

    // The reminder asks first, then says who it reached.
    await page
      .getByRole("button", { name: "Remind 2 who haven't answered" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Send reminders" })
      .click();
    await expect(page.getByText(/^Reminded 2 at /)).toBeVisible();

    await page.setViewportSize({ width: 320, height: 800 });
    await expectNoHorizontalScroll(page);
  });
});
