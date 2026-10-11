import { describe, expect, it } from "vitest";
import { maxDuration as callbackRouteMax } from "@/app/api/integrations/google/callback/route";
import { maxDuration as retryRouteMax } from "@/app/api/workspaces/[slug]/sheet/retry/route";
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

  it("the routes that run the sheet worker (Try again, the connect callback) use the dispatcher routes' maxDuration", () => {
    expect(retryRouteMax).toBe(DISPATCH_MAX_DURATION_S);
    expect(callbackRouteMax).toBe(DISPATCH_MAX_DURATION_S);
  });
});
