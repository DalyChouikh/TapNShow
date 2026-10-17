import { describe, expect, it } from "vitest";
import {
  PLATFORM_EVENT_KINDS,
  platformEventMessage,
  type PlatformEvent,
} from "./platform-events";

const base: PlatformEvent = {
  id: 1,
  kind: "auto_suspended",
  workspaceId: "w1",
  workspaceName: "Robotics Club",
  workspaceSlug: "robotics-ab12",
  facts: { reports: 3, people: 74 },
  createdAt: "2026-10-15T09:12:00Z",
  actorRole: null,
  emailedAt: null,
  attempts: 0,
};

describe("platformEventMessage", () => {
  it("an automatic suspension: amber, the rate, a link to the workspace in Admin", () => {
    const event = platformEventMessage(base, "https://www.tapnshow.tn");
    expect(event).toMatchObject({
      tone: "attention",
      title: "Sending suspended automatically",
      url: "https://www.tapnshow.tn/admin/workspaces/w1",
      source: "platform",
    });
    expect(event.fields).toEqual([
      { name: "Workspace", value: "Robotics Club" },
      { name: "Reports (7 days)", value: "3 of 74 people · 4.1%" },
    ]);
  });

  it("names who acted by role, never by name", () => {
    const event = platformEventMessage(
      { ...base, kind: "lifted", actorRole: "owner", facts: {} },
      "https://x.app",
    );
    expect(event.fields).toContainEqual({
      name: "By",
      value: "the platform owner",
    });
    expect(JSON.stringify(event)).not.toMatch(/@/);
  });

  it("covers every kind with a title", () => {
    for (const kind of PLATFORM_EVENT_KINDS) {
      expect(
        platformEventMessage(
          { ...base, kind, facts: { lane: "emails", cap: 100 } },
          "https://x.app",
        ).title.length,
      ).toBeGreaterThan(0);
    }
  });
});
