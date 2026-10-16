import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { senderFixture } from "@/test/fixtures/sender";
import { downloadBlob } from "@/lib/export/download";
import type { Roster } from "@/shared/api/roster";
import MeetingPage from "./page";

vi.mock("@/lib/export/download", () => ({ downloadBlob: vi.fn() }));

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
    [`GET ${meetingBase}/people?filter=all&limit=100`]: json({
      items: peopleFixture,
      nextCursor: null,
    }),
    [`GET ${base}/contacts`]: json(exportRoster),
    [`GET ${base}/sender`]: json(senderFixture()),
  });
  renderWithProviders(<MeetingPage />);
  return fetchMock;
}

const DESIGN = "7a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a1";
const exportRoster = {
  contacts: [
    {
      id: MEETING_IDS.amira,
      fullName: "Amira B.",
      email: "amira@uni.tn",
      listIds: [DESIGN],
      unsubscribed: false,
      reported: false,
    },
  ],
  lists: [{ id: DESIGN, name: "Design", contactCount: 1 }],
  limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
} satisfies Roster;

const sentResults = {
  ...resultsFixture,
  emails: { total: 30, queued: 0, sent: 29, skipped: 0, failed: 1, unknown: 0 },
  answers: {
    ...resultsFixture.answers,
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

  it("exports every answer as CSV for a meeting that asks for answers", async () => {
    const user = userEvent.setup();
    setup(
      { ...meetingFixture, status: "scheduled", startsAt: future },
      workspaceFixture,
      sentResults,
    );
    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "CSV" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toMatch(
      /^robotics-cd34-weekly-sync-answers-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const lines = (await blob.text()).split("\r\n");
    expect(lines[0]).toContain(
      "Name,Email,Lists,Answer,Late by (min),Reason,Comment,Answered at,After the deadline,Email,Checked in,Checked in by,Was late by (min)",
    );
    expect(lines[1]).toMatch(
      /^Amira B\.,amira@uni\.tn,Design,[^,]+,20,Bus from campus,,[^,]+,Yes,Sent,,,$/,
    );
    expect(lines[2]).toMatch(/^Youssef K\.,youssef@uni\.tn,,,,,,,,Failed,,,$/);
  });

  it("offers no Export for an announcement", async () => {
    setup(
      {
        ...meetingFixture,
        status: "scheduled",
        startsAt: future,
        responseMode: "announcement",
      },
      workspaceFixture,
      { ...sentResults, responseMode: "announcement" },
    );
    expect(
      await screen.findByRole("button", { name: /^Emails:/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  });

  it("says when a meeting was cancelled, with no Invite more or Nudge (M6)", async () => {
    setup({
      ...meetingFixture,
      status: "cancelled",
      startsAt: future,
      cancelledAt: "2026-10-09T08:00:00.000Z",
    });
    expect(
      await screen.findByText("Cancelled on Fri 9 Oct"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Meeting actions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Invite more people" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
  });

  it("offers Results / Check-in after the start to people who can check in (M6)", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    setup({ ...meetingFixture, status: "scheduled", startsAt: past });
    expect(
      await screen.findByRole("radio", { name: "Check-in" }),
    ).toBeInTheDocument();
  });

  it("lets a Viewer with check-in switch, but not a plain Viewer", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    setup(
      { ...meetingFixture, status: "scheduled", startsAt: past },
      { ...workspaceFixture, myRole: "viewer", canCheckIn: true },
    );
    expect(
      await screen.findByRole("radio", { name: "Check-in" }),
    ).toBeInTheDocument();
  });

  it("has no check-in before the start, for announcements or plain Viewers", async () => {
    setup({ ...meetingFixture, status: "scheduled", startsAt: future });
    await screen.findByRole("heading", { level: 1, name: "Weekly sync" });
    expect(screen.queryByRole("radio", { name: "Check-in" })).toBeNull();
  });
});
