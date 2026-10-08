import { addDays, format } from "date-fns";
import { expect, test, type Page } from "@playwright/test";
import { sentMessages } from "./helpers/fake-gmail";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { seedMember, seedRoster } from "./helpers/seed";
import { seedSender } from "./helpers/seed-sender";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

async function createWorkspace(page: Page, name: string): Promise<string> {
  await signInWithCode(page, uniqueEmail("e2e-meetings"), {
    startPath: "/login",
    name: "Meetings Owner",
  });
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+-[a-z0-9]{4}$/);
  return new URL(page.url()).pathname.split("/")[2];
}

/** Picks tomorrow in the Details step's calendar (moving a month on when needed). */
async function pickTomorrow(page: Page): Promise<void> {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  await page.getByRole("button", { name: /Pick a date/ }).click();
  if (tomorrow.getMonth() !== today.getMonth()) {
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await page
    .getByRole("button", { name: format(tomorrow, "EEEE, MMMM do, yyyy") })
    .click();
}

/** Undoes MIME header folding so a long header reads as one line. */
const unfold = (mime: string) => mime.replace(/\r\n[ \t]+/g, " ");

/** Decoded messages sent to addresses containing `stamp` (runs share the fake Gmail). */
async function messagesFor(stamp: string) {
  return (await sentMessages())
    .map((message) => ({
      ...message,
      mime: unfold(Buffer.from(message.raw, "base64url").toString("utf8")),
    }))
    .filter((message) => /^To: .*$/m.exec(message.mime)?.[0].includes(stamp));
}

test("an Owner sends a meeting and a member unsubscribes from the email", async ({
  page,
}) => {
  const slug = await createWorkspace(page, "E2E Club");
  const stamp = crypto.randomUUID().slice(0, 8);
  await seedRoster(slug, [
    {
      fullName: "Amira Ben Ali",
      email: `amira-${stamp}@example.test`,
      lists: ["Members"],
    },
    {
      fullName: "Sami Haddad",
      email: `sami-${stamp}@example.test`,
      lists: ["Members"],
    },
  ]);
  await seedSender(slug, `e2e-club-${stamp}@example.test`);
  // Home already cached "no sender"; a connect returns from Google with a full page load.
  await page.reload();

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "New meeting" })
    .click();
  await expect(page).toHaveURL(/edit\?step=details/);
  await page.getByLabel("Title").fill("E2E sync");
  await pickTomorrow(page);
  await page.getByRole("button", { name: /Pick a time/ }).click();
  await page.getByRole("option", { name: "18:00" }).click();
  await page.getByLabel("Place").fill("Room 1");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Next: Audience" }).click();

  await page.getByRole("button", { name: /^Members/ }).click();
  await expect(
    page.getByRole("button", { name: "Next: 2 people" }),
  ).toBeEnabled();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Next: 2 people" }).click();

  await expect(page.getByRole("heading", { name: "Answers" })).toBeVisible();
  await page.getByRole("button", { name: "Next: Review" }).click();

  await expect(page.getByText(/^From E2E Club </)).toBeVisible();
  await expect(
    page.getByText("2 emails now · 398 left today on this Gmail"),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Send 2 invites" }).click();
  const dialog = page.getByRole("dialog", {
    name: /Send 2 invites from .* now\?/,
  });
  await dialog.getByRole("button", { name: "Send 2 invites" }).click();

  await expect(page.getByText("2 invites sent")).toBeVisible({
    timeout: 30_000,
  });

  const messages = await messagesFor(stamp);
  expect(messages).toHaveLength(2);
  expect(messages[0].threadId).toBeNull();
  expect(messages[1].threadId).toBe(messages[0].assignedThread);
  const mime = messages[0].mime;
  expect(mime).toMatch(/^From: "?E2E Club"? </m);
  const unsubscribe = /^List-Unsubscribe: <([^>]+)>/m.exec(mime)?.[1] ?? "";
  const token = /\/api\/r\/([A-Za-z0-9_-]{43})\/unsubscribe$/.exec(
    unsubscribe,
  )?.[1];
  expect(token).toBeTruthy();

  await page.goto(`/u/${token}`);
  await expect(
    page.getByRole("heading", { name: "Stop emails from E2E Club?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(
    page.getByRole("heading", { name: "You're unsubscribed" }),
  ).toBeVisible();
  await page.goto(`/w/${slug}/lists`);
  await expect(page.getByText("Unsubscribed")).toBeVisible();
});

test("an Admin without a sender can only save the draft", async ({
  page,
  browser,
}) => {
  const slug = await createWorkspace(page, "No Sender Club");
  const adminUser = await seedMember(slug, "admin", "Youssef Trabelsi");
  const context = await browser.newContext();
  const adminPage = await context.newPage();
  await signInWithCode(adminPage, adminUser.email, { startPath: "/login" });
  await adminPage.goto(`/w/${slug}/meetings/new`);
  await expect(adminPage).toHaveURL(/edit\?step=details/);
  const url = new URL(adminPage.url());
  await adminPage.goto(`${url.pathname}?step=review`);
  await expect(
    adminPage.getByText(
      "Ask Meetings Owner to connect Gmail to send. You can save this draft.",
    ),
  ).toBeVisible();
  await expect(adminPage.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await context.close();
});
