import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_WORKSPACE_ID, reportRowFixture } from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { ReportRow } from "./report-row";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ReportRow", () => {
  it("shows the workspace's 7-day rate and when, and marks it reviewed", async () => {
    const fetchMock = routeFetch({
      [`POST /api/admin/reports/${reportRowFixture.id}/reviewed`]: json({
        ok: true,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ReportRow report={reportRowFixture} />, {
      toaster: true,
    });
    expect(screen.getByText("Robotics Club")).toBeInTheDocument();
    expect(
      screen.getByText("3 of 74 people · 4.1% in 7 days · 2 hours ago"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open workspace" }),
    ).toHaveAttribute("href", `/admin/workspaces/${ADMIN_WORKSPACE_ID}`);
    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Report marked reviewed"),
    ).toBeInTheDocument();
  });

  it("shows who reviewed it and offers no button", () => {
    renderWithProviders(
      <ReportRow
        report={{
          ...reportRowFixture,
          reviewedAt: "2026-10-16T09:00:00+00:00",
          reviewedByName: "Sami",
        }}
      />,
    );
    expect(screen.getByText("Reviewed by Sami")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
  });

  it("counts reports without a rate when nobody was emailed, and a reviewer who left", () => {
    renderWithProviders(
      <ReportRow
        report={{
          ...reportRowFixture,
          people7d: 0,
          reviewedAt: "2026-10-16T09:00:00+00:00",
          reviewedByName: null,
        }}
      />,
    );
    expect(
      screen.getByText("3 reports in 7 days · 2 hours ago"),
    ).toBeInTheDocument();
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
  });
});
