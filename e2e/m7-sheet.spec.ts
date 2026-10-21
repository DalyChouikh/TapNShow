import { expect, test } from "./helpers/test";
import { DETAIL_COLUMNS } from "../src/lib/export/columns";
import { type FakeTab, sheetFiles, toggleTrash } from "./helpers/fake-google";
import { latestEmailText } from "./helpers/mailpit";
import {
  answerLinkFrom,
  createWorkspace,
  markAtDoor,
  messagesFor,
  sendMeetingThroughUi,
} from "./helpers/meetings";
import { seedMember } from "./helpers/seed";
import { ownerEmailOf, workspaceIdOf } from "./helpers/admin";
import {
  moveMeetingStart,
  sheetStatus,
  syncSheetUntil,
} from "./helpers/seed-sheet";
import { connectGoogleSheet, openSettingsSection } from "./helpers/settings";
import { signInWithCode } from "./helpers/sign-in";

// Local times show in the sheet; the meeting is two days ahead so no reminder falls due mid-story.
test.use({ timezoneId: "Africa/Tunis" });

const column = (key: string) =>
  DETAIL_COLUMNS.findIndex((each) => each.key === key);
/** Data rows start after the title band, the subtitle, a blank row and the header. */
const FIRST_ROW = 4;
/** The hidden Answer tone column, right after the hidden band column (spec §8). */
const ANSWER_TONE = DETAIL_COLUMNS.length + 1;

/** The first tab of the file named `fileName` in the fake Drive, once there is one. */
async function tabOf(fileName: string): Promise<FakeTab | undefined> {
  return (await sheetFiles()).find((file) => file.name === fileName)?.tabs[0];
}

/** One person's data row of `tab`, by name. */
const rowOf = (tab: FakeTab | undefined, fullName: string) =>
  tab?.values.slice(FIRST_ROW).find((row) => row[column("name")] === fullName);

// A long story that waits on the sheet worker several times (25 to 30 s on a laptop): the default
// 30 s budget left no room, as for the other worker stories.
test.describe.configure({ timeout: 180_000 });

