import { adminClient, ownerEmailOf, workspaceIdOf } from "./helpers/admin";
import { refuseShares, sheetFiles } from "./helpers/fake-google";
import { createWorkspace } from "./helpers/meetings";
import { seedMember } from "./helpers/seed";
import { sheetStatus, syncSheetUntil } from "./helpers/seed-sheet";
import { connectGoogleSheet, openSettingsSection } from "./helpers/settings";
import { signInWithCode } from "./helpers/sign-in";
import { expect, test } from "./helpers/test";

// Each story waits on the Sheet worker several times, like the other worker stories.
test.describe.configure({ timeout: 180_000 });

/** The fake Drive file of `workspaceName`, once the worker has made it. */
const fileOf = async (workspaceName: string) =>
  (await sheetFiles()).find(
    (file) => file.name === `${workspaceName} · TapNShow`,
  );

/** Who can view the file (TapNShow's shares; the owning account is not one of them), sorted. */
const readersOf = async (workspaceName: string) =>
  ((await fileOf(workspaceName))?.permissions ?? [])
    .filter((permission) => permission.role === "reader")
    .map((permission) => permission.emailAddress)
    .sort();

/** Where TapNShow's record of sharing with `email` stands (service role). */
async function shareStateOf(
  workspaceId: string,
  email: string,
): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("sheet_shares")
    .select("state")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data?.state ?? null;
}

test("the team gets the Google Sheet and loses it when they leave", async ({
  page,
  browser,
  request,
}) => {
  const stamp = crypto.randomUUID().slice(0, 8);
  const name = `Share Club ${stamp}`;
  const slug = await createWorkspace(page, name);
  const workspaceId = await workspaceIdOf(slug);
  const ownerEmail = (await ownerEmailOf(workspaceId)).toLowerCase();
  const admin = await seedMember(slug, "admin", `Admin ${stamp}`);
  const viewer = await seedMember(slug, "viewer", `Viewer ${stamp}`);
  const team = [admin.email, ownerEmail, viewer.email].sort();

  // Connecting shares it with the whole team (the sheet's own account is the club's), one
  // Google email each.
  await connectGoogleSheet(page, slug);
  await syncSheetUntil(
    request,
    workspaceId,
    async () => (await readersOf(name)).length === team.length,
  );
  expect(await readersOf(name)).toEqual(team);
  expect([...((await fileOf(name))?.shareEmails ?? [])].sort()).toEqual(team);
  await page.reload();
  await openSettingsSection(page, "Google Sheets");
  await expect(
    page.getByText("Your team can view it · 3 of 3 people"),
  ).toBeVisible();

  // The Viewer is told they can open it with their own address.
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signInWithCode(viewerPage, viewer.email, { startPath: "/login" });
  await viewerPage.goto(`/w/${slug}/settings`);
  await openSettingsSection(viewerPage, "Google Sheets");
  await expect(
    viewerPage.getByText(`You can view it with ${viewer.email}.`),
  ).toBeVisible();
  await viewerContext.close();

  // The Owner removes the Viewer: their access goes, and nobody is emailed again.
  await openSettingsSection(page, "People");
  await page
    .getByRole("button", { name: `Actions for Viewer ${stamp}` })
    .click();
  await page.getByRole("menuitem", { name: "Remove from workspace" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove from workspace" })
    .click();
  await syncSheetUntil(
    request,
    workspaceId,
    async () => !(await readersOf(name)).includes(viewer.email),
  );
  expect(await readersOf(name)).toEqual([admin.email, ownerEmail].sort());
  expect((await fileOf(name))?.shareEmails).toHaveLength(team.length);

  // Turning the sheet off takes the team's access away before TapNShow lets go of it.
  await page.getByRole("button", { name: "Turn off the Google Sheet" }).click();
  await expect(
    page.getByRole("dialog").getByText(/your team loses access to it/),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Turn off the Google Sheet" })
    .click();
  await expect(page.getByText("Google Sheet turned off")).toBeVisible();
  await syncSheetUntil(
    request,
    workspaceId,
    async () => (await readersOf(name)).length === 0,
  );
});

test("one address Google refuses doesn't stop the sheet", async ({
  page,
  request,
}) => {
  const stamp = crypto.randomUUID().slice(0, 8);
  const name = `Refuse Club ${stamp}`;
  const slug = await createWorkspace(page, name);
  const workspaceId = await workspaceIdOf(slug);
  const ownerEmail = (await ownerEmailOf(workspaceId)).toLowerCase();
  const admin = await seedMember(slug, "admin", `Admin ${stamp}`);
  await refuseShares(admin.email);

  await connectGoogleSheet(page, slug);
  await syncSheetUntil(
    request,
    workspaceId,
    async () => (await shareStateOf(workspaceId, admin.email)) === "refused",
  );
  // The sheet itself carries on: made, and not paused.
  expect(await readersOf(name)).toEqual([ownerEmail]);
  expect(await sheetStatus(workspaceId)).toBe("active");

  // The Owner reads one count, and People marks who.
  await page.reload();
  await openSettingsSection(page, "Google Sheets");
  await expect(
    page.getByText(/^Google couldn't share it with 1 person,/),
  ).toBeVisible();
  await page.getByRole("link", { name: "They're marked in People." }).click();
  await expect(page.getByText("Can't open the sheet")).toBeVisible();
});
