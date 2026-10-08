import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { MeetingsList } from "./meetings-list";

const soon = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
const summaries = [
  {
    id: MEETING_IDS.meeting,
    title: "Weekly sync",
    startsAt: soon,
    timezone: "Africa/Tunis",
    durationMinutes: 60,
    status: "scheduled",
    locationMode: "in_person",
    invitedCount: 2,
    sentCount: 1,
  },
  {
    id: MEETING_IDS.invitee,
    title: "",
    startsAt: soon,
    timezone: "Africa/Tunis",
    durationMinutes: 60,
    status: "draft",
    locationMode: "in_person",
    invitedCount: 0,
    sentCount: 0,
  },
];

function setup(workspace = workspaceFixture) {
  routeFetch({
    "GET /api/workspaces/robotics-cd34": json(workspace),
    "GET /api/workspaces/robotics-cd34/meetings": json(summaries),
  });
  renderWithProviders(<MeetingsList slug="robotics-cd34" />);
}

describe("MeetingsList", () => {
  it("shows upcoming meetings with their send progress, and drafts on their tab", async () => {
    setup();
    const upcoming = await screen.findByRole("link", { name: /Weekly sync/ });
    expect(upcoming).toHaveAttribute(
      "href",
      `/w/robotics-cd34/meetings/${MEETING_IDS.meeting}`,
    );
    expect(within(upcoming).getByText("1 of 2 sent")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Drafts" }));
    expect(
      screen.getByRole("link", { name: /Untitled draft/ }),
    ).toHaveAttribute(
      "href",
      `/w/robotics-cd34/meetings/${MEETING_IDS.invitee}/edit`,
    );
    expect(
      screen.getByRole("button", { name: "Draft actions for Untitled draft" }),
    ).toBeInTheDocument();
  });

  it("gives Viewers no Drafts tab and no New meeting", async () => {
    setup({ ...workspaceFixture, myRole: "viewer" });
    await screen.findByRole("link", { name: /Weekly sync/ });
    expect(screen.queryByRole("radio", { name: "Drafts" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New meeting" })).toBeNull();
  });
});
