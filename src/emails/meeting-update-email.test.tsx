import { describe, expect, it } from "vitest";
import { EMOJI, meetingEmailProps } from "@/test/fixtures/emails";
import {
  type MeetingUpdateEmailProps,
  renderMeetingUpdateEmail,
} from "./meeting-update-email";

const PROPS: MeetingUpdateEmailProps = {
  ...meetingEmailProps,
  meeting: {
    ...meetingEmailProps.meeting,
    startsAt: "2026-10-11T17:00:00Z",
    locationText: "Hall A",
    footerNote: "",
  },
  changes: {},
  notify: true,
  reconfirm: false,
  calendar: false,
};
const moved = {
  starts_at: ["2026-10-10T17:00:00+00:00", "2026-10-11T17:00:00+00:00"],
  location_text: ["Room B12", "Hall A"],
} satisfies MeetingUpdateEmailProps["changes"];

describe("meeting update email", () => {
  it("shows the marked card and asks again after a time change", async () => {
    const email = await renderMeetingUpdateEmail({
      ...PROPS,
      changes: moved,
      reconfirm: true,
      calendar: true,
    });
    expect(email.subject).toBe("Changed: Weekly sync · Sun 11 Oct, 18:00");
    expect(email.html).toContain("line-through");
    expect(email.text).toContain(
      "Before: Sat 10 Oct, 18:00–19:00 (Africa/Tunis)",
    );
    expect(email.text).toContain("Now: Sun 11 Oct, 18:00–19:00 (Africa/Tunis)");
    expect(email.text).toContain("Can you still come at the new time?");
    expect(email.html).toContain("https://app.test/r/TOKEN?choice=attending");
    expect(email.text).toContain("Your calendar is updated too.");
  });

  it("offers Change my answer, not the choice buttons, when the time stayed", async () => {
    const email = await renderMeetingUpdateEmail({
      ...PROPS,
      changes: { location_text: ["Room B12", "Hall A"] },
    });
    expect(email.html).not.toContain("?choice=");
    expect(email.text).toContain("Change my answer");
    expect(email.text).not.toContain("Your calendar is updated too.");
  });

  it("asks people to confirm when the time moved and moved back", async () => {
    const email = await renderMeetingUpdateEmail({
      ...PROPS,
      reconfirm: true,
    });
    expect(email.subject).toBe(
      "Please confirm: Weekly sync · Sun 11 Oct, 18:00",
    );
    expect(email.text).not.toContain("Before:");
    expect(email.html).toContain("?choice=attending");
  });

  it("is a short note when only the calendar event changes", async () => {
    const email = await renderMeetingUpdateEmail({
      ...PROPS,
      changes: { agenda_md: ["a", "b"] },
      notify: false,
      calendar: true,
    });
    expect(email.subject).toBe(
      "Updated in your calendar: Weekly sync · Sun 11 Oct, 18:00",
    );
    expect(email.text).toContain("This meeting is updated in your calendar.");
    expect(email.text).not.toContain("Updated");
    expect(email.html).not.toContain("?choice=");
  });

  it("uses no emojis and escapes user text", async () => {
    const email = await renderMeetingUpdateEmail({
      ...PROPS,
      workspaceName: "<b>Club</b>",
      changes: { title: ["<i>old</i>", "<img src=x>"] },
      meeting: { ...PROPS.meeting, title: "<img src=x>" },
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).not.toContain("<img src=x>");
    expect(email.html).not.toContain("<i>old</i>");
    expect(`${email.subject}${email.text}`).not.toMatch(EMOJI);
  });
});
