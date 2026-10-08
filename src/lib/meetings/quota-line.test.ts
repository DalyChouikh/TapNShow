import { describe, expect, it } from "vitest";
import { quotaLine } from "./quota-line";

describe("quotaLine", () => {
  it("sends everything now when the budget allows", () => {
    expect(quotaLine({ toSend: 30, sentLast24h: 0, dailyLimit: 400 })).toEqual({
      now: 30,
      queued: 0,
      leftAfter: 370,
    });
  });

  it("queues what does not fit in the rolling window", () => {
    expect(
      quotaLine({ toSend: 30, sentLast24h: 390, dailyLimit: 400 }),
    ).toEqual({ now: 10, queued: 20, leftAfter: 0 });
    expect(quotaLine({ toSend: 5, sentLast24h: 410, dailyLimit: 400 })).toEqual(
      { now: 0, queued: 5, leftAfter: 0 },
    );
  });
});
