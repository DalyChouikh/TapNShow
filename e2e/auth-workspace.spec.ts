import { expect, test } from "@playwright/test";
import { latestEmailText } from "./helpers/mailpit";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

test("M2 story: sign in, create a workspace, invite a Viewer who accepts", async ({
  page,
  browser,
  context,
}) => {
  const viewerEmail = uniqueEmail("story-viewer");
  await signInWithCode(page, uniqueEmail("story-owner"), {
    startPath: "/login",
    name: "Story Owner",
  });
  await page.getByLabel("Workspace name").fill("Launch Club");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/launch-club-[a-z0-9]{4}$/);
  const slug = new URL(page.url()).pathname.split("/")[2];

  await page.getByRole("link", { name: "Invite" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings#people$`));
  await page.getByRole("button", { name: "Invite someone" }).click();
  await page.getByLabel("Email addresses").fill(viewerEmail);
  await page.getByLabel("Email addresses").press("Enter");
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByText("Email sent")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  const link = /(http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43})/.exec(
    await latestEmailText(viewerEmail),
  )?.[1];
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(link!);
  await viewer.getByRole("link", { name: "Sign in" }).click();
  await signInWithCode(viewer, viewerEmail, { name: "Story Viewer" });
  await viewer.getByRole("button", { name: "Accept invite" }).click();
  await expect(viewer).toHaveURL(new RegExp(`/w/${slug}$`));
  await expect(
    viewer.getByRole("heading", { name: "You're a Viewer in Launch Club" }),
  ).toBeVisible();
  await expect(viewer.getByRole("button", { name: "New meeting" })).toHaveCount(
    0,
  );

  // Review Focus 5: an expired session sends the user to sign-in, keeping where they were going.
  await context.clearCookies();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Home" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fw%2F${slug}$`));
});
