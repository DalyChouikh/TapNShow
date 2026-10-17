import { expect, test } from "./helpers/test";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { createWorkspace, sendMeetingThroughUi } from "./helpers/meetings";
import { seedPastMeetings, seedRoster } from "./helpers/seed";
import { seedSender } from "./helpers/seed-sender";
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

  test("Home shows how the group is doing and who often misses", async ({
    page,
  }) => {
    const slug = await createWorkspace(page, "Insights Club");
    const stamp = crypto.randomUUID().slice(0, 8);
    const people = [`Amira ${stamp}`, `Bilel ${stamp}`, `Chaima ${stamp}`];
    await seedRoster(
      slug,
      people.map((fullName, index) => ({
        fullName,
        email: `p${index}-${stamp}@example.test`,
        lists: ["Members"],
      })),
    );
    await seedSender(slug, `e2e-club-${stamp}@example.test`);
    const meetings = await seedPastMeetings(slug, stamp, people, [
      ["absent", "attending", "late"],
      ["absent", "attending", null],
      [null, "attending", "attending"],
    ]);
    await page.reload();

    // Three numbers and a bar per meeting, each linking to it.
    const numbers = page.getByRole("group", { name: "How it's going" }).first();
    await expect(numbers).toContainText("3meetings");
    await expect(numbers).toContainText("78%answered before the start");
    const chart = page.getByRole("group", { name: "Who came to each meeting" });
    await expect(chart.getByRole("link")).toHaveCount(3);
    await expect(chart.getByRole("link").last()).toHaveAccessibleName(
      new RegExp(
        `^Weekly sync 3 ${stamp}, .*: 2 came, 0 late, 0 absent, 1 no reply$`,
      ),
    );

    // Often missing: Amira first, opening her history over Home.
    const missing = page.getByRole("button", { name: new RegExp(people[0]) });
    await expect(missing).toContainText("Missed 3 of 3: 2 absent, 1 no reply");
    await expect(
      page.getByRole("button", { name: new RegExp(people[2]) }),
    ).toContainText("Missed 1 of 3: 0 absent, 1 no reply");
    await missing.click();
    const dialog = page.getByRole("dialog", { name: people[0] });
    await expect(dialog.getByRole("group", { name: "History" })).toContainText(
      "2",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "See everyone's attendance" }),
    ).toHaveAttribute("href", `/w/${slug}/lists?view=attendance`);

    // All time reads the same three; a bar opens its meeting.
    await page.getByRole("button", { name: "All time" }).click();
    await expect(numbers).toContainText("3meetings");
    await chart.getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${meetings[0]}$`));

    await page.goto(`/w/${slug}`);
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(chart.getByRole("link")).toHaveCount(3);
    await expectNoHorizontalScroll(page);
  });
});
