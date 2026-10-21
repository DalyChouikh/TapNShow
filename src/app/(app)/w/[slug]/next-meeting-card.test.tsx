import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addMinutes, format } from "date-fns";
import { describe, expect, it } from "vitest";
import { formatDeadline, formatMeetingWhen } from "@/lib/meetings/format";
import type { Meeting, MeetingSummary } from "@/shared/api/meetings";
import type { MeetingResults } from "@/shared/api/responses";
import { type FetchRoute, json, routeFetch } from "@/test/fetch";
import { meetingFixture, resultsFixture } from "@/test/fixtures/meetings";
import { senderFixture } from "@/test/fixtures/sender";
import { renderWithProviders } from "@/test/render";
import { NextMeetingCard } from "./next-meeting-card";

// The reminder button checks "started" against the real clock, so times are relative to it.
const NOW = new Date();
const at = (minutes: number) => addMinutes(NOW, minutes).toISOString();
const DAY = 24 * 60;
const base = "/api/workspaces/club-ab12";
const LIST = `GET ${base}/meetings?tab=upcoming&limit=1`;
const SECOND_ID = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    ...meetingFixture,
    status: "scheduled",
    sentAt: at(-DAY),
    startsAt: at(2 * DAY),
    ...overrides,
  };
}

function summary(of: Meeting): MeetingSummary {
  return {
    id: of.id,
    title: of.title,
    startsAt: of.startsAt,
    timezone: of.timezone,
    durationMinutes: of.durationMinutes,
    status: of.status,
    locationMode: of.locationMode,
    responseMode: of.responseMode,
    counts: {
      invited: 30,
      sent: 30,
      queued: 0,
      attending: 12,
      late: 6,
      absent: 6,
      noReply: 6,
    },
  };
}

function results(overrides: Partial<MeetingResults> = {}): MeetingResults {
  return {
    ...resultsFixture,
    emails: {
      total: 30,
      queued: 0,
      sent: 30,
      skipped: 0,
      failed: 0,
      unknown: 0,
    },
    answers: {
      attending: 12,
      late: 6,
      absent: 6,
      notAttending: 0,
      noReply: 6,
      calendarRequested: 0,
      toReconfirm: 0,
      remindable: 6,
      reachable: 30,
    },
    ...overrides,
  };
}

const page = (...meetings: Meeting[]) =>
  json({ items: meetings.map(summary), nextCursor: null });

function serve(
  shown: Meeting | null,
  options: {
    results?: MeetingResults;
    list?: FetchRoute;
    sender?: boolean;
  } = {},
) {
  return routeFetch({
    [LIST]: options.list ?? (shown ? page(shown) : page()),
    [`GET ${base}/sender`]: json(senderFixture(options.sender ?? true)),
    ...(shown
      ? {
          [`GET ${base}/meetings/${shown.id}`]: json(shown),
          [`GET ${base}/meetings/${shown.id}/results`]: json(
            options.results ?? results(),
          ),
        }
      : {}),
  });
}

const card = (
  props: { canManage?: boolean; now?: Date; suspended?: boolean } = {},
) => (
  <NextMeetingCard
    slug="club-ab12"
    canManage={props.canManage ?? true}
    canConnect={false}
    now={props.now ?? NOW}
    sendingSuspended={props.suspended ?? false}
  />
);

