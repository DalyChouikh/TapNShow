import { describe, expect, it } from "vitest";
import { changeSetSchema } from "./meeting-changes";

describe("changeSetSchema", () => {
  it("reads old/new pairs of any column type", () => {
    const changes = {
      title: ["Sync", "Weekly sync"],
      duration_minutes: [60, 90],
      reason_required: [true, false],
      response_deadline: ["2026-10-10T11:00:00+00:00", null],
    };
    expect(changeSetSchema.parse(changes)).toEqual(changes);
  });

  it("refuses anything but a pair", () => {
    expect(changeSetSchema.safeParse({ title: ["only one"] }).success).toBe(
      false,
    );
    expect(changeSetSchema.safeParse({ title: [{}, "x"] }).success).toBe(false);
  });
});
