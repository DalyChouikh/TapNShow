import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_WORKSPACE_ID, overviewFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { AttentionList } from "./attention-list";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T09:12:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("AttentionList", () => {
  it("lists new reports, each suspension and a nearly full platform email budget", () => {
    renderWithProviders(
      <AttentionList attention={overviewFixture.attention} />,
    );
    expect(
      screen.getByRole("heading", { name: "Needs attention · 3" }),
    ).toBeInTheDocument();
    const reports = screen.getByRole("link", { name: /2 new reports/ });
    expect(reports).toHaveAttribute("href", "/admin/reports");
    expect(reports).toHaveTextContent(
      "People said they never joined these groups.",
    );
    const suspended = screen.getByRole("link", {
      name: /Robotics Club is suspended/,
    });
    expect(suspended).toHaveAttribute(
      "href",
      `/admin/workspaces/${ADMIN_WORKSPACE_ID}`,
    );
    expect(suspended).toHaveTextContent("Automatically, 2 hours ago");
    expect(
      screen.getByText("Platform email: 82 of 100 today"),
    ).toBeInTheDocument();
  });

  it("names an admin's suspension and leaves out a quiet email budget", () => {
    renderWithProviders(
      <AttentionList
        attention={{
          newReports: 0,
          openSuspensions: [
            {
              ...overviewFixture.attention.openSuspensions[0],
              reason: "platform_admin",
            },
          ],
          platformEmailUsed: 79,
          platformEmailCap: 100,
        }}
      />,
    );
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list).toHaveTextContent("By an admin, 2 hours ago");
    expect(screen.queryByText(/new report/)).toBeNull();
    expect(screen.queryByText(/Platform email/)).toBeNull();
  });

  it("shows the first three suspensions and links to the rest", () => {
    const suspension = overviewFixture.attention.openSuspensions[0];
    renderWithProviders(
      <AttentionList
        attention={{
          ...overviewFixture.attention,
          newReports: 0,
          platformEmailUsed: 0,
          openSuspensions: Array.from({ length: 5 }, (_, index) => ({
            ...suspension,
            workspaceId: `${index}${suspension.workspaceId.slice(1)}`,
            workspaceName: `Club ${index + 1}`,
          })),
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Needs attention · 5" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("Club 4 is suspended")).toBeNull();
    expect(
      screen.getByRole("link", { name: /2 more workspaces are suspended/ }),
    ).toHaveAttribute("href", "/admin/workspaces?filter=suspended");
  });

  it("says when nothing needs the admin", () => {
    renderWithProviders(
      <AttentionList
        attention={{
          newReports: 0,
          openSuspensions: [],
          platformEmailUsed: 0,
          platformEmailCap: 100,
        }}
      />,
    );
    expect(
      screen.getByText("Nothing needs you right now."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
