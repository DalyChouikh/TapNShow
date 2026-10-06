import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { HomeChecklist } from "./home-checklist";

describe("HomeChecklist", () => {
  it("offers the Viewer invite now and marks later steps as coming soon", () => {
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    expect(
      screen.getByRole("heading", { name: "Welcome to Robotics Club" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invite" })).toHaveAttribute(
      "href",
      "/w/robotics-cd34/settings#people",
    );
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  });

  it("links the import step to the roster", () => {
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    expect(screen.getByRole("link", { name: "Import" })).toHaveAttribute(
      "href",
      "/w/robotics-cd34/lists",
    );
  });

  it("shows Viewers a read-only welcome instead", () => {
    renderWithProviders(
      <HomeChecklist workspace={{ ...workspaceFixture, myRole: "viewer" }} />,
    );
    expect(
      screen.getByRole("heading", { name: "You're a Viewer in Robotics Club" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Invite" })).toBeNull();
  });
});
