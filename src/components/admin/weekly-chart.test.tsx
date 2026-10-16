import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { overviewFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { WeeklyChart } from "./weekly-chart";

describe("WeeklyChart", () => {
  it("draws one bar per week and reads the numbers out as a table", () => {
    const { container } = renderWithProviders(
      <WeeklyChart weekly={overviewFixture.weekly} />,
    );
    expect(
      screen.getByRole("heading", { name: "Meetings sent per week" }),
    ).toBeInTheDocument();
    const bars = container.querySelectorAll("[data-bar]");
    expect(bars).toHaveLength(12);
    expect(bars[0]).toHaveStyle({ height: "0%" });
    expect(bars[11]).toHaveStyle({ height: "100%" });
    expect(bars[0].parentElement).toHaveAttribute("aria-hidden", "true");
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(13);
    expect(rows[1]).toHaveTextContent("Week of 27 Jul0");
    expect(rows[12]).toHaveTextContent("Week of 12 Oct22");
  });

  it("keeps flat bars when no meeting was sent", () => {
    const { container } = renderWithProviders(
      <WeeklyChart
        weekly={overviewFixture.weekly.map((week) => ({
          ...week,
          meetings: 0,
        }))}
      />,
    );
    for (const bar of container.querySelectorAll("[data-bar]")) {
      expect(bar).toHaveStyle({ height: "0%" });
    }
  });
});
