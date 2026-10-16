import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_WORKSPACE_ID,
  workspaceDetailFixture,
} from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminWorkspaceView } from "./admin-workspace";

afterEach(() => vi.unstubAllGlobals());

const DETAIL = `GET /api/admin/workspaces/${ADMIN_WORKSPACE_ID}`;

describe("AdminWorkspaceView", () => {
  it("shows the workspace with its actions, facts and history", async () => {
    routeFetch({ [DETAIL]: json(workspaceDetailFixture()) });
    renderWithProviders(<AdminWorkspaceView id={ADMIN_WORKSPACE_ID} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Robotics Club" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
      "href",
      "/admin/workspaces",
    );
    expect(
      screen.getByRole("button", { name: "Suspend sending" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Suspension history" }),
    ).toBeInTheDocument();
  });

  it("says the workspace is gone when it was deleted", async () => {
    routeFetch({ [DETAIL]: json({ error: { code: "not_found" } }, 404) });
    renderWithProviders(<AdminWorkspaceView id={ADMIN_WORKSPACE_ID} />);
    expect(
      await screen.findByText("This workspace no longer exists."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
      "href",
      "/admin/workspaces",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
