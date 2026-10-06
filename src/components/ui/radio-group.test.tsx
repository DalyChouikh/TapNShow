import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { RadioCard, RadioGroup } from "./radio-group";

describe("RadioGroup", () => {
  it("is a labelled radio group of styled cards that reports the choice", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <RadioGroup
        aria-label="Role"
        defaultValue="viewer"
        onValueChange={onValueChange}
      >
        <RadioCard value="viewer">Viewer</RadioCard>
        <RadioCard value="admin">Admin</RadioCard>
      </RadioGroup>,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Role" }),
    ).toBeInTheDocument();
    const viewer = screen.getByRole("radio", { name: "Viewer" });
    expect(viewer).toBeChecked();
    expect(viewer.tagName).toBe("BUTTON");
    expect(viewer.className).toContain("shadow-brutal-sm");
    await user.click(screen.getByRole("radio", { name: "Admin" }));
    expect(onValueChange).toHaveBeenCalledWith("admin");
    expect(screen.getByRole("radio", { name: "Admin" })).toBeChecked();
    expect(
      document.querySelector('input[type="radio"]:not([aria-hidden="true"])'),
    ).toBeNull();
  });
});
