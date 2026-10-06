import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestEmailText } from "./helpers/mailpit";
import { signInWithCode, uniqueEmail } from "./helpers/sign-in";

const INVITE_LINK = /(http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43})/;

async function ownerWithWorkspace(page: Page, name: string): Promise<void> {
  await signInWithCode(page, uniqueEmail("e2e-owner"), {
    startPath: "/login",
    name: "Invite Owner",
  });
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+-[a-z0-9]{4}$/);
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Settings" })
    .click();
}

async function invite(
  page: Page,
  email: string,
  delivery: "email" | "link",
): Promise<string | null> {
  await page.getByRole("button", { name: "Invite someone" }).click();
  await page.getByLabel("Email addresses").fill(email);
  await page.getByLabel("Email addresses").press("Enter");
  if (delivery === "link") {
    await page.getByRole("radio", { name: "Give me a link to share" }).click();
  }
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/invites") &&
      candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create invite" }).click();
  const { results } = (await (await response).json()) as {
    results: Array<{ status: string; link?: string }>;
  };
  await expect(
    page.getByText(delivery === "link" ? "Link ready" : "Email sent"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  return results[0].link ?? null;
}

test("several people are invited at once, each with their own link", async ({
  page,
}) => {
  await ownerWithWorkspace(page, "Batch Club");
  await page.getByRole("button", { name: "Invite someone" }).click();
  const field = page.getByLabel("Email addresses");
  await field.fill("one@example.test, two@example.test three@example.test");
  await field.press("Enter");
  await page.getByRole("radio", { name: "Give me a link to share" }).click();
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Link ready")).toHaveCount(3);
  await page.getByRole("button", { name: "Done" }).click();
  for (const email of [
    "one@example.test",
    "two@example.test",
    "three@example.test",
  ]) {
    await expect(page.getByText(email)).toBeVisible();
  }
});

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test("an emailed invite is accepted by the invited address", async ({
  page,
  browser,
}) => {
  const viewerEmail = uniqueEmail("e2e-viewer");
  await ownerWithWorkspace(page, "Invite Club");
  await invite(page, viewerEmail, "email");
  const link = INVITE_LINK.exec(await latestEmailText(viewerEmail))?.[1];
  expect(link).toBeTruthy();

  const viewer = await freshPage(browser);
  await viewer.goto(link!);
  await expect(
    viewer.getByRole("heading", { name: "Sign in to see your invitation" }),
  ).toBeVisible();
  await viewer.getByRole("link", { name: "Sign in" }).click();
  await signInWithCode(viewer, viewerEmail, { name: "Vic Viewer" });
  await viewer.getByRole("button", { name: "Accept invite" }).click();
  await expect(viewer).toHaveURL(/\/w\/invite-club-[a-z0-9]{4}$/);
  await expect(
    viewer.getByRole("button", { name: "Switch workspace" }),
  ).toContainText("Viewer");
  await expect(viewer.getByRole("button", { name: "New meeting" })).toHaveCount(
    0,
  );
});

test("a copied link opened by another account shows the masked address", async ({
  page,
  browser,
}) => {
  const invited = uniqueEmail("v");
  await ownerWithWorkspace(page, "Link Club");
  const link = await invite(page, invited, "link");

  const stranger = await freshPage(browser);
  await signInWithCode(stranger, uniqueEmail("e2e-stranger"), {
    startPath: "/login",
    name: "Stranger",
  });
  await stranger.goto(link!);
  await expect(
    stranger.getByRole("heading", {
      name: "This invite is for v•••@example.test",
    }),
  ).toBeVisible();
});

test("a revoked invite says it was cancelled", async ({ page, browser }) => {
  const invited = uniqueEmail("e2e-revoked");
  await ownerWithWorkspace(page, "Revoke Club");
  const link = await invite(page, invited, "link");
  await page
    .getByRole("button", { name: `Invite actions for ${invited}` })
    .click();
  await page.getByRole("menuitem", { name: "Cancel invite" }).click();
  await expect(page.getByText("Invite cancelled.")).toBeVisible();

  const person = await freshPage(browser);
  await signInWithCode(person, invited, { startPath: "/login", name: "Late" });
  await person.goto(link!);
  await expect(person.getByText("This invite was cancelled.")).toBeVisible();
});

test("invite pages never send the token as a referrer", async ({ request }) => {
  const response = await request.get(`/invite/${"A".repeat(43)}`);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
});
