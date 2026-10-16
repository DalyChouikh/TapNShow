import { describe, expect, it } from "vitest";
import {
  EDIT_STEPS,
  INVITE_MORE_STEPS,
  WIZARD_STEPS,
  resolveStep,
  stepAfter,
  stepBefore,
  stepsFor,
} from "./wizard-steps";

describe("wizard steps", () => {
  it("uses all four steps for drafts and two for Invite more", () => {
    expect(stepsFor("draft", "draft")).toBe(WIZARD_STEPS);
    expect(stepsFor("scheduled", "invite")).toBe(INVITE_MORE_STEPS);
  });

  it("falls back to the first step for unknown or unavailable steps", () => {
    expect(resolveStep("responses", WIZARD_STEPS)).toBe("responses");
    expect(resolveStep("details", INVITE_MORE_STEPS)).toBe("audience");
    expect(resolveStep(null, WIZARD_STEPS)).toBe("details");
  });
});

describe("editing a sent meeting (M6)", () => {
  it("uses Details, Answers and Review changes", () => {
    expect(stepsFor("scheduled", "edit")).toEqual([
      "details",
      "responses",
      "changes",
    ]);
    expect(stepsFor("draft", "edit")).toBe(WIZARD_STEPS);
  });

  it("knows the step before and after", () => {
    expect(stepAfter(WIZARD_STEPS, "responses")).toBe("review");
    expect(stepAfter(EDIT_STEPS, "responses")).toBe("changes");
    expect(stepAfter(EDIT_STEPS, "changes")).toBeNull();
    expect(stepBefore(EDIT_STEPS, "details")).toBeNull();
    expect(stepBefore(EDIT_STEPS, "changes")).toBe("responses");
  });
});
