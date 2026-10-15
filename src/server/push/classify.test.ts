import { describe, expect, it } from "vitest";
import { classifyPushResult } from "./classify";

const NOW = Date.parse("2026-10-14T12:00:00Z");

describe("classifyPushResult (spec §8)", () => {
  it("2xx sent; 404/410 gone", () => {
    expect(
      classifyPushResult({ status: 201, retryAfter: null }, 1, NOW),
    ).toEqual({
      kind: "sent",
    });
    expect(
      classifyPushResult({ status: 410, retryAfter: null }, 1, NOW),
    ).toEqual({
      kind: "gone",
    });
    expect(
      classifyPushResult({ status: 404, retryAfter: null }, 1, NOW),
    ).toEqual({
      kind: "gone",
    });
  });

  it("429, 5xx and no answer retry, honouring Retry-After, else doubling from a minute up to 30", () => {
    expect(
      classifyPushResult({ status: 429, retryAfter: "120" }, 1, NOW),
    ).toEqual({
      kind: "retry",
      afterSeconds: 120,
    });
    expect(
      classifyPushResult({ status: 503, retryAfter: null }, 1, NOW),
    ).toEqual({
      kind: "retry",
      afterSeconds: 60,
    });
    expect(classifyPushResult({ status: null }, 3, NOW)).toEqual({
      kind: "retry",
      afterSeconds: 240,
    });
    expect(
      classifyPushResult({ status: 500, retryAfter: null }, 10, NOW),
    ).toEqual({
      kind: "retry",
      afterSeconds: 1800,
    });
    // A date-style Retry-After counts from the run's clock, not the machine's.
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(
      classifyPushResult(
        { status: 429, retryAfter: "Wed, 14 Oct 2026 12:01:30 GMT" },
        1,
        now,
      ),
    ).toEqual({ kind: "retry", afterSeconds: 90 });
  });

  it("any other answer is a bug on our side: dropped and reported", () => {
    for (const status of [400, 401, 403, 413]) {
      expect(classifyPushResult({ status, retryAfter: null }, 1, NOW)).toEqual({
        kind: "drop",
        report: true,
      });
    }
  });
});
