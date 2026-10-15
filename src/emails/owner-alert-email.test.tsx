import { describe, expect, it } from "vitest";
import { renderOwnerAlertEmail } from "./owner-alert-email";

const EMOJI = /\p{Extended_Pictographic}/u;
const SENDING = "https://tapnshow.vercel.app/w/robotics-ab12/settings#sending";
const SHEETS = "https://tapnshow.vercel.app/w/robotics-ab12/settings#sheets";

describe("renderOwnerAlertEmail", () => {
  it("keeps the sender-broken wording and links Sending settings", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "Robotics Club",
      settingsUrl: SENDING,
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
      settingsUrl: SENDING,
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
      settingsUrl: SENDING,
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
      settingsUrl: SHEETS,
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
        settingsUrl: SHEETS,
      });
      expect(email.text).toMatch(/Google Sheet/);
      expect(email.text).not.toMatch(/sheetPaused|body\./);
    },
  );

  it("escapes workspace names that contain HTML", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "<b>Club</b>",
      settingsUrl: SENDING,
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });
});
