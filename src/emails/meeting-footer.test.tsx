import { describe, expect, it } from "vitest";
import { meetingEmailProps } from "@/test/fixtures/emails";
import { renderCalendarConfirmEmail } from "./calendar-confirm-email";
import { renderMeetingCancelEmail } from "./meeting-cancel-email";
import { renderMeetingInviteEmail } from "./meeting-invite-email";
import { renderMeetingReminderEmail } from "./meeting-reminder-email";
import { renderMeetingUpdateEmail } from "./meeting-update-email";

const INVITES = meetingEmailProps.links.invites;

const EMAILS = {
  invite: () => renderMeetingInviteEmail(meetingEmailProps),
  update: () =>
    renderMeetingUpdateEmail({
      ...meetingEmailProps,
      meeting: { ...meetingEmailProps.meeting, footerNote: "" },
      changes: {},
      notify: true,
      reconfirm: false,
      calendar: false,
    }),
  cancel: () =>
    renderMeetingCancelEmail({ ...meetingEmailProps, calendar: false }),
  reminder: () =>
    renderMeetingReminderEmail({ ...meetingEmailProps, audience: "pending" }),
  calendar: () =>
    renderCalendarConfirmEmail({ ...meetingEmailProps, action: "request" }),
};

describe("every meeting email's footer (spec §7.4 discovery)", () => {
  it.each(Object.entries(EMAILS))(
    "the %s email points to all of the member's invites in one place",
    async (_kind, render) => {
      const { html, text } = await render();
      expect(text).toContain(`See all your invites in one place: ${INVITES}`);
      expect(html).toContain(`href="${INVITES}"`);
    },
  );
});
