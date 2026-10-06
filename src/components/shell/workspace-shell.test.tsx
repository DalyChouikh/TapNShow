import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { meFixture, workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { WorkspaceShell } from "./workspace-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/chess-ab12",
  useRouter: () => ({ replace: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("WorkspaceShell", () => {
  it("shows a not-found state for unknown or foreign workspaces", async () => {
    routeFetch({
      "GET /api/me": json(meFixture),
      "GET /api/workspaces/nope-zzzz": json(
        { error: { code: "not_found" } },
        404,
      ),
    });
    renderWithProviders(
      <WorkspaceShell slug="nope-zzzz">content</WorkspaceShell>,
    );
    expect(
      await screen.findByRole("heading", { name: "Workspace not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to my workspaces" }),
    ).toHaveAttribute("href", "/welcome");
  });

  it("renders a Viewer shell without + and remembers the workspace once", async () => {
    const viewerWorkspace = {
      ...workspaceFixture,
      id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      slug: "chess-ab12",
      name: "Chess Club",
      myRole: "viewer",
    };
    const fetchMock = routeFetch({
      "GET /api/me": json(meFixture),
      "GET /api/workspaces/chess-ab12": json(viewerWorkspace),
      "PATCH /api/me": json({ ok: true }),
    });
    renderWithProviders(
      <WorkspaceShell slug="chess-ab12">content</WorkspaceShell>,
    );
    expect(await screen.findByText("content")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch workspace" }),
    ).toHaveTextContent("Viewer");
    expect(screen.queryByRole("button", { name: "New meeting" })).toBeNull();
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === "PATCH",
      );
      expect(patches).toHaveLength(1);
      expect(JSON.parse(String(patches[0][1]?.body))).toEqual({
        lastWorkspaceId: viewerWorkspace.id,
      });
    });
  });
});
