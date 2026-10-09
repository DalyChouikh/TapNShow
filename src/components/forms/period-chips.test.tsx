import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { PeriodChips } from "./period-chips";

describe("PeriodChips", () => {
  it("switches periods and shows two date pickers for a custom range", () => {
    const onChange = vi.fn();
    const { unmount } = renderWithProviders(
      <PeriodChips
        value="3m"
        onChange={onChange}
        custom={{ from: "2026-09-01", to: "2026-10-01" }}
        onCustomChange={vi.fn()}
        today="2026-10-08"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Last 3 months" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "This year" }));
    expect(onChange).toHaveBeenCalledWith("year");
    expect(screen.queryByText("From")).toBeNull();
    unmount();
    renderWithProviders(
      <PeriodChips
        value="custom"
        onChange={onChange}
        custom={{ from: "2026-09-01", to: "2026-10-01" }}
        onCustomChange={vi.fn()}
        today="2026-10-08"
      />,
    );
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
  });
});
