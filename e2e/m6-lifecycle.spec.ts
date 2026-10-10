import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  answerLinkFrom,
  createWorkspace,
  dispatchAndRead,
  messagesFor,
  sendMeetingThroughUi,
} from "./helpers/meetings";
import { dueTimers, seedMember, seedStartedMeeting } from "./helpers/seed";
import { signInWithCode } from "./helpers/sign-in";

// M6 (spec §14): change a sent meeting, reconfirm, reminders, nudge, cancel and delete, check-in,
// declared vs actual, duplicate. The global setup makes calendar and update emails due after 1 s;
// dispatchAndRead runs the dispatcher as cron would.

/** Quoted-printable undone, so subjects and ".ics" lines read as written. */
const plain = (mime: string) =>
  mime.replace(/=\r?\n/g, "").replace(/\r\n[ \t]/g, "");

test.describe.configure({ timeout: 180_000 });
// The workspace takes the browser's time zone; pin it so "19:00" is 18:00 UTC on any runner.
test.use({ timezoneId: "Africa/Tunis" });

test("an organizer changes, reminds, cancels and deletes a sent meeting", async ({
  page,
  browser,
  request,
}) => {
  const slug = await createWorkspace(page, "Lifecycle Club");
  const stamp = crypto.randomUUID().slice(0, 8);
  const amira = `amira-${stamp}@example.test`;
  const bilel = `bilel-${stamp}@example.test`;
  const meetingPath = await sendMeetingThroughUi(page, slug, {
    stamp,
    title: "Lifecycle sync",
    people: [
      { fullName: "Amira Ben Ali", email: amira },
      { fullName: "Bilel Trabelsi", email: bilel },
    ],
  });
  const meetingId = meetingPath.split("/").at(-1) ?? "";
  const invites = await messagesFor(stamp);
  const inviteOf = (to: string) =>
    invites.find(
      (message) =>
        message.mime.includes(`To: ${to}`) || message.mime.includes(`<${to}>`),
    );
  const amiraLink = answerLinkFrom(inviteOf(amira)?.mime ?? "", "attending");

  // Amira says Going: her calendar invitation goes out (sequence 0).
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(amiraLink);
  await member.getByRole("button", { name: "Confirm: I'm going" }).click();
  await expect(member.getByText("CONFIRMED")).toBeVisible();
  await expect
    .poll(async () => (await dispatchAndRead(request, stamp)).length, {
      timeout: 20_000,
      intervals: [1_500],
    })
    .toBe(3);
  expect(plain((await messagesFor(stamp))[2].mime)).toContain("SEQUENCE:0");

  // Move it from 18:00 to 19:00 through the wizard's edit mode.
  await page.goto(meetingPath);
  await page.getByRole("button", { name: "Meeting actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByText("Edit meeting · Step 1 of 3")).toBeVisible();
  await page.getByRole("button", { name: /^Time/ }).click();
  await page.getByRole("option", { name: "19:00" }).click();
  await page.getByRole("button", { name: "Next: Answers" }).click();
  await page.getByRole("button", { name: "Next: Review changes" }).click();
  await expect(page.getByText("Emails 2 people.")).toBeVisible();
  await expect(
    page.getByText("Everyone will be asked to confirm again."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save and email 2 people" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save and email 2 people" })
    .click();
  await expect(page.getByText("Changes saved.")).toBeVisible();

  await expect
    .poll(async () => (await dispatchAndRead(request, stamp)).length, {
      timeout: 30_000,
      intervals: [2_000],
    })
    .toBe(5);
  const updates = (await messagesFor(stamp)).slice(3).map((m) => plain(m.mime));
  const amiraUpdate = updates.find((mime) => mime.includes(amira)) ?? "";
  const bilelUpdate = updates.find((mime) => mime.includes(bilel)) ?? "";
  expect(amiraUpdate).toMatch(/Subject: .*Changed/);
  expect(amiraUpdate).toMatch(/METHOD:REQUEST/);
  expect(amiraUpdate).toContain("SEQUENCE:1");
  expect(amiraUpdate).toMatch(/DTSTART:\d{8}T180000Z/);
  expect(bilelUpdate).toMatch(/Subject: .*Changed/);
  expect(bilelUpdate).not.toContain("text/calendar");

  // Amira is asked again and confirms.
  await page.goto(meetingPath);
  await expect(
    page.getByRole("button", { name: /To reconfirm 1/ }),
  ).toBeVisible();
  await member.goto(amiraLink.split("?")[0]);
  await member.getByRole("button", { name: "Yes, still going" }).click();
  await expect(member.getByText("Your answer: Going")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Going 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /To reconfirm/ })).toHaveCount(
    0,
  );
  await memberContext.close();

  // The "not answered" reminder reaches only Bilel.
  await dueTimers(meetingId);
  await expect
    .poll(async () => (await dispatchAndRead(request, stamp)).length, {
      timeout: 20_000,
      intervals: [1_500],
    })
    .toBe(6);
  const reminder = plain((await messagesFor(stamp))[5].mime);
  expect(reminder).toContain(bilel);
  expect(reminder).toMatch(/Subject: .*Reminder/);
  // Quoted-printable keeps "=" as "=3D" in the HTML part.
  expect(reminder).toContain("?choice=3Dattending");

  // A nudge reminds him once more.
  await page
    .getByRole("button", { name: "Remind 1 who hasn't answered" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Send reminders" })
    .click();
  await expect(page.getByText(/^Reminded 1 at /)).toBeVisible();
  await expect
    .poll(async () => (await dispatchAndRead(request, stamp)).length, {
      timeout: 20_000,
      intervals: [1_500],
    })
    .toBe(7);

  // Cancel: Amira's calendar event is removed; Bilel gets the email only.
  await page.getByRole("button", { name: "Meeting actions" }).click();
  await page.getByRole("menuitem", { name: "Cancel meeting" }).click();
  const cancel = page.getByRole("dialog", {
    name: "Cancel this meeting and email 2 people?",
  });
  await cancel.getByRole("button", { name: "Cancel meeting" }).click();
  await expect(page.getByText(/^Cancelled on /)).toBeVisible();
  await expect
    .poll(async () => (await dispatchAndRead(request, stamp)).length, {
      timeout: 20_000,
      intervals: [1_500],
    })
    .toBe(9);
  const cancellations = (await messagesFor(stamp))
    .slice(7)
    .map((m) => plain(m.mime));
  expect(cancellations.find((mime) => mime.includes(amira))).toMatch(
    /METHOD:CANCEL/,
  );
  expect(cancellations.find((mime) => mime.includes(bilel))).not.toContain(
    "text/calendar",
  );

  // Delete, once the cancellation emails are out.
  await page.getByRole("button", { name: "Meeting actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/meetings$`));
});

test("the committee checks people in; History and exports show what happened", async ({
  page,
  browser,
}) => {
  const slug = await createWorkspace(page, "Door Club");
  const stamp = crypto.randomUUID().slice(0, 8);
  const going = `Amira ${stamp}`;
  const silent = `Bilel ${stamp}`;
  const meetingId = await seedStartedMeeting(slug, stamp, { going, silent });
  const doorUser = await seedMember(slug, "viewer", "Door Viewer", true);
  const context = await browser.newContext();
  const door = await context.newPage();
  await signInWithCode(door, doorUser.email, { startPath: "/login" });
  await door.goto(`/w/${slug}/meetings/${meetingId}`);
  await door.getByRole("radio", { name: "Check-in" }).click();
  await door
    .getByRole("group", { name: `Check-in for ${going}` })
    .getByRole("button", { name: "Absent" })
    .click();
  await expect(door.getByText("1 of 2 checked in")).toBeVisible();
  await door
    .getByRole("button", { name: "Mark the rest as they said" })
    .click();
  await door
    .getByRole("dialog")
    .getByRole("button", { name: "Mark the rest" })
    .click();
  await expect(door.getByText("Marked 1 person.")).toBeVisible();
  await expect(door.getByText("2 of 2 checked in")).toBeVisible();

  await door.getByRole("radio", { name: "Results" }).click();
  const download = door.waitForEvent("download");
  await door.getByRole("button", { name: "Export" }).click();
  await door.getByRole("menuitem", { name: "CSV" }).click();
  const csv = readFileSync((await (await download).path()) ?? "", "utf8");
  const lines = csv.split("\r\n");
  expect(lines[0]).toContain("Checked in,Checked in by");
  expect(lines.find((line) => line.startsWith(going))).toMatch(
    /,Absent,Door Viewer$/,
  );
  expect(lines.find((line) => line.startsWith(silent))).toMatch(
    /,Absent,Door Viewer$/,
  );

  await door.goto(`/w/${slug}/lists?view=attendance`);
  await door.getByRole("button", { name: going }).first().click();
  await expect(
    door.getByRole("dialog").getByText("Said going · Was absent"),
  ).toBeVisible();
  await context.close();

  // The Owner copies the started meeting into a new draft with no date.
  await page.goto(`/w/${slug}/meetings/${meetingId}`);
  await page.getByRole("button", { name: "Meeting actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page).toHaveURL(/\/edit\?step=details$/);
  await expect(page.getByText("Copy created. Pick a date.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Pick a date/ })).toBeVisible();
});
