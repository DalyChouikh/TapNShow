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

  test("an admin marks a report reviewed", async ({ page }) => {
    const stamp = crypto.randomUUID().slice(0, 8);
    const name = `Reported Club ${stamp}`;
    const slug = await createWorkspace(page, name);
    const [token] = await seedInvitedPeople(slug, stamp, 1);
    expect((await page.request.post(`/api/r/${token}/report`)).ok()).toBe(true);
    await makePlatformAdmin(page);

    await page.goto("/admin/reports");
    const report = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name }) });
    await report.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(report.getByText("Reviewed by Meetings Owner")).toBeVisible();
  });

  test("the platform owner invites an admin by link, who joins; a wrong account can't", async ({
    page,
    browser,
  }, testInfo) => {
    // The platform has one owner: running this on both phones at once would swap it mid-story.
    test.skip(testInfo.project.name !== "phone", "one platform owner");
    await signInWithCode(page, uniqueEmail("e2e-powner"), {
      startPath: "/login",
      name: "Platform Owner",
    });
    await makePlatformAdmin(page, "owner");
    await page.goto("/admin/admins");
    await page.getByRole("button", { name: "Add an admin" }).click();
    const invitedEmail = uniqueEmail("e2e-newadmin");
    await page.getByLabel("Their email").fill(invitedEmail);
    await page.getByRole("radio", { name: "Copy a link" }).click();
    await page.getByRole("button", { name: "Make the link" }).click();
    const link = await page.getByLabel("Invite link").inputValue();
    expect(link).toMatch(/\/admin\/join\//);

    const strangerPage = await (await browser.newContext()).newPage();
    await signInWithCode(strangerPage, uniqueEmail("e2e-stranger"), {
      startPath: "/login",
      name: "Stranger",
    });
    await strangerPage.goto(link);
    await expect(
      strangerPage.getByRole("heading", { name: /This invite is for/ }),
    ).toBeVisible();

    const invitedPage = await (await browser.newContext()).newPage();
    // /admin/* needs a session: the proxy sends a signed-out visitor to sign-in, then back.
    await invitedPage.goto(link);
    await expect(invitedPage).toHaveURL(/\/login\?next=/);
    await signInWithCode(invitedPage, invitedEmail, { name: "New Admin" });
    await invitedPage
      .getByRole("button", { name: "Accept the invite" })
      .click();
    await expect(invitedPage).toHaveURL(/\/admin$/);

    await page.goto("/admin/log");
    await expect(page.getByText(/joined as an admin/).first()).toBeVisible();
  });
});
