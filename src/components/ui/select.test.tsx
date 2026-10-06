import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

describe("Select", () => {
  it("is a labelled, styled combobox listing options", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <span id="owner-label">New Owner</span>
        <Select onValueChange={onValueChange}>
          <SelectTrigger aria-labelledby="owner-label">
            <SelectValue placeholder="Choose an Admin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a1">Ada Admin</SelectItem>
            <SelectItem value="a2">Bo Admin</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );
    const trigger = screen.getByRole("combobox", { name: "New Owner" });
    expect(trigger).toHaveTextContent("Choose an Admin");
    expect(trigger.className).toContain("shadow-brutal-sm");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Bo Admin" }));
    expect(onValueChange).toHaveBeenCalledWith("a2");
    expect(trigger).toHaveTextContent("Bo Admin");
    expect(
      document.querySelector("select:not([aria-hidden='true'])"),
    ).toBeNull();
  });
});
