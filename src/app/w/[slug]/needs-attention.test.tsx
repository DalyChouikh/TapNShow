import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { NeedsAttention } from "./needs-attention";

const CONN = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const broken = {
  connectionId: CONN,
  email: "club@gmail.com",
  status: "broken",
  connectedBy: "Amira Ben Ali",
  connectedAt: "2026-10-07T10:00:00Z",
  isMine: true,
  sentLast24h: 0,
  dailyLimit: 400,
};
const draft = {
  id: MEETING_IDS.meeting,
  title: "Weekly sync",
  startsAt: null,
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "draft",
  locationMode: "in_person",
  responseMode: "attendance",
  counts: {
    invited: 0,
    sent: 0,
    queued: 0,
    attending: 0,
    late: 0,
    absent: 0,
    noReply: 0,
  },
};

const sheet = (state: "off" | "on" | "paused") => ({
  state,
  spreadsheetId: state === "off" ? null : "file-abcdefghij",
  pausedReason: state === "paused" ? "trashed" : null,
  syncedAt: null,
  behind: false,
  createdAt: null,
  turnedOnBy: "",
  accountEmail: null,
  ownerName: "Amira Ben Ali",
  tabs: [],
});

function setup(
  sender: object | null,
  meetings: object[],
  workspace = workspaceFixture,
  sheetState: "off" | "on" | "paused" = "off",
) {
  routeFetch({
    "GET /api/workspaces/robotics-cd34/sender": json({
      sender,
      ownerName: "Amira Ben Ali",
      myConnections: [],
    }),
    "GET /api/workspaces/robotics-cd34/meetings?tab=drafts&limit=1": json({
      items: meetings,
      nextCursor: null,
    }),
    "GET /api/workspaces/robotics-cd34/sheet": json(sheet(sheetState)),
  });
  return renderWithProviders(<NeedsAttention workspace={workspace} />);
}

describe("NeedsAttention", () => {
  it("asks the Owner to reconnect a broken sender", async () => {
    setup(broken, []);
    expect(
      await screen.findByText(
        "Gmail sending needs reconnecting. Queued invites are paused.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      "/api/integrations/google/connect?workspace=robotics-cd34&purpose=sending",
    );
  });

  it("tells an Admin to ask the Owner", async () => {
    setup(broken, [], { ...workspaceFixture, myRole: "admin" });
    expect(
      await screen.findByText("Ask Amira Ben Ali to reconnect Gmail."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
  });

  it("points the Owner at a draft waiting for a sender", async () => {
    setup(null, [draft]);
    expect(
      await screen.findByText("A draft is waiting: connect Gmail to send it."),
    ).toBeInTheDocument();
  });

  it("renders nothing when all is well", async () => {
    setup({ ...broken, status: "active" }, [draft]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("tells the Owner the Google Sheet stopped updating, below the Gmail line", async () => {
    setup(broken, [], workspaceFixture, "paused");
    const sheetLine = await screen.findByText(
      "The Google Sheet stopped updating.",
    );
    const gmailLine = screen.getByText(
      "Gmail sending needs reconnecting. Queued invites are paused.",
    );
    expect(
      gmailLine.compareDocumentPosition(sheetLine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/w/robotics-cd34/settings#sheets",
    );
  });

  it("shows a paused sheet even when Gmail is fine", async () => {
    setup({ ...broken, status: "active" }, [], workspaceFixture, "paused");
    expect(
      await screen.findByText("The Google Sheet stopped updating."),
    ).toBeInTheDocument();
  });

  it("shows Admins nothing about the sheet", async () => {
    setup(
      { ...broken, status: "active" },
      [],
      { ...workspaceFixture, myRole: "admin" },
      "paused",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Needs attention")).toBeNull();
  });
});
