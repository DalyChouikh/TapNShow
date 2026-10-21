import { screen, within } from "@testing-library/react";
import { addDays } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SVG_FILL_CLASS } from "@/components/ui/fill";
import { OUTCOME_TONES } from "@/design/tokens";
import type { InsightsMeeting } from "@/shared/api/insights";
import { INSIGHTS_IDS, insightsFixture } from "@/test/fixtures/insights";
import { setCoarsePointer } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import { InsightsChart } from "./insights-chart";

const mocks = vi.hoisted(() => ({ width: 600 as number | null }));
vi.mock("@/hooks/use-element-width", () => ({
  useElementWidth: () => [() => undefined, mocks.width],
}));

beforeEach(() => {
  mocks.width = 600;
});

/** `count` weekly meetings, the newest on Mon 12 Oct (18:00 Africa/Tunis). */
function weekly(count: number): InsightsMeeting[] {
  return Array.from({ length: count }, (_, n) => ({
    ...insightsFixture.chart[0],
    id: `7b2a3c4d-5e6f-4a70-8b81-c2d3e4f5a7${String(n).padStart(2, "0")}`,
    title: `Weekly sync ${n + 1}`,
    startsAt: addDays(
      new Date("2026-10-12T17:00:00Z"),
      7 * (n - count + 1),
    ).toISOString(),
  }));
}

const dateLabels = () =>
  within(screen.getByTestId("chart-dates"))
    .getAllByText(/\d+ \w{3}/)
    .map((label) => label.textContent);

describe("InsightsChart", () => {
  it("draws one linked bar per meeting with a label naming every count", () => {
    renderWithProviders(
      <InsightsChart slug="club-ab12" meetings={insightsFixture.chart} />,
    );
    const bars = screen.getAllByRole("link");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAccessibleName(
      "Weekly sync 1, Mon 5 Oct: 18 came, 4 late, 5 absent, 3 no reply",
    );
    // #417: named once, by its own tooltip, so a screen reader doesn't read it twice; and a ring
    // drawn inside the link shows keyboard focus where SVG links get no outline (Safari).
    expect(bars[0]).not.toHaveAttribute("aria-label");
    expect(bars[0]).not.toHaveAccessibleDescription();
    expect(bars[0].querySelector("[data-focus-ring]")).not.toBeNull();
    expect(bars[0]).toHaveAttribute(
      "href",
      `/w/club-ab12/meetings/${INSIGHTS_IDS.firstMeeting}`,
    );
    expect(
      screen.getByText(
        "Check-ins where you marked them, otherwise the answers.",
      ),
    ).toBeInTheDocument();
    for (const name of ["Came", "Late", "Absent", "No reply"]) {
      expect(
        within(screen.getByRole("list", { name: "Legend" })).getByText(name),
      ).toBeInTheDocument();
    }
  });

  it("labels dates in each meeting's own time zone", () => {
    const [meeting] = insightsFixture.chart;
    renderWithProviders(
      <InsightsChart
        slug="club-ab12"
        meetings={[
          {
            ...meeting,
            startsAt: "2026-10-05T23:30:00Z",
            timezone: "Africa/Tunis",
          },
          {
            ...meeting,
            id: INSIGHTS_IDS.secondMeeting,
            startsAt: "2026-10-05T23:30:00Z",
            timezone: "America/New_York",
          },
        ]}
      />,
    );
    expect(dateLabels()).toEqual(["6 Oct", "5 Oct"]);
  });

  it("thins labels below 400 px, keeping the newest", () => {
    mocks.width = 360;
    const { unmount } = renderWithProviders(
      <InsightsChart slug="club-ab12" meetings={weekly(12)} />,
    );
    expect(dateLabels()).toEqual([
      "3 Aug",
      "17 Aug",
      "31 Aug",
      "14 Sep",
      "28 Sep",
      "12 Oct",
    ]);
    expect(screen.getAllByRole("link")).toHaveLength(12);
    unmount();

    mocks.width = 600;
    renderWithProviders(
      <InsightsChart slug="club-ab12" meetings={weekly(12)} />,
    );
    expect(dateLabels()).toHaveLength(12);
  });

  it("segments use the tile tones, with No reply hatched", () => {
    renderWithProviders(
      <InsightsChart slug="club-ab12" meetings={insightsFixture.chart} />,
    );
    const [bar] = screen.getAllByRole("link");
    const segment = (key: keyof typeof OUTCOME_TONES) =>
      bar.querySelector(`[data-segment="${key}"]`);
    for (const key of Object.keys(
      OUTCOME_TONES,
    ) as (keyof typeof OUTCOME_TONES)[]) {
      expect(segment(key)).toHaveClass(SVG_FILL_CLASS[OUTCOME_TONES[key]]);
    }
    expect(bar.querySelector('[data-hatch="noReply"]')).not.toBeNull();
  });

  it("on a touch screen, bars narrower than 44 px aren't links but keep their labels", () => {
    setCoarsePointer(true);
    mocks.width = 360;
    renderWithProviders(
      <InsightsChart slug="club-ab12" meetings={weekly(12)} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    const bars = screen.getAllByRole("img");
    expect(bars).toHaveLength(12);
    expect(bars[11]).toHaveAccessibleName(
      "Weekly sync 12, Mon 12 Oct: 18 came, 4 late, 5 absent, 3 no reply",
    );
    expect(bars[11]).not.toHaveAttribute("aria-label");
  });

  it("on a touch screen, bars wide enough for 44 px stay links", () => {
    setCoarsePointer(true);
    mocks.width = 360;
    renderWithProviders(
      <InsightsChart slug="club-ab12" meetings={insightsFixture.chart} />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
