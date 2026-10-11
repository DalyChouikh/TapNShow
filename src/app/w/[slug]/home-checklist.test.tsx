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

const sheet = (state: "off" | "on") => ({
  state,
  spreadsheetId: state === "on" ? "file-abcdefghij" : null,
  pausedReason: null,
  syncedAt: null,
  behind: false,
  createdAt: null,
  turnedOnBy: "",
  accountEmail: null,
  ownerName: "Amira Ben Ali",
  tabs: [],
});

function senderIs(sender: object | null, sheetState: "off" | "on" = "off") {
  routeFetch({
    "GET /api/workspaces/robotics-cd34/sender": json({
      sender,
      ownerName: "Amira Ben Ali",
      myConnections: [],
    }),
    "GET /api/workspaces/robotics-cd34/sheet": json(sheet(sheetState)),
  });
}

const connectLinks = async () =>
  (await screen.findAllByRole("link", { name: "Connect" })).map((link) =>
    link.getAttribute("href"),
  );

beforeEach(() => senderIs(null));

describe("HomeChecklist", () => {
  it("offers the Viewer invite now and no step is coming soon any more", () => {
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    expect(
      screen.getByRole("heading", { name: "Welcome to Robotics Club" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invite" })).toHaveAttribute(
      "href",
      "/w/robotics-cd34/settings#people",
    );
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  it("sends the Owner to Settings > Sending and Settings > Sheets, where the confirm lives", async () => {
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    await screen.findByText("Sync responses to Google Sheets");
    expect(await connectLinks()).toEqual([
      "/w/robotics-cd34/settings#sending",
      "/w/robotics-cd34/settings#sheets",
    ]);
  });

  it("shows Done once a sender is active and a sheet is on", async () => {
    senderIs(activeSender, "on");
    renderWithProviders(<HomeChecklist workspace={workspaceFixture} />);
    expect(await screen.findAllByText("Done")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Connect" })).toBeNull();
  });

  it("tells Admins the Owner connects Gmail", async () => {
    renderWithProviders(
      <HomeChecklist workspace={{ ...workspaceFixture, myRole: "admin" }} />,
    );
    expect(
      await screen.findByText("Amira Ben Ali connects Gmail"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Amira Ben Ali connects Google Sheets"),
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
