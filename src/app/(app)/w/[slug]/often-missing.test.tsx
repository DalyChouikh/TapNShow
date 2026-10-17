import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_DEFAULT_PERIOD } from "@/config/responses";
import { periodRange } from "@/lib/responses/periods";
import { usePeriod } from "@/lib/responses/use-period";
import type { MissingMember, WorkspaceInsights } from "@/shared/api/insights";
import { json, routeFetch } from "@/test/fetch";
import { INSIGHTS_IDS, insightsFixture } from "@/test/fixtures/insights";
import { expectNothingShown, renderWithProviders } from "@/test/render";
import { OftenMissing } from "./often-missing";
import type { HistoryPerson } from "./person-history-dialog";

const NOW = new Date("2026-10-17T13:00:00.000Z");
const base = "/api/workspaces/club-ab12";
const range = periodRange(HISTORY_DEFAULT_PERIOD, NOW, "Africa/Tunis");
const from = new URLSearchParams({ from: range.from ?? "" }).toString();
const INSIGHTS = `GET ${base}/insights?${from}`;

const onOpen = vi.fn<(person: HistoryPerson) => void>();

function Home() {
  const period = usePeriod("Africa/Tunis");
  return <OftenMissing slug="club-ab12" period={period} onOpen={onOpen} />;
}

const people: MissingMember[] = [
  {
    contactId: INSIGHTS_IDS.amira,
    fullName: "Amira Ben Salah",
    invited: 8,
    missed: 6,
    absent: 4,
    noReply: 2,
  },
  {
    contactId: "7b2a3c4d-5e6f-4a70-8b81-c2d3e4f5a611",
    fullName: "Youssef Haddad",
    invited: 8,
    missed: 5,
    absent: 3,
    noReply: 2,
  },
  {
    contactId: "7b2a3c4d-5e6f-4a70-8b81-c2d3e4f5a612",
    fullName: "Lina Gharbi",
    invited: 8,
    missed: 4,
    absent: 3,
    noReply: 1,
  },
];
const insights = (oftenMissing: MissingMember[]): WorkspaceInsights => ({
  ...insightsFixture,
  oftenMissing,
});

beforeEach(() => {
  onOpen.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("OftenMissing", () => {
  it("lists up to 3 with Missed X of Y and the split", async () => {
    routeFetch({ [INSIGHTS]: json(insights(people)) });
    renderWithProviders(<Home />);
    const card = (
      await screen.findByRole("heading", { name: "Often missing" })
    ).closest("section") as HTMLElement;
    expect(within(card).getByText("Last 3 months")).toBeInTheDocument();
    const rows = within(card).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "ABAmira Ben SalahMissed 6 of 8: 4 absent, 2 no reply",
      "YHYoussef HaddadMissed 5 of 8: 3 absent, 2 no reply",
      "LGLina GharbiMissed 4 of 8: 3 absent, 1 no reply",
    ]);
  });

  it("names a From… period by its days", async () => {
    const custom = { from: "2026-09-01", to: "2026-09-30" };
    const customRange = periodRange("custom", NOW, "Africa/Tunis", custom);
    routeFetch({
      [`GET ${base}/insights?${new URLSearchParams({ from: customRange.from ?? "", to: customRange.to ?? "" })}`]:
        json(insights(people)),
    });
    function CustomHome() {
      const period = usePeriod("Africa/Tunis", { period: "custom", custom });
      return <OftenMissing slug="club-ab12" period={period} onOpen={onOpen} />;
    }
    renderWithProviders(<CustomHome />);
    expect(await screen.findByText("1 Sep to 30 Sep")).toBeInTheDocument();
  });

  it("hides when nobody missed anything", async () => {
    const fetchMock = routeFetch({ [INSIGHTS]: json(insights([])) });
    renderWithProviders(<Home />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expectNothingShown();
  });

  it("asks Home to open the person's history", async () => {
    routeFetch({ [INSIGHTS]: json(insights(people)) });
    renderWithProviders(<Home />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Amira Ben Salah/ }),
    );
    expect(onOpen).toHaveBeenCalledWith(people[0]);
  });

  it("links to everyone's attendance", async () => {
    routeFetch({ [INSIGHTS]: json(insights(people)) });
    renderWithProviders(<Home />);
    expect(
      await screen.findByRole("link", { name: "See everyone's attendance" }),
    ).toHaveAttribute("href", "/w/club-ab12/lists?view=attendance");
  });
});
