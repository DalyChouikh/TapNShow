import { describe, expect, it } from "vitest";
import { renderInviteEmail } from "./invite-email";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("renderInviteEmail", () => {
  it("names the inviter, workspace and role, links the invite, and has a text part", async () => {
    const email = await renderInviteEmail({
      workspaceName: "Robotics Club",
      inviterName: "Amira",
      role: "viewer",
      link: "https://tapnshow.vercel.app/invite/abc",
      expiresInDays: 7,
    });
    expect(email.subject).toBe(
      "Amira invited you to Robotics Club on TapNShow",
    );
    expect(email.html).toContain(
      'href="https://tapnshow.vercel.app/invite/abc"',
    );
    expect(email.html).toContain("a Viewer");
    expect(email.text).toContain("https://tapnshow.vercel.app/invite/abc");
    expect(email.text).toContain("expires in 7 days");
    expect(email.html).not.toContain("box-shadow");
    expect(email.html).not.toMatch(EMOJI);
  });

  it("escapes names that contain HTML", async () => {
    const email = await renderInviteEmail({
      workspaceName: "<b>Club</b>",
      inviterName: "A & B",
      role: "admin",
      link: "https://x.test/invite/t",
      expiresInDays: 7,
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });
});