test("the Owner connects a Google Sheet that follows answers and check-ins, pauses in the trash and stays when turned off", async ({
  page,
  browser,
  request,
}) => {
  const stamp = crypto.randomUUID().slice(0, 8);
  const workspaceName = `Sheet Club ${stamp}`;
  const fileName = `${workspaceName} · TapNShow`;
  const slug = await createWorkspace(page, workspaceName);
  const workspaceId = await workspaceIdOf(slug);
  const ownerEmail = await ownerEmailOf(workspaceId);
  const viewer = await seedMember(slug, "viewer", "Sheet Viewer");

  // The Owner connects through Google's consent screen (the fake agrees at once).
  await connectGoogleSheet(page, slug);

  const people = ["Amira", "Bilel", "Chiraz"].map((first) => ({
    fullName: `${first} ${stamp}`,
    email: `${first.toLowerCase()}-${stamp}@example.test`,
  }));
  const meetingPath = await sendMeetingThroughUi(page, slug, {
    stamp,
    title: `Sheet sync ${stamp}`,
    people,
    daysAhead: 2,
  });

  // The first runs create the file and draw this year's tab in the app's look.
  await syncSheetUntil(
    request,
    workspaceId,
    async () => rowOf(await tabOf(fileName), people[2].fullName) !== undefined,
  );
  const tab = await tabOf(fileName);
  expect(tab?.title).toBe(
    String(new Date(Date.now() + 2 * 86_400_000).getFullYear()),
  );
  expect(
    tab?.values
      .slice(FIRST_ROW)
      .map((row) => [row[column("name")], row[column("answer")]]),
  ).toEqual(people.map((person) => [person.fullName, "No reply"]));
  expect(tab?.rules).toBe(10);
  expect(tab?.slicerIds).toHaveLength(1);

  // An answer reaches its row, tinted.
  const bilel = people[1];
  const invite = (await messagesFor(stamp)).find((message) =>
    message.mime.includes(bilel.email),
  );
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(answerLinkFrom(invite?.mime ?? "", "late"));
  await member.getByRole("button", { name: "15 min" }).click();
  await member.getByLabel("Reason").fill("Bus from campus");
  await member.getByRole("button", { name: "Confirm: late by 15 min" }).click();
  await expect(member.getByText("CONFIRMED")).toBeVisible();
  await syncSheetUntil(request, workspaceId, async () => {
    const row = rowOf(await tabOf(fileName), bilel.fullName);
    return (
      row?.[column("answer")] === "Late by 15 min" &&
      row?.[ANSWER_TONE] === "warning"
    );
  });

  // Settings and the meeting's Export menu open it.
  await page.goto(`/w/${slug}/settings`);
  await openSettingsSection(page, "Google Sheets");
  await expect(page.getByText("Up to date")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the Google Sheet" }),
  ).toBeVisible();
  await page.goto(meetingPath);
  await page.getByRole("button", { name: "Export" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Open the Google Sheet" }),
  ).toHaveAttribute("href", /#gid=0$/);
  await page.keyboard.press("Escape");

  // A Viewer can open it but not turn it off.
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signInWithCode(viewerPage, viewer.email, { startPath: "/login" });
  await viewerPage.goto(`/w/${slug}/settings`);
  await openSettingsSection(viewerPage, "Google Sheets");
  await expect(
    viewerPage.getByText(/^Answers are copied to a Google Sheet\./),
  ).toBeVisible();
  await expect(
    viewerPage.getByRole("link", { name: "Open the Google Sheet" }),
  ).toBeVisible();
  await expect(
    viewerPage.getByRole("button", { name: "Turn off the Google Sheet" }),
  ).toHaveCount(0);
  await viewerContext.close();

  // In the trash, the next change pauses it and the Owner gets one email.
  const fileId =
    (await sheetFiles()).find((file) => file.name === fileName)?.id ?? "";
  await toggleTrash(fileId);
  const trashedAt = new Date(Date.now() - 1000);
  await member.getByRole("button", { name: "Change" }).click();
  await member.getByRole("radio", { name: "I can't come" }).click();
  await member.getByRole("button", { name: "Confirm: I can't come" }).click();
  await expect(member.getByText("CONFIRMED")).toBeVisible();
  await syncSheetUntil(
    request,
    workspaceId,
    async () => (await sheetStatus(workspaceId)) === "paused",
  );
  await page.goto(`/w/${slug}/settings`);
  await openSettingsSection(page, "Google Sheets");
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/^The Google Sheet was moved to the trash\./),
  ).toBeVisible();
  expect(
    await latestEmailText(ownerEmail, {
      after: trashedAt,
      subject: /stopped updating/,
    }),
  ).toContain("moved to the trash");

  // Restored, Try again catches up with the answer it missed.
  await toggleTrash(fileId);
  await page.getByRole("button", { name: "Try again" }).click();
  await syncSheetUntil(request, workspaceId, async () => {
    const answer = rowOf(await tabOf(fileName), bilel.fullName)?.[
      column("answer")
    ];
    return answer !== "Late by 15 min" && answer !== "No reply";
  });
  await page.reload();
  await openSettingsSection(page, "Google Sheets");
  await expect(page.getByText("Up to date")).toBeVisible();

  // A check-in at the door reaches its row once the meeting has started.
  await moveMeetingStart(
    meetingPath.split("/").at(-1) ?? "",
    new Date(Date.now() - 3_600_000),
  );
  await page.goto(meetingPath);
  await page.getByRole("radio", { name: "Check-in" }).click();
  await markAtDoor(page, people[0].fullName, "Present");
  await syncSheetUntil(
    request,
    workspaceId,
    async () =>
      rowOf(await tabOf(fileName), people[0].fullName)?.[
        column("checkedIn")
      ] === "Present",
  );

  // Turned off, the file stays in Drive.
  await page.goto(`/w/${slug}/settings`);
  await openSettingsSection(page, "Google Sheets");
  await page.getByRole("button", { name: "Turn off the Google Sheet" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Turn off the Google Sheet" })
    .click();
  await expect(page.getByText("Google Sheet turned off")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Google Sheets" }),
  ).toBeVisible();
  expect(
    (await sheetFiles()).some((file) => file.id === fileId && !file.trashed),
  ).toBe(true);
  await memberContext.close();
});
