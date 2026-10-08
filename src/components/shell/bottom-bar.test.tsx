import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { BottomBar } from "./bottom-bar";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/club-ab12/lists" }));

describe("BottomBar", () => {
  it("marks the current section and links + to a new meeting", () => {
    renderWithProviders(<BottomBar role="owner" slug="club-ab12" />);
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "New meeting" })).toHaveAttribute(
      "href",
      "/w/club-ab12/meetings/new",
    );
  });

  it("has no + for Viewers", () => {
    renderWithProviders(<BottomBar role="viewer" slug="club-ab12" />);
    expect(screen.queryByRole("link", { name: "New meeting" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New meeting" })).toBeNull();
  });
});
