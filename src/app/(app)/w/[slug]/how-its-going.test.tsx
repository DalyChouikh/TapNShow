import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_DEFAULT_PERIOD } from "@/config/responses";
import { periodRange } from "@/lib/responses/periods";
import { usePeriod } from "@/lib/responses/use-period";
import type { WorkspaceInsights } from "@/shared/api/insights";
import { type FetchRoute, json, routeFetch } from "@/test/fetch";
import { insightsFixture } from "@/test/fixtures/insights";
import { renderWithProviders } from "@/test/render";
import { HowItsGoing } from "./how-its-going";

const NOW = new Date("2026-10-17T13:00:00.000Z");
const base = "/api/workspaces/club-ab12";
const range = periodRange(HISTORY_DEFAULT_PERIOD, NOW, "Africa/Tunis");
const DEFAULT = `GET ${base}/insights?${new URLSearchParams({ from: range.from ?? "" })}`;
const ALL_TIME = `GET ${base}/insights`;

function Home() {
  const period = usePeriod("Africa/Tunis");
  return <HowItsGoing slug="club-ab12" period={period} />;
}

const serve = (
  insights: WorkspaceInsights,
  more: Record<string, FetchRoute> = {},
) => routeFetch({ [DEFAULT]: json(insights), ...more });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("HowItsGoing", () => {
  it("shows the three numbers for the period", async () => {
    serve(insightsFixture);
    renderWithProviders(<Home />);
    const numbers = await screen.findByRole("group", {
      name: "How it's going",
    });
    expect(numbers).toHaveTextContent(
      "2meetings23of 30came on average90%answered before the start",
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByText(/The latest/)).toBeNull();
  });

  it("refetches when the period chip changes", async () => {
    const fetchMock = serve(insightsFixture, {
      [ALL_TIME]: json({
        ...insightsFixture,
        period: { ...insightsFixture.period, meetings: 5 },
      }),
    });
    renderWithProviders(<Home />);
    await screen.findByRole("group", { name: "How it's going" });
    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(
      await screen.findByRole("group", { name: "How it's going" }),
    ).toHaveTextContent(/^5meetings/);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      DEFAULT.slice(4),
      ALL_TIME.slice(4),
    ]);
  });

  it("says No meetings in this period", async () => {
    serve({
      ...insightsFixture,
      period: {
        meetings: 0,
        cameAverage: 0,
        invitedAverage: 0,
        answeredBeforeStart: null,
      },
      chart: [],
      oftenMissing: [],
    });
    renderWithProviders(<Home />);
    expect(
      await screen.findByText("No meetings in this period."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "How it's going" }),
    ).toHaveTextContent(
      "0meetings0of 0came on averageNone yetanswered before the start",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("explains what will appear before the first meeting", async () => {
    serve({
      ...insightsFixture,
      held: 0,
      period: {
        meetings: 0,
        cameAverage: 0,
        invitedAverage: 0,
        answeredBeforeStart: null,
      },
      chart: [],
      oftenMissing: [],
    });
    renderWithProviders(<Home />);
    expect(
      await screen.findByText(
        "After your first meeting, you'll see here who came, who was late and who didn't answer.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All time" })).toBeNull();
    expect(screen.queryByRole("group", { name: "How it's going" })).toBeNull();
  });

  it("says The latest 12 of N when the period has more", async () => {
    serve({
      ...insightsFixture,
      period: { ...insightsFixture.period, meetings: 14 },
    });
    renderWithProviders(<Home />);
    expect(await screen.findByText("The latest 2 of 14")).toBeInTheDocument();
  });

  it("offers to try again when it can't load", async () => {
    let calls = 0;
    serve(insightsFixture, {
      [DEFAULT]: () => {
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify({ error: { code: "forbidden" } }), {
              status: 403,
            })
          : new Response(JSON.stringify(insightsFixture));
      },
    });
    renderWithProviders(<Home />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    expect(
      await screen.findByRole("group", { name: "How it's going" }),
    ).toBeInTheDocument();
  });

  it("keeps the chips when a period can't load, so another period can be picked", async () => {
    serve(insightsFixture, {
      [ALL_TIME]: () =>
        new Response(JSON.stringify({ error: { code: "forbidden" } }), {
          status: 403,
        }),
    });
    renderWithProviders(<Home />);
    await screen.findByRole("group", { name: "How it's going" });
    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "How it's going" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Last 3 months" }),
    );
    expect(
      await screen.findByRole("group", { name: "How it's going" }),
    ).toHaveTextContent(/^2meetings/);
  });
});
