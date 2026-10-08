import { describe, expect, it } from "vitest";
import { renderSenderBrokenEmail } from "./sender-broken-email";

const EMOJI = /\p{Extended_Pictographic}/u;
const SETTINGS = "https://tapnshow.vercel.app/w/gdg-ab12/settings#sending";

describe("renderSenderBrokenEmail", () => {
  it("names the workspace and links its Sending settings", async () => {
    const email = await renderSenderBrokenEmail({
      workspaceName: "GDG ISSAT",
      settingsUrl: SETTINGS,
    });
    expect(email.subject).toBe(
      "Gmail sending for GDG ISSAT needs reconnecting",
    );
    expect(email.html).toContain(`href="${SETTINGS}"`);
    expect(email.text).toContain(SETTINGS);
    expect(email.text).toContain("nothing is lost");
    expect(email.html).not.toMatch(EMOJI);
  });

  it("escapes workspace names that contain HTML", async () => {
    const email = await renderSenderBrokenEmail({
      workspaceName: "<b>Club</b>",
      settingsUrl: SETTINGS,
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });
});
