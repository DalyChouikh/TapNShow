import { addDays, format } from "date-fns";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { sentMessages } from "./fake-gmail";
import { expectNoHorizontalScroll } from "./layout";
import { seedRoster } from "./seed";
import { E2E_DISPATCH_SECRET, seedSender } from "./seed-sender";
import { signInWithCode, uniqueEmail } from "./sign-in";

/** Signs up an Owner named "Meetings Owner" and creates a workspace; returns its slug. */
export async function createWorkspace(
  page: Page,
  name: string,
): Promise<string> {
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
export async function messagesFor(stamp: string) {
  return (await sentMessages())
    .map((message) => ({
      ...message,
      mime: unfold(Buffer.from(message.raw, "base64url").toString("utf8")),
    }))
    .filter((message) => /^To: .*$/m.exec(message.mime)?.[0].includes(stamp));
}

/**
 * Runs the dispatcher the way Supabase Cron does, then returns this run's messages: lets calendar
 * emails that became due after the answer's own dispatch kick go out (local stacks have no cron).
 */
export async function dispatchAndRead(
  request: APIRequestContext,
  stamp: string,
) {
  await request.post("/api/internal/dispatch", {
    headers: { authorization: `Bearer ${E2E_DISPATCH_SECRET}` },
  });
  return messagesFor(stamp);
}

/** Decodes quoted-printable text (soft line breaks and `=XX` bytes). */
function decodeQuotedPrintable(text: string): string {
  return Buffer.from(
    text
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
    "latin1",
  ).toString("utf8");
}

/** Path and query of the invite's answer link for `choice` (e.g. `/r/<token>?choice=late`). */
export function answerLinkFrom(mime: string, choice: string): string {
  const href = new RegExp(`href="([^"]*\\?choice=${choice})"`).exec(
    decodeQuotedPrintable(mime),
  )?.[1];
  if (!href) {
    throw new Error(`no ${choice} link in the invite`);
  }
  const url = new URL(href);
  return `${url.pathname}${url.search}`;
}

/**
 * Seeds `people` (on one list) and a sender, then creates and sends a meeting for tomorrow 18:00
 * through the wizard, waiting until every invite is out. Returns the meeting page's path.
 */
export async function sendMeetingThroughUi(
  page: Page,
  slug: string,
  options: {
    stamp: string;
    people: Array<{ fullName: string; email: string }>;
    title: string;
  },
): Promise<string> {
  const count = options.people.length;
  const invites = count === 1 ? "1 invite" : `${count} invites`;
  await seedRoster(
    slug,
    options.people.map((person) => ({ ...person, lists: ["Members"] })),
  );
  await seedSender(slug, `e2e-club-${options.stamp}@example.test`);
  // Home already cached "no sender"; a connect returns from Google with a full page load.
  await page.reload();

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "New meeting" })
    .click();
  await expect(page).toHaveURL(/edit\?step=details/);
  await page.getByLabel("Title").fill(options.title);
  await pickTomorrow(page);
  await page.getByRole("button", { name: /Pick a time/ }).click();
  await page.getByRole("option", { name: "18:00" }).click();
  await page.getByLabel("Place").fill("Room 1");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Next: Audience" }).click();

  const next = count === 1 ? "Next: 1 person" : `Next: ${count} people`;
  await page.getByRole("button", { name: /^Members/ }).click();
  await expect(page.getByRole("button", { name: next })).toBeEnabled();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: next }).click();

  await expect(page.getByRole("heading", { name: "Answers" })).toBeVisible();
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(page.getByText(/^From .* </)).toBeVisible();
  await expect(
    page.getByText(
      `${count === 1 ? "1 email" : `${count} emails`} now · ${400 - count} left today on this Gmail`,
    ),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: `Send ${invites}` }).click();
  const dialog = page.getByRole("dialog", {
    name: new RegExp(`Send ${invites} from .* now\\?`),
  });
  await dialog.getByRole("button", { name: `Send ${invites}` }).click();

  // Once every invite is out, the progress card gives way to the email line (M5).
  await expect(
    page.getByRole("button", { name: `Emails: ${count} sent` }),
  ).toBeVisible({ timeout: 30_000 });
  return new URL(page.url()).pathname;
}
