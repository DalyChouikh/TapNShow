import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ADMIN_WORKSPACE_ID, workspaceRowFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { WorkspaceTable } from "./workspace-table";

describe("WorkspaceTable", () => {
  it("lists each workspace with its Owner, numbers and state", () => {
    renderWithProviders(
      <WorkspaceTable
        rows={[
          workspaceRowFixture,
          {
            ...workspaceRowFixture,
            id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
            name: "Chess Society",
            ownerEmail: null,
            reports7d: 2,
            people7d: 0,
            suspended: false,
            sender: "broken",
          },
        ]}
      />,
    );
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Workspace",
      "Owner",
      "People",
      "Meetings",
      "Emails",
      "Reports",
      "Status",
    ]);
    const [, first, second] = within(table).getAllByRole("row");
    expect(
      within(first).getByRole("link", { name: "Robotics Club" }),
    ).toHaveAttribute("href", `/admin/workspaces/${ADMIN_WORKSPACE_ID}`);
    expect(
      within(first)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "a•••@example.test",
      "74",
      "6",
      "402",
      "3 · 4.1%",
      "SuspendedSending",
    ]);
    expect(
      within(second)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["–", "74", "6", "402", "2", "Needs reconnect"]);
  });
});
