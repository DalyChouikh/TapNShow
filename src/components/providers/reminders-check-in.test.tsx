import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  checkIn: vi.fn<(now: Date) => Promise<void>>(async () => undefined),
}));
vi.mock("@/lib/push/client", () => ({ checkInReminders: push.checkIn }));

const { RemindersCheckIn } = await import("./reminders-check-in");

describe("RemindersCheckIn", () => {
  it("checks in once per app load and shows nothing", () => {
    const { container, rerender } = render(<RemindersCheckIn />);
    rerender(<RemindersCheckIn />);
    expect(push.checkIn).toHaveBeenCalledOnce();
    expect(push.checkIn.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(container).toBeEmptyDOMElement();
  });
});
