import { describe, expect, it } from "vitest";
import { PRIVACY_POLICY_URL } from "@/config/legal";
import { meetingEmailProps } from "@/test/fixtures/emails";
import { renderAdminInviteEmail } from "./admin-invite-email";
import { renderCalendarConfirmEmail } from "./calendar-confirm-email";
import { renderInviteEmail } from "./invite-email";
import { renderMeetingCancelEmail } from "./meeting-cancel-email";
import { renderMeetingInviteEmail } from "./meeting-invite-email";
import { renderMeetingReminderEmail } from "./meeting-reminder-email";
import { renderMeetingUpdateEmail } from "./meeting-update-email";
import { renderOwnerAlertEmail } from "./owner-alert-email";
import { renderSignInCodeTemplate } from "./sign-in-code-email";

/** Every email TapNShow sends that has a plain-text part. */
const EMAILS = {
  "meeting invite": () => renderMeetingInviteEmail(meetingEmailProps),
  "meeting update": () =>
    renderMeetingUpdateEmail({
      ...meetingEmailProps,
      meeting: { ...meetingEmailProps.meeting, footerNote: "" },
      changes: {},
      notify: true,
      reconfirm: false,
      calendar: false,
    }),
  "meeting cancel": () =>
    renderMeetingCancelEmail({ ...meetingEmailProps, calendar: false }),
  "meeting reminder": () =>
    renderMeetingReminderEmail({ ...meetingEmailProps, audience: "pending" }),
  "calendar confirm": () =>
    renderCalendarConfirmEmail({ ...meetingEmailProps, action: "request" }),
  "workspace invite": () =>
    renderInviteEmail({
      workspaceName: "Robotics Club",
      inviterName: "Amira",
      role: "viewer",
      link: "https://www.tapnshow.tn/invite/abc",
      expiresInDays: 7,
    }),
  "admin invite": () =>
    renderAdminInviteEmail({
      inviterName: "Mohamed",
      link: "https://www.tapnshow.tn/admin/join/abc",
      expiresInDays: 7,
    }),
  "owner alert": () =>
    renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "Robotics Club",
      linkUrl: "https://www.tapnshow.tn/w/robotics-ab12/settings",
    }),
};

describe("every email links the privacy policy in its footer (spec §7.18)", () => {
  it("links production's policy, from every environment", () => {
    expect(PRIVACY_POLICY_URL).toBe("https://www.tapnshow.tn/privacy");
  });

  it.each(Object.entries(EMAILS))("the %s email", async (_kind, render) => {
    const { html, text } = await render();
    expect(html).toContain(`href="${PRIVACY_POLICY_URL}"`);
    expect(text).toContain(`Privacy ${PRIVACY_POLICY_URL}`);
  });

  it("the sign-in code template (Supabase sends it; HTML only)", async () => {
    const { html } = await renderSignInCodeTemplate();
    expect(html).toContain(`href="${PRIVACY_POLICY_URL}"`);
  });
});
