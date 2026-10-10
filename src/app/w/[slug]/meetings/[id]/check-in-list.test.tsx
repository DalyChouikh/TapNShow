import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RESULTS_POLL_MS } from "@/config/responses";
import { json, routeFetch } from "@/test/fetch";
import {
  meetingFixture,
  MEETING_IDS,
  peopleFixture,
  resultsFixture,
} from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import type { PersonRow } from "@/shared/api/responses";
import { CheckInList } from "./check-in-list";

const base = `/api/workspaces/club-ab12/meetings/${MEETING_IDS.meeting}`;
const [amira] = peopleFixture;
const answer = {
  delayMinutes: null,
  reason: "",
  comment: "",
  afterDeadline: false,
  updatedAt: "2026-10-09T10:00:00.000Z",
  needsReconfirmation: false,
};
const people: PersonRow[] = [
  {
    ...amira,
    inviteeId: "00000000-0000-4000-8000-0000000000a1",
    fullName: "Amira",
    answer: { ...answer, status: "attending" },
    mark: null,
  },
  {
    ...amira,
    inviteeId: "00000000-0000-4000-8000-0000000000b2",
    fullName: "Bilel",
    answer: { ...answer, status: "late", delayMinutes: 10 },
    mark: null,
  },
  {
    ...amira,
    inviteeId: "00000000-0000-4000-8000-0000000000c3",
    fullName: "Chiraz",
    answer: null,
    mark: null,
  },
];
const started = {
  ...meetingFixture,
  status: "scheduled" as const,
  startsAt: new Date(Date.now() - 3600_000).toISOString(),
};
const results = {
  ...resultsFixture,
  emails: { ...resultsFixture.emails, total: 3, sent: 3, queued: 0 },
  checkedIn: 1,
};

function setup(putStatus = 200, live = true) {
  const bodies: { method: string; body: string }[] = [];
  const fetchMock = routeFetch({
    [`GET ${base}/people?filter=all&limit=50`]: json({
      items: people,
      nextCursor: null,
    }),
    [`GET ${base}/people?filter=all&search=chi&limit=50`]: json({
      items: [people[2]],
      nextCursor: null,
    }),
    [`PUT ${base}/check-in`]: (init) => {
      bodies.push({ method: "PUT", body: String(init?.body) });
      const body = JSON.parse(String(init?.body));
      return putStatus === 200
        ? json({
            mark: body.actual
              ? {
                  actual: body.actual,
                  markedAt: "2026-10-09T17:05:00.000Z",
                  markedByName: "Daly",
                  lateMinutes: body.lateMinutes ?? null,
                }
              : null,
          })()
        : new Response(JSON.stringify({ error: { code: "internal" } }), {
            status: putStatus,
          });
    },
    [`POST ${base}/check-in/rest`]: () => {
      bodies.push({ method: "POST", body: "" });
      return json({ marked: 2 })();
    },
    [`GET ${base}/results`]: json(results),
  });
  renderWithProviders(
    <CheckInList
      slug="club-ab12"
      meeting={started}
      results={results}
      live={live}
    />,
    { toaster: true },
  );
  return { bodies, fetchMock };
}

const row = (name: string) =>
  screen.getByRole("group", { name: `Check-in for ${name}` });

describe("CheckInList", () => {
  it("refreshes the list only while the meeting is near (review)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const listCalls = (fetchMock: ReturnType<typeof setup>["fetchMock"]) =>
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith("/people?filter=all&limit=50"),
        ).length;
      const { fetchMock } = setup(200, false);
      await screen.findByText("Amira");
      await vi.advanceTimersByTimeAsync(RESULTS_POLL_MS * 2);
      expect(listCalls(fetchMock)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers Present / Late / Absent per person, hinting what they said", async () => {
    setup();
    await screen.findByText("Amira");
    const present = within(row("Amira")).getByRole("button", {
      name: "Present",
    });
    expect(present).toHaveAttribute("aria-pressed", "false");
    expect(present.className).toContain("border-dashed");
    expect(screen.getByText("1 of 3 checked in")).toBeInTheDocument();
  });

  it("marks at once, says what the person had said, and clears on a second tap", async () => {
    const { bodies } = setup();
    await screen.findByText("Amira");
    const absent = within(row("Amira")).getByRole("button", { name: "Absent" });
    await userEvent.click(absent);
    expect(absent).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Said going")).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(JSON.parse(bodies[0].body)).toEqual({
        inviteeId: people[0].inviteeId,
        actual: "absent",
        lateMinutes: null,
      }),
    );
    await userEvent.click(absent);
    await vi.waitFor(() =>
      expect(JSON.parse(bodies[1].body)).toEqual({
        inviteeId: people[0].inviteeId,
        actual: null,
        lateMinutes: null,
      }),
    );
  });

  it("asks how late, from the meeting's choices or a custom number (owner feedback #257)", async () => {
    const { bodies } = setup();
    await screen.findByText("Bilel");
    const lastBody = () => JSON.parse(bodies.at(-1)?.body ?? "{}");
    // Bilel said "Late by 10 min": Late keeps his minutes.
    await userEvent.click(
      within(row("Bilel")).getByRole("button", { name: "Late" }),
    );
    await vi.waitFor(() =>
      expect(lastBody()).toEqual({
        inviteeId: people[1].inviteeId,
        actual: "late",
        lateMinutes: 10,
      }),
    );
    const minutes = await screen.findByRole("group", {
      name: "How late was Bilel?",
    });
    expect(
      within(minutes).getByRole("button", { name: "10 min" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      within(minutes).getByRole("button", { name: "15 min" }),
    );
    await vi.waitFor(() =>
      expect(lastBody()).toMatchObject({ lateMinutes: 15 }),
    );
    await userEvent.click(
      within(minutes).getByRole("button", { name: "Other" }),
    );
    const custom = screen.getByLabelText("Minutes late");
    await userEvent.type(custom, "300{Enter}");
    expect(screen.getByText("Enter 1 to 240 minutes.")).toBeInTheDocument();
    const sent = bodies.length;
    await userEvent.clear(custom);
    await userEvent.type(custom, "25{Enter}");
    await vi.waitFor(() =>
      expect(lastBody()).toMatchObject({ lateMinutes: 25 }),
    );
    expect(bodies).toHaveLength(sent + 1);
  });

  it("marks the rest after asking", async () => {
    const { bodies } = setup();
    await screen.findByText("Amira");
    await userEvent.click(
      screen.getByRole("button", { name: "Mark the rest as they said" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Mark everyone not checked in yet?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "People are marked from their answer. People who didn't answer are marked Absent.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Mark the rest" }),
    );
    expect(await screen.findByText("Marked 2 people.")).toBeInTheDocument();
    expect(bodies.filter((b) => b.method === "POST")).toHaveLength(1);
  });

  it("searches people by name", async () => {
    setup();
    await screen.findByText("Amira");
    await userEvent.type(screen.getByLabelText("Search people"), "chi");
    expect(await screen.findByText("Chiraz")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText("Amira")).toBeNull());
  });

  it("puts the chip back and says so when saving fails", async () => {
    setup(500);
    await screen.findByText("Amira");
    const late = within(row("Bilel")).getByRole("button", { name: "Late" });
    await userEvent.click(late);
    expect(
      await screen.findByText("Couldn't save. Try again."),
    ).toBeInTheDocument();
    expect(late).toHaveAttribute("aria-pressed", "false");
  });
});
