import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { TimePicker } from "./time-picker";

describe("TimePicker", () => {
  it("picks from the 15-minute list", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TimePicker id="t" label="Time" value="18:00" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Time.*18:00/ }));
    await userEvent.click(screen.getByRole("option", { name: "18:15" }));
    expect(onChange).toHaveBeenCalledWith("18:15");
  });

  it("jumps to a typed time and offers an exact one", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TimePicker id="t" label="Time" value={null} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Pick a time/ }));
    await userEvent.type(
      screen.getByPlaceholderText("Type a time, e.g. 1830"),
      "1820",
    );
    await userEvent.click(screen.getByRole("option", { name: "Use 18:20" }));
    expect(onChange).toHaveBeenCalledWith("18:20");
  });
});

describe("TimePicker error", () => {
  it("describes the error and switches to dark text on the danger fill", () => {
    renderWithProviders(
      <TimePicker
        id="t"
        label="Time"
        value={null}
        error="Pick a time."
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Pick a time/ });
    expect(trigger).toHaveAccessibleDescription("Pick a time.");
    expect(trigger).toHaveAttribute("data-invalid");
    expect(trigger).not.toHaveAttribute("aria-invalid");
    expect(trigger.className).toContain("data-invalid:text-on-fill");
  });
});
