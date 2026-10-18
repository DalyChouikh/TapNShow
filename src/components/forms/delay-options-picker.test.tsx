import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { DelayOptionsPicker } from "./delay-options-picker";

function Harness({
  durationMinutes,
  initial,
  disabled = false,
  onChange,
}: {
  durationMinutes: number;
  initial: number[];
  disabled?: boolean;
  onChange: (next: number[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DelayOptionsPicker
      id="delays"
      legend="Late by"
      durationMinutes={durationMinutes}
      value={value}
      disabled={disabled}
      hint="Pick up to 6. Each is shorter than the meeting."
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function setup(durationMinutes: number, initial: number[], disabled = false) {
  const onChange = vi.fn<(next: number[]) => void>();
  renderWithProviders(
    <Harness
      durationMinutes={durationMinutes}
      initial={initial}
      disabled={disabled}
      onChange={onChange}
    />,
  );
  const group = screen.getByRole("group", { name: "Late by" });
  const chip = (name: string) => within(group).getByRole("button", { name });
  const other = async (typed: string) => {
    await userEvent.click(chip("Other"));
    await userEvent.type(screen.getByLabelText("Minutes late"), typed);
  };
  return { onChange, group, chip, other };
}

describe("DelayOptionsPicker", () => {
  it("offers the chips shorter than the meeting, and Other", () => {
    const { group, chip } = setup(30, [5, 10]);
    for (const name of ["5 min", "10 min", "15 min", "20 min", "Other"]) {
      expect(chip(name)).toBeInTheDocument();
    }
    expect(within(group).queryByRole("button", { name: "30 min" })).toBeNull();
  });

  it("adds a typed late time with Add, as a pressed chip in order", async () => {
    const { onChange, chip, other } = setup(30, [5, 10]);
    await other("25");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith([5, 10, 25]);
    expect(chip("25 min")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Minutes late")).toBeNull();
  });

  it("adds with Enter too, and keeps only digits", async () => {
    const { onChange, other } = setup(30, [5]);
    await other("2a5{Enter}");
    expect(onChange).toHaveBeenLastCalledWith([5, 25]);
  });

  it("removes a typed late time when its chip is tapped", async () => {
    const { onChange, group, chip } = setup(30, [5, 25]);
    await userEvent.click(chip("25 min"));
    expect(onChange).toHaveBeenLastCalledWith([5]);
    expect(within(group).queryByRole("button", { name: "25 min" })).toBeNull();
  });

  it("says why a typed time can't be added, and adds nothing", async () => {
    const { onChange, other } = setup(30, [5, 25]);
    await other("30{Enter}");
    expect(screen.getByText("Enter 1 to 29 minutes.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Minutes late"));
    await userEvent.type(screen.getByLabelText("Minutes late"), "25{Enter}");
    expect(
      screen.getByText("Already one of the late choices."),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a seventh late choice", async () => {
    const { onChange, other } = setup(60, [5, 10, 15, 20, 30, 45]);
    await other("50{Enter}");
    expect(
      screen.getByText("Up to 6 late choices: remove one first."),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets the shortest meeting take a typed time, though no chip fits", async () => {
    const { onChange, group, other } = setup(5, []);
    expect(within(group).queryByRole("button", { name: "5 min" })).toBeNull();
    await other("4{Enter}");
    expect(onChange).toHaveBeenLastCalledWith([4]);
  });

  it("locks every chip and Other when disabled", () => {
    const { chip } = setup(60, [5, 25], true);
    for (const name of ["5 min", "25 min", "Other"]) {
      expect(chip(name)).toBeDisabled();
    }
  });
});
