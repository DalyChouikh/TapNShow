import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { overviewFixture } from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminOverviewView } from "./admin-overview";

afterEach(() => vi.unstubAllGlobals());

describe("AdminOverviewView", () => {
  it("opens on 30 days, attention first, and switches the period", async () => {
    const fetchMock = routeFetch({
      "GET /api/admin/overview?days=30": json(overviewFixture),
      "GET /api/admin/overview?days=7": json({
        ...overviewFixture,
        current: { ...overviewFixture.current, meetingsSent: 9 },
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminOverviewView />);
    expect(
      await screen.findByRole("heading", { name: "Needs attention · 3" }),
    ).toBeInTheDocument();
    const headings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
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
    await user.click(screen.getByRole("radio", { name: "7 days" }));
    expect(
      await screen.findByText("9", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/overview?days=7",
      expect.anything(),
    );
  });

  it("keeps the last figures on screen while the next period loads", async () => {
    routeFetch({
      "GET /api/admin/overview?days=30": json(overviewFixture),
      "GET /api/admin/overview?days=90": () => new Promise<Response>(() => {}),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminOverviewView />);
    await user.click(await screen.findByRole("radio", { name: "90 days" }));
    expect(screen.getByRole("radio", { name: "90 days" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("214", { selector: "dd" })).toBeInTheDocument();
  });

  it("offers to try again when the overview can't load", async () => {
    let calls = 0;
    routeFetch({
      "GET /api/admin/overview?days=30": () => {
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
