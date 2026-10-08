import { describe, expect, it } from "vitest";
import {
  renderMeetingInviteEmail,
  type MeetingInviteEmailProps,
} from "./meeting-invite-email";

const EMOJI = /\p{Extended_Pictographic}/u;
const base: MeetingInviteEmailProps = {
  workspaceName: "GDG ISSAT",
  recipientName: "Amira Ben Ali",
  senderEmail: "club@gmail.com",
  meeting: {
    title: "Weekly sync",
    agendaMd: "- Recap\n- **Hackathon** teams",
    startsAt: "2026-10-09T17:00:00.000Z",
    durationMinutes: 60,
    timezone: "Africa/Tunis",
    locationMode: "hybrid",
    locationText: "Room B12",
    onlineText: "",
    meetingUrl: "https://meet.example.test/abc",
    responseMode: "attendance",
    responseDeadline: "2026-10-09T11:00:00.000Z",
  },
  links: {
    respond: "https://tapnshow.vercel.app/r/TOKEN",
    unsubscribe: "https://tapnshow.vercel.app/u/TOKEN",
    report: "https://tapnshow.vercel.app/report/TOKEN",
  },
};

describe("renderMeetingInviteEmail", () => {
  it("has the subject, time in the meeting zone, place, agenda, three answers and the footer links", async () => {
    const email = await renderMeetingInviteEmail(base);
    expect(email.subject).toBe("Weekly sync · Fri 9 Oct, 18:00");
    expect(email.html).toContain("GDG ISSAT invites you");
    expect(email.html).toContain("Hi Amira Ben Ali,");
    expect(email.html).toContain("Fri 9 Oct, 18:00–19:00 (Africa/Tunis)");
    expect(email.html).toContain("Room B12");
    expect(email.html).toContain('href="https://meet.example.test/abc"');
    expect(email.html).toContain("<strong>Hackathon</strong>");
    for (const choice of ["attending", "late", "absent"]) {
      expect(email.html).toContain(
        `href="https://tapnshow.vercel.app/r/TOKEN?choice=${choice}"`,
      );
    }
    expect(email.html).toContain("Please answer by Fri 9 Oct, 12:00.");
    expect(email.html).toContain('href="https://tapnshow.vercel.app/u/TOKEN"');
    expect(email.html).toContain(
      'href="https://tapnshow.vercel.app/report/TOKEN"',
    );
    expect(email.html).toContain("Sent from club@gmail.com with TapNShow.");
    expect(email.text).toContain(
      "https://tapnshow.vercel.app/r/TOKEN?choice=late",
    );
    expect(email.html).not.toContain("box-shadow");
    expect(email.html).not.toMatch(EMOJI);
  });

  it("says where online and names the app on the Join button", async () => {
    const online = await renderMeetingInviteEmail({
      ...base,
      meeting: {
        ...base.meeting,
        locationMode: "online",
        onlineText: "Club Discord, Meetings voice",
        meetingUrl: "https://discord.gg/abc123",
      },
    });
    expect(online.html).toContain("Club Discord, Meetings voice");
    expect(online.html).toContain("Join on Discord");
    expect(online.html).not.toContain("Room B12");
    const placeOnly = await renderMeetingInviteEmail({
      ...base,
      meeting: {
        ...base.meeting,
        locationMode: "online",
        onlineText: "Club Discord",
        meetingUrl: "",
      },
    });
    expect(placeOnly.html).toContain("Club Discord");
    expect(placeOnly.html).not.toContain("Join ");
  });

  it("underlines the footer links so they read as links", async () => {
    const email = await renderMeetingInviteEmail(base);
    for (const href of [base.links.unsubscribe, base.links.report]) {
      const tag = new RegExp(`<a[^>]*href="${href}"[^>]*>`).exec(
        email.html,
      )?.[0];
      expect(tag).toMatch(/text-decoration:\s*underline/);
    }
  });

  it("shows two answers for RSVP and none for announcements", async () => {
    const rsvp = await renderMeetingInviteEmail({
      ...base,
      meeting: { ...base.meeting, responseMode: "rsvp" },
    });
    expect(rsvp.html).toContain("?choice=going");
    expect(rsvp.html).not.toContain("?choice=late");
    const announcement = await renderMeetingInviteEmail({
      ...base,
      meeting: {
        ...base.meeting,
        responseMode: "announcement",
        responseDeadline: null,
      },
    });
    expect(announcement.html).not.toContain("?choice=");
    expect(announcement.html).toContain("No answer needed.");
    expect(announcement.html).toContain("Add to my calendar");
    expect(announcement.html).toContain(
      'href="https://tapnshow.vercel.app/r/TOKEN"',
    );
  });

  it("escapes user text and refuses an unsafe meeting link", async () => {
    const email = await renderMeetingInviteEmail({
      ...base,
      workspaceName: "<b>Club</b>",
      meeting: {
        ...base.meeting,
        title: "<img src=x>",
        agendaMd: "<script>x</script>",
        meetingUrl: "javascript:alert(1)",
      },
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).not.toContain("<img src=x>");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain('href="javascript');
  });
});