describe("NextMeetingCard", () => {
  it("shows when, how long until, where, the tiles and how many answered", async () => {
    const next = meeting();
    serve(next);
    renderWithProviders(card());
    expect(
      await screen.findByRole("link", { name: "Weekly sync" }),
    ).toHaveAttribute("href", `/w/club-ab12/meetings/${next.id}`);
    expect(
      screen.getByRole("heading", { name: "Next meeting" }),
    ).toBeInTheDocument();
    const when = formatMeetingWhen({ ...next, startsAt: at(2 * DAY) });
    expect(
      screen.getByText(`${when.date}, ${when.start}–${when.end}`),
    ).toBeInTheDocument();
    expect(screen.getByText("in 2 days")).toBeInTheDocument();
    expect(screen.getByText("Room B12")).toBeInTheDocument();
    expect(
      await screen.findByRole("group", { name: "Answers" }),
    ).toHaveTextContent("Going12Late6Absent6No reply6");
    expect(screen.queryByRole("button", { name: /^Going/ })).toBeNull();
    expect(screen.getByText("24 of 30 answered")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Answered" }),
    ).toHaveAttribute("aria-valuenow", "24");
    expect(screen.getByRole("link", { name: "Open meeting" })).toHaveAttribute(
      "href",
      `/w/club-ab12/meetings/${next.id}`,
    );
  });

  it("says when answers close, and that they closed", async () => {
    const closing = meeting({ responseDeadline: at(DAY) });
    serve(closing);
    const first = renderWithProviders(card());
    expect(
      await screen.findByText(
        `24 of 30 answered, answers close ${formatDeadline(at(DAY), "Africa/Tunis")}`,
      ),
    ).toBeInTheDocument();
    first.unmount();

    const closed = meeting({ responseDeadline: at(-60) });
    serve(closed);
    renderWithProviders(card());
    expect(
      await screen.findByText(
        `24 of 30 answered, answers closed ${formatDeadline(at(-60), "Africa/Tunis")}`,
      ),
    ).toBeInTheDocument();
  });

  it("shows an online meeting's place as Online", async () => {
    serve(meeting({ locationMode: "online", locationText: "" }));
    renderWithProviders(card());
    expect(await screen.findByText("Online")).toBeInTheDocument();
  });

  it("says Now and hides the reminder while the meeting is in progress", async () => {
    serve(meeting({ startsAt: at(-10) }));
    renderWithProviders(card());
    expect(await screen.findByText("Now")).toBeInTheDocument();
    await screen.findByRole("group", { name: "Answers" });
    expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open meeting" })).toHaveClass(
      "bg-fill-primary",
    );
  });

  it("shows Sending invites while invites are queued", async () => {
    serve(meeting(), {
      results: results({
        emails: {
          total: 30,
          queued: 18,
          sent: 12,
          skipped: 0,
          failed: 0,
          unknown: 0,
        },
      }),
    });
    renderWithProviders(card());
    expect(
      await screen.findByText("Sending invites: 12 of 30"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Invites sent" }),
    ).toHaveAttribute("aria-valuenow", "12");
    expect(screen.queryByText(/of 30 answered/)).toBeNull();
  });

  it("shows RSVP tiles and no tiles for an announcement", async () => {
    serve(meeting({ responseMode: "rsvp" }), {
      results: results({ responseMode: "rsvp" }),
    });
    const rsvp = renderWithProviders(card());
    expect(
      await screen.findByRole("group", { name: "Answers" }),
    ).toHaveTextContent("Going12Not going0No reply6");
    rsvp.unmount();

    serve(meeting({ responseMode: "announcement" }), {
      results: results({ responseMode: "announcement" }),
    });
    renderWithProviders(card());
    expect(
      await screen.findByText("Nobody asked for a calendar invite yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Answers" })).toBeNull();
    expect(screen.queryByText(/of 30 answered/)).toBeNull();
  });

  it("shows the reminder only to Owners and Admins", async () => {
    serve(meeting());
    const managing = renderWithProviders(card());
    expect(
      await screen.findByRole("button", {
        name: "Remind 6 who haven't answered",
      }),
    ).toBeInTheDocument();
    managing.unmount();

    serve(meeting());
    renderWithProviders(card({ canManage: false }));
    await screen.findByRole("group", { name: "Answers" });
    expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
  });

  it("offers New meeting when nothing is coming up, but not to Viewers", async () => {
    serve(null, { sender: false });
    const managing = renderWithProviders(card());
    expect(
      await screen.findByText("No meeting coming up."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New meeting" })).toHaveAttribute(
      "href",
      "/w/club-ab12/meetings/new",
    );
    expect(
      await screen.findByText(
        "Create one now; you can send it once Gmail is connected.",
      ),
    ).toBeInTheDocument();
    managing.unmount();

    serve(null, { sender: false });
    renderWithProviders(card({ canManage: false }));
    expect(
      await screen.findByText("No meeting coming up."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New meeting" })).toBeNull();
    expect(screen.queryByText(/Create one now/)).toBeNull();
  });

  it("moves on to the next meeting once this one ends", async () => {
    const current = meeting({ startsAt: at(-30), durationMinutes: 60 });
    const following = meeting({
      id: SECOND_ID,
      title: "Planning",
      startsAt: at(7 * DAY),
    });
    let listCalls = 0;
    routeFetch({
      [LIST]: () => {
        listCalls += 1;
        return new Response(
          JSON.stringify({
            items: [summary(listCalls === 1 ? current : following)],
            nextCursor: null,
          }),
        );
      },
      [`GET ${base}/sender`]: json(senderFixture()),
      [`GET ${base}/meetings/${current.id}`]: json(current),
      [`GET ${base}/meetings/${current.id}/results`]: json(results()),
      [`GET ${base}/meetings/${SECOND_ID}`]: json(following),
      [`GET ${base}/meetings/${SECOND_ID}/results`]: json(results()),
    });
    const { rerender } = renderWithProviders(card());
    expect(await screen.findByText("Now")).toBeInTheDocument();

    rerender(card({ now: addMinutes(NOW, 31) }));

    expect(
      await screen.findByRole("link", { name: "Planning" }),
    ).toBeInTheDocument();
    expect(listCalls).toBe(2);
  });

  it("offers to try again when the next meeting can't load", async () => {
    let listCalls = 0;
    const next = meeting();
    serve(next, {
      list: () => {
        listCalls += 1;
        return listCalls === 1
          ? new Response(JSON.stringify({ error: { code: "forbidden" } }), {
              status: 403,
            })
          : new Response(
              JSON.stringify({ items: [summary(next)], nextCursor: null }),
            );
      },
    });
    renderWithProviders(card());
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Weekly sync" }),
      ).toBeInTheDocument(),
    );
  });

  it("says sending is paused instead of Sending invites (#417)", async () => {
    const queued = {
      total: 30,
      queued: 18,
      sent: 12,
      skipped: 0,
      failed: 0,
      unknown: 0,
    };
    serve(meeting(), {
      results: results({ emails: queued, paused: 18, senderState: "broken" }),
    });
    const { unmount } = renderWithProviders(card());
    expect(
      await screen.findByText("Paused: Gmail needs reconnecting."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Sending invites/)).toBeNull();
    unmount();

    serve(meeting(), { results: results({ emails: queued }) });
    const suspended = renderWithProviders(card({ suspended: true }));
    expect(
      await screen.findByText(
        "Sending is paused while TapNShow reviews reports about this workspace.",
      ),
    ).toBeInTheDocument();
    suspended.unmount();

    const resumesAt = addMinutes(NOW, 40);
    serve(meeting(), {
      results: results({ emails: queued, resumesAt: resumesAt.toISOString() }),
    });
    renderWithProviders(card());
    expect(
      await screen.findByText(
        `18 queued, resumes about ${format(resumesAt, "HH:mm")}`,
      ),
    ).toBeInTheDocument();
  });

  it("keeps a meeting someone made longer on another device (#417)", async () => {
    const current = meeting({ startsAt: at(-30), durationMinutes: 60 });
    let detailCalls = 0;
    routeFetch({
      [LIST]: page(current),
      [`GET ${base}/sender`]: json(senderFixture()),
      [`GET ${base}/meetings/${current.id}`]: () => {
        detailCalls += 1;
        return new Response(
          JSON.stringify(
            detailCalls === 1 ? current : { ...current, durationMinutes: 120 },
          ),
        );
      },
      [`GET ${base}/meetings/${current.id}/results`]: json(results()),
    });
    const { rerender } = renderWithProviders(card());
    expect(await screen.findByText("Now")).toBeInTheDocument();
    // Its first end has passed here, but the server still lists it: it was made longer.
    rerender(card({ now: addMinutes(NOW, 31) }));
    await waitFor(() => expect(detailCalls).toBe(2));
    expect(
      await screen.findByRole("link", { name: current.title }),
    ).toBeInTheDocument();
  });

  it("turns to Now when the meeting starts while Home is open (#417)", async () => {
    const soon = meeting({ startsAt: at(5) });
    serve(soon);
    const { rerender } = renderWithProviders(card());
    expect(await screen.findByText("in 5 minutes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Remind/ })).toBeInTheDocument();
    rerender(card({ now: addMinutes(NOW, 6) }));
    expect(await screen.findByText("Now")).toBeInTheDocument();
  });
});
