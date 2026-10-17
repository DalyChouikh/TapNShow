import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminOverview } from "@/shared/api/admin";
import { overviewFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { MeetingsChart } from "./meetings-chart";

// Twelve weeks from 27 Jul with 0, 2, 4, … 22 meetings: 132 in all, the last one 22, the period
// ending on 16 Oct.
const weeks = overviewFixture.series;
const TODAY = "2026-10-16";
const LATER = "2026-10-20";

function days(count: number, first: string): AdminOverview["series"] {
  const start = Date.parse(`${first}T00:00:00Z`);
  return {
    unit: "day",
    points: Array.from({ length: count }, (_, index) => {
      const day = new Date(start + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return { start: day, end: day, meetings: index % 3 };
    }),
  };
}

/** The axis' bar labels and the month or year row under them. */
function axis(container: HTMLElement) {
  const text = (selector: string) =>
    Array.from(container.querySelectorAll(selector)).map(
      (label) => label.textContent,
    );
  return { bars: text("[data-bar-label]"), groups: text("[data-group-label]") };
}

describe("MeetingsChart", () => {
  it("leads with the current week's number and the period's total", () => {
    renderWithProviders(<MeetingsChart series={weeks} today={TODAY} />);
    expect(
      screen.getByRole("heading", { name: "Meetings sent per week" }),
    ).toBeInTheDocument();
    expect(screen.getByText("132 meetings in this period")).toBeInTheDocument();
    expect(screen.getByTestId("chart-readout")).toHaveTextContent(
      "22meetingsThis week so far",
    );
  });

  it("names the last week by its days when the period ended before today", () => {
    renderWithProviders(<MeetingsChart series={weeks} today={LATER} />);
    expect(screen.getByTestId("chart-readout")).toHaveTextContent(
      "22meetings12 – 16 Oct",
    );
  });

  it("dates every bar, with the month written where it changes", () => {
    const { container } = renderWithProviders(
      <MeetingsChart series={weeks} today={TODAY} />,
    );
    expect(axis(container)).toEqual({
      bars: [
        "27",
        "3",
        "10",
        "17",
        "24",
        "31",
        "7",
        "14",
        "21",
        "28",
        "5",
        "12",
      ],
      groups: ["Jul", "Aug", "Sep", "Oct"],
    });
  });

  it("draws days for a month, each one dated", () => {
    const { container } = renderWithProviders(
      <MeetingsChart series={days(30, "2026-09-17")} today={TODAY} />,
    );
    expect(
      screen.getByRole("heading", { name: "Meetings sent per day" }),
    ).toBeInTheDocument();
    const { bars, groups } = axis(container);
    expect(bars).toHaveLength(30);
    expect(bars.slice(0, 3)).toEqual(["17", "18", "19"]);
    expect(groups).toEqual(["Sep", "Oct"]);
    expect(screen.getByTestId("chart-readout")).toHaveTextContent(
      "Today so far",
    );
  });

  it("draws months with the year written where it changes", () => {
    const series: AdminOverview["series"] = {
      unit: "month",
      points: [
        ["2025-11-01", "2025-11-30"],
        ["2025-12-01", "2025-12-31"],
        ["2026-01-01", "2026-01-31"],
        ["2026-02-01", "2026-02-28"],
      ].map(([start, end], index) => ({ start, end, meetings: index })),
    };
    const { container } = renderWithProviders(
      <MeetingsChart series={series} today={TODAY} />,
    );
    expect(axis(container)).toEqual({
      bars: ["Nov", "Dec", "Jan", "Feb"],
      groups: ["2025", "2026"],
    });
    expect(screen.getByTestId("chart-readout")).toHaveTextContent(
      "3meetingsFebruary 2026",
    );
  });

  it("draws columns on a clean scale and labels the busiest one", () => {
    const { container } = renderWithProviders(
      <MeetingsChart series={weeks} today={TODAY} />,
    );
    const ticks = Array.from(container.querySelectorAll("[data-tick]")).map(
      (tick) => tick.textContent,
    );
    expect(ticks).toEqual(["30", "15", "0"]);
    const bars = container.querySelectorAll("[data-bar]");
    expect(bars).toHaveLength(11);
    expect(bars[bars.length - 1]).toHaveStyle({ height: "73.333%" });
    expect(container.querySelectorAll("[data-peak]")).toHaveLength(1);
    const peak = container.querySelector("[data-peak]");
    expect(peak).toHaveTextContent("22");
    // On the bar's top, over its centre, pulled back by the same share so it stays on the plot.
    expect(peak).toHaveStyle({
      bottom: "73.333%",
      left: "95.833%",
      transform: "translateX(-95.833%)",
    });
  });

  it("moves between bars with the arrow keys and says which one is chosen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MeetingsChart series={weeks} today={TODAY} />);
    const slider = screen.getByRole("slider", { name: "Choose a week" });
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "This week so far: 22 meetings",
    );
    slider.focus();
    await user.keyboard("{ArrowLeft}");
    expect(slider).toHaveAttribute("aria-valuetext", "5 – 11 Oct: 20 meetings");
    expect(screen.getByTestId("chart-readout")).toHaveTextContent(
      "20meetings5 – 11 Oct",
    );
    await user.keyboard("{Home}");
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "27 Jul – 2 Aug: 0 meetings",
    );
    await user.keyboard("{End}");
    expect(slider).toHaveAttribute("aria-valuenow", "11");
  });

  it("chooses the bar under a finger or the pointer", () => {
    renderWithProviders(<MeetingsChart series={weeks} today={TODAY} />);
    const slider = screen.getByRole("slider", { name: "Choose a week" });
    slider.getBoundingClientRect = () => new DOMRect(0, 0, 120, 160);
    fireEvent.pointerDown(slider, { clientX: 15 });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    fireEvent.pointerMove(slider, { clientX: 119 });
    expect(slider).toHaveAttribute("aria-valuenow", "11");
  });

  it("goes back to the latest bar when the period changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <MeetingsChart series={weeks} today={TODAY} />,
    );
    const slider = screen.getByRole("slider", { name: "Choose a week" });
    slider.focus();
    await user.keyboard("{Home}");
    rerender(<MeetingsChart series={days(7, "2026-10-10")} today={TODAY} />);
    expect(
      screen.getByRole("slider", { name: "Choose a day" }),
    ).toHaveAttribute("aria-valuenow", "6");
  });

  it("keeps every number in a table for screen readers", () => {
    renderWithProviders(<MeetingsChart series={weeks} today={TODAY} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(13);
    expect(rows[1]).toHaveTextContent("27 Jul – 2 Aug0");
    expect(rows[12]).toHaveTextContent("This week so far22");
  });

  it("says so when no meeting was sent, on a scale that still reads", () => {
    const { container } = renderWithProviders(
      <MeetingsChart
        series={{
          ...weeks,
          points: weeks.points.map((point) => ({ ...point, meetings: 0 })),
        }}
        today={TODAY}
      />,
    );
    expect(
      screen.getByText("No meetings sent in this period."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(0);
    expect(container.querySelector("[data-peak]")).toBeNull();
  });

  it("names a month the period cuts by its days, a whole one by its name", () => {
    const series: AdminOverview["series"] = {
      unit: "month",
      points: [
        { start: "2025-10-20", end: "2025-10-31", meetings: 4 },
        { start: "2025-11-01", end: "2025-11-30", meetings: 9 },
      ],
    };
    renderWithProviders(<MeetingsChart series={series} today={TODAY} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("20 – 31 Oct 20254");
    expect(rows[2]).toHaveTextContent("November 20259");
  });

  it("writes large scales short, so the scale fits beside the bars on a phone", () => {
    const { container } = renderWithProviders(
      <MeetingsChart
        series={{
          ...weeks,
          points: weeks.points.map((point, index) => ({
            ...point,
            meetings: index * 250,
          })),
        }}
        today={TODAY}
      />,
    );
    const ticks = Array.from(container.querySelectorAll("[data-tick]")).map(
      (tick) => tick.textContent,
    );
    expect(ticks).toEqual(["3K", "1.5K", "0"]);
    expect(container.querySelector("[data-peak]")).toHaveTextContent("2,750");
  });
});
