import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import {
  meetingFixture,
  MEETING_IDS,
  progressFixture,
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

function setup(meeting: object, workspace = workspaceFixture) {
  routeFetch({
    [`GET ${base}`]: json(workspace),
    [`GET ${base}/meetings/${MEETING_IDS.meeting}`]: json(meeting),
    [`GET ${base}/meetings/${MEETING_IDS.meeting}/progress`]:
      json(progressFixture),
  });
  renderWithProviders(<MeetingPage />);
}

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
});
