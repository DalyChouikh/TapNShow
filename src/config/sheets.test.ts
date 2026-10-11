import { describe, expect, it } from "vitest";
import { DISPATCH_MAX_DURATION_S, DISPATCH_SAFETY_MARGIN_MS } from "./meetings";
import {
  SHEET_BUDGET_MS,
  SHEET_LEASE_SECONDS,
  SHEET_MIN_LEFT_MS,
  SHEET_REQUEST_TIMEOUT_MS,
} from "./sheets";

describe("sheet worker timing (spec §8)", () => {
  it("never starts a Google request that could outlive the function", () => {
    expect(
      SHEET_BUDGET_MS -
        SHEET_MIN_LEFT_MS +
        SHEET_REQUEST_TIMEOUT_MS +
        DISPATCH_SAFETY_MARGIN_MS,
    ).toBeLessThanOrEqual(DISPATCH_MAX_DURATION_S * 1000);
  });

  it("leases a sheet for twice the route's maxDuration, so a live run never loses it", () => {
    expect(SHEET_LEASE_SECONDS).toBe(2 * DISPATCH_MAX_DURATION_S);
  });
});
