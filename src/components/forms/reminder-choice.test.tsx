import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ReminderChoice } from "./reminder-choice";

function setup(value: number | null, onChange = vi.fn()) {
  renderWithProviders(
    <ReminderChoice
      id="reminder-pending"
      label="Remind people who haven't answered"
      hint="Before the deadline, or before the start if there is none."
      value={value}
      choices={[1, 2, 6, 24, 48]}
      fallback={24}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("ReminderChoice", () => {
  it("shows only the switch when off, and switching on picks the default", async () => {
    const onChange = setup(null);
    expect(screen.queryByRole("radio")).toBeNull();
    await userEvent.click(
      screen.getByRole("switch", {
        name: "Remind people who haven't answered",
      }),
    );
    expect(onChange).toHaveBeenCalledWith(24);
  });

  it("shows the hours as one choice, and switching off sends null", async () => {
    const onChange = setup(24);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "24 h" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "6 h" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await userEvent.click(screen.getByRole("radio", { name: "6 h" }));
    expect(onChange).toHaveBeenLastCalledWith(6);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
