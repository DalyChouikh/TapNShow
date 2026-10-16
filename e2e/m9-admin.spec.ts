import { makePlatformAdmin } from "./helpers/admin";
import { expect, test } from "./helpers/test";
import {
  confirmSend,
  createWorkspace,
  openReviewThroughUi,
} from "./helpers/meetings";
import { seedInvitedPeople } from "./helpers/seed";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

test.describe("sending paused after reports (spec §7.12)", () => {
  // The refused send answers 409 by design; the browser logs every 4xx resource.
  test.use({ allowConsole: /status of 409 \(Conflict\)/ });

  test("three people's reports pause sending; the Owner sees why, and a send is refused in plain words", async ({
    page,
  }) => {
    const stamp = crypto.randomUUID().slice(0, 8);
    const slug = await createWorkspace(page, `Paused Club ${stamp}`);
    const tokens = await seedInvitedPeople(slug, stamp, 10);
    for (const token of tokens.slice(0, 3)) {
      const reported = await page.request.post(`/api/r/${token}/report`);
      expect(reported.ok()).toBe(true);
    }

    await page.goto(`/w/${slug}`);
    await expect(page.getByText("Sending is paused.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Contact us" }),
    ).toHaveAttribute("href", /^mailto:/);

    await openReviewThroughUi(page, slug, {
      stamp,
      people: [
        { fullName: `Amira ${stamp}`, email: `amira-${stamp}@example.test` },
      ],
      title: `Paused send ${stamp}`,
    });
    await confirmSend(page, 1);
    await expect(
      page.getByText(
        "Sending is paused while TapNShow reviews reports about this workspace.",
      ),
    ).toBeVisible();
  });
});

test.describe("the admin area (spec §7.19)", () => {
  test.describe("until Task 20 adds the Reports, Admins and Log pages", () => {
    // TEMPORARY (M9 Task 19): the shell's tabs prefetch those three pages, which answer 404 until
    // Task 20 adds them. Task 20 removes this allowance.
    test.use({
      allowConsole:
        /status of 404 \(Not Found\) <http:\/\/localhost:\d+\/admin\/(reports|admins|log)\?_rsc=/,
    });

    test("a platform admin finds a workspace, suspends its sending, then lifts it", async ({
      page,
    }) => {
      const stamp = crypto.randomUUID().slice(0, 8);
      const name = `Seeded Club ${stamp}`;
      await createWorkspace(page, name);
      await makePlatformAdmin(page);
      await page.goto("/admin");
      await expect(
        page.getByRole("heading", { name: /^Needs attention/ }),
      ).toBeVisible();

      await page
        .getByRole("navigation", { name: "Admin" })
        .getByRole("link", { name: "Workspaces" })
        .click();
      await page
        .getByRole("searchbox", { name: "Search by name or Owner email" })
        .fill(name);
      await expect(page).toHaveURL(/\/admin\/workspaces\?q=/);
      await page.getByRole("link", { name: new RegExp(name) }).click();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

      await page.getByRole("button", { name: "Suspend sending" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Suspend sending" })
        .click();
      await expect(
        page.getByRole("status").getByText("Sending suspended by an admin"),
      ).toBeVisible();

      await page.getByRole("button", { name: "Lift suspension" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Lift suspension" })
        .click();
      await expect(
        page.getByRole("button", { name: "Suspend sending" }),
      ).toBeVisible();
      const history = page
        .getByRole("region", { name: "Suspension history" })
        .getByRole("listitem");
      await expect(history).toHaveCount(1);
      await expect(history).toContainText("lifted");
    });
  });

  test("anyone else sees the not-found view at /admin", async ({ page }) => {
    await signInWithCode(page, uniqueEmail("e2e-member"), {
      startPath: "/login",
      name: "Member",
    });
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
  });
});
