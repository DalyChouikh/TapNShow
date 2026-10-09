import { describe, expect, it } from "vitest";
import { EMOJI, meetingEmailProps } from "@/test/fixtures/emails";
import { renderMeetingCancelEmail } from "./meeting-cancel-email";

const PROPS = { ...meetingEmailProps, calendar: false };

describe("meeting cancellation email", () => {
  it("says the meeting is cancelled and the event removed", async () => {
    const email = await renderMeetingCancelEmail({ ...PROPS, calendar: true });
    expect(email.subject).toBe("Cancelled: Weekly sync · Fri 9 Oct, 18:00");
    expect(email.text).toContain(
      "GDG ISSAT cancelled Weekly sync on Fri 9 Oct at 18:00.",
    );
    expect(email.text).toContain("It's removed from your calendar.");
    expect(email.html).not.toContain("?choice=");
  });

  it("says nothing about a calendar the person doesn't have", async () => {
    const email = await renderMeetingCancelEmail(PROPS);
    expect(email.text).not.toContain("calendar");
  });

  it("uses no emojis and escapes user text", async () => {
    const email = await renderMeetingCancelEmail({
      ...PROPS,
      workspaceName: "<b>Club</b>",
      meeting: { ...PROPS.meeting, title: "<img src=x>" },
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).not.toContain("<img src=x>");
    expect(`${email.subject}${email.text}`).not.toMatch(EMOJI);
  });
});
