import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./progress-bar";

const fill = (bar: HTMLElement) => bar.firstElementChild as HTMLElement;

describe("ProgressBar", () => {
  it("names itself and reports how far along it is", () => {
    render(<ProgressBar label="Answered" value={24} max={30} />);
    const bar = screen.getByRole("progressbar", { name: "Answered" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "30");
    expect(bar).toHaveAttribute("aria-valuenow", "24");
    expect(fill(bar).style.width).toBe("80%");
  });

  it("stays empty with nothing to count and never overflows", () => {
    render(<ProgressBar label="Empty" value={0} max={0} />);
    expect(fill(screen.getByRole("progressbar")).style.width).toBe("0%");
  });

  it("caps a value above the maximum", () => {
    render(<ProgressBar label="Over" value={12} max={10} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(fill(bar).style.width).toBe("100%");
  });

  it("draws the divider only between filled and empty", () => {
    const { rerender } = render(
      <ProgressBar label="Steps" value={0} max={2} />,
    );
    expect(fill(screen.getByRole("progressbar"))).not.toHaveClass(
      "border-r-[length:var(--tn-border-width)]",
    );
    rerender(<ProgressBar label="Steps" value={1} max={2} />);
    expect(fill(screen.getByRole("progressbar"))).toHaveClass(
      "border-r-[length:var(--tn-border-width)]",
    );
    rerender(<ProgressBar label="Steps" value={2} max={2} />);
    expect(fill(screen.getByRole("progressbar"))).not.toHaveClass(
      "border-r-[length:var(--tn-border-width)]",
    );
  });
});
