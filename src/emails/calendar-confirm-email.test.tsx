import { describe, expect, it } from "vitest";
import { renderCalendarConfirmEmail } from "./calendar-confirm-email";

const PROPS = {
  action: "request" as const,
  workspaceName: "GDG ISSAT",
  recipientName: "Amira",
  senderEmail: "club@gmail.com",
  meeting: {
    title: "Weekly sync",
    agendaMd: "",
    startsAt: "2026-10-09T17:00:00Z",
    durationMinutes: 60,
    timezone: "Africa/Tunis",
    locationMode: "in_person" as const,
    locationText: "Room B12",
    onlineText: "",
    meetingUrl: "",
    responseMode: "attendance" as const,
    responseDeadline: null,
  },
  links: {
    respond: "https://app.test/r/TOKEN",
    unsubscribe: "https://app.test/u/TOKEN",
    report: "https://app.test/report/TOKEN",
  },
};

describe("calendar confirmation email", () => {
  it("names the meeting in the subject and links to change the answer", async () => {
    const email = await renderCalendarConfirmEmail(PROPS);
    expect(email.subject).toBe(
      "In your calendar: Weekly sync · Fri 9 Oct, 18:00",
    );
    expect(email.html).toContain("https://app.test/r/TOKEN");
    expect(email.text).toContain("Not in your calendar yet?");
    expect(email.html).toContain("https://app.test/u/TOKEN");
  });

  it("says the event was removed after a switch to Absent", async () => {
    const email = await renderCalendarConfirmEmail({
      ...PROPS,
      action: "cancel",
    });
    expect(email.subject).toBe(
      "Removed from your calendar: Weekly sync · Fri 9 Oct, 18:00",
    );
    expect(email.text).not.toContain("Not in your calendar yet?");
  });

  it("has no Change-your-answer link for an announcement", async () => {
    const email = await renderCalendarConfirmEmail({
      ...PROPS,
      meeting: { ...PROPS.meeting, responseMode: "announcement" },
    });
    expect(email.html).not.toContain("https://app.test/r/TOKEN");
  });

  it("uses no emojis and escapes user text", async () => {
    const email = await renderCalendarConfirmEmail({
      ...PROPS,
      workspaceName: "<b>Club</b>",
      meeting: { ...PROPS.meeting, title: "<img src=x>" },
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).not.toContain("<img src=x>");
    expect(`${email.subject}${email.text}`).not.toMatch(
      /\p{Extended_Pictographic}/u,
    );
  });
});
