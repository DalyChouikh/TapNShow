import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("is a styled, labelled checkbox (no native input) that toggles", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <Checkbox aria-label="Select Inès" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "Select Inès" });
    expect(box.tagName).toBe("BUTTON");
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box).toBeChecked();
    expect(
      document.querySelector(
        'input[type="checkbox"]:not([aria-hidden="true"])',
      ),
    ).toBeNull();
  });
});
