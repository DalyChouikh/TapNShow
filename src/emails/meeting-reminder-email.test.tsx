import { describe, expect, it } from "vitest";
import { EMOJI, meetingEmailProps } from "@/test/fixtures/emails";
import {
  type MeetingReminderEmailProps,
  renderMeetingReminderEmail,
} from "./meeting-reminder-email";

const PROPS: MeetingReminderEmailProps = {
  ...meetingEmailProps,
  audience: "pending",
};
const withDeadline = {
  ...PROPS.meeting,
  responseDeadline: "2026-10-09T12:00:00Z",
};

describe("meeting reminder email", () => {
  it("asks someone who hasn't answered, with the deadline while it is ahead", async () => {
    const email = await renderMeetingReminderEmail({
      ...PROPS,
      meeting: withDeadline,
    });
    expect(email.subject).toBe("Reminder: Weekly sync · Fri 9 Oct, 18:00");
    expect(email.text).toContain("Please answer by Fri 9 Oct, 13:00.");
    expect(email.html).toContain("?choice=late");
  });

  it("drops the deadline once it has passed", async () => {
    const email = await renderMeetingReminderEmail({
      ...PROPS,
      now: new Date("2026-10-09T13:00:00Z"),
      meeting: withDeadline,
    });
    expect(email.text).toContain("Please let GDG ISSAT know if you're coming.");
    expect(email.text).not.toContain("Please answer by");
  });

  it("tells Going people when and where", async () => {
    const email = await renderMeetingReminderEmail({
      ...PROPS,
      audience: "going",
    });
    expect(email.subject).toBe("See you at 18:00: Weekly sync");
    expect(email.text).toContain("See you on Fri 9 Oct at 18:00.");
    expect(email.text).toContain("Room B12");
    expect(email.text).toContain("Change my answer");
    expect(email.html).not.toContain("?choice=");
  });

  it("uses no emojis and escapes user text", async () => {
    const email = await renderMeetingReminderEmail({
      ...PROPS,
      workspaceName: "<b>Club</b>",
      meeting: { ...PROPS.meeting, title: "<img src=x>" },
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).not.toContain("<img src=x>");
    expect(`${email.subject}${email.text}`).not.toMatch(EMOJI);
  });
});
