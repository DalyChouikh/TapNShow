import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportRowFixture } from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminReportsView } from "./admin-reports";

afterEach(() => vi.unstubAllGlobals());

describe("AdminReportsView", () => {
  it("lists reports 25 at a time and says when the list ends", async () => {
    routeFetch({
      "GET /api/admin/reports?limit=25": json({
        items: [reportRowFixture],
        nextCursor: "c1",
      }),
      "GET /api/admin/reports?limit=25&cursor=c1": json({
        items: [
          {
            ...reportRowFixture,
            id: "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            workspaceName: "Chess Society",
          },
        ],
        nextCursor: null,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminReportsView />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Chess Society")).toBeInTheDocument();
    expect(screen.getByText("That's every report.")).toBeInTheDocument();
  });

  it("says when there is no report", async () => {
    routeFetch({
      "GET /api/admin/reports?limit=25": json({ items: [], nextCursor: null }),
    });
    renderWithProviders(<AdminReportsView />);
    expect(
      await screen.findByText(
        "No reports. Nobody has told us about a group they didn't join.",
      ),
    ).toBeInTheDocument();
  });
});
