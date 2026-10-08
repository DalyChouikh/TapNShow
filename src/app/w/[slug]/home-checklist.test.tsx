import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { HomeChecklist } from "./home-checklist";

const activeSender = {
  connectionId: "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60",
  email: "club@gmail.com",
  status: "active",
  connectedBy: "Amira Ben Ali",
  connectedAt: "2026-10-07T10:00:00Z",
  isMine: true,
  sentLast24h: 0,
  dailyLimit: 400,
};

function senderIs(sender: object | null) {
  routeFetch({
    "GET /api/workspaces/robotics-cd34/sender": json({
      sender,
      ownerName: "Amira Ben Ali",
      myConnections: [],
    }),
  });
}

beforeEach(() => senderIs(null));

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
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
  });

  it("sends the Owner to Settings > Sending, then marks Gmail done", async () => {
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    expect(
      await screen.findByRole("link", { name: "Connect" }),
    ).toHaveAttribute("href", "/w/robotics-cd34/settings#sending");
  });

  it("shows Done once a sender is active", async () => {
    senderIs(activeSender);
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect" })).toBeNull();
  });

  it("tells Admins the Owner connects Gmail", async () => {
    renderWithProviders(
      <HomeChecklist workspace={{ ...workspaceFixture, myRole: "admin" }} />,
    );
    expect(
      await screen.findByText("Amira Ben Ali connects Gmail"),
    ).toBeInTheDocument();
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
