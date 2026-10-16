import { describe, expect, it } from "vitest";
import { renderAdminInviteEmail } from "./admin-invite-email";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("renderAdminInviteEmail", () => {
  it("names the inviter, says what an admin does, links the invite and its expiry", async () => {
    const email = await renderAdminInviteEmail({
      inviterName: "Mohamed",
      link: "https://tapnshow.vercel.app/admin/join/abc",
      expiresInDays: 7,
    });
    expect(email.subject).toBe("Mohamed invited you to help run TapNShow");
    expect(email.html).toContain(
      'href="https://tapnshow.vercel.app/admin/join/abc"',
    );
    expect(email.text).toContain("pause a group's emails when needed");
    expect(email.text).toContain(
      "The invite works for 7 days and only for this address.",
    );
    expect(email.text).toContain("https://tapnshow.vercel.app/admin/join/abc");
    expect(email.html).not.toMatch(/token|suspen|platform_|dashboard API/i);
    expect(email.html).not.toMatch(EMOJI);
  });

  it("escapes an inviter name that contains HTML", async () => {
    const email = await renderAdminInviteEmail({
      inviterName: "<b>x</b>",
      link: "https://tapnshow.vercel.app/admin/join/abc",
      expiresInDays: 1,
    });
    expect(email.html).not.toContain("<b>x</b>");
    expect(email.text).toContain("1 day");
  });
});
