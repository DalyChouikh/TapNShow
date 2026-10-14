import { describe, expect, it } from "vitest";
import { classifyPushResult } from "./classify";

describe("classifyPushResult (spec §8)", () => {
  it("2xx sent; 404/410 gone", () => {
    expect(classifyPushResult({ status: 201, retryAfter: null }, 1)).toEqual({
      kind: "sent",
    });
    expect(classifyPushResult({ status: 410, retryAfter: null }, 1)).toEqual({
      kind: "gone",
    });
    expect(classifyPushResult({ status: 404, retryAfter: null }, 1)).toEqual({
      kind: "gone",
    });
  });

  it("429, 5xx and no answer retry, honouring Retry-After, else doubling from a minute up to 30", () => {
    expect(classifyPushResult({ status: 429, retryAfter: "120" }, 1)).toEqual({
      kind: "retry",
      afterSeconds: 120,
    });
    expect(classifyPushResult({ status: 503, retryAfter: null }, 1)).toEqual({
      kind: "retry",
      afterSeconds: 60,
    });
    expect(classifyPushResult({ status: null }, 3)).toEqual({
      kind: "retry",
      afterSeconds: 240,
    });
    expect(classifyPushResult({ status: 500, retryAfter: null }, 10)).toEqual({
      kind: "retry",
      afterSeconds: 1800,
    });
    const date = new Date(Date.now() + 90_000).toUTCString();
    const fromDate = classifyPushResult({ status: 429, retryAfter: date }, 1);
    expect(
      fromDate.kind === "retry" && fromDate.afterSeconds,
    ).toBeGreaterThanOrEqual(85);
  });

  it("any other answer is a bug on our side: dropped and reported", () => {
    for (const status of [400, 401, 403, 413]) {
      expect(classifyPushResult({ status, retryAfter: null }, 1)).toEqual({
        kind: "drop",
        report: true,
      });
    }
  });
});
