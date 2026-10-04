import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
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
});
