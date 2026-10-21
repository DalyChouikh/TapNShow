import { describe, expect, it } from "vitest";
import { renderOwnerAlertEmail } from "./owner-alert-email";

const EMOJI = /\p{Extended_Pictographic}/u;
const SENDING = "https://www.tapnshow.tn/w/robotics-ab12/settings#sending";
const SHEETS = "https://www.tapnshow.tn/w/robotics-ab12/settings#sheets";

describe("renderOwnerAlertEmail", () => {
  it("keeps the sender-broken wording and links Sending settings", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "Robotics Club",
      linkUrl: SENDING,
    });
    expect(email.subject).toBe(
      "Gmail sending for Robotics Club needs reconnecting",
    );
    expect(email.text).toContain("Reconnect Gmail");
    expect(email.text).toContain("nothing is lost");
    expect(email.html).toContain(`href="${SENDING}"`);
    expect(email.text).toContain(SENDING);
    expect(email.html).not.toMatch(EMOJI);
  });

  it("says sending stopped because the sender's account was deleted", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderRemoved",
      workspaceName: "Robotics Club",
      linkUrl: SENDING,
    });
    expect(email.subject).toBe("Gmail sending for Robotics Club stopped");
    expect(email.text).toContain("deleted their TapNShow account");
    expect(email.text).toContain("Connect Gmail");
    expect(email.html).toContain(`href="${SENDING}"`);
    expect(email.html).not.toMatch(/token|scope|API/i);
    expect(email.html).not.toMatch(EMOJI);
  });

  it("names both when the deleted account sent the emails and held the Google Sheet", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderAndSheetRemoved",
      workspaceName: "Robotics Club",
      linkUrl: SENDING,
    });
    expect(email.subject).toBe(
      "Gmail sending and the Google Sheet of Robotics Club stopped",
    );
    expect(email.text).toContain("deleted their TapNShow account");
    expect(email.text).toContain("Connect a Gmail account");
    expect(email.text).toContain("Google Sheet");
    expect(email.html).toContain(`href="${SENDING}"`);
    expect(email.html).not.toMatch(/token|scope|API/i);
    expect(email.html).not.toMatch(EMOJI);
  });

  it("says the Google Sheet stopped updating, with the reason in plain words", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "sheetPaused",
      reason: "trashed",
      workspaceName: "Robotics Club",
      linkUrl: SHEETS,
    });
    expect(email.subject).toBe(
      "The Google Sheet of Robotics Club stopped updating",
    );
    expect(email.text).toContain("moved to the trash");
    expect(email.text).toContain("Open Settings");
    expect(email.html).toContain(`href="${SHEETS}"`);
    expect(email.html).not.toMatch(/token|scope|API/i);
    expect(email.html).not.toMatch(EMOJI);
  });

  it.each(["deleted", "access_lost", "full"] as const)(
    "has a plain line for a sheet paused as %s",
    async (reason) => {
      const email = await renderOwnerAlertEmail({
        kind: "sheetPaused",
        reason,
        workspaceName: "Robotics Club",
        linkUrl: SHEETS,
      });
      expect(email.text).toMatch(/Google Sheet/);
      expect(email.text).not.toMatch(/sheetPaused|body\./);
    },
  );

  it("escapes workspace names that contain HTML", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "<b>Club</b>",
      linkUrl: SENDING,
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });

  it("says plainly that meeting emails are paused, and links the workspace", async () => {
    const home = "https://www.tapnshow.tn/w/robotics-ab12";
    const email = await renderOwnerAlertEmail({
      kind: "sendingSuspended",
      workspaceName: "Robotics Club",
      linkUrl: home,
    });
    expect(email.subject).toBe("Meeting emails from Robotics Club are paused");
    expect(email.text).toContain("Nothing is deleted.");
    expect(email.text).toContain("Open Robotics Club");
    expect(email.html).toContain(`href="${home}"`);
    expect(email.html).not.toMatch(/suspen|token|webhook|report rate/i);
    expect(email.html).not.toMatch(EMOJI);
  });

  it("says when emails can go out again", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "sendingResumed",
      workspaceName: "Robotics Club",
      linkUrl: "https://www.tapnshow.tn/w/robotics-ab12",
    });
    expect(email.subject).toBe(
      "Meeting emails from Robotics Club can go out again",
    );
    expect(email.text).toContain(
      "except for meetings that have already started",
    );
  });

  it("says how many people may still have access, and where the sheet is", async () => {
    const link = "https://docs.google.com/spreadsheets/d/file-000001abc/edit";
    const email = await renderOwnerAlertEmail({
      kind: "sheetAccessLeft",
      left: 2,
      workspaceName: "Robotics Club",
      accountEmail: "club@example.test",
      linkUrl: link,
    });
    expect(email.subject).toBe(
      "People may still have access to a Google Sheet",
    );
    expect(email.text).toContain("couldn't remove 2 people");
    expect(email.text).toContain("club@example.test's Drive");
    expect(email.text).toContain("Robotics Club");
    expect(email.html).toContain(`href="${link}"`);
    expect(email.html).not.toMatch(/token|scope|API|permission/i);
    expect(email.html).not.toMatch(EMOJI);
  });

  it("leaves the workspace out when it no longer exists", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "sheetAccessLeft",
      left: 1,
      workspaceName: null,
      accountEmail: "club@example.test",
      linkUrl: "https://docs.google.com/spreadsheets/d/x/edit",
    });
    expect(email.text).toContain("couldn't remove 1 person");
    expect(email.text).not.toContain("null");
  });
});
