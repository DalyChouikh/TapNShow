import { addDays, format } from "date-fns";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { sentMessages } from "./fake-google";
import { expectNoHorizontalScroll } from "./layout";
import { seedRoster } from "./seed";
import { E2E_DISPATCH_SECRET, seedSender } from "./seed-sender";
import { signUpWithWorkspace } from "./sign-in";

/** Signs up an Owner named "Meetings Owner" and creates a workspace; returns its slug. */
export async function createWorkspace(
  page: Page,
  name: string,
): Promise<string> {
  return signUpWithWorkspace(page, name, {
    prefix: "e2e-meetings",
    ownerName: "Meetings Owner",
  });
}

/** Picks the day `days` from today in the Details step's calendar (moving a month on when needed). */
async function pickDay(page: Page, days: number): Promise<void> {
  const today = new Date();
  const day = addDays(today, days);
  await page.getByRole("button", { name: /Pick a date/ }).click();
  if (day.getMonth() !== today.getMonth()) {
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await page
    .getByRole("button", { name: format(day, "EEEE, MMMM do, yyyy") })
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
 * Wakes both workers (emails and the Google Sheet) the way Supabase Cron does; local stacks have no
 * cron. They run after the route answers, so their work lands a moment later.
 */
export async function runWorkers(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/internal/dispatch", {
    headers: { authorization: `Bearer ${E2E_DISPATCH_SECRET}` },
  });
  expect(response.status()).toBe(202);
}

/**
 * Runs the workers, then returns this run's messages: lets calendar emails that became due after
 * the answer's own dispatch kick go out.
 */
export async function dispatchAndRead(
  request: APIRequestContext,
  stamp: string,
) {
  await runWorkers(request);
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
 * Seeds `people` (on one list) and a sender, then creates and sends a meeting at 18:00 `daysAhead`
 * days from today (default tomorrow) through the wizard, waiting until every invite is out. Returns
 * the meeting page's path.
 */
export async function sendMeetingThroughUi(
  page: Page,
  slug: string,
  options: {
    stamp: string;
    people: Array<{ fullName: string; email: string }>;
    title: string;
    daysAhead?: number;
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
  await pickDay(page, options.daysAhead ?? 1);
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

/**
 * Marks a person at the door (Check-in tab open) and waits until the saved mark shows. A click that
 * lands before the page is interactive is retried; a pressed chip is never clicked again (that
 * would clear the mark).
 */
export async function markAtDoor(
  page: Page,
  fullName: string,
  actual: "Present" | "Late" | "Absent",
): Promise<void> {
  const chip = page
    .getByRole("group", { name: `Check-in for ${fullName}` })
    .getByRole("button", { name: actual });
  await expect(async () => {
    if ((await chip.getAttribute("aria-pressed")) !== "true") {
      await chip.click();
    }
    await expect(chip).toHaveAttribute("aria-pressed", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });
}
