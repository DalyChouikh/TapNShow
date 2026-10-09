import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  answerLinkFrom,
  createWorkspace,
  dispatchAndRead,
  messagesFor,
  sendMeetingThroughUi,
} from "./helpers/meetings";
import { seedMember, seedPastMeetingWithAnswer } from "./helpers/seed";
import { signInWithCode } from "./helpers/sign-in";

// The global setup sets calendar_confirm_delay_seconds to 1 for the run; dispatchAndRead runs the
// dispatcher (as cron would) so a calendar email goes out once its job is due.

test("a member answers from the email and the organizers see it", async ({
  page,
  browser,
  request,
}) => {
  const slug = await createWorkspace(page, "Answers Club");
  const stamp = crypto.randomUUID().slice(0, 8);
  const meetingPath = await sendMeetingThroughUi(page, slug, {
    stamp,
    title: "Answers sync",
    people: [
      { fullName: "Amira Ben Ali", email: `amira-${stamp}@example.test` },
    ],
  });
  const [invite] = await messagesFor(stamp);
  const lateLink = answerLinkFrom(invite.mime, "late");

  // A link scanner opens the link without a browser: nothing may be saved (Review Focus 1).
  expect((await request.get(lateLink)).status()).toBe(200);
  await page.goto(meetingPath);
  await expect(page.getByRole("button", { name: /No reply 1/ })).toBeVisible();

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(lateLink);
  await expect(
    member.getByRole("radio", { name: "I'll be late" }),
  ).toBeChecked();
  await member.getByRole("button", { name: "15 min" }).click();
  await member.getByLabel("Reason").fill("Bus from campus");
  await member.getByRole("button", { name: "Confirm: late by 15 min" }).click();
  await expect(member.getByText("CONFIRMED")).toBeVisible();

  await expect
    .poll(async () => (await dispatchAndRead(request, stamp)).length, {
      timeout: 20_000,
      intervals: [1_500],
    })
    .toBe(2);
  const calendar = (await messagesFor(stamp))[1];
  expect(calendar.mime).toMatch(/method=REQUEST/i);
  expect(calendar.threadId).toBe(invite.assignedThread);

  await expect(page.getByRole("button", { name: /Late 1/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /Late 1/ }).click();
  await expect(page.getByText("Bus from campus")).toBeVisible();

  await member.getByRole("button", { name: "Change" }).click();
  await member.getByRole("radio", { name: "I can't come" }).click();
  await member.getByRole("button", { name: "Confirm: I can't come" }).click();
  await expect(member.getByText("CONFIRMED")).toBeVisible();
  await expect
    .poll(async () => (await dispatchAndRead(request, stamp)).length, {
      timeout: 20_000,
      intervals: [1_500],
    })
    .toBe(3);
  expect((await messagesFor(stamp))[2].mime).toMatch(/method=CANCEL/i);
  await memberContext.close();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "CSV" }).click();
  const csv = readFileSync((await (await download).path()) ?? "", "utf8");
  expect(csv).toContain("Amira Ben Ali");
  expect(csv).toContain("Bus from campus");
});

test("a Viewer sees answers in the Attendance view and the person's history", async ({
  page,
  browser,
}) => {
  const slug = await createWorkspace(page, "Viewer Club");
  const stamp = crypto.randomUUID().slice(0, 8);
  const contactName = await seedPastMeetingWithAnswer(slug, stamp, {
    status: "late",
    delayMinutes: 10,
    reason: `Lab ${stamp}`,
  });
  const viewerUser = await seedMember(slug, "viewer", "Committee Viewer");
  const context = await browser.newContext();
  const viewer = await context.newPage();
  await signInWithCode(viewer, viewerUser.email, { startPath: "/login" });
  await viewer.goto(`/w/${slug}/lists?view=attendance`);
  await expect(viewer.getByText("1 meeting in this period")).toBeVisible();
  await viewer.getByRole("button", { name: contactName }).first().click();
  await expect(
    viewer.getByRole("dialog").getByText(`Lab ${stamp}`),
  ).toBeVisible();
  await viewer.keyboard.press("Escape");
  await expect(viewer.getByRole("button", { name: "Import" })).toHaveCount(0);
  await context.close();
});
