import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Switch } from "./switch";

describe("Switch", () => {
  it("is a labelled switch that reports its state", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <label>
        <Switch defaultChecked onCheckedChange={onCheckedChange} />
        First row is headers
      </label>,
    );
    const toggle = screen.getByRole("switch", { name: "First row is headers" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
