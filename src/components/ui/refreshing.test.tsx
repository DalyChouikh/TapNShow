import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Refreshing } from "./refreshing";

describe("Refreshing", () => {
  it("keeps the last answer on screen, dimmed and busy, while the next one loads", () => {
    const { rerender } = render(
      <Refreshing busy={false} className="flex">
        <p>Last period</p>
      </Refreshing>,
    );
    const box = screen.getByText("Last period").parentElement;
    expect(box).toHaveAttribute("aria-busy", "false");
    expect(box).not.toHaveClass("opacity-60");
    expect(box).toHaveClass("flex");
    rerender(
      <Refreshing busy className="flex">
        <p>Last period</p>
      </Refreshing>,
    );
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box).toHaveClass("opacity-60");
  });
});
