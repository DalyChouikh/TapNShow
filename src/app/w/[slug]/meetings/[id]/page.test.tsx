import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import {
  meetingFixture,
  MEETING_IDS,
  peopleFixture,
  resultsFixture,
} from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import MeetingPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "robotics-cd34", id: MEETING_IDS.meeting }),
  useRouter: () => ({ replace }),
}));

const base = "/api/workspaces/robotics-cd34";
const future = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();

const meetingBase = `${base}/meetings/${MEETING_IDS.meeting}`;

function setup(
  meeting: object,
  workspace = workspaceFixture,
  results: object = resultsFixture,
) {
  const fetchMock = routeFetch({
    [`GET ${base}`]: json(workspace),
    [`GET ${meetingBase}`]: json(meeting),
    [`GET ${meetingBase}/results`]: json(results),
    [`GET ${meetingBase}/people?filter=all&limit=50`]: json({
      items: peopleFixture,
      nextCursor: null,
    }),
    [`GET ${meetingBase}/people?filter=late&limit=50`]: json({
      items: [peopleFixture[0]],
      nextCursor: null,
    }),
  });
  renderWithProviders(<MeetingPage />);
  return fetchMock;
}

const sentResults = {
  ...resultsFixture,
  emails: { total: 30, queued: 0, sent: 29, skipped: 0, failed: 1, unknown: 0 },
  answers: {
    attending: 17,
    late: 4,
    absent: 3,
    notAttending: 0,
    noReply: 6,
    calendarRequested: 0,
  },
};

beforeEach(() => vi.clearAllMocks());

describe("/w/[slug]/meetings/[id]", () => {
  it("shows the meeting, its progress and Invite more", async () => {
    setup({ ...meetingFixture, status: "scheduled", startsAt: future });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Weekly sync" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Sending 1 of 2")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Invite more people" }),
    ).toHaveAttribute(
      "href",
      `/w/robotics-cd34/meetings/${MEETING_IDS.meeting}/edit?step=audience`,
    );
  });

  it("gives Viewers no Invite more", async () => {
    setup(
      { ...meetingFixture, status: "scheduled", startsAt: future },
      { ...workspaceFixture, myRole: "viewer" },
    );
    expect(await screen.findByText("Sending 1 of 2")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Invite more people" }),
    ).toBeNull();
  });

  it("sends a draft to the editor", async () => {
    setup(meetingFixture);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/w/robotics-cd34/meetings/${MEETING_IDS.meeting}/edit`,
      ),
    );
  });

  it("says where online and names the app on the Join link", async () => {
    setup({
      ...meetingFixture,
      status: "scheduled",
      startsAt: future,
      locationMode: "hybrid",
      onlineText: "Club Discord",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });
    expect(await screen.findByText("Club Discord")).toBeInTheDocument();
    expect(screen.getByText("Room B12")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Join on Google Meet" }),
    ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
  });

  it("shows the email line, the tiles and the people once invites are out", async () => {
    setup(
      { ...meetingFixture, status: "scheduled", startsAt: future },
      workspaceFixture,
      sentResults,
    );
    const line = await screen.findByRole("button", {
      name: "Emails: 29 sent · 1 not delivered",
    });
    expect(screen.getByRole("button", { name: "Late 4" })).toBeInTheDocument();
    expect(await screen.findByText("Bus from campus")).toBeInTheDocument();
    line.click();
    expect(
      await screen.findByRole("dialog", { name: "Email delivery" }),
    ).toBeInTheDocument();
  });

  it("filters the people by the pressed tile", async () => {
    const fetchMock = setup(
      { ...meetingFixture, status: "scheduled", startsAt: future },
      workspaceFixture,
      sentResults,
    );
    (await screen.findByRole("button", { name: "Late 4" })).click();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("filter=late"),
        ),
      ).toBe(true),
    );
  });
});
