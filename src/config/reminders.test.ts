import { describe, expect, it } from "vitest";
import {
  REMINDER_GOING_CHOICES,
  REMINDER_GOING_DEFAULT,
  REMINDER_PENDING_CHOICES,
  REMINDER_PENDING_DEFAULT,
} from "./reminders";

describe("reminder choices", () => {
  it("offers the defaults among the choices", () => {
    expect(REMINDER_PENDING_CHOICES).toContain(REMINDER_PENDING_DEFAULT);
    expect(REMINDER_GOING_CHOICES).toContain(REMINDER_GOING_DEFAULT);
  });
});
