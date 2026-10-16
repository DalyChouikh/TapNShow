import { expect, test } from "./helpers/test";
import {
  confirmSend,
  createWorkspace,
  openReviewThroughUi,
} from "./helpers/meetings";
import { seedInvitedPeople } from "./helpers/seed";

test.describe("sending paused after reports (spec §7.12)", () => {
  // The refused send answers 409 by design; the browser logs every 4xx resource.
  test.use({ allowConsole: /status of 409 \(Conflict\)/ });

  test("three people's reports pause sending; the Owner sees why, and a send is refused in plain words", async ({
    page,
  }) => {
    const stamp = crypto.randomUUID().slice(0, 8);
    const slug = await createWorkspace(page, `Paused Club ${stamp}`);
    const tokens = await seedInvitedPeople(slug, stamp, 10);
    for (const token of tokens.slice(0, 3)) {
      const reported = await page.request.post(`/api/r/${token}/report`);
      expect(reported.ok()).toBe(true);
    }

    await page.goto(`/w/${slug}`);
    await expect(page.getByText("Sending is paused.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Contact us" }),
    ).toHaveAttribute("href", /^mailto:/);

    await openReviewThroughUi(page, slug, {
      stamp,
      people: [
        { fullName: `Amira ${stamp}`, email: `amira-${stamp}@example.test` },
      ],
      title: `Paused send ${stamp}`,
    });
    await confirmSend(page, 1);
    await expect(
      page.getByText(
        "Sending is paused while TapNShow reviews reports about this workspace.",
      ),
    ).toBeVisible();
  });
});
