import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { DatePicker } from "./date-picker";

describe("DatePicker", () => {
  it("opens a month grid, picks a day as yyyy-MM-dd and closes", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <DatePicker
        id="d"
        label="Date"
        value="2026-10-07"
        today="2026-10-07"
        min="2026-10-07"
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /^Date Wed 7 Oct$/,
    });
    await userEvent.click(trigger);
    await userEvent.click(
      screen.getByRole("button", { name: /October 9th, 2026/ }),
    );
    expect(onChange).toHaveBeenCalledWith("2026-10-09");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("disables days before the minimum and shows a placeholder without a value", async () => {
    renderWithProviders(
      <DatePicker
        id="d"
        label="Date"
        value={null}
        today="2026-10-07"
        min="2026-10-07"
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Pick a date/ }));
    expect(
      screen.getByRole("button", { name: /October 6th, 2026/ }),
    ).toBeDisabled();
  });

  it("names the year only when it is not this year, on one line", () => {
    renderWithProviders(
      <DatePicker
        id="d"
        label="Date"
        value="2027-01-08"
        today="2026-10-07"
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /^Date Fri 8 Jan 2027$/,
    });
    expect(trigger).toHaveClass("whitespace-nowrap");
  });
});
