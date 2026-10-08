import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { MeetingsList } from "./meetings-list";

const soon = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
const counts = (over: object = {}) => ({
  invited: 0,
  sent: 0,
  queued: 0,
  attending: 0,
  late: 0,
  absent: 0,
  noReply: 0,
  ...over,
});
const sending = {
  id: MEETING_IDS.meeting,
  title: "Weekly sync",
  startsAt: soon,
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "scheduled",
  locationMode: "in_person",
  responseMode: "attendance",
  counts: counts({ invited: 2, sent: 1, queued: 1 }),
};
const answered = {
  ...sending,
  id: "7b2d3c4e-5f60-4a71-8b92-c3d4e5f6a7b8",
  title: "Hackathon prep",
  // One email failed: the card still shows the answers, not "29 of 30 sent".
  counts: counts({
    invited: 30,
    sent: 29,
    attending: 17,
    late: 4,
    absent: 3,
    noReply: 6,
  }),
};
const draft = {
  ...sending,
  id: MEETING_IDS.invitee,
  title: "",
  status: "draft",
  counts: counts(),
};
const base = "/api/workspaces/robotics-cd34/meetings";

function setup(workspace = workspaceFixture) {
  const fetchMock = routeFetch({
    "GET /api/workspaces/robotics-cd34": json(workspace),
    [`GET ${base}?tab=upcoming&limit=50`]: json({
      items: [sending, answered],
      nextCursor: null,
    }),
    [`GET ${base}?tab=drafts&limit=50`]: json({
      items: [draft],
      nextCursor: null,
    }),
    [`GET ${base}?tab=past&limit=50`]: json({
      items: [
        {
          ...answered,
          id: "8c3d4e5f-6a71-4b82-9ca3-d4e5f6a7b8c9",
          title: "Kickoff",
        },
      ],
      nextCursor: "c1",
    }),
    [`GET ${base}?tab=past&limit=50&cursor=c1`]: json({
      items: [
        {
          ...answered,
          id: "9d4e5f6a-7b82-4c93-8db4-e5f6a7b8c9d0",
          title: "Retro",
        },
      ],
      nextCursor: null,
    }),
  });
  renderWithProviders(<MeetingsList slug="robotics-cd34" />);
  return fetchMock;
}

describe("MeetingsList", () => {
  it("shows upcoming meetings with send progress or answers, and drafts on their tab", async () => {
    setup();
    const upcoming = await screen.findByRole("link", { name: /Weekly sync/ });
    expect(upcoming).toHaveAttribute(
      "href",
      `/w/robotics-cd34/meetings/${MEETING_IDS.meeting}`,
    );
    expect(within(upcoming).getByText("1 of 2 sent")).toBeInTheDocument();
    const withAnswers = screen.getByRole("link", { name: /Hackathon prep/ });
    expect(
      within(withAnswers).getByText("17 going · 4 late · 6 no reply"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Drafts" }));
    expect(
      await screen.findByRole("link", { name: /Untitled draft/ }),
    ).toHaveAttribute(
      "href",
      `/w/robotics-cd34/meetings/${MEETING_IDS.invitee}/edit`,
    );
    expect(
      screen.getByRole("button", { name: "Draft actions for Untitled draft" }),
    ).toBeInTheDocument();
  });

  it("loads more past meetings on Show more", async () => {
    setup();
    await screen.findByRole("link", { name: /Weekly sync/ });
    await userEvent.click(screen.getByRole("radio", { name: "Past" }));
    await screen.findByRole("link", { name: /Kickoff/ });
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      await screen.findByRole("link", { name: /Retro/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("gives Viewers no Drafts tab and no New meeting", async () => {
    setup({ ...workspaceFixture, myRole: "viewer" });
    await screen.findByRole("link", { name: /Weekly sync/ });
    expect(screen.queryByRole("radio", { name: "Drafts" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New meeting" })).toBeNull();
  });
});
