import { describe, expect, it } from "vitest";
import { parsePushClaim } from "./push";

/** One delivery as `push_claim` returns it (snake_case). */
function dbItem(n: number, over: Record<string, string | number | null> = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    kind: "invite",
    audience: null,
    attempts: 1,
    invitee_id: "10000000-0000-4000-8000-000000000001",
    endpoint: "https://fcm.googleapis.com/fcm/send/x",
    p256dh: "k",
    auth: "a",
    workspace_name: "GDG ISSAT",
    locale: "en",
    title: "Weekly sync",
    starts_at: "2026-10-18T17:00:00+00:00",
    timezone: "Africa/Tunis",
    duration_minutes: 60,
    location_mode: "in_person",
    location_text: "Room B12",
    online_text: "",
    response_mode: "attendance",
    answered: false,
    needs_reconfirmation: false,
    ...over,
  };
}

describe("parsePushClaim", () => {
  it("keeps every readable delivery and names the unreadable ones, so one bad row never fails the batch", () => {
    const claim = parsePushClaim({
      dropped: 2,
      items: [dbItem(1), dbItem(2, { title: null }), dbItem(3)],
    });
    expect(claim.dropped).toBe(2);
    expect(claim.items.map((item) => item.id)).toEqual([
      dbItem(1).id,
      dbItem(3).id,
    ]);
    expect(claim.unreadable).toEqual([dbItem(2).id]);
  });

  it("counts a row without a readable id as unreadable too", () => {
    const claim = parsePushClaim({
      dropped: 0,
      items: [dbItem(1, { id: "not-a-uuid" })],
    });
    expect(claim.items).toEqual([]);
    expect(claim.unreadable).toEqual([null]);
  });
});
