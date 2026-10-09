import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { NextMeetingCard } from "./next-meeting-card";

const url = "GET /api/workspaces/club-ab12/meetings?tab=upcoming&limit=1";
const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
const meeting = {
  id: MEETING_IDS.meeting,
  title: "Weekly sync",
  startsAt: soon,
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "scheduled",
  locationMode: "in_person",
  responseMode: "attendance",
  counts: {
    invited: 30,
    sent: 30,
    queued: 0,
    attending: 17,
    late: 4,
    absent: 3,
    noReply: 6,
  },
};

describe("NextMeetingCard", () => {
  it("shows the next meeting with its answers", async () => {
    routeFetch({ [url]: json({ items: [meeting], nextCursor: null }) });
    renderWithProviders(<NextMeetingCard slug="club-ab12" />);
    expect(
      await screen.findByRole("link", { name: "Weekly sync" }),
    ).toHaveAttribute("href", `/w/club-ab12/meetings/${MEETING_IDS.meeting}`);
    expect(
      screen.getByText("17 going · 4 late · 6 no reply"),
    ).toBeInTheDocument();
    expect(screen.getByText("Next meeting")).toBeInTheDocument();
  });

  it("shows nothing without an upcoming meeting", async () => {
    const fetchMock = routeFetch({
      [url]: json({ items: [], nextCursor: null }),
    });
    const { container } = renderWithProviders(
      <NextMeetingCard slug="club-ab12" />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalled();
    expect(container.querySelector("section")).toBeNull();
  });
});
