import { expect, test } from "@playwright/test";
import {
  createWorkspace,
  messagesFor,
  sendMeetingThroughUi,
} from "./helpers/meetings";
import { seedMember } from "./helpers/seed";
import { signInWithCode } from "./helpers/sign-in";

test("an Owner sends a meeting and a member unsubscribes from the email", async ({
  page,
}) => {
  const slug = await createWorkspace(page, "E2E Club");
  const stamp = crypto.randomUUID().slice(0, 8);
  await sendMeetingThroughUi(page, slug, {
    stamp,
    title: "E2E sync",
    people: [
      { fullName: "Amira Ben Ali", email: `amira-${stamp}@example.test` },
      { fullName: "Sami Haddad", email: `sami-${stamp}@example.test` },
    ],
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
