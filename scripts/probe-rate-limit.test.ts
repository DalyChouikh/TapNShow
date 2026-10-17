import { describe, expect, it } from "vitest";
import { probeRateLimit } from "./probe-rate-limit";

describe("probeRateLimit", () => {
  it("counts statuses and keeps the first Retry-After", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return calls > 3
        ? new Response("", { status: 429, headers: { "retry-after": "42" } })
        : new Response("{}", { status: 200 });
    };
    const result = await probeRateLimit({
      url: "https://x.app/api/me",
      total: 5,
      concurrency: 2,
      fetch,
    });
    expect(result.statuses).toEqual({ 200: 3, 429: 2 });
    expect(result.retryAfter).toBe("42");
    expect(calls).toBe(5);
  });

  it("sends exactly the total even with more workers than requests", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    };
    await probeRateLimit({
      url: "https://x.app/api/health",
      total: 3,
      concurrency: 20,
      fetch,
    });
    expect(calls).toBe(3);
  });
});
