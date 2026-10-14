import { describe, expect, it } from "vitest";
import { DISPATCH_MAX_DURATION_S, DISPATCH_SAFETY_MARGIN_MS } from "./meetings";
import {
  PUSH_BACKOFF_MAX_SECONDS,
  PUSH_BUDGET_MS,
  PUSH_LEASE_SECONDS,
  PUSH_MIN_LEFT_MS,
  PUSH_REQUEST_TIMEOUT_MS,
} from "./push";

describe("push lane timing (spec §8)", () => {
  it("never starts a push request that could outlive the function", () => {
    expect(
      PUSH_BUDGET_MS -
        PUSH_MIN_LEFT_MS +
        PUSH_REQUEST_TIMEOUT_MS +
        DISPATCH_SAFETY_MARGIN_MS,
    ).toBeLessThanOrEqual(DISPATCH_MAX_DURATION_S * 1000);
    expect(PUSH_MIN_LEFT_MS).toBeGreaterThan(PUSH_REQUEST_TIMEOUT_MS);
  });

  it("leases a delivery for twice the route's maxDuration, so a live run never loses it", () => {
    expect(PUSH_LEASE_SECONDS).toBe(2 * DISPATCH_MAX_DURATION_S);
  });

  it("backs off at most as long as the database allows (push_retry_max_minutes)", () => {
    expect(PUSH_BACKOFF_MAX_SECONDS).toBe(30 * 60);
  });
});
