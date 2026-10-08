import { describe, expect, it, vi } from "vitest";
import { maxDuration as dispatchRouteMax } from "@/app/api/internal/dispatch/route";
import { maxDuration as calendarRouteMax } from "@/app/api/r/[token]/calendar/route";
import { maxDuration as answerRouteMax } from "@/app/api/r/[token]/response/route";
import { maxDuration as sendRouteMax } from "@/app/api/workspaces/[slug]/meetings/[id]/send/route";
import { GMAIL_SEND_TIMEOUT_MS } from "./gmail";
import {
  DISPATCH_BUDGET_MS,
  DISPATCH_MAX_DURATION_S,
  DISPATCH_SAFETY_MARGIN_MS,
} from "./meetings";

vi.mock("@/server/dispatch/schedule-dispatch", () => ({
  scheduleDispatch: vi.fn(),
}));

describe("dispatch timing (#168)", () => {
  it("never starts a send that could outlive the function", () => {
    expect(
      DISPATCH_BUDGET_MS + GMAIL_SEND_TIMEOUT_MS + DISPATCH_SAFETY_MARGIN_MS,
    ).toBeLessThanOrEqual(DISPATCH_MAX_DURATION_S * 1000);
  });

  it("routes that run the dispatcher use the same maxDuration", () => {
    expect(dispatchRouteMax).toBe(DISPATCH_MAX_DURATION_S);
    expect(sendRouteMax).toBe(DISPATCH_MAX_DURATION_S);
    expect(answerRouteMax).toBe(DISPATCH_MAX_DURATION_S);
    expect(calendarRouteMax).toBe(DISPATCH_MAX_DURATION_S);
  });
});
