import { describe, expect, it } from "vitest";
import {
  INVITE_MORE_STEPS,
  WIZARD_STEPS,
  resolveStep,
  stepsFor,
} from "./wizard-steps";

describe("wizard steps", () => {
  it("uses all four steps for drafts and two for Invite more", () => {
    expect(stepsFor("draft")).toBe(WIZARD_STEPS);
    expect(stepsFor("scheduled")).toBe(INVITE_MORE_STEPS);
  });

  it("falls back to the first step for unknown or unavailable steps", () => {
    expect(resolveStep("responses", WIZARD_STEPS)).toBe("responses");
    expect(resolveStep("details", INVITE_MORE_STEPS)).toBe("audience");
    expect(resolveStep(null, WIZARD_STEPS)).toBe("details");
  });
});
