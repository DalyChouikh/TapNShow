import { type Page } from "@playwright/test";
import { expect, test } from "./helpers/test";
import { z } from "zod";
import { adminClient, workspaceIdOf } from "./helpers/admin";
import {
  createWorkspace,
  messagesFor,
  runWorkers,
  sendMeetingThroughUi,
} from "./helpers/meetings";
import {
  decryptPush,
  newBrowserKeys,
  pushesFor,
  seedPushSubscription,
} from "./helpers/push";
import {
  openNewWorkspace,
  signInWithCode,
  uniqueEmail,
} from "./helpers/sign-in";

const meSchema = z.object({ userId: z.uuid() });
const notificationSchema = z.object({
  title: z.string(),
  body: z.string(),
  url: z.string(),
  tag: z.string(),
});

/** The signed-in person's user id, as the app knows it. */
async function myUserId(page: Page): Promise<string> {
  return meSchema.parse(await (await page.request.get("/api/me")).json())
    .userId;
}

/** Waits until the worker has saved `/invites` and its list (it saves just after answering). */
async function savedForOffline(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const names = await caches.keys();
        return names.includes("tn-pages") && names.includes("tn-invites");
      }),
    )
    .toBe(true);
}

test.describe(() => {
  // The phone goes offline on purpose; the browser logs the requests it can't make.
  test.use({ allowConsole: /net::ERR_INTERNET_DISCONNECTED/ });

  test("a member sees every group's invites, gets them on the phone, reads them offline, and deletes the account", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const stampA = crypto.randomUUID().slice(0, 8);
    const stampB = crypto.randomUUID().slice(0, 8);
    // One address in both groups; each stamp finds its own emails.
    const email = `amira-${stampA}-${stampB}@example.test`;
    const person = { fullName: "Amira Ben Ali", email };

    // The member signs in before any invite: the member home is empty.
    const memberContext = await browser.newContext();
    await memberContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    const member = await memberContext.newPage();
    await signInWithCode(member, email, {
      startPath: "/login",
      name: "Amira Ben Ali",
    });
    await expect(member).toHaveURL(/\/invites$/);
    await expect(member.getByText("No invites yet")).toBeVisible();

    // A phone with reminders on (the browser side of subscribing is unit-tested).
    const keys = newBrowserKeys();
    await seedPushSubscription(await myUserId(member), keys, stampA);

    // Two groups invite the same address.
    const slugA = await createWorkspace(page, "Robotics Club");
    await sendMeetingThroughUi(page, slugA, {
      stamp: stampA,
      title: `Sync A ${stampA}`,
      people: [person],
    });
    await page.goto("/invites");
    await openNewWorkspace(page);
    await page.getByLabel("Workspace name").fill("Chess Club");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/w\/chess-club-[a-z0-9]{4}$/);
    const slugB = new URL(page.url()).pathname.split("/")[2];
    await sendMeetingThroughUi(page, slugB, {
      stamp: stampB,
      title: `Sync B ${stampB}`,
      people: [person],
    });

    // Every invite email points to the member home.
    const [inviteA] = await messagesFor(stampA);
    expect(inviteA.mime).toContain("See all your invites in one place");
    expect(inviteA.mime).toMatch(/http:\/\/localhost:3000\/invites/);

    // Each email brought a notification: encrypted, signed, with no personal link.
    await expect
      .poll(
        async () => {
          await runWorkers(request);
          return (await pushesFor(stampA)).length;
        },
        { timeout: 30_000, intervals: [1_500] },
      )
      .toBe(2);
    const pushes = await pushesFor(stampA);
    for (const push of pushes) {
      expect(Number(push.ttl)).toBeGreaterThan(0);
      expect(push.topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(push.authorization).toMatch(/^vapid t=.+, k=.+$/);
    }
    const shown = pushes.map((push) =>
      notificationSchema.parse(JSON.parse(decryptPush(push, keys))),
    );
    const first = shown.find((each) => each.title.includes(`Sync A ${stampA}`));
    expect(first?.title).toBe(`Robotics Club · Sync A ${stampA}`);
    expect(first?.body).toMatch(/^New invite: .+\. Are you coming\?$/);
    expect(first?.url).toMatch(/^\/invites\/[0-9a-f-]{36}$/);
    expect(first?.tag).toMatch(/^invite:[0-9a-f-]{36}$/);
    expect(JSON.stringify(shown)).not.toContain("/r/");

    // Tapping the notification opens that invite's answer page.
    await member.goto(first?.url ?? "/invites");
    await expect(member).toHaveURL(/\/r\/[A-Za-z0-9_-]{43}$/);
    await expect(member.getByText(`Sync A ${stampA}`)).toBeVisible();
    await expect(
      member.getByRole("link", { name: "Back to my invites" }),
    ).toBeVisible();

    // The member home lists both groups' invites and counts what needs an answer.
    await member.goto("/invites");
    await expect(member.getByText(`Sync A ${stampA}`)).toBeVisible();
    await expect(member.getByText(`Sync B ${stampB}`)).toBeVisible();
    await expect(
      member.getByRole("button", { name: "Needs your answer 2" }),
    ).toBeVisible();

    // Answer from the list: the answer page, then back.
    // The card is one link named after the meeting (screen readers announce it so).
    await member
      .getByRole("link", { name: new RegExp(`^Sync A ${stampA}`) })
      .click();
    await expect(member).toHaveURL(/\/r\//);
    await member.getByRole("radio", { name: "I can't come" }).click();
    await member.getByLabel("Reason").fill("Exam week");
    await member.getByRole("button", { name: "Confirm: I can't come" }).click();
    await expect(member.getByText("CONFIRMED")).toBeVisible();
    await member.getByRole("link", { name: "Back to my invites" }).click();
    await expect(member).toHaveURL(/\/invites$/);
    await expect(
      member.getByRole("button", { name: "Needs your answer 1" }),
    ).toBeVisible();
    await expect(member.getByText("Can't come")).toBeVisible();

    // A notification that went stale before it was sent never arrives.
    const invitee = await inviteeOf(email, slugB);
    const { data: subscription } = await adminClient()
      .from("push_subscriptions")
      .select("id")
      .like("endpoint", `%/push/${stampA}`)
      .single();
    expect(
      (
        await adminClient().from("push_deliveries").insert({
          subscription_id: subscription?.id,
          invitee_id: invitee.id,
          kind: "update",
          job_id: crypto.randomUUID(),
        })
      ).error,
    ).toBeNull();
    await adminClient()
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("id", invitee.meeting_id);
    await runWorkers(request);
    await expect
      .poll(async () => {
        const { count } = await adminClient()
          .from("push_deliveries")
          .select("id", { count: "exact", head: true })
          .eq("invitee_id", invitee.id);
        return count;
      })
      .toBe(0);
    expect(await pushesFor(stampA)).toHaveLength(2);

    // Offline later: the saved list, its time, and no way to answer.
    await member.goto("/invites");
    await expect(member.getByText(`Sync A ${stampA}`)).toBeVisible();
    await savedForOffline(member);
    await memberContext.setOffline(true);
    await member.reload();
    await expect(
      member.getByRole("status").filter({ hasText: "You're offline" }),
    ).toBeVisible();
    await expect(member.getByText(`Sync A ${stampA}`)).toBeVisible();
    await memberContext.setOffline(false);

    // Signing out wipes this device; the next person sees only their own invites.
    await member.goto("/invites");
    await member.getByRole("button", { name: "Account", exact: true }).click();
    await member.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(member).toHaveURL(/\/login/);
    expect(
      await member.evaluate(async () => ({
        caches: (await caches.keys()).filter(
          (name) => name === "tn-pages" || name === "tn-invites",
        ),
        storage: Object.keys(localStorage).filter((key) =>
          key.startsWith("tn."),
        ),
      })),
    ).toEqual({ caches: [], storage: [] });
    await signInWithCode(member, uniqueEmail("next-person"), {
      name: "Sami",
    });
    await expect(member).toHaveURL(/\/invites$/);
    await expect(member.getByText("No invites yet")).toBeVisible();
    await expect(member.getByText(`Sync A ${stampA}`)).toHaveCount(0);

    // An Owner can't delete the account while owning a workspace.
    await page.goto("/account");
    await expect(
      page.getByText("You own these workspaces.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete my account" }),
    ).toBeDisabled();

    // The member deletes the account; their words leave the organizer's meeting.
    await member.getByRole("button", { name: "Account", exact: true }).click();
    await member.getByRole("menuitem", { name: "Sign out" }).click();
    await signInWithCode(member, email, { startPath: "/login" });
    await member.goto("/account");
    await member.getByRole("button", { name: "Delete my account" }).click();
    await member.getByRole("button", { name: "Copy confirm" }).click();
    const copied = await member.evaluate(() => navigator.clipboard.readText());
    await member.getByLabel("Type confirm to delete").fill(copied);
    await member
      .getByRole("dialog")
      .getByRole("button", { name: "Delete my account" })
      .click();
    await expect(member).toHaveURL(/\/login\?deleted=1$/);
    await expect(member.getByText("Your account was deleted.")).toBeVisible();

    const { data: answer } = await adminClient()
      .from("responses")
      .select("status, reason")
      .eq("invitee_id", (await inviteeOf(email, slugA)).id)
      .single();
    expect(answer).toEqual({ status: "absent", reason: "" });
  });
});

/** The invitee of `email` in the workspace at `slug`. */
async function inviteeOf(email: string, slug: string) {
  const { data, error } = await adminClient()
    .from("meeting_invitees")
    .select("id, meeting_id, contacts!inner(email)")
    .eq("contacts.email", email)
    .eq("workspace_id", await workspaceIdOf(slug))
    .single();
  if (error) {
    throw error;
  }
  return data;
}
