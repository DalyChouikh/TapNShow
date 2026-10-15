import { describe, expect, it } from "vitest";
import type { PushItem } from "@/shared/api/push";
import { pushMessage, pushTtlSeconds, pushUrgency, pushWords } from "./message";

const item: PushItem = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "invite",
  audience: null,
  attempts: 1,
  inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
  endpoint: "https://push.example.test/x",
  p256dh: "k",
  auth: "a",
  workspaceName: "Robotics Club",
  locale: "en",
  title: "Weekly sync",
  startsAt: "2026-10-18T17:00:00.000Z",
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  locationMode: "in_person",
  locationText: "Room B12",
  onlineText: "",
  responseMode: "attendance",
  answered: false,
  needsReconfirmation: false,
};
const words = pushWords("en");

describe("pushMessage (spec §7.4)", () => {
  it("titles with the workspace and meeting, opens the invite, and tags by event", () => {
    expect(pushMessage(item, words)).toEqual({
      title: "Robotics Club · Weekly sync",
      body: "New invite: Sun 18 Oct, 18:00. Are you coming?",
      url: "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
      tag: "invite:6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    });
  });

  it("says each event in one line", () => {
    const body = (patch: Partial<PushItem>) =>
      pushMessage({ ...item, ...patch }, words).body;
    expect(body({ responseMode: "announcement" })).toBe(
      "New meeting: Sun 18 Oct, 18:00.",
    );
    expect(
      body({ kind: "update", answered: true, needsReconfirmation: true }),
    ).toBe("The time changed to Sun 18 Oct, 18:00. Still going?");
    expect(body({ kind: "update" })).toBe(
      "Details changed: Sun 18 Oct, 18:00, Room B12.",
    );
    expect(body({ kind: "cancel" })).toBe("This meeting was cancelled.");
    expect(body({ kind: "reminder", audience: "pending" })).toBe(
      "Please answer: Sun 18 Oct, 18:00.",
    );
    expect(body({ kind: "reminder", audience: "going" })).toBe(
      "Starts at 18:00, Room B12.",
    );
    expect(
      body({
        kind: "reminder",
        audience: "going",
        locationMode: "online",
        locationText: "",
        onlineText: "Club Discord",
      }),
    ).toBe("Starts at 18:00, Club Discord.");
  });

  it("never carries a personal link, an answer or a reason, and stays short", () => {
    const long = pushMessage({ ...item, title: "x".repeat(500) }, words);
    expect(long.title.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(long)).not.toMatch(/\/r\//);
  });

  it("lives until the start (a minute at least); cancellations a day; starts-soon is urgent", () => {
    const now = Date.parse("2026-10-18T16:00:00.000Z");
    expect(pushTtlSeconds(item, now)).toBe(3600);
    expect(
      pushTtlSeconds({ ...item, startsAt: "2026-10-18T16:00:30.000Z" }, now),
    ).toBe(60);
    expect(pushTtlSeconds({ ...item, kind: "cancel" }, now)).toBe(86_400);
    expect(pushUrgency({ ...item, kind: "reminder", audience: "going" })).toBe(
      "high",
    );
    expect(pushUrgency(item)).toBe("normal");
  });
});
