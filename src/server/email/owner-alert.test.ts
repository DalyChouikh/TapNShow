import { describe, expect, it, vi } from "vitest";
import { type OwnerAlertInput, sendOwnerAlert } from "./owner-alert";

const APP = "https://www.tapnshow.tn";

async function sent(alert: OwnerAlertInput) {
  const send = vi.fn<
    (email: {
      to: string;
      subject: string;
      html: string;
      text: string;
    }) => Promise<void>
  >(async () => undefined);
  await sendOwnerAlert({ send }, APP, "owner@example.test", alert);
  expect(send).toHaveBeenCalledOnce();
  return send.mock.calls[0][0];
}

describe("sendOwnerAlert", () => {
  it("links Sending settings for Gmail problems", async () => {
    for (const kind of [
      "senderBroken",
      "senderRemoved",
      "senderAndSheetRemoved",
    ] as const) {
      const email = await sent({
        kind,
        workspaceName: "Robotics Club",
        workspaceSlug: "robotics-ab12",
      });
      expect(email.to).toBe("owner@example.test");
      expect(email.html).toContain(
        `href="${APP}/w/robotics-ab12/settings#sending"`,
      );
    }
  });

  it("links Sheets settings for a paused sheet", async () => {
    const email = await sent({
      kind: "sheetPaused",
      reason: "access_lost",
      workspaceName: "Robotics Club",
      workspaceSlug: "robotics-ab12",
    });
    expect(email.html).toContain(
      `href="${APP}/w/robotics-ab12/settings#sheets"`,
    );
  });

  it("links the workspace's Home when sending is paused or resumes", async () => {
    for (const kind of ["sendingSuspended", "sendingResumed"] as const) {
      const email = await sent({
        kind,
        workspaceName: "Robotics Club",
        workspaceSlug: "robotics-ab12",
      });
      expect(email.html).toContain(`href="${APP}/w/robotics-ab12"`);
      expect(email.html).not.toContain("/settings");
    }
  });
});
