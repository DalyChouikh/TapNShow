import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overviewFixture } from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminOverviewView } from "./admin-overview";

const mocks = vi.hoisted(() => ({
  replace: vi.fn<(href: string, options?: { scroll?: boolean }) => void>(),
  params: { value: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(mocks.params.value),
}));

const OVERVIEW = "GET /api/admin/overview";
const THIRTY_DAYS = `${OVERVIEW}?from=2026-09-17&to=2026-10-16`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.params.value = "";
});

describe("AdminOverviewView", () => {
  it("opens on the last 30 days, attention first, then the figures and their chart", async () => {
    routeFetch({ [THIRTY_DAYS]: json(overviewFixture) });
    renderWithProviders(<AdminOverviewView />);
    expect(
      await screen.findByRole("heading", { name: "Needs attention · 3" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual([
      "Overview",
      "Needs attention · 3",
      "Figures",
      "Meetings sent per week",
      "System health",
    ]);
    expect(screen.getByRole("radio", { name: "30 days" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("switches the figures and the chart together, and keeps the period in the address", async () => {
    const fetchMock = routeFetch({
      [THIRTY_DAYS]: json(overviewFixture),
      [`${OVERVIEW}?from=2025-11-01&to=2026-10-16`]: json({
        ...overviewFixture,
        current: { ...overviewFixture.current, meetingsSent: 9 },
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminOverviewView />);
    await user.click(await screen.findByRole("radio", { name: "12 months" }));
    expect(
      await screen.findByText("9", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/overview?from=2025-11-01&to=2026-10-16",
      expect.anything(),
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenLastCalledWith("/admin?period=12m", {
        scroll: false,
      }),
    );
  });

  it("opens on the period the address names", async () => {
    mocks.params.value = "period=90d";
    routeFetch({
      [`${OVERVIEW}?from=2026-07-19&to=2026-10-16`]: json(overviewFixture),
    });
    renderWithProviders(<AdminOverviewView />);
    expect(
      await screen.findByRole("radio", { name: "90 days" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      await screen.findByRole("heading", { name: "Needs attention · 3" }),
    ).toBeInTheDocument();
  });

  it("picks a custom range from the current one", async () => {
    const fetchMock = routeFetch({
      [THIRTY_DAYS]: json(overviewFixture),
      [`${OVERVIEW}?from=2026-09-20&to=2026-10-16`]: json(overviewFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminOverviewView />);
    await user.click(await screen.findByRole("radio", { name: "Custom" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenLastCalledWith(
        "/admin?from=2026-09-17&to=2026-10-16",
        { scroll: false },
      ),
    );
    await user.click(screen.getByRole("button", { name: /^From / }));
    await user.click(
      screen.getByRole("button", { name: /September 20th, 2026/ }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/overview?from=2026-09-20&to=2026-10-16",
        expect.anything(),
      ),
    );
    expect(screen.getByRole("button", { name: /^To / })).toBeInTheDocument();
  });

  it("keeps the last figures on screen while the next period loads", async () => {
    routeFetch({
      [THIRTY_DAYS]: json(overviewFixture),
      [`${OVERVIEW}?from=2026-07-19&to=2026-10-16`]: () =>
        new Promise<Response>(() => {}),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminOverviewView />);
    await user.click(await screen.findByRole("radio", { name: "90 days" }));
    expect(screen.getByRole("radio", { name: "90 days" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("214", { selector: "dd" })).toBeInTheDocument();
    // …and says they are loading, so they aren't read as the new period's.
    expect(screen.getByRole("region", { name: "Figures" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("keeps the period switch when a period can't load, so another one can be picked", async () => {
    routeFetch({
      [THIRTY_DAYS]: json(overviewFixture),
      [`${OVERVIEW}?from=2026-07-19&to=2026-10-16`]: () =>
        new Response(JSON.stringify({ error: { code: "invalid_input" } }), {
          status: 400,
        }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminOverviewView />);
    await user.click(await screen.findByRole("radio", { name: "90 days" }));
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "30 days" }));
    expect(
      await screen.findByText("214", { selector: "dd" }),
    ).toBeInTheDocument();
  });

  it("moves a preset on to the new day after midnight UTC", async () => {
    vi.setSystemTime(new Date("2026-10-16T23:59:50Z"));
    const fetchMock = routeFetch({
      [THIRTY_DAYS]: json(overviewFixture),
      [`${OVERVIEW}?from=2026-09-18&to=2026-10-17`]: json(overviewFixture),
    });
    const { rerender } = renderWithProviders(<AdminOverviewView />);
    await screen.findByRole("heading", { name: "Needs attention · 3" });
    vi.setSystemTime(new Date("2026-10-17T00:00:10Z"));
    rerender(<AdminOverviewView />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/overview?from=2026-09-18&to=2026-10-17",
        expect.anything(),
      ),
    );
  });

  it("offers to try again when the overview can't load", async () => {
    let calls = 0;
    routeFetch({
      [THIRTY_DAYS]: () => {
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify({ error: { code: "internal" } }), {
              status: 400,
            })
          : new Response(JSON.stringify(overviewFixture));
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminOverviewView />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Needs attention · 3" }),
    ).toBeInTheDocument();
  });
});
