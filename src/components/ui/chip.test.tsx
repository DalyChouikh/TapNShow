import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Chip } from "./chip";

function Harness() {
  const [pressed, setPressed] = useState(false);
  return (
    <Chip tone="warning" pressed={pressed} onPressedChange={setPressed}>
      10-20 min
    </Chip>
  );
}

describe("Chip", () => {
  it("toggles aria-pressed", async () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "10-20 min" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("can be one choice of a radio group, and disabled", async () => {
    const onPressedChange = vi.fn();
    renderWithProviders(
      <Chip role="radio" pressed disabled onPressedChange={onPressedChange}>
        24 h
      </Chip>,
    );
    const chip = screen.getByRole("radio", { name: "24 h" });
    expect(chip).toHaveAttribute("aria-checked", "true");
    expect(chip).not.toHaveAttribute("aria-pressed");
    await userEvent.click(chip);
    expect(onPressedChange).not.toHaveBeenCalled();
  });
});
