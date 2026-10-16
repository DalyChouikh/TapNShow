import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ADMIN_WORKSPACE_ID, workspaceRowFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { WorkspaceRow } from "./workspace-row";

describe("WorkspaceRow", () => {
  it("links to the workspace and shows its state and numbers", () => {
    renderWithProviders(<WorkspaceRow row={workspaceRowFixture} />);
    const link = screen.getByRole("link", { name: /Robotics Club/ });
    expect(link).toHaveAttribute(
      "href",
      `/admin/workspaces/${ADMIN_WORKSPACE_ID}`,
    );
    expect(link).toHaveTextContent("Suspended");
    expect(link).toHaveTextContent("3 reports · 4.1%");
    expect(link).toHaveTextContent("Sending");
    expect(link).toHaveTextContent("74 people · 6 meetings · 96% delivered");
    expect(link).not.toHaveTextContent("Sheet");
  });

  it("gives no report rate when nobody was emailed in the window", () => {
    renderWithProviders(
      <WorkspaceRow row={{ ...workspaceRowFixture, people7d: 0 }} />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("3 reports");
    expect(screen.getByRole("link")).not.toHaveTextContent("100%");
  });

  it("leaves out reports and the delivered rate when there are none", () => {
    renderWithProviders(
      <WorkspaceRow
        row={{
          ...workspaceRowFixture,
          suspended: false,
          reports7d: 0,
          people7d: 0,
          emails30d: 0,
          failed30d: 0,
          meetings30d: 1,
          contacts: 1,
          sender: "none",
          sheet: "paused",
        }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).not.toHaveTextContent("Suspended");
    expect(link).not.toHaveTextContent("report");
    expect(link).toHaveTextContent("No sender");
    expect(link).toHaveTextContent("Sheet paused");
    expect(link).toHaveTextContent("1 person · 1 meeting");
    expect(link).not.toHaveTextContent("delivered");
  });
});
