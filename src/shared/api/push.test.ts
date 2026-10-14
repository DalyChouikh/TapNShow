import { describe, expect, it } from "vitest";
import { pushSubscriptionBodySchema, pushUnsubscribeBodySchema } from "./push";

const chrome = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};

describe("push subscription bodies", () => {
  it("accepts what a browser's PushSubscription.toJSON() gives", () => {
    expect(pushSubscriptionBodySchema.safeParse(chrome).success).toBe(true);
    expect(
      pushUnsubscribeBodySchema.safeParse({ endpoint: chrome.endpoint })
        .success,
    ).toBe(true);
  });

  it("refuses plain http, a huge endpoint and keys of the wrong length", () => {
    const bad = [
      { ...chrome, endpoint: "http://fcm.googleapis.com/fcm/send/abc" },
      { ...chrome, endpoint: `https://fcm.googleapis.com/${"a".repeat(2048)}` },
      { ...chrome, keys: { ...chrome.keys, p256dh: "short" } },
      { ...chrome, keys: { ...chrome.keys, auth: "A".repeat(40) } },
    ];
    for (const body of bad) {
      expect(pushSubscriptionBodySchema.safeParse(body).success).toBe(false);
    }
  });
});
